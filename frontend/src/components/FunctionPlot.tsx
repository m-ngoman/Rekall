import { useMemo, useRef, useState } from 'react'
import { useElementWidth } from '../hooks/useElementWidth'
import { buildGeometry, describePlot, formatTick, formatValue, type PlotSpec } from '../lib/plot'

/** Radius of a marked point, and the padding the frame needs so its surface ring isn't clipped.
 * Same values and the same reason as AdminScreen's trend chart. */
const DOT_R = 4
const PAD_TOP = DOT_R + 4
const PAD_RIGHT = DOT_R + 4
const PAD_LEFT = 38 // room for y tick labels
const PAD_BOTTOM = 20 // room for x tick labels

/** A graph the tutor asked for.
 *
 * The model never draws. It names a function and a domain; this samples, scales and renders.
 * That division is the whole design: models are unreliable at coordinate arithmetic and reliable
 * at saying what a thing is.
 *
 * SVG rather than canvas, for three reasons that all matter here: `var(--token)` resolves in
 * presentation attributes so dark and light need no branch and no `getComputedStyle` dance;
 * hover and focus are ordinary DOM events; and the tick labels are real text, which a screen
 * reader and a text-size setting both understand.
 *
 * Colour follows the app's accent rule rather than chart convention. The curve is `--text` and
 * the axes are `--rule`; `--accent` is spent only on the points the tutor is actually talking
 * about, so the highlight means "this bit" rather than "this is a chart".
 */
export default function FunctionPlot({ spec }: { spec: PlotSpec }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  // Measured rather than a fixed viewBox with preserveAspectRatio — see the hook, which exists
  // for this: scaling a viewBox scales the 2px stroke with it.
  const [boxRef, measured] = useElementWidth<HTMLDivElement>()

  // Capped so a graph doesn't become the whole desktop column; floored so it stays readable on a
  // phone. Height follows width until it would get too tall to sit inside a reply.
  const width = Math.min(Math.max(measured, 240), 460)
  const height = Math.round(Math.min(Math.max(width * 0.62, 170), 260))

  const geometry = useMemo(() => {
    if (width <= 0) return null
    try {
      return buildGeometry(spec, width - PAD_LEFT - PAD_RIGHT)
    } catch {
      // The backend validates before sending, so this is the belt to that braces. A plot that
      // cannot be built degrades to its label rather than taking the reply down.
      return null
    }
  }, [spec, width])

  // The hook reports 0 until the first measurement lands, so the wrapper always renders and the
  // plot waits one frame rather than dividing by zero.
  if (measured === 0) return <div ref={boxRef} className="mt-2.5 h-px w-full" />

  if (!geometry || geometry.segments.length === 0) {
    return (
      <div ref={boxRef}>
        <p className="mt-2 text-[0.8125rem] text-[var(--text-muted)]">{spec.label ?? `y = ${spec.fn}`}</p>
      </div>
    )
  }

  const { segments, xMin, xMax, yMin, yMax, xTicks, yTicks } = geometry
  const plotW = width - PAD_LEFT - PAD_RIGHT
  const plotH = height - PAD_TOP - PAD_BOTTOM
  const sx = (x: number) => PAD_LEFT + ((x - xMin) / (xMax - xMin)) * plotW
  const sy = (y: number) => PAD_TOP + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const xStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : 1
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1

  // Every sample, flattened, so the crosshair can snap to the nearest one.
  const flat = segments.flat()
  const hovered = hover === null ? null : flat[hover]

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return
    const px = ((e.clientX - box.left) / box.width) * width
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < flat.length; i += 1) {
      const d = Math.abs(sx(flat[i].x) - px)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    setHover(best)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -1 : 1
    setHover((prev) => {
      const next = (prev ?? Math.floor(flat.length / 2)) + step * Math.max(1, Math.round(flat.length / 40))
      return Math.max(0, Math.min(flat.length - 1, next))
    })
  }

  // The readout writes into a fixed line above the plot rather than a floating tooltip: nothing
  // to mis-position near an edge, and it never covers the marks it is describing. Same call
  // AdminScreen made. Fixed height so the bubble doesn't jump by a line on hover.
  // Commas, never a middle dot: the house copy rules ban "·" as a separator, and this line is
  // read as a sentence rather than scanned as a label.
  const readout = hovered
    ? `x = ${formatValue(hovered.x, xStep)},  y = ${formatValue(hovered.y, yStep)}`
    : [spec.label ?? `y = ${spec.fn}`, spec.note && `${spec.note} marked`].filter(Boolean).join(', ')

  return (
    <div ref={boxRef} className="mt-2.5">
      <div className="mb-1 h-4 text-[0.8125rem] leading-4 text-[var(--text-muted)] tabular-nums">{readout}</div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full touch-none"
        role="img"
        aria-label={describePlot(spec, geometry)}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {/* Grid first, so everything else sits on top of it. Hairline and solid, never dashed. */}
        {xTicks.map((t) => (
          <line key={`gx${t}`} x1={sx(t)} y1={PAD_TOP} x2={sx(t)} y2={PAD_TOP + plotH} stroke="var(--rule)" strokeWidth={1} opacity={0.5} />
        ))}
        {yTicks.map((t) => (
          <line key={`gy${t}`} x1={PAD_LEFT} y1={sy(t)} x2={PAD_LEFT + plotW} y2={sy(t)} stroke="var(--rule)" strokeWidth={1} opacity={0.5} />
        ))}

        {/* The axes proper, where zero is in frame. For school maths these are the reference the
            whole reading depends on, so they are the same hue at full strength. */}
        {yMin < 0 && yMax > 0 && (
          <line x1={PAD_LEFT} y1={sy(0)} x2={PAD_LEFT + plotW} y2={sy(0)} stroke="var(--rule)" strokeWidth={1} />
        )}
        {xMin < 0 && xMax > 0 && (
          <line x1={sx(0)} y1={PAD_TOP} x2={sx(0)} y2={PAD_TOP + plotH} stroke="var(--rule)" strokeWidth={1} />
        )}

        {/* Tick labels wear text tokens, never the data colour. `tabular-nums` because a column
            of numbers has to line up; deliberately NOT `.numeral`, which index.css reserves for
            the four places allowed to be loud. */}
        {xTicks.map((t) => (
          <text key={`tx${t}`} x={sx(t)} y={height - 6} textAnchor="middle" className="tabular-nums" fontSize={10} fill="var(--text-muted)">
            {formatTick(t, xStep)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`ty${t}`} x={PAD_LEFT - 6} y={sy(t) + 3} textAnchor="end" className="tabular-nums" fontSize={10} fill="var(--text-muted)">
            {formatTick(t, yStep)}
          </text>
        ))}

        {/* The curve. One path per unbroken run, so an asymptote is a gap rather than a line
            drawn straight through it. 2px, round join and cap. */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')}
            fill="none"
            stroke="var(--text)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Crosshair under the dot, so the dot isn't cut in half by its own guide. */}
        {hovered && <line x1={sx(hovered.x)} y1={PAD_TOP} x2={sx(hovered.x)} y2={PAD_TOP + plotH} stroke="var(--rule)" strokeWidth={1} />}
        {hovered && (
          <circle cx={sx(hovered.x)} cy={sy(hovered.y)} r={DOT_R} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
        )}

        {/* The points the explanation is about — the only accent on the plot. The surface ring
            keeps them legible where they sit on the curve. */}
        {(spec.marks ?? []).map(([mx, my], i) => (
          <circle key={`m${i}`} cx={sx(mx)} cy={sy(my)} r={DOT_R} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
    </div>
  )
}
