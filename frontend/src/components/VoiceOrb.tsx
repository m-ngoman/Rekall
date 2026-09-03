import { useEffect, useRef } from 'react'

export type OrbState = 'idle' | 'waiting' | 'listening' | 'thinking' | 'speaking'

interface Props {
  state: OrbState
  getAnalyser: () => AnalyserNode | null
  size?: number
}

// Ported from the planning doc's original orb prototype (docs/reference-adjacent voice-orb.html):
// multi-band jagged rings reacting per frequency band, not a single averaged pulse, plus a scope-
// style tick ring around the outside. Tuned for a ~140-200px render size rather than the
// prototype's 520px canvas — its exact pixel constants would be too fine/cluttered this small.
const BAND_COUNT = 64
const TICK_COUNT = 40
const RING_COUNT = 7
const SMOOTHING = 0.22

export default function VoiceOrb({ state, getAnalyser, size = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const getAnalyserRef = useRef(getAnalyser)
  getAnalyserRef.current = getAnalyser
  const scale = size / 200

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const baseR = 52 * scale

    const bands = new Float32Array(BAND_COUNT)
    const targetBands = new Float32Array(BAND_COUNT)
    let t = 0
    let raf = 0

    const updateSimulatedBands = (s: OrbState) => {
      for (let i = 0; i < BAND_COUNT; i++) {
        const phase = t * 0.001 + i * 0.15
        if (s === 'idle') {
          targetBands[i] = 0.06 + Math.sin(phase * 0.5) * 0.03
        } else if (s === 'waiting') {
          // Between turns with the mic open but nothing being sent anywhere: awake, not eager.
          // Only reached before the analyser is available — normally `waiting` shows real room
          // amplitude, which is the honest picture of a mic that is genuinely open.
          targetBands[i] = 0.09 + Math.sin(phase * 0.8) * 0.05
        } else if (s === 'thinking') {
          targetBands[i] = 0.12 + Math.sin(phase * 1.3 + i) * 0.08 + 0.05 * Math.sin(t * 0.004)
        } else {
          // listening/speaking without a live analyser yet (e.g. permission still resolving)
          const env = 0.25 + Math.sin(t * 0.003) * 0.12
          targetBands[i] = Math.max(0, env + (Math.random() - 0.5) * 0.3)
        }
      }
    }

    const readAnalyserBands = (analyser: AnalyserNode) => {
      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(data)
      for (let i = 0; i < BAND_COUNT; i++) {
        // biased toward the lower ~70% of the spectrum, roughly where voice energy concentrates
        const idx = Math.floor((i / BAND_COUNT) * data.length * 0.7)
        targetBands[i] = data[idx] / 255
      }
    }

    const draw = () => {
      const s = stateRef.current
      ctx.clearRect(0, 0, size, size)

      const analyser = s === 'listening' || s === 'waiting' || s === 'speaking' ? getAnalyserRef.current() : null
      if (analyser) readAnalyserBands(analyser)
      else updateSimulatedBands(s)

      for (let i = 0; i < BAND_COUNT; i++) {
        bands[i] += (targetBands[i] - bands[i]) * SMOOTHING
      }
      let avg = 0
      for (let i = 0; i < BAND_COUNT; i++) avg += bands[i]
      avg /= BAND_COUNT

      // Read the accent off the canvas's own `color` rather than the raw custom property: in the
      // light theme --accent is a relative-colour expression, and this is the resolved colour.
      const accent = getComputedStyle(canvas).color

      // outer glow
      const glowR = baseR + 25 * scale + avg * 41 * scale
      const glow = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, glowR)
      glow.addColorStop(0, accent)
      glow.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.22 + avg * 0.25
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
      ctx.fill()

      // frequency rings — each a closed jagged loop, radius modulated per-band by amplitude
      for (let ring = 0; ring < RING_COUNT; ring++) {
        const ringR = baseR - ring * 4.8 * scale
        const ringAlpha = 0.85 - ring * 0.1
        ctx.beginPath()
        for (let i = 0; i <= BAND_COUNT; i++) {
          const idx = i % BAND_COUNT
          const angle = (i / BAND_COUNT) * Math.PI * 2 - Math.PI / 2
          const wobble =
            s === 'idle'
              ? Math.sin(t * 0.0015 + idx * 0.3) * 2.7 * scale
              : bands[idx] * (19 - ring * 1.9) * scale
          const rr = ringR + wobble + Math.sin(t * 0.001 + ring) * 2.7 * scale
          const x = cx + Math.cos(angle) * rr
          const y = cy + Math.sin(angle) * rr
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.globalAlpha = ringAlpha
        ctx.strokeStyle = accent
        ctx.lineWidth = (ring === 0 ? 1.4 : 0.9) * scale
        ctx.stroke()
      }

      // core
      const coreR = 18 * scale + avg * 16 * scale + (s === 'idle' ? Math.sin(t * 0.0018) * 2.7 * scale : 0)
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      core.addColorStop(0, accent)
      core.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.95
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()

      // scope-style tick marks around the perimeter, reactive per band
      ctx.save()
      ctx.translate(cx, cy)
      for (let i = 0; i < TICK_COUNT; i++) {
        const angle = (i / TICK_COUNT) * Math.PI * 2
        const inner = baseR + 25 * scale
        const len = (2 + (i % 4 === 0 ? 2 : 0)) * scale
        const bandIdx = i % BAND_COUNT
        ctx.globalAlpha = 0.1 + bands[bandIdx] * 0.4
        ctx.strokeStyle = accent
        ctx.lineWidth = Math.max(1, scale)
        ctx.beginPath()
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        ctx.lineTo(Math.cos(angle) * (inner + len), Math.sin(angle) * (inner + len))
        ctx.stroke()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    }

    const loop = (ts: number) => {
      t = ts
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [size, scale])

  return <canvas ref={canvasRef} style={{ width: size, height: size, color: 'var(--accent)' }} />
}
