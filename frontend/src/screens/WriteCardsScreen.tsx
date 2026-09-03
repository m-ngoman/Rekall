import { useEffect, useRef, useState } from 'react'
import { createCard, createDeck, deleteCard, listCards, listDecks, updateCard } from '../api'
import type { Card, Deck } from '../types'

interface Props {
  /** Opens straight into one deck and hides the picker — this is the "edit this deck" entry
   * from the library, as opposed to the open-ended "write some cards" one. */
  deckId?: string
  /** Called on the way out, with whether anything was actually written — the library only needs
   * to refetch if it did. */
  onDone: (changed: boolean) => void
}

const NEW_DECK = '__new__'

/** Writing cards by hand.
 *
 * The deck is chosen once and then stays out of the way: the point of this screen is typing a
 * run of cards, so after each save the form clears and returns focus to the question rather than
 * making you re-confirm where they're going. Cards already in the deck are listed underneath and
 * editable in place, which is also the only way to fix a typo anywhere in the app.
 */
export default function WriteCardsScreen({ deckId: fixedDeckId, onDone }: Props) {
  const locked = fixedDeckId !== undefined
  const [decks, setDecks] = useState<Deck[] | null>(null)
  const [deckId, setDeckId] = useState(fixedDeckId ?? '')
  const [query, setQuery] = useState('')
  const [newDeckName, setNewDeckName] = useState('')
  const [cards, setCards] = useState<Card[] | null>(null)

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addedCount, setAddedCount] = useState(0)
  /** Any change that moves a deck's card counts — adding or deleting, not editing text — so the
   * library knows whether it has to refetch on the way out. */
  const [countsChanged, setCountsChanged] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const questionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listDecks()
      .then((d) => {
        setDecks(d)
        if (locked) return
        // Pre-select the most recent deck: writing into the one you were just working in is the
        // overwhelmingly common case, and it's a single tap to change.
        if (d.length > 0) setDeckId(d[0].id)
        else setDeckId(NEW_DECK)
      })
      .catch(() => setError('Could not load your decks.'))
  }, [locked])

  useEffect(() => {
    if (!deckId || deckId === NEW_DECK) {
      setCards(null)
      return
    }
    let alive = true
    listCards(deckId)
      .then((c) => alive && setCards(c))
      .catch(() => alive && setCards([]))
    return () => {
      alive = false
    }
  }, [deckId])

  const canSave = question.trim().length > 0 && answer.trim().length > 0 && !busy

  const needle = query.trim().toLowerCase()
  const visibleCards = !needle
    ? cards ?? []
    : (cards ?? []).filter(
        (c) =>
          c.question.toLowerCase().includes(needle) ||
          c.answer.toLowerCase().includes(needle) ||
          (c.subtopic ?? '').toLowerCase().includes(needle),
      )

  const handleAdd = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      // A brand-new deck is created on the first save rather than when it's typed, so abandoning
      // this screen can't leave an empty deck behind.
      let targetId = deckId
      if (targetId === NEW_DECK) {
        const name = newDeckName.trim()
        if (!name) {
          setError('Give the new deck a name first.')
          setBusy(false)
          return
        }
        const deck = await createDeck(name)
        targetId = deck.id
        setDecks((prev) => [deck, ...(prev ?? [])])
        setDeckId(deck.id)
        setCards([])
      }

      const card = await createCard(targetId, {
        question: question.trim(),
        answer: answer.trim(),
        subtopic: subtopic.trim(),
      })
      setCards((prev) => [card, ...(prev ?? [])])
      setAddedCount((n) => n + 1)
      setCountsChanged(true)
      setQuestion('')
      setAnswer('')
      // Subtopic deliberately persists: a run of cards usually shares one, and retyping "Photosynthesis"
      // twelve times is exactly the kind of friction that makes people stop writing cards.
      questionRef.current?.focus()
    } catch {
      setError("Couldn't save that card. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this card?')) return
    try {
      await deleteCard(id)
      setCards((prev) => prev?.filter((c) => c.id !== id) ?? null)
      setCountsChanged(true)
    } catch {
      setError("Couldn't delete that card.")
    }
  }

  const handleSaveEdit = async (id: string, patch: { question: string; answer: string; subtopic: string }) => {
    try {
      const updated = await updateCard(id, patch)
      setCards((prev) => prev?.map((c) => (c.id === id ? updated : c)) ?? null)
      setEditingId(null)
    } catch {
      setError("Couldn't save that change.")
    }
  }

  return (
    <div>
      <button onClick={() => onDone(countsChanged)} className="-ml-2 mb-3 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
      {locked ? (
        <div className="mb-5">
          <div className="text-[1.25rem] font-bold tracking-tight">
            {decks?.find((d) => d.id === deckId)?.name ?? 'Deck'}
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every card in this deck. Tap the pencil to fix one, or add more below.
          </p>
        </div>
      ) : (
        <p className="mb-5 text-sm text-[var(--text-muted)]">
          Type a question and the answer you'd accept as correct. Grading compares what you say or write against
          this answer, so write it the way you'd actually say it out loud.
        </p>
      )}

      <div className={locked ? 'hidden' : 'mb-5'}>
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Add to</div>
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
        >
          <option value={NEW_DECK}>New deck, I'll name it</option>
          {decks?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.total})
            </option>
          ))}
        </select>

        {deckId === NEW_DECK && (
          <input
            autoFocus
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            disabled={busy}
            placeholder="Deck name"
            maxLength={80}
            className="mt-2 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
          />
        )}
      </div>

      <div className="flex flex-col gap-2.5 rounded-[var(--r-md)] bg-[var(--surface)] p-4">
        <Field label="Question">
          <textarea
            ref={questionRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            // Ctrl/Cmd+Enter saves from either field — writing a run of cards is a keyboard task,
            // and reaching for the mouse every card is what makes bulk entry tedious.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd()
            }}
            disabled={busy}
            rows={2}
            placeholder="What produces ATP in a cell?"
            className="w-full resize-none rounded-[var(--r-sm)] bg-[var(--bg)] px-3.5 py-2.5 text-[0.9375rem]"
          />
        </Field>

        <Field label="Answer">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd()
            }}
            disabled={busy}
            rows={2}
            placeholder="The mitochondria"
            className="w-full resize-none rounded-[var(--r-sm)] bg-[var(--bg)] px-3.5 py-2.5 text-[0.9375rem]"
          />
        </Field>

        <Field label="Topic (optional)">
          <input
            value={subtopic}
            onChange={(e) => setSubtopic(e.target.value)}
            disabled={busy}
            maxLength={60}
            placeholder="Cell biology"
            className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--bg)] px-3.5 text-[0.9375rem]"
          />
        </Field>

        {error && <p className="text-sm font-semibold text-[var(--grade-forgot)]">{error}</p>}

        <div className="mt-1 flex items-center justify-between">
          <span className="text-[0.8125rem] text-[var(--text-muted)]">
            {addedCount > 0 ? `${addedCount} card${addedCount === 1 ? '' : 's'} added` : 'Ctrl+Enter also saves'}
          </span>
          <button
            onClick={handleAdd}
            disabled={!canSave}
            className="on-accent min-h-[44px] rounded-[var(--r-full)] bg-[var(--accent)] px-5 text-[0.875rem] font-bold disabled:opacity-50"
          >
            {busy ? 'Saving' : 'Add card'}
          </button>
        </div>
      </div>

      {cards !== null && cards.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-bold">In this deck</span>
            <span className="text-[0.8125rem] text-[var(--text-muted)]">
              {cards.length} card{cards.length === 1 ? '' : 's'}
            </span>
          </div>
          {/* Only once a deck is big enough for scrolling to be the slower way to find a card. */}
          {cards.length > 8 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search these cards"
              className="mb-3 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
            />
          )}
          {/* One list, ruled rows: a border round every card would be a box per item, which the
              deck tiles already avoid. */}
          <div className="flex flex-col border-t border-[var(--rule)]">
            {visibleCards.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">No cards match "{query}".</p>
            )}
            {visibleCards.map((card) =>
              editingId === card.id ? (
                <CardEditor
                  key={card.id}
                  card={card}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) => handleSaveEdit(card.id, patch)}
                />
              ) : (
                <div
                  key={card.id}
                  className="flex items-start gap-3 border-b border-[var(--rule)] py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    {card.subtopic && <div className="mb-0.5 text-[0.8125rem] font-semibold text-[var(--text-muted)]">{card.subtopic}</div>}
                    <div className="text-[0.9375rem] font-bold">{card.question}</div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">{card.answer}</div>
                  </div>
                  <div className="-mr-2 flex flex-shrink-0 items-center">
                    <IconButton label="Edit card" onClick={() => setEditingId(card.id)}>
                      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
                    </IconButton>
                    <IconButton label="Delete card" danger onClick={() => handleDelete(card.id)}>
                      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
                    </IconButton>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  )
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] ${
        danger ? 'text-[var(--text-muted)] hover:text-[var(--grade-forgot)]' : 'text-[var(--text-muted)]'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

/** Edits happen in place in the list rather than in a modal: you're usually fixing one word, and
 * the card either side is the context that tells you what to fix. */
function CardEditor({
  card,
  onCancel,
  onSave,
}: {
  card: Card
  onCancel: () => void
  onSave: (patch: { question: string; answer: string; subtopic: string }) => void
}) {
  const [question, setQuestion] = useState(card.question)
  const [answer, setAnswer] = useState(card.answer)
  const [subtopic, setSubtopic] = useState(card.subtopic ?? '')

  const valid = question.trim().length > 0 && answer.trim().length > 0

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r-md)] bg-[var(--surface)] p-3">
      <textarea
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2 text-[0.9375rem]"
      />
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2 text-[0.9375rem]"
      />
      <input
        value={subtopic}
        onChange={(e) => setSubtopic(e.target.value)}
        maxLength={60}
        placeholder="Topic (optional)"
        className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--bg)] px-3 text-[0.9375rem]"
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="min-h-[44px] rounded-[var(--r-full)] px-3.5 text-[0.875rem] font-bold text-[var(--text-muted)]">
          Cancel
        </button>
        <button
          onClick={() => onSave({ question: question.trim(), answer: answer.trim(), subtopic: subtopic.trim() })}
          disabled={!valid}
          className="on-accent min-h-[44px] rounded-[var(--r-full)] bg-[var(--accent)] px-4 text-[0.875rem] font-bold disabled:opacity-50"
        >
          Save changes
        </button>
      </div>
    </div>
  )
}
