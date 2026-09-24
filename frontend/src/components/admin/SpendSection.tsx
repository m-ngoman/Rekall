import type { Spend, SpendFeature } from '../../types'
import { Sparkline } from './charts'
import { formatNumber } from './format'
import SectionTitle from './SectionTitle'

/** Where the money goes, one row per feature.

    Small multiples rather than a stacked chart, for a reason that is as much design-system as
    taste: the app has one accent colour and a rule that it appears in four places, so six series
    would need six colours it does not have. A sorted list of rows with a share bar and its own
    sparkline answers "what goes where" more directly anyway — the question is usually about the
    top of the list, not the shape of the whole.

    The estimated/billed distinction is surfaced rather than smoothed over. The model calls are
    priced by the provider; the two speech rows are computed from rates in config, and a computed
    number shown beside billed ones would be read as billed. */
export default function SpendSection({ spend, rangeLabel }: { spend: Spend; rangeLabel: string }) {
  const spending = spend.features.filter((f) => f.usd > 0)
  const billed = spend.total_usd - spend.estimated_usd

  return (
    <section>
      <SectionTitle>What it costs to run</SectionTitle>

      {spending.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Nothing recorded in {rangeLabel} yet — spend is logged as calls are made.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="numeral text-[2rem]">${spend.total_usd.toFixed(2)}</span>
              <span className="ml-2 text-xs text-[var(--text-muted)]">in {rangeLabel}</span>
            </div>
            <div className="text-xs leading-relaxed text-[var(--text-muted)]">
              ${billed.toFixed(2)} billed by providers
              {spend.estimated_usd > 0 && <>, ${spend.estimated_usd.toFixed(2)} estimated from configured rates</>}
              {spend.all_time_usd > spend.total_usd && <>. ${spend.all_time_usd.toFixed(2)} all time</>}
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]">
            {spending.map((f) => (
              <SpendRow key={f.key} feature={f} />
            ))}
          </div>

          <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
            Model calls are priced by the provider on each response, so these are what was actually
            charged rather than a rate table multiplied out. Speech is the exception and is marked:
            neither speech provider reports a cost, so those two are computed from the rates in
            config and are only as current as those are.
          </p>
        </>
      )}
    </section>
  )
}

function SpendRow({ feature: f }: { feature: SpendFeature }) {
  // Sub-cent figures are the norm here — a grading call is about $0.0004 — so the window total
  // needs more than two decimals or most rows read as $0.00.
  const money = f.usd >= 1 ? `$${f.usd.toFixed(2)}` : `$${f.usd.toFixed(4)}`
  const perCall = f.calls ? f.usd / f.calls : 0

  return (
    <div className="flex items-center gap-4 border-b border-[var(--rule)] px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[0.8125rem] font-semibold">{f.label}</span>
          {f.estimated && (
            <span
              className="flex-shrink-0 rounded-[var(--r-full)] px-1.5 py-px text-[0.625rem] font-bold text-[var(--text-muted)]"
              style={{ background: 'var(--rule)' }}
              title="No provider reports a cost for this — computed from the rates in config"
            >
              est
            </span>
          )}
        </div>
        {/* The share bar is the comparison; the number beside it is the value. Accent at reduced
            opacity so a row of them does not compete with the accent's four real jobs. */}
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-[var(--r-full)]" style={{ background: 'var(--rule)' }}>
          <div className="h-full" style={{ width: `${Math.max(1, f.share * 100)}%`, background: 'var(--accent)', opacity: 0.55 }} />
        </div>
        <div className="mt-1 text-[0.6875rem] text-[var(--text-muted)]">
          {formatNumber(f.calls)} {f.calls === 1 ? 'call' : 'calls'}
          {perCall > 0 && <>, ${perCall.toFixed(5)} each</>}
          {/* Cached tokens are the prompt cache showing up as money rather than as a log line —
              the difference between a turn that read its prefix and one that rewrote it. */}
          {f.tokens_cached > 0 && <>, {formatNumber(f.tokens_cached)} cached tokens</>}
        </div>
      </div>

      <div className="w-24 flex-shrink-0 text-right">
        <div className="numeral text-[0.9375rem]">{money}</div>
        <div className="text-[0.6875rem] text-[var(--text-muted)]">{(f.share * 100).toFixed(1)}%</div>
      </div>

      <div className="w-24 flex-shrink-0">
        <Sparkline values={f.daily_usd} label={`${f.label}: daily spend`} />
      </div>
    </div>
  )
}
