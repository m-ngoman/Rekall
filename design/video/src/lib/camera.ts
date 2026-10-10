import type { CameraKey } from '../timeline'
import { CAMERA_EASE, clamp, lerp } from './ease'

/** Where the camera is at `frame`: between two keys, positions ease across and zoom eases in log
 * space, so a push from 1× to 2× spends as long on each doubling of detail as a pull back does.
 * Before the first key and after the last, it holds. */
export function cameraAt(frame: number, keys: readonly CameraKey[]): { x: number; y: number; z: number } {
  if (keys.length === 0) throw new Error('A camera needs at least one key')
  if (frame <= keys[0].f) return keys[0]
  for (let k = 1; k < keys.length; k++) {
    const [a, b] = [keys[k - 1], keys[k]]
    if (frame < b.f) {
      const e = CAMERA_EASE(clamp((frame - a.f) / (b.f - a.f)))
      return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), e)) }
    }
  }
  return keys[keys.length - 1]
}

/** The transform that puts replica point (x, y) at the middle of a `viewW × viewH` view, at
 * `base × z` scale, kept from showing past the replica's own edges. */
export function cameraTransform(
  cam: { x: number; y: number; z: number },
  replica: { width: number; height: number },
  view: { width: number; height: number },
  base: number,
): { scale: number; tx: number; ty: number } {
  const scale = base * cam.z
  const halfW = view.width / 2 / scale
  const halfH = view.height / 2 / scale
  const fit = (v: number, half: number, size: number) => (half * 2 >= size ? size / 2 : clamp(v, half, size - half))
  const x = fit(cam.x, halfW, replica.width)
  const y = fit(cam.y, halfH, replica.height)
  return { scale, tx: view.width / 2 - x * scale, ty: view.height / 2 - y * scale }
}
