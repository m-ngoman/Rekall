import { describe, expect, it } from 'vitest'
import take from '../audio/tutor-sn1-sn2.words.json'
import demo from '../data/demo.json'
import { cuesFor, soundFor, type Cue } from '../audio/cues'
import { SR, Stereo, buffer, db, lufs } from '../audio/dsp'
import { lofiBed } from '../audio/music'
import { chime, click, keystroke, mallet, pop, tick, whoosh } from '../audio/sounds'
import { typingSchedule } from '../lib/typing'
import { CUTS, FPS, voiceStartFrame } from '../timeline'

const mean = (x: Float32Array) => x.reduce((a, b) => a + b, 0) / x.length
const maxAbs = (x: Float32Array) => x.reduce((a, b) => Math.max(a, Math.abs(b)), 0)

describe('the loudness meter', () => {
  it('reads a 1 kHz tone as BS.1770 does', () => {
    // A -20 dBFS 1 kHz sine in both channels measures -20 LUFS: the standard's own calibration.
    const [l, r] = [buffer(4), buffer(4)]
    for (let i = 0; i < l.length; i++) l[i] = r[i] = db(-20) * Math.sin((2 * Math.PI * 1000 * i) / SR)
    expect(lufs(l, r)).toBeCloseTo(-20, 1)
  })
  it('gates silence out', () => {
    // Two seconds of the tone, then two of silence: the silent blocks don't count, and only the
    // three that straddle the tone's end pull the reading down (by about a third of a LU).
    const [l, r] = [buffer(4), buffer(4)]
    for (let i = 0; i < 2 * SR; i++) l[i] = r[i] = db(-20) * Math.sin((2 * Math.PI * 1000 * i) / SR)
    expect(lufs(l, r)).toBeCloseTo(-20, 0)
  })
})

describe('the sound effects', () => {
  const made: [string, Float32Array][] = [
    ['key', keystroke('a')],
    ['space', keystroke('a', true)],
    ['tick', tick('a')],
    ['click', click('a')],
    ['pop', pop('a')],
    ['mallet', mallet('a', 392)],
    ['chime', chime('a', 1046.5)],
    ['whoosh', whoosh('a', 0.5, true)],
  ]
  it.each(made)('%s is finite, peaks at full scale and has no DC offset', (_, x) => {
    expect(x.every(Number.isFinite)).toBe(true)
    expect(maxAbs(x)).toBeCloseTo(1, 5)
    expect(Math.abs(mean(x))).toBeLessThan(0.02)
  })
  it('is the same for the same seed and different for another', () => {
    expect(keystroke('x')).toEqual(keystroke('x'))
    expect(keystroke('x')).not.toEqual(keystroke('y'))
  })
})

describe.each(CUTS)('the $id cut’s effects', (cut) => {
  const cues = cuesFor(cut)
  const seconds = cut.durationInFrames / FPS
  const study = cut.scenes.find((s) => s.kind === 'study')!
  if (study.kind !== 'study') throw new Error('no study scene')

  it('are in order, inside the cut, and the same every time', () => {
    expect(cues.every((c, i) => i === 0 || c.at >= cues[i - 1].at)).toBe(true)
    expect(cues.every((c) => c.at >= 0 && c.at < seconds)).toBe(true)
    expect(cuesFor(cut)).toEqual(cues)
  })

  it('press a key on the frame each character of the answer appears', () => {
    const keys = cues.filter((c) => c.sound.kind === 'key')
    const frames = typingSchedule(demo.study.typed, study.beats.typeStart, study.beats.typeEnd, 'answer')
    expect(keys.map((c) => c.at)).toEqual(frames.map((f) => (study.start + f) / FPS))
    expect(keys.filter((c) => c.sound.kind === 'key' && c.sound.space).length).toBe(demo.study.typed.split(' ').length - 1)
  })

  it('click on every press the picture shows', () => {
    const presses = cut.scenes.flatMap((s) => {
      switch (s.kind) {
        case 'study':
          return [s.beats.press, ...(s.beats.save ? [s.beats.save.press] : [])].map((f) => s.start + f)
        case 'voice':
          return [s.beats.micPress, ...(s.beats.exit !== undefined ? [s.beats.exit] : [])].map((f) => s.start + f)
        case 'generate':
          return [s.beats.press, s.beats.homePress].map((f) => s.start + f)
        case 'home':
          return [s.start + s.beats.press]
        case 'calendar':
          return s.beats.nextMonth ? [s.start + s.beats.nextMonth.press] : []
        default:
          return []
      }
    })
    const clicks = cues.filter((c) => c.sound.kind === 'click').map((c) => Math.round(c.at * FPS))
    expect(clicks.sort((a, b) => a - b)).toEqual(presses.sort((a, b) => a - b))
  })

  it('stay out of the way while the tutor speaks', () => {
    const start = voiceStartFrame(cut) / FPS
    const end = start + take.duration
    const during = (c: Cue) => c.at >= start && c.at < end
    expect(cues.filter(during)).toEqual([])
  })

  it('never clip when mixed', () => {
    const mix = new Stereo(seconds)
    for (const c of cues) mix.place(soundFor(c), c.at, c.gain, c.pan)
    expect(mix.peak()).toBeLessThan(db(-6))
  })
})

describe('the music bed', () => {
  const bed = lofiBed(7)
  it('is finite, stays under full scale, and is the same every time', () => {
    expect(bed.left.every(Number.isFinite) && bed.right.every(Number.isFinite)).toBe(true)
    expect(bed.peak()).toBeLessThanOrEqual(1)
    expect(lofiBed(7).left).toEqual(bed.left)
  })
  it('is playing, in stereo, from its first beat', () => {
    expect(lufs(bed.left, bed.right)).toBeGreaterThan(-40)
    expect(maxAbs(bed.left.subarray(0, SR / 2))).toBeGreaterThan(0.01)
    expect(bed.left).not.toEqual(bed.right)
  })
})
