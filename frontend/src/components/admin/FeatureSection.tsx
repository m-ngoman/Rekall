import SectionTitle from './SectionTitle'
import type { DailyUsage, FeatureUsage } from '../../types'
import { Sparkline } from './charts'
import { formatDate, formatNumber, plural } from './format'
import { parseISODate } from '../../lib/dates'

/** What a feature's `items` total should be called when it means something other than its use
 * count — cards from a generation run, files in an upload batch. */
const ITEM_NOUNS: Record<string, string> = {
  cards_generated: 'card',
  notes_uploaded: 'file',
  // For the two cost meters this caption is the whole point of the tile: the use count says how
  // many turns spoke, the item total says what was actually billed.
  tts_characters: 'character',
  stt_seconds: 'second',
}

export default function FeatureSection({
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
      {/* Small multiples rather than every feature as a series on one chart: the features differ
          by orders of magnitude, so a shared plot would flatten most of them onto the axis, and a
          hue each would make colour carry an identity the labels already carry. */}
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
