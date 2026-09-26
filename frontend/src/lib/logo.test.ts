import { describe, expect, it } from 'vitest'
import { HELD, LOGO_EDGES, LOGO_NODES, MAX_DRIFT_GAIN, driftAt, driftGain, heldAngle } from './logo'

const heldEdges = LOGO_EDGES.filter(([from, to]) => from === HELD || to === HELD)

/** Every 5ms for ten minutes: far longer than any wait, and every period in the drift many times over. */
function* samples(gain: number) {
  for (let t = 0; t <= 600_000; t += 5) yield driftAt(t, gain)
}

describe('the mark', () => {
  it('holds its bright node by two edges', () => {
    expect(heldEdges).toHaveLength(2)
    expect(heldAngle(LOGO_NODES)).toBeCloseTo(38.6, 1)
  })
})

describe('driftAt', () => {
  it('starts from the logo itself, and eases out of it', () => {
    for (const t of [-100, 0]) {
      expect(driftAt(t, MAX_DRIFT_GAIN)).toEqual(LOGO_NODES.map(({ x, y }) => ({ x, y })))
    }
    // One frame in, nothing has visibly moved.
    driftAt(16, MAX_DRIFT_GAIN).forEach((p, i) => {
      expect(Math.hypot(p.x - LOGO_NODES[i].x, p.y - LOGO_NODES[i].y)).toBeLessThan(0.05)
    })
  })

  it('never closes up the bright node’s two edges, or runs any two nodes together', () => {
    const r = LOGO_NODES[HELD].r
    const widest = Math.max(...heldEdges.map(([, , width]) => width))
    let smallestAngle = Infinity
    let smallestGap = Infinity
    for (const p of samples(MAX_DRIFT_GAIN)) {
      smallestAngle = Math.min(smallestAngle, heldAngle(p))
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          const gap = Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) - LOGO_NODES[i].r - LOGO_NODES[j].r
          smallestGap = Math.min(smallestGap, gap)
        }
      }
    }
    expect(smallestAngle).toBeGreaterThan(26)
    // Where the two edges leave the bright node they are this far apart, centre to centre: more
    // than a stroke's width, so they never touch.
    expect(2 * r * Math.sin((smallestAngle * Math.PI) / 360)).toBeGreaterThan(widest)
    expect(smallestGap).toBeGreaterThan(3)
  })

  it('keeps each node close to where it rests', () => {
    for (const [gain, bound] of [[1, 5], [MAX_DRIFT_GAIN, 7.5]] as const) {
      let furthest = 0
      for (const p of samples(gain)) {
        p.forEach((q, i) => (furthest = Math.max(furthest, Math.hypot(q.x - LOGO_NODES[i].x, q.y - LOGO_NODES[i].y))))
      }
      expect(furthest).toBeLessThan(bound)
    }
  })
})

describe('driftGain', () => {
  it('is 1 for a full-size mark and grows, to its cap, as the mark shrinks', () => {
    expect(driftGain(64)).toBe(1)
    expect(driftGain(40)).toBe(1)
    expect(driftGain(32)).toBe(1.25)
    expect(driftGain(22)).toBe(MAX_DRIFT_GAIN)
    expect(driftGain(8)).toBe(MAX_DRIFT_GAIN)
  })
})
