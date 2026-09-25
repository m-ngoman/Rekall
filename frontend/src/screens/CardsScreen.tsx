import { useState } from 'react'
import { listDecks } from '../api'
import ActionCard from '../components/ActionCard'
import DeckTile from '../components/DeckTile'
import LoadNotice from '../components/LoadNotice'
import { useCachedResource } from '../hooks/useCachedResource'
import type { Deck } from '../types'
import GenerateScreen from './GenerateScreen'
import ImportScreen from './ImportScreen'
import WriteCardsScreen from './WriteCardsScreen'

interface Props {
  onStudy: (deckId: string) => void
  /** Forwarded to GenerateScreen, which is the paid feature living under this tab. */
  onOpenPricing: () => void
  onChanged: () => void
  /** False when AI card generation is off in settings. Import and hand-written cards are
   * unaffected — turning AI off removes a route to cards, not the ability to have any. */
  aiGeneration: boolean
}

export default function CardsScreen({ onStudy, onChanged, aiGeneration, onOpenPricing }: Props) {
  const [decks, setDecks, decksStatus] = useCachedResource<Deck[]>('decks', listDecks)
  // Phone only: the ways in, folded under "Add cards" once there's a library to lead with.
  const [addOpen, setAddOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [writing, setWriting] = useState(false)
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)

  if (writing || editingDeckId) {
    return (
      <WriteCardsScreen
        deckId={editingDeckId ?? undefined}
        onDone={(changed) => {
          setWriting(false)
          setEditingDeckId(null)
          if (changed) {
            onChanged()
            listDecks().then(setDecks)
          }
        }}
      />
    )
  }

  if (importing) {
    return (
      <ImportScreen
        onDone={() => {
          setImporting(false)
          onChanged()
          listDecks().then(setDecks)
        }}
        onCancel={() => setImporting(false)}
      />
    )
  }

  if (generating) {
    return (
      <GenerateScreen
        onOpenPricing={onOpenPricing}
        onDone={() => {
          setGenerating(false)
          onChanged()
          listDecks().then(setDecks)
        }}
        onCancel={() => setGenerating(false)}
      />
    )
  }

  const totalCards = decks?.reduce((sum, d) => sum + d.total, 0) ?? 0

  const WRITE_ICON = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
  const IMPORT_ICON = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
  const GENERATE_ICON = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 16.6l-1.9-4.9L5.2 9.8l4.9-1.9L12 3z" />
    </svg>
  )

  /** The three ways in, as text buttons. Desktop only: they collapse to a row above the library
   * so the library itself can have the width, instead of a phone-shaped panel pinned beside it. */
  const waysIn = (
    <div className="hidden flex-shrink-0 items-center gap-1 lg:flex">
      {[
        { label: 'Write your own', icon: WRITE_ICON, onClick: () => setWriting(true), off: false },
        { label: 'Import CSV', icon: IMPORT_ICON, onClick: () => setImporting(true), off: false },
        { label: 'Generate with AI', icon: GENERATE_ICON, onClick: () => setGenerating(true), off: !aiGeneration },
      ].map((w) => (
        <button
          key={w.label}
          onClick={w.onClick}
          disabled={w.off}
          title={w.off ? 'Turned off in Settings, under AI features' : undefined}
          className="flex h-10 items-center gap-2 rounded-[var(--r-sm)] px-3 text-[0.875rem] font-bold disabled:cursor-not-allowed"
          style={{ opacity: w.off ? 0.45 : 1 }}
        >
          <span className="flex text-[var(--text-muted)]">{w.icon}</span>
          {w.label}
        </button>
      ))}
    </div>
  )

  // The phone's ways in are three rows with a line each, which is right for someone with nothing
  // yet and in the way for everyone else: a returning user opening this tab is almost always
  // after the library. So they lead only while the library is empty, and otherwise wait behind
  // "Add cards" above it. Unknown while the first load is out, so nothing is drawn for them yet.
  const empty = decks !== null && decks.length === 0
  const waysInPanel = (
    <div className="divide-y divide-[var(--rule)] overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)] lg:hidden [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
      <ActionCard
        onClick={() => setWriting(true)}
        title="Write your own"
        description="Type questions and answers yourself"
        icon={WRITE_ICON}
      />
      <ActionCard
        onClick={() => setImporting(true)}
        title="Import CSV"
        description="From a spreadsheet or export"
        icon={IMPORT_ICON}
      />
      <ActionCard
        onClick={() => setGenerating(true)}
        disabled={!aiGeneration}
        disabledHint="Turned off in Settings, under AI features"
        title="Generate with AI"
        description="From photos of your notes, a PDF or a topic"
        icon={GENERATE_ICON}
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-7">
      {/* Phone keeps the panel: one surface, three rows, inset dividers. The ways in are choices,
          not cards, and on a 390px screen a row of text buttons would not fit. */}
      {empty && waysInPanel}

      <div>
        {/* Phone: the title and count on the left, "Add cards" on the right once there are decks.
            Desktop: the count moves left and the three ways in take the right of the same row, so
            nothing sits in a column of its own. */}
        <div className="mb-3 flex items-center justify-between gap-4 lg:mb-2">
          <div className="flex min-w-0 flex-col lg:flex-row lg:items-baseline">
            <span className="text-[1.0625rem] font-bold tracking-[-0.01em] lg:hidden">Library</span>
            {decks !== null && decks.length > 0 && (
              <span className="text-[0.8125rem] text-[var(--text-muted)] lg:text-[0.875rem]">
                {decks.length} deck{decks.length === 1 ? '' : 's'}, {totalCards.toLocaleString()} card{totalCards === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {!empty && (
            // Outline, like "Add notes" and "Add exam": a way to more, beside the thing itself.
            <button
              onClick={() => setAddOpen((open) => !open)}
              aria-expanded={addOpen}
              className="flex h-10 flex-shrink-0 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.875rem] font-bold lg:hidden"
              style={{ background: addOpen ? 'var(--surface)' : undefined }}
            >
              Add cards
            </button>
          )}
          {waysIn}
        </div>
        {!empty && addOpen && <div className="mb-4">{waysInPanel}</div>}
        {decks === null ? (
          decksStatus.failed ? (
            <LoadNotice stale={false} what="your decks" onRetry={decksStatus.retry} />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          )
        ) : decks.length === 0 ? (
          <p className="py-6 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
            No decks yet. Write a few cards, import a CSV, or generate from your notes, and they'll show up here.
          </p>
        ) : (
          <>
            {decksStatus.failed && <LoadNotice stale what="your decks" onRetry={decksStatus.retry} className="mb-3" />}
            {/* Rows on the page with a rule above the first, not a grid of tiles. A library is a
                list, and drawing it as cards is what made every screen look like the same screen. */}
            <div className="border-t border-[var(--rule)]">
              {decks.map((deck) => (
                <DeckTile
                  key={deck.id}
                  deck={deck}
                  variant="row"
                  onClick={() => onStudy(deck.id)}
                  onEdit={() => setEditingDeckId(deck.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
