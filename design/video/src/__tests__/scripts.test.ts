import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM shared with the render scripts.
import { COMPOSITIONS, CUTS } from '../../scripts/cuts.mjs'
import { LAUNCH30, LAUNCH60, SIZES, voiceStartFrame } from '../timeline'

describe('the render scripts', () => {
  it.each([LAUNCH30, LAUNCH60])('know $id as the timeline does', (cut) => {
    const spec = CUTS[cut.id]
    expect(spec.frames).toBe(cut.durationInFrames)
    expect(spec.voiceStart).toBe(voiceStartFrame(cut))
    expect(spec.posters).toEqual(Object.fromEntries(cut.posters.map((p) => [p.name, p.frame])))
  })
  it('render every composition at its size', () => {
    for (const [id, spec] of Object.entries(COMPOSITIONS) as [string, { width: number; height: number }][]) {
      const layout = id.endsWith('Portrait') ? 'portrait' : 'landscape'
      expect({ width: spec.width, height: spec.height }).toEqual(SIZES[layout])
    }
  })
})
