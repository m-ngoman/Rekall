import { APP_EASE, cubicBezier, lerp, msToFrames, progress } from './ease'

/** useSlidingPill's motion, from the moment the active option changes. The travel and the stretch
 * are separate clocks there (translate and scale are separate CSS properties) and so they are here:
 * the pill travels for 400 ms on an overshooting curve while it stretches along the way it's going
 * — quickly, 130 ms — and then relaxes for 520 ms from 240 ms, giving back a little as it settles. */
const TRAVEL = cubicBezier(0.33, 1.16, 0.45, 1)
const GROW = cubicBezier(0.3, 0.9, 0.4, 1)
const RELAX = cubicBezier(0.22, 1.12, 0.36, 1)
export const STRETCH = 1.14

export function pillAt(
  frame: number,
  changedAt: number,
  from: { x: number; w: number },
  to: { x: number; w: number },
): { x: number; w: number; scaleX: number } {
  const f400 = msToFrames(400)
  const travel = progress(frame, changedAt, f400, TRAVEL)
  const width = progress(frame, changedAt, f400, APP_EASE)
  const grown = progress(frame, changedAt, msToFrames(130), GROW)
  const relaxed = progress(frame, changedAt + msToFrames(240), msToFrames(520), RELAX)
  const scaleX = frame < changedAt ? 1 : lerp(lerp(1, STRETCH, grown), 1, relaxed)
  return { x: lerp(from.x, to.x, travel), w: lerp(from.w, to.w, width), scaleX }
}
