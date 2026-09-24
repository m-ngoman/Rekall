import { formatDayLong } from '../../lib/dates'
import type { ExamOffer } from './types'

interface Props {
  offer: ExamOffer
  onDismiss: () => void
  onAdd: () => void
}

/** The tutor's offer to add an exam, as a row in the log.
 *
 * A divided row on the page, not a surface card: the accent-stroked glyph and the
 * green "Added" tick were both outside the four jobs the accent and the grade colours
 * have. The confirmation is plain muted text now, which is all it ever needed to be.
 */
export function ExamOfferRow({ offer, onDismiss, onAdd }: Props) {
  return (
    <div className="flex items-center gap-3 self-stretch border-y border-[var(--rule)] py-3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.875rem] font-bold">{offer.name}</div>
        <div className="text-[0.8125rem] text-[var(--text-muted)]">{formatDayLong(offer.date)}</div>
      </div>
      {offer.added ? (
        <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">Added to your calendar</span>
      ) : (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={onDismiss}
            className="flex h-10 items-center rounded-[var(--r-sm)] px-3 text-[0.875rem] font-semibold text-[var(--text-muted)]"
          >
            Not now
          </button>
          <button
            onClick={onAdd}
            className="flex h-10 items-center rounded-[var(--r-sm)] px-3 text-[0.875rem] font-bold"
          >
            Add to calendar
          </button>
        </div>
      )}
    </div>
  )
}

/** The same offer on the voice stage, which covers the log while it is up. */
export function StageExamOffer({ offer, onDismiss, onAdd }: Props) {
  return (
    <div className="mx-auto mb-4 flex w-[min(26rem,88%)] items-center gap-3 rounded-[16px] px-4 py-3"
      style={{ background: 'rgb(255 255 255 / 0.08)', border: '1px solid rgb(255 255 255 / 0.14)' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white/90">{offer.name}</div>
        <div className="text-xs text-white/50">{formatDayLong(offer.date)}</div>
      </div>
      {offer.added ? (
        <span className="flex-shrink-0 text-[0.8125rem] text-white/50">Added to your calendar</span>
      ) : (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button onClick={onDismiss} className="flex h-9 items-center rounded-[var(--r-sm)] px-3 text-[0.8125rem] font-bold text-white/45">
            Not now
          </button>
          {/* The one primary button on this stage, so it keeps the accent fill — but with
              .on-accent rather than a literal near-white, which is the rule everywhere
              else in the app. */}
          <button
            onClick={onAdd}
            className="on-accent flex h-9 items-center rounded-[var(--r-full)] px-4 text-[0.8125rem] font-bold"
            style={{ background: 'var(--accent)' }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
