import type { WordTiming } from '../types'

/** When the voice reaches each word of a sentence, in seconds into that sentence's own audio.
 *
 * Cartesia reports real per-word timings alongside the audio, so there is normally nothing to
 * estimate. Two fallbacks keep this honest rather than brittle:
 *  - counts disagree (the synthesizer normalized something — "$5" spoken as two words), so
 *    written words are mapped proportionally onto the real timings. Still anchored to the
 *    actual audio, just coarser.
 *  - no timings at all (Chatterbox), so the old letter-weighted estimate stands in, spread over
 *    `duration` when the audio's length is known. It ran up to ~0.35s ahead of the voice when
 *    measured, which is why it's the last resort.
 */
export function wordStarts(sentence: string, timings: WordTiming[], duration?: number): { word: string; start: number }[] {
  const words = sentence.split(/\s+/).filter(Boolean)

  if (timings.length === words.length) {
    return words.map((word, i) => ({ word, start: timings[i].s }))
  }
  if (timings.length > 0) {
    return words.map((word, i) => ({
      word,
      start: timings[Math.min(timings.length - 1, Math.floor((i * timings.length) / words.length))].s,
    }))
  }

  const total = duration ?? words.length * 0.36
  const weights = words.map((w) => w.length + 2)
  const sum = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return words.map((word, i) => {
    const start = (total * acc) / sum
    acc += weights[i]
    return { word, start }
  })
}
