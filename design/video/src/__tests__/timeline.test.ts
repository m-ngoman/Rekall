import { describe, expect, it } from 'vitest'
import words from '../audio/tutor-sn1-sn2.words.json'
import { CUTS, FPS, voiceStartFrame } from '../timeline'

describe.each(CUTS)('$id', (cut) => {
  it('runs its scenes back to back to exactly its length', () => {
    let at = 0
    for (const scene of cut.scenes) {
      expect(scene.start, `${scene.kind} starts where the last scene ended`).toBe(at)
      at += scene.duration
    }
    expect(at).toBe(cut.durationInFrames)
    expect(cut.transitions).toHaveLength(cut.scenes.length - 1)
  })

  it('stays under a minute, so every platform takes it as is', () => {
    expect(cut.durationInFrames / FPS).toBeLessThan(60)
  })

  it('lets the voice line finish before anything else happens', () => {
    const v = cut.scenes.find((s) => s.kind === 'voice')
    if (!v || v.kind !== 'voice') throw new Error('no voice scene')
    const lineEnd = v.beats.speakStart + Math.ceil(words.duration * FPS)
    expect(v.beats.listenAfter).toBeGreaterThanOrEqual(lineEnd)
    expect(v.beats.exit ?? v.duration).toBeGreaterThanOrEqual(v.beats.listenAfter)
    // A crossfade out of the scene may not start until the line is over.
    const i = cut.scenes.indexOf(v)
    const out = cut.transitions[i]
    if (out) expect(v.duration - out.frames).toBeGreaterThanOrEqual(lineEnd)
  })

  it('puts the voice where the render scripts expect it', () => {
    expect(voiceStartFrame(cut)).toBe(cut.id === 'Launch30' ? 420 : 622)
  })

  it('shows one caption at a time, each long enough to read', () => {
    const sorted = [...cut.captions].sort((a, b) => a.from - b.from)
    expect(sorted).toEqual(cut.captions)
    sorted.forEach((c, i) => {
      expect(c.to - c.from, `"${c.id}" is on screen for at least 1.8 s`).toBeGreaterThanOrEqual(54)
      expect(c.to).toBeLessThanOrEqual(cut.durationInFrames)
      if (i > 0) expect(c.from, `"${c.id}" starts after "${sorted[i - 1].id}" has gone`).toBeGreaterThan(sorted[i - 1].to)
    })
  })

  it('keeps every scene beat inside its scene', () => {
    for (const scene of cut.scenes) {
      if (!('beats' in scene)) continue
      const numbers = JSON.stringify(scene.beats, (k, v) => (k === 'camera' ? undefined : v)).match(/-?\d+(\.\d+)?/g) ?? []
      for (const n of numbers.map(Number)) expect(n, `${scene.kind} beat ${n}`).toBeLessThan(scene.duration)
    }
  })

  it('has posters inside the cut', () => {
    for (const p of cut.posters) expect(p.frame).toBeLessThan(cut.durationInFrames)
  })
})
