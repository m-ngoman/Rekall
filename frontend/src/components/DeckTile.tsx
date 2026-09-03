import type { Deck } from '../types'

interface Props {
  deck: Deck
  /** Unused since the monogram colours went; accepted so the library's call sites compile. */
  index?: number
  onClick: () => void
  /** Opens the deck's cards for editing. Library-only: on Home a deck tile means "study this". */
  onEdit?: () => void
  onDelete?: () => void
}

/** The one thing in Rekall that is allowed to be a card: an actual deck. Surface fill, medium
 * radius, no border, no badges — the counts are text, and the accent stays out of it. */
export default function DeckTile({ deck, onClick, onEdit, onDelete }: Props) {
  const left = deck.due + deck.new
  const status = deck.exam_paused
    ? 'Exam passed. Study anytime.'
    : left > 0
      ? `${left} left today`
      : 'Done for today'

  return (
    <div
      className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3.5 ${
        deck.exam_paused ? 'opacity-60' : ''
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.9375rem] font-bold">{deck.name}</div>
        <div className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{status}</div>
      </div>
      <div className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">
        {deck.total} card{deck.total === 1 ? '' : 's'}
      </div>
      {/* The two actions ride together with no gap between them and overhang the tile's right
          padding. Each keeps its full 44px touch target; what's reclaimed is the dead space
          around the 16px glyphs, which is what was truncating deck names on a 390px phone. */}
      {(onEdit || onDelete) && (
        <div className="-mr-3 flex flex-shrink-0">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              aria-label={`Edit ${deck.name}`}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className="flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
