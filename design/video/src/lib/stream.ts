import { random } from 'remotion/no-react'

/** A streamed reply, as the app receives it: a few words per event, each appended as it arrives.
 * Returns the character count on screen after each event and the frame it lands on; the first at
 * `start`, the last at `end`, deterministic for a seed. */
export function streamSchedule(text: string, start: number, end: number, seed: string): { chars: number; frame: number }[] {
  const words = text.split(/(?<=\s)/) // keep each word's trailing space with it
  const events: number[] = []
  let at = 0
  let k = 0
  while (at < words.length) {
    const take = 1 + Math.floor(random(`${seed}-n${k}`) * 3)
    at = Math.min(words.length, at + take)
    events.push(words.slice(0, at).join('').length)
    k++
  }
  const weights = events.map((_, i) => (i === 0 ? 0 : 0.7 + 0.6 * random(`${seed}-g${i}`)))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  return events.map((chars, i) => {
    acc += weights[i]
    return { chars, frame: i === events.length - 1 ? end : start + ((end - start) * acc) / total }
  })
}

export function streamedAt(frame: number, text: string, schedule: { chars: number; frame: number }[]): string {
  let chars = 0
  for (const ev of schedule) if (ev.frame <= frame) chars = ev.chars
  return text.slice(0, chars)
}
