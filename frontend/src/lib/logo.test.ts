import { describe, expect, it } from 'vitest'
import { CENTRE, DEPTH, FOCAL, HELD, LOADER_REST, LOADER_SCALE, LOGO_EDGES, LOGO_NODES, depthOpacity, floatAt } from './logo'

/** Every 5ms for ten minutes: far longer than any wait, and every period in the float many times over. */
function* frames() {
  for (let t = 0; t <= 600_000; t += 5) yield floatAt(t)
}

describe('the mark', () => {
  it('holds its bright node by two edges', () => {
    expect(LOGO_EDGES.filter(([from, to]) => from === HELD || to === HELD)).toHaveLength(2)
  })
})

describe('floatAt', () => {
  it('rests as the logo, drawn smaller about its middle', () => {
    for (const t of [-100, 0]) {
      floatAt(t).forEach((p, i) => {
        expect(p.x).toBeCloseTo(CENTRE.x + (LOGO_NODES[i].x - CENTRE.x) * LOADER_SCALE, 10)
        expect(p.y).toBeCloseTo(CENTRE.y + (LOGO_NODES[i].y - CENTRE.y) * LOADER_SCALE, 10)
        expect(p.r).toBeCloseTo(LOGO_NODES[i].r * LOADER_SCALE, 10)
        expect([p.scale, p.near]).toEqual([1, 0.5])
      })
    }
    expect(LOADER_REST).toEqual(floatAt(0))
  })

  it('eases out of rest: one frame in, nothing has visibly moved', () => {
    floatAt(16).forEach((p, i) => {
      expect(Math.hypot(p.x - LOADER_REST[i].x, p.y - LOADER_REST[i].y)).toBeLessThan(0.05)
    })
  })

  it('stays inside its box, in depth range, and never jumps', () => {
    let edge = Infinity
    let fastest = 0
    let [nearMin, nearMax, scaleMin, scaleMax] = [Infinity, -Infinity, Infinity, -Infinity]
    let previous = floatAt(0)
    for (const nodes of frames()) {
      nodes.forEach((p, i) => {
        edge = Math.min(edge, p.x - p.r, p.y - p.r, 120 - (p.x + p.r), 120 - (p.y + p.r))
        fastest = Math.max(fastest, Math.hypot(p.x - previous[i].x, p.y - previous[i].y))
        ;[nearMin, nearMax] = [Math.min(nearMin, p.near), Math.max(nearMax, p.near)]
        ;[scaleMin, scaleMax] = [Math.min(scaleMin, p.scale), Math.max(scaleMax, p.scale)]
      })
      previous = nodes
    }
    // Room to spare on every side, at the size each node is drawn.
    expect(edge).toBeGreaterThan(5)
    // 5ms apart, never more than an eighth of a unit, easing in included: a float, not a jump.
    expect(fastest).toBeLessThan(0.125)
    expect(nearMin).toBeGreaterThanOrEqual(0)
    expect(nearMax).toBeLessThanOrEqual(1)
    expect(scaleMin).toBeGreaterThanOrEqual(FOCAL / (FOCAL + DEPTH))
    expect(scaleMax).toBeLessThanOrEqual(FOCAL / (FOCAL - DEPTH))
  })

  it('floats every node in front of every other at some point', () => {
    const passes = new Set<string>()
    for (const nodes of frames()) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) if (i !== j && nodes[i].near > nodes[j].near) passes.add(`${i} over ${j}`)
      }
    }
    expect(passes.size).toBe(LOGO_NODES.length * (LOGO_NODES.length - 1))
  })
})

describe('depthOpacity', () => {
  it('is the logo’s own opacity at rest, dimmer further away and brighter closer', () => {
    expect(depthOpacity(0.58, 0.5)).toBeCloseTo(0.58, 10)
    expect(depthOpacity(0.58, 0)).toBeCloseTo(0.406, 3)
    expect(depthOpacity(0.58, 1)).toBeCloseTo(0.754, 3)
  })

  it('keeps within its floor and 1', () => {
    expect(depthOpacity(1, 0, 0.85)).toBe(0.85)
    expect(depthOpacity(1, 1, 0.85)).toBe(1)
  })
})
