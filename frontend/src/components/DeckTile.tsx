import type { Deck } from '../types'

interface Props {
  deck: Deck
  /** Unused since the monogram colours went; accepted so the library's call sites compile. */
  index?: number
  onClick: () => void
  /** Opens the deck's cards for editing. Library-only: on Home a deck tile means "study this". */
  onEdit?: () => void
  /** `card` is Home's tile; `row` is the library, which is a list and so is drawn as rows. */
  variant?: 'card' | 'row'
}

/** A deck. The one thing in Rekall still allowed to be a card — everything else that used to be
 * one is a row on the page now, which is what stopped every screen looking like the same screen.
 *
 * The total moved into the condensed face. It is the number you actually read off a deck, and
 * setting it like the countdown is what stops a deck row and an exam row looking alike.
 */
export default function DeckTile({ deck, onClick, onEdit, variant = 'card' }: Props) {
  const left = deck.due + deck.new
  const status = deck.exam_paused
    ? 'Exam passed. Study anytime.'
    : left > 0
      ? `${left} left today`
      : 'Done for today'

  // Paused decks used to sit at 0.6 opacity, which dragged the muted status line under 4.5:1.
  // Muting the *name* says the same thing with tokens that already pass.
  const nameColor = deck.exam_paused ? 'var(--text-muted)' : undefined

  const total = (
    <div className="flex flex-shrink-0 items-baseline gap-1">
      <span className="numeral text-[1.25rem]" style={{ color: nameColor }}>
        {deck.total}
      </span>
      <span className="text-[0.6875rem] text-[var(--text-muted)]">card{deck.total === 1 ? '' : 's'}</span>
    </div>
  )

  const edit = onEdit && (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onEdit()
      }}
      aria-label={`Edit ${deck.name}`}
      className="-mr-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
        <path d="M13.5 6.5l4 4" />
      </svg>
    </button>
  )

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  // The library. Divided rows on the page, and on desktop a real grid so the name, the status and
  // the count each get a column instead of being crushed into a phone-width strip.
  if (variant === 'row') {
    return (
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={keys}
        className="flex cursor-pointer items-center gap-3 border-b border-[var(--rule)] py-2 lg:grid lg:grid-cols-[minmax(0,1fr)_220px_140px_44px] lg:items-center lg:gap-x-6 lg:py-2.5"
      >
        <div className="min-w-0 flex-1 lg:flex-none">
          <div className="truncate text-[0.9375rem] font-bold" style={{ color: nameColor }}>
            {deck.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)] lg:hidden">{status}</div>
        </div>
        <div className="hidden text-[0.8125rem] text-[var(--text-muted)] lg:block">{status}</div>
        {total}
        {edit}
      </div>
    )
  }

  return (
    <div
      className="flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3 lg:flex-col lg:items-start lg:gap-3 lg:px-4.5 lg:py-4"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={keys}
    >
      <div className="min-w-0 flex-1 lg:w-full lg:flex-none">
        <div className="truncate text-[0.9375rem] font-bold" style={{ color: nameColor }}>
          {deck.name}
        </div>
        <div className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{status}</div>
      </div>
      {/* Desktop puts the total at the foot of the card in a bigger numeral: the card is a tile in
          a four-up grid there, not a row, so the number has somewhere to land. */}
      <div className="flex flex-shrink-0 items-baseline gap-1 lg:hidden">
        <span className="numeral text-[1.25rem]" style={{ color: nameColor }}>{deck.total}</span>
        <span className="text-[0.6875rem] text-[var(--text-muted)]">card{deck.total === 1 ? '' : 's'}</span>
      </div>
      <div className="hidden items-baseline gap-1.5 lg:flex">
        <span className="numeral text-[1.75rem]" style={{ color: nameColor }}>{deck.total}</span>
        <span className="text-[0.8125rem] text-[var(--text-muted)]">card{deck.total === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
