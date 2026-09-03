import { useEffect, useState } from 'react'
import { getAdminStats } from '../api'
import Segmented from '../components/Segmented'
import { useElementWidth } from '../hooks/useElementWidth'
import { parseISODate } from '../lib/dates'
import type { AdminStats, DailyUsage, FeatureUsage } from '../types'

interface Props {
  onBack: () => void
}

// Abbreviated to match the table's column heads, and because "30 days" wraps inside the pill.
const RANGES: { value: number; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

/** Plot heights in px. Each chart's date band sits below its plot rather than inside it, so the
 * card grows to fit both instead of cropping the labels into a nested scrollbar. */
const PLOT_HEIGHT = 96
const TREND_HEIGHT = 76

function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** "1 Sep" — short enough for an axis tick, unambiguous without a year at these ranges. */
function formatDay(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Mon, 1 Sep" — the hover readout, where there's room to say which day of the week it was. */
function formatDayLong(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** `many` is only needed where adding an "s" doesn't work — "3 persons" is not English. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

export default function AdminScreen({ onBack }: Props) {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // Cleared so a range switch shows the loading state rather than the old range's charts, which
    // would silently disagree with the range control for as long as the request takes.
    setStats(null)
    setError(null)
    getAdminStats(days)
      .then((s) => alive && setStats(s))
      // Not left on "Loading…" forever: this screen only exists for one account, so a failure
      // here has an audience of one and should say what happened.
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load stats.'))
    return () => {
      alive = false
    }
  }, [days])

  if (stats === null) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink onBack={onBack} />
        <p className="text-sm text-[var(--text-muted)]">{error ?? 'Loading…'}</p>
      </div>
    )
  }

  const { users, library, daily } = stats
  const rangeLabel = `${days} days`

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink onBack={onBack} />
        {/* One control for the whole page rather than one per chart: everything below plots the
            same window, and three copies of it would only invite them to disagree. */}
        <div className="w-[168px]">
          <Segmented options={RANGES} value={days} onChange={setDays} />
        </div>
      </div>

      <section>
        <SectionTitle>People</SectionTitle>
        {/* Two charts, never one with two lines: three people and five hundred events cannot share
            a y-axis, and the way round that is a second axis — which lets you draw any
            relationship you like between two series. Separate plots keep both honest. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChart
            title="Registered"
            daily={daily}
            value={(d) => d.registered}
            mark="area"
            headline={
              <>
                {plural(users.registered, 'account')}{' '}
                <span className="font-medium text-[var(--text-muted)]">
                  {users.new_month > 0
                    ? `, ${formatNumber(users.new_month)} new in 30 days`
                    : ', no new sign-ups in 30 days'}
                </span>
              </>
            }
            describe={(d) => (
              <>
                {formatDayLong(d.date)} —{' '}
                <span className="text-[var(--text-muted)]">
                  {plural(d.registered, 'account')}
                  {d.new_users > 0 && `, ${formatNumber(d.new_users)} new that day`}
                </span>
              </>
            )}
          />

          <TrendChart
            title="Active people"
            daily={daily}
            value={(d) => d.active_users}
            mark="line"
            headline={
              <>
                {plural(users.active.day, 'person', 'people')}{' '}
                <span className="font-medium text-[var(--text-muted)]">
                  today, {formatNumber(users.active.week)} this week, {formatNumber(users.active.month)} this
                  month
                </span>
              </>
            }
            describe={(d) => (
              <>
                {formatDayLong(d.date)} —{' '}
                <span className="text-[var(--text-muted)]">
                  {plural(d.active_users, 'person', 'people')} active
                </span>
              </>
            )}
          />
        </div>
        {/* "Active" is a definition, not a fact, so it says which one it means rather than leaving
            the chart to be read as whatever the reader assumes. */}
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
          Active means they reviewed a card, generated cards, uploaded notes or used the tutor —
          not merely that they were signed in.
        </p>
      </section>

      <section>
        <SectionTitle>Everything they did</SectionTitle>
        <TrendChart
          title="Uses"
          daily={daily}
          value={(d) => d.uses}
          mark="bars"
          plotHeight={PLOT_HEIGHT}
          headline={
            <>
              {plural(
                daily.reduce((sum, d) => sum + d.uses, 0),
                'use',
              )}{' '}
              <span className="font-medium text-[var(--text-muted)]">in {rangeLabel}</span>
            </>
          }
          describe={(d) => (
            <>
              {formatDayLong(d.date)} —{' '}
              <span className="text-[var(--text-muted)]">
                {plural(d.uses, 'use')}, {plural(d.active_users, 'person', 'people')}
              </span>
            </>
          )}
        />
        {/* Directly under the charts it tabulates. Left between sections it read as a stray
            control belonging to whichever heading happened to be above it. */}
        <div className="mt-4">
          <DailyTable daily={daily} />
        </div>
      </section>

      <FeatureSection features={stats.features} daily={daily} rangeLabel={rangeLabel} />

      <section>
        <SectionTitle>Library right now</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Decks" value={library.decks} />
          <StatTile label="Cards" value={library.cards} />
          <StatTile label="Notes" value={library.notes} />
          <StatTile label="Tutor sessions" value={library.tutor_sessions} />
        </div>
        {/* Numbers rather than charts here on purpose: these are a snapshot of what exists, and
            nothing records what existed last Tuesday, so a line would have to be invented. */}
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
          What exists at this moment — these fall when things are deleted, unlike everything above.
          There's no history behind them to plot.
        </p>
      </section>

      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Counts only. No card, note or conversation content is recorded for any of these numbers.
        {stats.tracking_since && ` Recording began ${formatDate(new Date(stats.tracking_since))}.`}
      </p>
    </div>
  )
}

function BackLink({ onBack }: Props) {
  return (
    <button onClick={onBack} className="-ml-2 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Settings
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[0.9375rem] font-bold">{children}</div>
}

/** The display face, like every other headline number in the app. */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--r-md)] bg-[var(--surface)] p-4">
      <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{label}</div>
      <div className="numeral mt-1.5 text-[2rem]">{formatNumber(value)}</div>
    </div>
  )
}

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
function TrendChart({
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

/** What a feature's `items` total should be called when it means something other than its use
 * count — cards from a generation run, files in an upload batch. */
const ITEM_NOUNS: Record<string, string> = {
  cards_generated: 'card',
  notes_uploaded: 'file',
}

function FeatureSection({
  features,
  daily,
  rangeLabel,
}: {
  features: FeatureUsage[]
  daily: DailyUsage[]
  rangeLabel: string
}) {
  // Anything counted only since after this window began has a misleadingly small "All" figure, so
  // those tiles say when they started. Ones counting since before it don't need the caveat.
  const windowStart = daily.length ? parseISODate(daily[0].date) : new Date()

  return (
    <section>
      <SectionTitle>Feature usage</SectionTitle>
      {/* Small multiples rather than five series on one chart: the features differ by two orders
          of magnitude, so a shared plot would flatten four of them onto the axis, and five hues
          would make colour carry an identity the labels already carry. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {features.map((f) => {
          const noun = ITEM_NOUNS[f.key]
          const since = f.tracked_since ? new Date(f.tracked_since) : null
          const inWindow = f.daily_uses.reduce((sum, n) => sum + n, 0)

          return (
            <div
              key={f.key}
              className="flex flex-col rounded-[var(--r-md)] bg-[var(--surface)] p-4"
            >
              <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{f.label}</div>
              <div className="numeral mt-1.5 text-[2rem]">{formatNumber(inWindow)}</div>
              <div className="mt-1 text-[0.6875rem] leading-tight text-[var(--text-muted)]">
                in {rangeLabel}
                {/* Only where it says something the use count doesn't: a review produces exactly
                    one review, so "3 reviews from 3 reviews" would be noise on that tile. */}
                {noun && f.items_total > 0 && `, ${plural(f.items_total, noun)} all time`}
                {since && since > windowStart && `, counting since ${formatDate(since)}`}
              </div>
              {/* mt-auto so the sparklines line up across tiles whose captions wrap differently. */}
              <div className="mt-auto pt-3">
                <Sparkline values={f.daily_uses} label={f.label} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
        Each shape is scaled to its own busiest day, so compare the numbers rather than the
        heights. A generation run counts once however many cards it makes, and an upload counts
        once however many files it carries.
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-bold text-[var(--text-muted)]">
          Show exact numbers
        </summary>
        <div
          className="mt-3 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="px-4 pb-2 pt-4 text-left text-xs font-bold">Feature</th>
                <th className="px-2 pb-2 pt-4 text-right text-xs font-bold">24h</th>
                <th className="px-2 pb-2 pt-4 text-right text-xs font-bold">7d</th>
                <th className="px-2 pb-2 pt-4 text-right text-xs font-bold">30d</th>
                <th className="px-4 pb-2 pt-4 text-right text-xs font-bold">All</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key} className="border-t border-[var(--rule)]">
                  <td className="px-4 py-3 font-bold">{f.label}</td>
                  {/* tabular-nums here and not on the tiles: these align down a column. */}
                  <td className="px-2 py-3 text-right tabular-nums">{formatNumber(f.uses_day)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatNumber(f.uses_week)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatNumber(f.uses_month)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{formatNumber(f.uses_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/** A shape, not a chart: no axis, no hover, no labels. The number above it carries the magnitude
 * and the table below carries the values, which is what lets this be as small as it is. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
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

/** One table for all three charts above, rather than a collapsible table under each. Their
 * `aria-label`s describe the shape; this is what makes the actual values reachable without a
 * pointer — on a touch device, or by a screen reader. */
function DailyTable({ daily }: { daily: DailyUsage[] }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-bold text-[var(--text-muted)]">
        Show daily numbers
      </summary>
      <div
        className="mt-3 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]"
      >
        <table className="w-full text-xs tabular-nums">
          <thead className="text-[var(--text-muted)]">
            <tr>
              <th className="px-4 pb-2 pt-4 text-left font-bold">Day</th>
              <th className="px-2 pb-2 pt-4 text-right font-bold">Registered</th>
              <th className="px-2 pb-2 pt-4 text-right font-bold">Active</th>
              <th className="px-4 pb-2 pt-4 text-right font-bold">Uses</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className="border-t border-[var(--rule)]">
                <td className="px-4 py-2">{formatDayLong(d.date)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(d.registered)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(d.active_users)}</td>
                <td className="px-4 py-2 text-right">{formatNumber(d.uses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
