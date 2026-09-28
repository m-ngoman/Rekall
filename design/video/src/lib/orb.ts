import { random } from 'remotion/no-react'
import { BIN_COUNT, byteFrequencyData } from './analyser'

/** VoiceOrb.tsx's constants — held in step by src/__tests__/drift.test.ts. */
export const BAND_COUNT = 64
export const TICK_COUNT = 40
export const RING_COUNT = 7
export const SMOOTHING = 0.22

export type OrbState = 'idle' | 'waiting' | 'listening' | 'thinking' | 'speaking'

/** What drives the orb at one moment: the state, and either a place in the voice take (the app's
 * analyser reads the reply's audio while speaking) or an amplitude envelope for a sound the video
 * has no recording of (the student asking, the room while listening). */
export interface OrbInput {
  state: OrbState
  /** Seconds into the take. */
  audioTime?: number
  /** 0-1: how much sound there is, when there is no take to analyse. */
  envelope?: number
}

export interface AudioSamples {
  samples: Float32Array
  sampleRate: number
}

/** The analyser's reading turned into the orb's 64 bands, as VoiceOrb.readAnalyserBands does it:
 * biased toward the lower ~70% of the spectrum, where voice energy sits. */
function bandsFromBytes(bytes: Uint8Array, out: Float64Array) {
  for (let i = 0; i < BAND_COUNT; i++) out[i] = bytes[Math.floor((i / BAND_COUNT) * bytes.length * 0.7)] / 255
}

/** VoiceOrb.updateSimulatedBands, with its one Math.random replaced by a seeded value per band and
 * per tick, so every render of a frame is the same frame. `t` is the loop's clock in ms. */
function simulatedBands(s: OrbState, t: number, tick: number, envelope: number, out: Float64Array) {
  for (let i = 0; i < BAND_COUNT; i++) {
    const phase = t * 0.001 + i * 0.15
    if (s === 'idle') out[i] = 0.06 + Math.sin(phase * 0.5) * 0.03
    else if (s === 'waiting') out[i] = 0.09 + Math.sin(phase * 0.8) * 0.05
    else if (s === 'thinking') out[i] = 0.12 + Math.sin(phase * 1.3 + i) * 0.08 + 0.05 * Math.sin(t * 0.004)
    else {
      // Listening or speaking with no recording: the app's own stand-in, shaped by the envelope
      // of the speech it stands in for.
      const env = (0.25 + Math.sin(t * 0.003) * 0.12) * envelope
      out[i] = Math.max(0, env + (random(`orb-${tick}-${i}`) - 0.5) * 0.3 * envelope)
    }
  }
}

/** The orb's bands at `t` ms. The app eases each band 22% of the way to its target every animation
 * frame, and the analyser smooths 80% over its last reading, so a frame's look depends on the ones
 * before it. Rather than carry state between video frames — which would make a frame depend on
 * which frames happened to be rendered before it — the last 48 of the app's 60 Hz ticks (0.8 s) are
 * replayed from rest every time. What that leaves out has decayed to 0.78^48 ≈ 7e-6 of its size. */
export function orbBandsAt(t: number, inputAt: (t: number) => OrbInput, audio: AudioSamples | null, steps = 48): Float64Array {
  const tickMs = 1000 / 60
  const bands = new Float64Array(BAND_COUNT)
  const target = new Float64Array(BAND_COUNT)
  const smoothed = new Float64Array(BIN_COUNT)
  for (let k = steps - 1; k >= 0; k--) {
    const tk = t - k * tickMs
    const tick = Math.round(tk / tickMs)
    const input = inputAt(tk)
    if (audio && input.audioTime !== undefined && (input.state === 'speaking' || input.state === 'listening')) {
      const end = Math.round(input.audioTime * audio.sampleRate)
      bandsFromBytes(byteFrequencyData(audio.samples, end, smoothed), target)
    } else {
      smoothed.fill(0)
      simulatedBands(input.state, tk, tick, input.envelope ?? 1, target)
    }
    for (let i = 0; i < BAND_COUNT; i++) bands[i] += (target[i] - bands[i]) * SMOOTHING
  }
  return bands
}

/** VoiceOrb's draw(), with the bands passed in rather than read from its loop, and the canvas
 * drawn at `resolution` device pixels per CSS pixel — the replica is scaled up for the video, so a
 * 1× canvas would be upscaled soft. Everything else is the app's code as it is: glow, seven jagged
 * rings, core and scope ticks, in the accent read off the canvas's own `color`. */
export function drawOrb(ctx: CanvasRenderingContext2D, bands: Float64Array, t: number, s: OrbState, size: number, resolution: number) {
  const scale = size / 200
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0)
  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2
  const baseR = 52 * scale

  let avg = 0
  for (let i = 0; i < BAND_COUNT; i++) avg += bands[i]
  avg /= BAND_COUNT

  const accent = getComputedStyle(ctx.canvas).color

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

  // frequency rings
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const ringR = baseR - ring * 4.8 * scale
    const ringAlpha = 0.85 - ring * 0.1
    ctx.beginPath()
    for (let i = 0; i <= BAND_COUNT; i++) {
      const idx = i % BAND_COUNT
      const angle = (i / BAND_COUNT) * Math.PI * 2 - Math.PI / 2
      const wobble = s === 'idle' ? Math.sin(t * 0.0015 + idx * 0.3) * 2.7 * scale : bands[idx] * (19 - ring * 1.9) * scale
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

  // scope ticks
  ctx.save()
  ctx.translate(cx, cy)
  for (let i = 0; i < TICK_COUNT; i++) {
    const angle = (i / TICK_COUNT) * Math.PI * 2
    const inner = baseR + 25 * scale
    const len = (2 + (i % 4 === 0 ? 2 : 0)) * scale
    ctx.globalAlpha = 0.1 + bands[i % BAND_COUNT] * 0.4
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
