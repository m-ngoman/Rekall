import { describe, expect, it } from 'vitest'
import { wordStarts } from './wordTimings'

const t = (w: string, s: number) => ({ w, s, e: s + 0.2 })

describe('wordStarts', () => {
  it('uses the synthesizer timings when every word has one', () => {
    expect(wordStarts('The mitochondria  divide', [t('The', 0), t('mitochondria', 0.2), t('divide', 0.9)])).toEqual([
      { word: 'The', start: 0 },
      { word: 'mitochondria', start: 0.2 },
      { word: 'divide', start: 0.9 },
    ])
  })

  it('maps written words onto the spoken ones proportionally when the counts disagree', () => {
    // "$5" was spoken as "five dollars": three written words, four timings.
    const starts = wordStarts('It costs $5', [t('It', 0), t('costs', 0.2), t('five', 0.6), t('dollars', 0.9)])
    expect(starts.map((w) => w.start)).toEqual([0, 0.2, 0.6])
  })

  it('estimates by word length when there are no timings, over the known duration', () => {
    const starts = wordStarts('a bbbb', [], 1.2)
    // Weights are length + 2: 3 and 6, so the second word starts a third of the way in.
    expect(starts.map((w) => w.word)).toEqual(['a', 'bbbb'])
    expect(starts[0].start).toBe(0)
    expect(starts[1].start).toBeCloseTo(0.4)
  })

  it('assumes 0.36s a word when the duration is unknown too', () => {
    const starts = wordStarts('ab cd', [])
    expect(starts[0].start).toBe(0)
    expect(starts[1].start).toBeCloseTo(0.36)
  })
})
