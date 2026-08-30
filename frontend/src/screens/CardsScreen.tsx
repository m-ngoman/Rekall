import { useState } from 'react'
import { deleteDeck, listDecks } from '../api'
import ActionCard from '../components/ActionCard'
import DeckTile from '../components/DeckTile'
import { useCachedResource } from '../hooks/useCachedResource'
import type { Deck } from '../types'
import GenerateScreen from './GenerateScreen'
import ImportScreen from './ImportScreen'
import WriteCardsScreen from './WriteCardsScreen'

interface Props {
  onStudy: (deckId: string) => void
  onChanged: () => void
}

export default function CardsScreen({ onStudy, onChanged }: Props) {
  const [decks, setDecks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const [importing, setImporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [writing, setWriting] = useState(false)
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this deck and all study history?')) return
    await deleteDeck(id)
    setDecks((prev) => prev?.filter((d) => d.id !== id) ?? null)
    onChanged()
  }

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

  return (
    <div className="flex flex-col gap-6">
      {/* Horizontal cards with a line of explanation each, rather than two bare icon+label
          squares — the two routes in do genuinely different things and the labels alone didn't
          say which to pick. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionCard
          onClick={() => setWriting(true)}
          title="Write your own"
          description="Type questions and answers yourself"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
          }
        />
        <ActionCard
          onClick={() => setImporting(true)}
          title="Import CSV"
          description="From a spreadsheet or export"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
        />
        <ActionCard
          onClick={() => setGenerating(true)}
          title="Generate with AI"
          description="From photos of your notes or a PDF"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 16.6l-1.9-4.9L5.2 9.8l4.9-1.9L12 3z" />
            </svg>
          }
        />
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-base font-extrabold">Your Library</span>
          {decks !== null && decks.length > 0 && (
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              {decks.length} deck{decks.length === 1 ? '' : 's'} · {totalCards} card{totalCards === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {decks === null ? (
          <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
        ) : decks.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--ring-track)] p-10 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              No decks yet — pick one of the two options above to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
            {decks.map((deck, i) => (
              <DeckTile
                key={deck.id}
                deck={deck}
                index={i}
                onClick={() => onStudy(deck.id)}
                onEdit={() => setEditingDeckId(deck.id)}
                onDelete={() => handleDelete(deck.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
