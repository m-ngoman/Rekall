import { APP_EASE, progress } from './ease'

/** A countdown numeral arriving: each digit rises into place from below its own line, a few frames
 * after the one before. Returned per digit as the fraction of its height still to travel. */
export function digitRise(frame: number, start: number, digits: number, stagger = 3, length = 12): number[] {
  return Array.from({ length: digits }, (_, j) => 1 - progress(frame, start + j * stagger, length, APP_EASE))
}
