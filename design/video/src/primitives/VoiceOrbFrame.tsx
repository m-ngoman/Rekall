import { useLayoutEffect, useRef } from 'react'
import { drawOrb, type OrbState } from '../lib/orb'

/** VoiceOrb for one frame: the app's own canvas drawing (lib/orb drawOrb), handed this frame's
 * bands instead of reading them from a live analyser in a loop. Drawn in a layout effect, so the
 * canvas is complete before the frame is captured. */
export function VoiceOrbFrame({
  bands,
  t,
  state,
  size = 200,
  resolution = 3,
}: {
  bands: Float64Array
  t: number
  state: OrbState
  size?: number
  resolution?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    drawOrb(ctx, bands, t, state, size, resolution)
  }, [bands, t, state, size, resolution])
  return (
    <canvas
      ref={ref}
      width={Math.round(size * resolution)}
      height={Math.round(size * resolution)}
      style={{ width: size, height: size, color: 'var(--accent)' }}
    />
  )
}
