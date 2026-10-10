import { FPS } from '../timeline'

/** CSS's cubic-bezier(), solved the way browsers solve it: Newton's method on x(t), bisection when
 * that stalls. The replicas animate with the app's own curves, so these have to be the real thing,
 * not an approximation that merely looks close. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const solve = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-7) return t
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 64; i++) {
      const v = sampleX(t)
      if (Math.abs(v - x) < 1e-7) break
      if (x > v) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)))
}

/** focus-word-pop, focus-line-in (index.css) and the sliding pill's width (useSlidingPill). */
export const APP_EASE = cubicBezier(0.22, 1, 0.36, 1)
/** The orb growing out of the mic button (TutorScreen's FLIP). */
export const FLIP_EASE = cubicBezier(0.16, 1, 0.3, 1)
/** CSS `ease`: focus-line-fade. */
export const CSS_EASE = cubicBezier(0.25, 0.1, 0.25, 1)
/** CSS `ease-out`: node-loader-in. */
export const EASE_OUT = cubicBezier(0, 0, 0.58, 1)
/** Tailwind's default transition curve: the focus overlay's opacity and the stage's rise. */
export const TW_EASE = cubicBezier(0.4, 0, 0.2, 1)
/** Tailwind's animate-pulse. */
export const PULSE_EASE = cubicBezier(0.4, 0, 0.6, 1)
/** The video's own camera, and only the camera: slow in, slow out, like a hand on a slider. */
export const CAMERA_EASE = cubicBezier(0.65, 0, 0.35, 1)

export const framesToMs = (frames: number) => (frames / FPS) * 1000
export const msToFrames = (ms: number) => (ms / 1000) * FPS
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))

/** 0 → 1 across `length` frames from `from`, eased, held at either end. */
export function progress(frame: number, from: number, length: number, ease: (x: number) => number = APP_EASE): number {
  if (length <= 0) return frame >= from ? 1 : 0
  return ease(clamp((frame - from) / length))
}
