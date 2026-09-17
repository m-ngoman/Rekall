import { compile } from './expr'

/** What the tutor asked us to draw. Parsed and validated server-side, so by the time it reaches
 * the renderer every field is known good — see `_PLOT` in backend/app/api/tutor.py. */
export interface PlotSpec {
  fn: string
  domain: [number, number]
  label?: string
  /** Points the explanation is about. These get the accent; nothing else does. */
  marks?: [number, number][]
  /** Names what the marks are, e.g. "roots". Shown beside the label. */
  note?: string
  /** Axis names, with units. Physics graphs need them — "time (s)" against "velocity (m/s)" —
   * and pure maths does not, where the axes are already called x and y. */
  xlabel?: string
  ylabel?: string
  /** Shades between the curve and the x-axis across this range of x. The area under a
   * velocity-time graph *is* the displacement, so on the questions this feature exists for the
   * shading is the answer rather than decoration. */
  shade?: [number, number]
}

/** One unbroken run of the curve. A function with an asymptote or a gap in its domain produces
 * several, and drawing them as one path is what makes a naive plotter draw a vertical line
 * straight through a pole. */
export type Segment = { x: number; y: number }[]

export interface PlotGeometry {
  segments: Segment[]
  /** The parts of `segments` inside `spec.shade`, ready to be closed down to the baseline.
   * Empty when nothing is shaded. */
  shadeSegments: Segment[]
  /** Where the shading closes: y = 0, pulled into frame when zero is off-screen. */
  shadeBase: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  xTicks: number[]
  yTicks: number[]
}

/** Samples per CSS pixel of plot width. Two is enough that the polyline reads as a curve at this
 * size; adaptive sampling would be a real win for pathological functions and a lot more code,
 * and school-level functions do not need it. */
const SAMPLES_PER_PX = 2

/** A jump larger than this multiple of the visible range is treated as a discontinuity rather
 * than a very steep bit of curve. Chosen so `tan(x)` breaks at its asymptotes while a genuinely
 * steep function like `x^3` near the edge of its domain stays connected. */
const BREAK_FACTOR = 3

/** Ticks at 1, 2 or 5 times a power of ten — the steps people actually read. */
function niceStep(range: number, target: number): number {
  if (!(range > 0)) return 1
  const rough = range / Math.max(1, target)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function ticksFor(min: number, max: number, target: number): number[] {
  const step = niceStep(max - min, target)
  const out: number[] = []
  // Small epsilon on the bound so a tick landing exactly on the edge isn't lost to float noise.
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    // Snap to the step grid: accumulating `+= step` drifts, and a tick labelled 0.30000000000004
    // is the kind of detail that makes a chart look hand-made in the wrong way.
    out.push(Math.round(t / step) * step)
  }
  return out
}

/** The y-range worth showing, given every finite sample.
 *
 * Trimming outliers is the point. One pole sends a sample to 1e15, and a range that accommodates
 * it flattens the entire rest of the curve onto the x-axis. Taking a central percentile of the
 * sorted values keeps the shape the student is meant to see, and the curve simply leaves the top
 * of the frame where it runs away — which is what a textbook does too.
 */
function rangeFor(values: number[], marks: number[]): [number, number] {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return [-1, 1]

  const cut = Math.floor(finite.length * 0.02)
  let lo = finite[cut]
  let hi = finite[finite.length - 1 - cut]

  // A marked point must be on screen — it is the thing being discussed.
  for (const m of marks) {
    if (Number.isFinite(m)) {
      lo = Math.min(lo, m)
      hi = Math.max(hi, m)
    }
  }

  if (!(hi > lo)) {
    // A constant function. Give it room so the line isn't welded to an edge.
    const pad = Math.max(1, Math.abs(hi) * 0.5)
    return [lo - pad, hi + pad]
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

/** Samples the function and works out the frame. Pure — no DOM, so it is testable on its own. */
export function buildGeometry(spec: PlotSpec, widthPx: number): PlotGeometry {
  const f = compile(spec.fn)
  const [xMin, xMax] = spec.domain
  const count = Math.max(2, Math.round(widthPx * SAMPLES_PER_PX))

  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < count; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / (count - 1)
    xs.push(x)
    ys.push(f(x))
  }

  const markYs = (spec.marks ?? []).map(([, y]) => y)
  const [yMin, yMax] = rangeFor(ys, markYs)
  const visible = yMax - yMin

  // Break the curve on a non-finite sample, and on a jump too large to be a slope. Without the
  // second test, 1/x and tan(x) draw a vertical line through the asymptote joining +∞ to −∞.
  const segments: Segment[] = []
  let current: Segment = []
  for (let i = 0; i < count; i += 1) {
    const y = ys[i]
    if (!Number.isFinite(y)) {
      if (current.length) segments.push(current)
      current = []
      continue
    }
    if (current.length) {
      const jump = Math.abs(y - current[current.length - 1].y)
      const crossesFrame = (y - yMax) * (current[current.length - 1].y - yMax) < 0 || (y - yMin) * (current[current.length - 1].y - yMin) < 0
      if (jump > visible * BREAK_FACTOR && crossesFrame) {
        segments.push(current)
        current = []
      }
    }
    current.push({ x: xs[i], y })
  }
  if (current.length) segments.push(current)

  // Shading is cut from the finished curve rather than sampled again, so a region spanning an
  // asymptote is shaded in the same pieces the curve is drawn in — no wash across the gap.
  // The edges land on the nearest sample rather than exactly on the bounds; at two samples per
  // pixel that is half a pixel, and paying for exactness here would mean re-evaluating f.
  const shade = spec.shade
  const shadeSegments = shade
    ? segments
        .map((seg) => seg.filter((p) => p.x >= Math.min(...shade) && p.x <= Math.max(...shade)))
        .filter((seg) => seg.length > 1)
    : []

  return {
    segments,
    shadeSegments,
    // Clamped, so a curve that never comes near zero still shades to the bottom of the frame
    // instead of to a baseline nobody can see.
    shadeBase: Math.max(yMin, Math.min(yMax, 0)),
    xMin,
    xMax,
    yMin,
    yMax,
    xTicks: ticksFor(xMin, xMax, 6),
    yTicks: ticksFor(yMin, yMax, 5),
  }
}

/** Axis tick text. Ticks sit exactly on step multiples, so the step's own precision is enough
 * and anything finer is noise on an axis. */
export function formatTick(value: number, step: number): string {
  if (Math.abs(value) < step * 1e-9) return '0'
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))
  const rounded = value.toFixed(decimals)
  return Math.abs(value) >= 10000 ? Number(rounded).toLocaleString() : rounded
}

/** Readout text for a value the pointer landed on, which is *not* on a tick.
 *
 * Separate from `formatTick` because reusing it was actively wrong: with a tick step of 2, a
 * point at x = 1.71 rendered as "2" and the readout confidently named a coordinate the dot was
 * visibly not at. Ticks can afford the step's precision because they sit exactly on it; an
 * arbitrary sample cannot.
 */
export function formatValue(value: number, step: number): string {
  const decimals = Math.min(3, Math.max(1, Math.ceil(-Math.log10(step / 100))))
  const rounded = Number(value.toFixed(decimals))
  // -0 reads as a mistake rather than as zero.
  const safe = Object.is(rounded, -0) ? 0 : rounded
  return Math.abs(safe) >= 10000 ? safe.toLocaleString() : safe.toFixed(decimals)
}

/** A sentence describing the plot, for a screen reader.
 *
 * Follows ExamCalendar's practice of describing rather than announcing raw data: a listener
 * gets what the graph shows, not a list of coordinates they would have to hold in their head.
 */
export function describePlot(spec: PlotSpec, geometry: PlotGeometry): string {
  // Named axes before the label, matching the backend's transcript sentence and for the same
  // reason: the axes carry the units a listener can't read off the picture. The visible readout
  // line prefers the label, because there the axis titles are right there on the plot.
  const named = spec.xlabel && spec.ylabel ? `${spec.ylabel} against ${spec.xlabel}` : null
  const parts = [`Graph of ${named ?? spec.label ?? `y = ${spec.fn}`}`]
  // The axis name, where there is one: "for time (s) from 0 to 8" beats "for x from 0 to 8" when
  // the whole point of the graph is that x is seconds.
  parts.push(`for ${spec.xlabel ?? 'x'} from ${spec.domain[0]} to ${spec.domain[1]}`)
  if (geometry.segments.length > 1) parts.push(`drawn in ${geometry.segments.length} parts, breaking where it is undefined`)
  const marks = spec.marks ?? []
  if (marks.length) {
    // Bracketed, so "marked at -2, 0 and 2, 0" isn't heard as four numbers.
    const where = marks.map(([x, y]) => `(${x}, ${y})`).join(' and ')
    parts.push(spec.note ? `with the ${spec.note} marked at ${where}` : `with points marked at ${where}`)
  }
  if (geometry.shadeSegments.length) {
    parts.push(`with the area beneath it shaded from ${spec.shade![0]} to ${spec.shade![1]}`)
  }
  return parts.join(', ') + '.'
}
