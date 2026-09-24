import { useState } from 'react'
import type { DailyUsage } from '../../types'
import { formatDay, formatDayLong, formatNumber } from './format'
import { useElementWidth } from '../../hooks/useElementWidth'

/** Plot heights in px. Each chart's date band sits below its plot rather than inside it, so the
 * card grows to fit both instead of cropping the labels into a nested scrollbar. */
export const PLOT_HEIGHT = 96
const TREND_HEIGHT = 76

/**
 * One measure over the window — the only chart shape on this page.
 *
 * `mark` picks how the values are drawn, and each option is chosen by the job rather than for
 * variety: `area` for a running total that only ever climbs, `line` for a level that moves up and
 * down, `bars` for a per-day count where each day is a quantity of its own.
 *
 * Always a single series, so there is no legend — the title says what is plotted, and a box
 * holding one swatch would only restate it. The hover writes into the headline instead of a
 * floating tooltip: nothing to position wrong near an edge, and it never covers the marks it is
 * describing.
 */
export function TrendChart({
  title,
  daily,
  value,
  mark,
  headline,
  describe,
  plotHeight = TREND_HEIGHT,
}: {
  title: string
  daily: DailyUsage[]
  value: (d: DailyUsage) => number
  mark: 'area' | 'line' | 'bars'
  headline: React.ReactNode
  describe: (d: DailyUsage) => React.ReactNode
  plotHeight?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [plotRef, width] = useElementWidth<HTMLDivElement>()

  const values = daily.map(value)
  const peak = Math.max(...values, 1)
  const peakAt = values.indexOf(peak)
  const hoveredDay = hovered === null ? null : daily[hovered]

  // A running total's peak is just its last value, so "highest" would tell a screen-reader user
  // nothing. Where it went from and to is the whole story of that series; for the others, the
  // busiest day is.
  const label =
    mark === 'area'
      ? `${title} over ${daily.length} days: ${formatNumber(values[0])} at the start, ` +
        `${formatNumber(values[values.length - 1])} at the end.`
      : `${title} over ${daily.length} days: ${formatNumber(values[values.length - 1])} on the last day, ` +
        `highest ${formatNumber(peak)} on ${formatDayLong(daily[peakAt < 0 ? 0 : peakAt].date)}.`

  return (
    <div className="rounded-[var(--r-md)] bg-[var(--surface)] p-4">
      <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{title}</div>
      {/* Fixed height so the card doesn't shift by a line when a hovered day needs two of them. */}
      <div className="mb-3 mt-0.5 h-10 text-sm font-bold leading-tight">
        {hoveredDay ? describe(hoveredDay) : headline}
      </div>

      <div
        ref={plotRef}
        role="img"
        aria-label={label}
        style={{ height: plotHeight }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Nothing until the width is measured — the SVG marks are plotted in real pixels, so
            there is no meaningful geometry to draw at width 0. */}
        {width > 0 &&
          (mark === 'bars' ? (
            <Bars values={values} peak={peak} height={plotHeight} hovered={hovered} onHover={setHovered} />
          ) : (
            <Curve
              values={values}
              peak={peak}
              width={width}
              height={plotHeight}
              filled={mark === 'area'}
              hovered={hovered}
              onHover={setHovered}
            />
          ))}
      </div>

      {/* Bars sit on the bottom edge of the plot, so their baseline is this rule. A curve's zero
          is PAD higher up — it needs room for the end dot's ring — so `Curve` draws its own at the
          right height instead. One rule under both would sit below the line chart's actual zero. */}
      {mark === 'bars' && <div className="h-px w-full" style={{ background: 'var(--rule)' }} />}

      <div className="mt-2 flex justify-between text-[0.6875rem] text-[var(--text-muted)]">
        <span>{formatDay(daily[0].date)}</span>
        <span>{formatDay(daily[daily.length - 1].date)}</span>
      </div>
    </div>
  )
}

function Bars({
  values,
  peak,
  height,
  hovered,
  onHover,
}: {
  values: number[]
  peak: number
  height: number
  hovered: number | null
  onHover: (i: number | null) => void
}) {
  return (
    <div className="flex h-full items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          onMouseEnter={() => onHover(i)}
          // The hit target is the full-height column, not the bar — a one-review day is a 2px
          // sliver nobody can point at. The column takes an equal share of the width and the
          // *bar* is what's capped, so the leftover becomes air between bars instead of dead
          // space collecting at the right-hand end.
          className="flex h-full flex-1 items-end justify-center"
        >
          <div
            className="w-full max-w-[16px] rounded-t-[4px] transition-opacity"
            style={{
              // A day with nothing on it is left empty against the baseline rather than given a
              // token stub, which would read as "a little activity".
              height: v === 0 ? 0 : `${Math.max(3, (v / peak) * height)}px`,
              background: 'var(--accent)',
              // Emphasis rather than a highlight colour: the readout above says *what* is
              // hovered, and dimming the rest is what points at it without introducing a second
              // colour that would read as a second series.
              opacity: hovered !== null && hovered !== i ? 0.35 : 1,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** Radius of the end dot, and the padding the plot needs so its surface ring isn't clipped. */
const DOT_R = 4
const PAD = DOT_R + 2

function Curve({
  values,
  peak,
  width,
  height,
  filled,
  hovered,
  onHover,
}: {
  values: number[]
  peak: number
  width: number
  height: number
  filled: boolean
  hovered: number | null
  onHover: (i: number | null) => void
}) {
  // A single point has no line to draw and would divide by zero working out the spacing. The
  // range control's shortest window is a week, so this only guards the API's own lower bound.
  if (values.length < 2) return null

  const x = (i: number) => PAD + (i * (width - PAD * 2)) / (values.length - 1)
  const y = (v: number) => height - PAD - (v / peak) * (height - PAD * 2)
  const step = (width - PAD * 2) / (values.length - 1)
  const last = values.length - 1

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${x(last).toFixed(2)},${height - PAD} L${x(0).toFixed(2)},${height - PAD} Z`

  const marker = hovered ?? last

  return (
    <svg width={width} height={height} className="block">
      {/* Hairline baseline, solid and one step off the surface: it is what makes a zero day read
          as a real zero rather than as a gap in the data. */}
      <line x1={0} y1={height - PAD} x2={width} y2={height - PAD} stroke="var(--rule)" strokeWidth={1} />

      {/* A wash, never a saturated block — the line is the mark; the fill only says "below". */}
      {filled && <path d={area} fill="var(--accent)" fillOpacity={0.1} />}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Crosshair under the dot, so the dot isn't cut in half by its own guide. */}
      {hovered !== null && (
        <line x1={x(hovered)} y1={PAD} x2={x(hovered)} y2={height - PAD} stroke="var(--rule)" strokeWidth={1} />
      )}

      {/* One marker, on the hovered point or else on the latest one. A flat series has nothing
          else showing where the line ends, and the end is the value the headline is quoting. */}
      <circle cx={x(marker)} cy={y(values[marker])} r={DOT_R} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />

      {/* Hit targets, one per point and far wider than the marks they select — a 2px line is not
          something anyone can hover deliberately. */}
      {values.map((_, i) => (
        <rect
          key={i}
          x={x(i) - step / 2}
          y={0}
          width={step}
          height={height}
          fill="transparent"
          onMouseEnter={() => onHover(i)}
        />
      ))}
    </svg>
  )
}

/** A shape, not a chart: no axis, no hover, no labels. The number above it carries the magnitude
 * and the table below carries the values, which is what lets this be as small as it is. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const peak = Math.max(...values, 1)
  const last = values.length - 1

  return (
    <div className="flex h-8 items-end gap-px" role="img" aria-label={`${label}: daily trend`}>
      {values.map((v, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 rounded-t-[2px]"
          style={{
            height: v === 0 ? 0 : `${Math.max(2, (v / peak) * 32)}px`,
            background: 'var(--accent)',
            // The most recent day at full strength and the history behind it recessive — a
            // sparkline's job is "where is this now, and how did it get here".
            opacity: i === last ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  )
}
