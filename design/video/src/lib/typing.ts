import { random } from 'remotion/no-react'

/** When each character of `text` appears, in (fractional) frames: the first at `start`, the last
 * exactly at `end`. Keys aren't evenly spaced — a seeded jitter, a beat after each word and a longer
 * one after punctuation — so it reads as someone typing rather than a ticker. */
export function typingSchedule(text: string, start: number, end: number, seed: string): number[] {
  const n = text.length
  if (n === 0) return []
  if (n === 1) return [start]
  const gaps = Array.from({ length: n - 1 }, (_, k) => {
    const prev = text[k]
    return 0.6 + 0.8 * random(`${seed}-${k}`) + (prev === ' ' ? 1.5 : 0) + (/[.,;:!?]/.test(prev) ? 3 : 0)
  })
  const total = gaps.reduce((a, b) => a + b, 0)
  const times = [start]
  let acc = 0
  for (const g of gaps) {
    acc += g
    times.push(start + ((end - start) * acc) / total)
  }
  times[n - 1] = end
  return times
}

/** What has been typed by `frame`, and when the last key went down (for the caret, which stays
 * solid while typing and blinks once it stops). */
export function typedAt(frame: number, text: string, schedule: number[]): { text: string; lastKey: number | null } {
  let n = 0
  while (n < schedule.length && schedule[n] <= frame) n++
  return { text: text.slice(0, n), lastKey: n > 0 ? schedule[n - 1] : null }
}

/** A text caret: solid for 500 ms after a key, then Chrome's 500 ms on, 500 ms off. */
export function caretVisible(frame: number, lastKey: number | null, fps: number): boolean {
  const since = frame - (lastKey ?? -Infinity)
  const half = fps / 2
  if (since < half) return true
  const sinceIdle = lastKey === null ? frame : since - half
  return Math.floor(sinceIdle / half) % 2 === 1
}
