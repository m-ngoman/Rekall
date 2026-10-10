import { CAMERA_EASE, clamp, lerp } from './ease'

export interface Point {
  x: number
  y: number
}

/** A pointer moving from `from` to `to` between two frames: eased, on a shallow arc — a hand on a
 * trackpad doesn't travel in a ruled line — and landing exactly on the target. */
export function pointerAt(frame: number, from: Point, to: Point, start: number, arrive: number): Point {
  const e = CAMERA_EASE(clamp((frame - start) / Math.max(1, arrive - start)))
  const bow = Math.sin(Math.PI * e) * 0.08 * Math.hypot(to.x - from.x, to.y - from.y)
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const len = Math.hypot(dx, dy) || 1
  return { x: lerp(from.x, to.x, e) + (-dy / len) * bow, y: lerp(from.y, to.y, e) + (dx / len) * bow }
}

/** A press: the pointer dips for 3 frames, and the control under it takes the app's own :active
 * filter (brightness 0.92 with a mouse, 0.9 with a finger — index.css) for as long. */
export function pressed(frame: number, press: number, frames = 3): boolean {
  return frame >= press && frame < press + frames
}
