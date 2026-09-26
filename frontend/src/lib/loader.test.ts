import { describe, expect, it } from 'vitest'
import { BRIGHT, DEPTH, FOCAL, LINK_CAP, LINK_FLOOR, LOADER_NODES, LOADER_REST, PAIRS, depthOpacity, floatAt, linksAt, sizeBoost } from './loader'

/** Every 5ms for ten minutes: far longer than any wait, and every period in the float many times over. */
function* frames() {
  for (let t = 0; t <= 600_000; t += 5) yield floatAt(t)
}

const overlapping = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r

describe('the float', () => {
  it('has eight nodes, one of them bright and larger', () => {
    expect(LOADER_NODES).toHaveLength(8)
    expect(LOADER_NODES.every((n, i) => i === BRIGHT || n.r < LOADER_NODES[BRIGHT].r)).toBe(true)
  })

  it('starts where it rests', () => {
    expect(LOADER_REST).toEqual(floatAt(0))
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
    // 5ms apart, never more than a quarter of a unit: a float, not a jump.
    expect(fastest).toBeLessThan(0.25)
    expect(nearMin).toBeGreaterThanOrEqual(0)
    expect(nearMax).toBeLessThanOrEqual(1)
    expect(scaleMin).toBeGreaterThanOrEqual(FOCAL / (FOCAL + DEPTH))
    expect(scaleMax).toBeLessThanOrEqual(FOCAL / (FOCAL - DEPTH))
  })

  it('stays inside its box at the smallest size too, where nodes are drawn larger', () => {
    const boost = sizeBoost(24)
    let edge = Infinity
    for (const nodes of frames()) {
      for (const p of nodes) {
        const r = p.r * boost
        edge = Math.min(edge, p.x - r, p.y - r, 120 - (p.x + r), 120 - (p.y + r))
      }
    }
    expect(edge).toBeGreaterThan(1)
    expect(sizeBoost(48)).toBe(1)
    expect(sizeBoost(80)).toBe(1)
  })

  it('floats every node in front of every other at some point', () => {
    const passes = new Set<string>()
    for (const nodes of frames()) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) if (i !== j && nodes[i].near > nodes[j].near) passes.add(`${i} over ${j}`)
      }
    }
    expect(passes.size).toBe(LOADER_NODES.length * (LOADER_NODES.length - 1))
  })

  it('passes every node through every other: on screen, each pair overlaps at some point', () => {
    const crossed = new Set<number>()
    for (const nodes of frames()) {
      PAIRS.forEach(([a, b], k) => {
        if (overlapping(nodes[a], nodes[b])) crossed.add(k)
      })
    }
    expect(crossed.size).toBe(PAIRS.length)
  })
})

describe('linksAt', () => {
  it('always draws a few links and never a tangle, and none pops on or off', () => {
    let [fewest, most, sharpest] = [Infinity, 0, 0]
    let previous = linksAt(floatAt(0))
    for (const nodes of frames()) {
      const links = linksAt(nodes)
      const drawn = links.filter((s) => s >= 0.5).length
      ;[fewest, most] = [Math.min(fewest, drawn), Math.max(most, drawn)]
      links.forEach((s, k) => {
        sharpest = Math.max(sharpest, Math.abs(s - previous[k]))
      })
      previous = links
    }
    // Half drawn or more: never fewer than the floor, never more than the cap and one more fading.
    expect(fewest).toBeGreaterThanOrEqual(LINK_FLOOR)
    expect(most).toBeLessThanOrEqual(LINK_CAP + 1)
    // A link takes a tenth of a second or more to come or go.
    expect(sharpest).toBeLessThan(0.05)
  })

  it('at rest: the nodes are apart, and linked', () => {
    PAIRS.forEach(([a, b]) => expect(overlapping(LOADER_REST[a], LOADER_REST[b])).toBe(false))
    expect(linksAt(LOADER_REST).filter((s) => s >= 0.5).length).toBeGreaterThanOrEqual(4)
  })

  it('pairs every node with every other once', () => {
    expect(PAIRS).toHaveLength((LOADER_NODES.length * (LOADER_NODES.length - 1)) / 2)
    expect(new Set(PAIRS.map(([a, b]) => `${a}-${b}`)).size).toBe(PAIRS.length)
    expect(PAIRS.every(([a, b]) => a < b)).toBe(true)
  })
})

describe('depthOpacity', () => {
  it('is the base opacity half way back, dimmer further away and brighter closer', () => {
    expect(depthOpacity(0.58, 0.5)).toBeCloseTo(0.58, 10)
    expect(depthOpacity(0.58, 0)).toBeCloseTo(0.406, 3)
    expect(depthOpacity(0.58, 1)).toBeCloseTo(0.754, 3)
  })

  it('keeps within its floor and 1', () => {
    expect(depthOpacity(1, 0, 0.85)).toBe(0.85)
    expect(depthOpacity(1, 1, 0.85)).toBe(1)
  })
})
