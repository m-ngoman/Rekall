import { describe, expect, it } from 'vitest'
import { buildGeometry, describePlot, formatTick, formatValue, type PlotSpec } from './plot'

describe('plot geometry', () => {
  it('breaks the curve at an asymptote instead of drawing through it', () => {
    const g = buildGeometry({ fn: '1/x', domain: [-5, 5] }, 200)
    expect(g.segments.length).toBe(2)
    expect(g.segments[0].every((p) => p.x < 0)).toBe(true)
    expect(g.segments[1].every((p) => p.x > 0)).toBe(true)
  })

  it('keeps a steep but continuous curve in one piece', () => {
    expect(buildGeometry({ fn: 'x^3', domain: [-10, 10] }, 200).segments.length).toBe(1)
  })

  it('gives a constant function room', () => {
    const g = buildGeometry({ fn: '3', domain: [0, 1] }, 50)
    expect(g.yMin).toBeLessThan(3)
    expect(g.yMax).toBeGreaterThan(3)
  })

  it('shades only inside the range, down to a baseline pulled into frame', () => {
    const spec: PlotSpec = { fn: 'min(2*x, 8)', domain: [0, 10], shade: [0, 4] }
    const g = buildGeometry(spec, 200)
    const xs = g.shadeSegments.flat().map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(4)
    expect(g.shadeBase).toBe(Math.max(g.yMin, Math.min(g.yMax, 0)))
    const high = buildGeometry({ fn: 'x + 100', domain: [0, 1], shade: [0, 1] }, 50)
    expect(high.shadeBase).toBe(high.yMin)
  })

  it('keeps a marked point on screen', () => {
    const g = buildGeometry({ fn: 'x', domain: [0, 1], marks: [[0.5, 50]] }, 50)
    expect(g.yMax).toBeGreaterThanOrEqual(50)
  })

  it('puts ticks on 1-2-5 steps', () => {
    const g = buildGeometry({ fn: 'x', domain: [0, 10] }, 100)
    expect(g.xTicks).toEqual([0, 2, 4, 6, 8, 10])
  })
})

describe('labels', () => {
  it('formats ticks to the precision of their step', () => {
    expect(formatTick(0.30000000000000004, 0.1)).toBe('0.3')
    expect(formatTick(1e-12, 1)).toBe('0')
    expect(formatTick(20000, 5000)).toBe((20000).toLocaleString())
  })

  it('formats a readout finer than the ticks, without a negative zero', () => {
    expect(formatValue(1.71, 2)).toBe('1.71') // a tick step of 2 would have printed "2"
    expect(formatValue(-0.0001, 2)).toBe('0.00')
  })

  it('describes the graph for a screen reader, axes first', () => {
    const spec: PlotSpec = {
      fn: 'min(2*x, 8)',
      domain: [0, 10],
      label: 'velocity against time',
      marks: [[4, 8]],
      note: 'end of acceleration',
      xlabel: 'time (s)',
      ylabel: 'velocity (m/s)',
      shade: [0, 4],
    }
    expect(describePlot(spec, buildGeometry(spec, 200))).toBe(
      'Graph of velocity (m/s) against time (s), for time (s) from 0 to 10, with the end of acceleration marked at (4, 8), with the area beneath it shaded from 0 to 4.',
    )
  })
})
