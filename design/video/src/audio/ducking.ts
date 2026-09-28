import take from './tutor-sn1-sn2.words.json'
import { FPS } from '../timeline'

const db = (x: number) => Math.pow(10, x / 20)
/** A music bed under the video, if there is one: -16 dB, ducked to -28 dB around the voice line —
 * from 8 frames before it to 12 after, ramping over 8 — and faded out over the last `fadeOut`
 * frames. No fade in: feeds autoplay, and a bed that swells in reads as a slow start. The ramps
 * are linear in decibels, which is how loudness is heard. */
export function musicGain(frame: number, voiceStart: number, total: number, fadeOut: number): number {
  const voiceEnd = voiceStart + Math.ceil(take.duration * FPS)
  const ramp = 8
  const duckIn = voiceStart - 8
  const duckOut = voiceEnd + 12
  let level = -16
  if (frame >= duckIn - ramp && frame < duckIn) level = -16 - 12 * ((frame - (duckIn - ramp)) / ramp)
  else if (frame >= duckIn && frame < duckOut) level = -28
  else if (frame >= duckOut && frame < duckOut + ramp) level = -28 + 12 * ((frame - duckOut) / ramp)
  const fade = Math.min(1, Math.max(0, (total - frame) / fadeOut))
  return db(level) * fade
}
