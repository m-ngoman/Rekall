import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM helper shared with the scripts; typed by use here.
import { foldWords, readPinnedAlignment } from '../../scripts/lib/inworld.mjs'
import take from '../audio/tutor-sn1-sn2.words.json'
import demo from '../data/demo.json'
import { wordStarts } from '@app/lib/wordTimings'

const testFile = fs.readFileSync(path.resolve(__dirname, '../../../../backend/tests/test_tts_inworld.py'), 'utf8')

describe('the voice line', () => {
  it('folds Inworld tokens the way the backend does', () => {
    const words = foldWords(readPinnedAlignment(testFile))
    // The backend test's own assertions, restated against the port.
    expect(words).toHaveLength(10)
    expect(words.map((w: { w: string }) => w.w)).toEqual(['Tertiary', 'substrates', 'go', 'SN1', 'primary', 'ones', 'almost', 'always', 'go', 'SN2'])
    expect(words[3]).toEqual({ w: 'SN1', s: 1.5, e: 2.49 })
  })

  it('is the line the tutor says in the demo', () => {
    expect(take.text).toBe(demo.tutor.reply)
  })

  it('has one timing per written word, so the karaoke lights exact words', () => {
    const written = take.text.split(/\s+/)
    expect(take.words).toHaveLength(written.length)
    // wordStarts only uses the real timings when the counts match; otherwise it remaps.
    const starts = wordStarts(take.text, take.words)
    expect(starts.map((w) => w.start)).toEqual(take.words.map((w) => w.s))
  })

  it('moves forward in time', () => {
    take.words.forEach((w, i) => {
      expect(w.e).toBeGreaterThanOrEqual(w.s)
      if (i > 0) expect(w.s).toBeGreaterThanOrEqual(take.words[i - 1].s)
    })
    expect(take.duration).toBeGreaterThanOrEqual(take.words[take.words.length - 1].e)
  })
})
