import { daysUntil } from '../lib/dates'
import type { Deck } from '../types'

// Muted deliberately: four fully-saturated swatches stacked down a list read as decoration.
// Hues are unchanged, so a deck keeps the colour you already associate with it.
const MONOGRAM_COLORS = ['oklch(0.64 0.11 40)', 'oklch(0.58 0.07 145)', 'oklch(0.56 0.07 250)', 'oklch(0.56 0.1 340)']

interface Props {
  deck: Deck
  index: number
  onClick: () => void
  /** Opens the deck's cards for editing. Library-only: on Home a deck tile means "study this". */
  onEdit?: () => void
  onDelete?: () => void
}

export default function DeckTile({ deck, index, onClick, onEdit, onDelete }: Props) {
  const monogramColor = MONOGRAM_COLORS[index % MONOGRAM_COLORS.length]
  const subtitle = deck.exam_paused
    ? 'Exam passed — study anytime'
    : deck.due > 0 || deck.new > 0
      ? `${deck.due + deck.new} card${deck.due + deck.new > 1 ? 's' : ''} left today`
      : 'All caught up'
  const examDays = deck.next_exam ? daysUntil(deck.next_exam.date) : null
  // `learned` is total-minus-new (see decks.py) — cards you've *started*, not ones you've
  // mastered. Labelled accordingly rather than overclaiming progress.
  const startedPct = deck.total > 0 ? Math.round((deck.learned / deck.total) * 100) : 0

  return (
    <div
      className={`flex cursor-pointer items-center gap-3.5 rounded-[16px] border border-[var(--ring-track)] p-4 transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)] lg:flex-col lg:items-stretch lg:gap-3 lg:rounded-[18px] lg:p-5 ${
        deck.exam_paused ? 'opacity-60' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5 lg:flex-none lg:gap-3">
        <div
          className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-2xl text-[1.1875rem] font-extrabold"
          style={{ background: monogramColor, color: 'oklch(0.99 0.005 90)' }}
        >
          {deck.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-bold">{deck.name}</div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</div>
        </div>
      </div>

      {/* Fills what used to be dead space with something actually useful — how far into the deck
          you are — instead of decorative chrome. Hidden on mobile's compact row, where the badges
          on the right already carry the "what do I do next" signal. */}
      <div className="hidden lg:block">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[0.6875rem] font-semibold text-[var(--text-secondary)]">
            {deck.learned} of {deck.total} started
          </span>
          <span className="text-[0.6875rem] font-bold text-[var(--text-secondary)]">{startedPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ring-track)]">
          <div className="h-full rounded-full transition-all" style={{ width: `${startedPct}%`, background: monogramColor }} />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* Paused replaces the whole badge row: due/new counts would contradict the deck being
            off the daily list, and ✓ done would overclaim. */}
        {deck.exam_paused ? (
          <span
            className="rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
            style={{ color: 'var(--text-secondary)', background: 'var(--ring-track)' }}
          >
            exam passed
          </span>
        ) : (
          <>
            {examDays !== null && examDays >= 0 && (
              <span
                title={deck.next_exam!.name}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                style={{ color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                {examDays === 0 ? 'today' : `${examDays}d`}
              </span>
            )}
            {deck.due > 0 && (
              <span
                className="rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                style={{ color: 'var(--grade-forgot)', background: 'var(--grade-forgot-bg)' }}
              >
                {deck.due} due
              </span>
            )}
            {deck.new > 0 && (
              <span
                className="rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                style={{
                  color: 'var(--accent)',
                  background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))',
                  boxShadow: 'var(--highlight-shadow)',
                }}
              >
                {deck.new} new
              </span>
            )}
            {deck.due === 0 && deck.new === 0 && (
              <span
                className="rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                style={{ color: 'var(--grade-good)', background: 'var(--grade-good-bg)' }}
              >
                ✓ done
              </span>
            )}
          </>
        )}
        {onEdit && (
          <button
            onClick={(e) => {
              // The tile itself starts a study session, so every control inside it has to stop
              // the click from reaching the tile.
              e.stopPropagation()
              onEdit()
            }}
            aria-label={`Edit ${deck.name}`}
            className="ml-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:text-[var(--accent)] lg:ml-auto"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            aria-label={`Delete ${deck.name}`}
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--grade-forgot-bg)] hover:text-[var(--grade-forgot)] ${
              onEdit ? '' : 'ml-1 lg:ml-auto'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
