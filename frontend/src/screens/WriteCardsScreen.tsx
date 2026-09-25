import { useEffect, useRef, useState } from 'react'
import { createCard, createDeck, deleteCard, deleteDeck, listCards, listDecks, renameDeck, updateCard } from '../api'
import type { Card, Deck } from '../types'
import { useConfirm } from '../hooks/useConfirm'
import BackButton from '../components/BackButton'
import ConfirmDialog from '../components/ConfirmDialog'
import MaybeMath from '../components/MaybeMath'
import Notice from '../components/Notice'

interface Props {
  /** Opens straight into one deck and hides the picker — this is the "edit this deck" entry
   * from the library, as opposed to the open-ended "write some cards" one. */
  deckId?: string
  /** Called on the way out, with whether anything was actually written — the library only needs
   * to refetch if it did. */
  onDone: (changed: boolean) => void
}

const NEW_DECK = '__new__'

/** Writing cards by hand, and the library's editor for one deck.
 *
 * Writing: the deck is chosen once and then stays out of the way. The point is typing a run of
 * cards, so after each save the form clears and returns focus to the question rather than making
 * you re-confirm where they're going.
 *
 * Editing a deck from the library is the other way round. What you came for is the cards already
 * in it, so they come first, searchable, and editable in place, which is also the only way to fix
 * a typo anywhere in the app. The form waits behind "Add card", and deleting the deck sits behind
 * the pencil on its name, the way removing a category does on Notes. It used to open on a red
 * "Delete this deck" and then a blank form, with the cards below the fold: routine maintenance
 * laid out like creation, with the destructive action first.
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
  /** Anything the library shows that moved — a count or the deck's name, not a card's text — so it
   * knows whether it has to refetch on the way out. */
  const [libraryChanged, setLibraryChanged] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Deck editor only: the add form is open. Writing mode has no other content, so it's always open. */
  const [adding, setAdding] = useState(false)
  /** Deck editor only: the name is being edited, which is also where deleting the deck lives. */
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  /** Set once a rename has been saved, abandoned or given up for delete, so the blur that can
   * follow the field's removal doesn't settle it a second time — saving a name Escape abandoned,
   * or sending the same rename twice. CategoryNameInput guards the same way. */
  const renameSettled = useRef(false)
  const { confirmation, ask, cancel } = useConfirm()

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
      .then((c) => {
        if (!alive) return
        setCards(c)
        // An empty deck has nothing to look at yet, so the editor opens on the form.
        if (locked && c.length === 0) setAdding(true)
      })
      .catch(() => alive && setCards([]))
    return () => {
      alive = false
    }
  }, [deckId, locked])

  const canSave = question.trim().length > 0 && answer.trim().length > 0 && !busy
  const formOpen = !locked || adding
  const deckName = decks?.find((d) => d.id === deckId)?.name ?? 'Deck'

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
      setLibraryChanged(true)
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

  const handleDelete = (id: string) => {
    ask({
      title: 'Delete this card?',
      body: 'Its review history goes with it.',
      confirmLabel: 'Delete card',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteCard(id)
          setCards((prev) => prev?.filter((c) => c.id !== id) ?? null)
          setLibraryChanged(true)
        } catch {
          setError("Couldn't delete that card.")
        }
      },
    })
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

  const handleDeleteDeck = () => {
    const count = cards?.length ?? 0
    ask({
      title: `Delete ${deckName}?`,
      body: `${count === 0 ? 'The deck' : `All ${count} card${count === 1 ? '' : 's'} and their`} study history will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete deck',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteDeck(deckId)
          onDone(true)
        } catch {
          setError('Could not delete that deck.')
        }
      },
    })
  }

  const finishRename = async () => {
    if (renameSettled.current) return
    renameSettled.current = true
    setRenaming(false)
    const name = nameDraft.trim()
    if (!name || name === deckName) return
    try {
      const renamed = await renameDeck(deckId, name)
      setDecks((prev) => prev?.map((d) => (d.id === renamed.id ? renamed : d)) ?? null)
      setLibraryChanged(true)
    } catch {
      setError("Couldn't rename that deck.")
    }
  }

  const openForm = () => {
    setError(null)
    setAdding(true)
  }

  const form = (
    <div className="flex flex-col gap-2.5 rounded-[var(--r-md)] bg-[var(--surface)] p-4">
      <Field label="Question">
        <textarea
          ref={questionRef}
          // The deck editor opens this on request, so the request is where typing starts. Writing
          // mode opens on the deck picker, and that is where focus belongs there.
          autoFocus={locked}
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

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 text-[0.8125rem] text-[var(--text-muted)]">
          {addedCount > 0 ? `${addedCount} card${addedCount === 1 ? '' : 's'} added` : 'Ctrl+Enter also saves'}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {locked && (
            <button
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              className="min-h-[44px] rounded-[var(--r-full)] px-3.5 text-[0.875rem] font-bold text-[var(--text-muted)]"
            >
              Done
            </button>
          )}
          <button
            onClick={handleAdd}
            disabled={!canSave}
            className="on-accent min-h-[44px] rounded-[var(--r-full)] px-5 text-[0.875rem] font-bold disabled:opacity-50"
          >
            {busy ? 'Saving' : 'Add card'}
          </button>
        </div>
      </div>
    </div>
  )

  const search = (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search these cards"
      className="h-11 w-full min-w-0 rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
    />
  )

  // One list, ruled rows: a border round every card would be a box per item, which the deck
  // tiles already avoid.
  const list = cards !== null && cards.length > 0 && (
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
              <div className="text-[0.9375rem] font-bold [text-wrap:pretty]"><MaybeMath text={card.question} math={card.is_math} /></div>
              <div className="mt-0.5 text-sm text-[var(--text-muted)] [text-wrap:pretty]"><MaybeMath text={card.answer} math={card.is_math} /></div>
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
  )

  // Only once a deck is big enough for scrolling to be the slower way to find a card.
  const searchable = cards !== null && cards.length > 8

  if (locked) {
    return (
      <div>
        <ConfirmDialog confirmation={confirmation} onCancel={cancel} />
        <BackButton onClick={() => onDone(libraryChanged)} className="mb-3">Back</BackButton>

        {renaming ? (
          // Renaming is also where deleting lives, as removing a category does on Notes: the one
          // destructive thing on this screen, two deliberate taps away and never beside a control
          // you'd reach for in routine editing. Leaving the pair (tapping away, Tab past the
          // button, Enter) saves the name; Escape abandons it.
          <div
            className="mb-4 flex items-center gap-2"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finishRename()
            }}
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename()
                if (e.key === 'Escape') {
                  renameSettled.current = true
                  setRenaming(false)
                }
              }}
              maxLength={80}
              aria-label="Deck name"
              className="h-11 min-w-0 flex-1 rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[1.0625rem] font-bold"
            />
            <button
              // Keeps the name field focused through a mouse press, so the blur above doesn't
              // close the row before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                renameSettled.current = true
                setRenaming(false)
                handleDeleteDeck()
              }}
              className="flex h-11 flex-shrink-0 items-center rounded-[var(--r-sm)] px-2 text-[0.875rem] font-semibold"
              style={{ color: 'var(--grade-forgot)' }}
            >
              Delete deck
            </button>
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[1.25rem] font-bold tracking-tight">{deckName}</span>
              {cards !== null && (
                <>
                  <span className="numeral flex-shrink-0 text-[1.25rem]">{cards.length}</span>
                  <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">card{cards.length === 1 ? '' : 's'}</span>
                </>
              )}
            </div>
            <button
              onClick={() => {
                renameSettled.current = false
                setNameDraft(deckName)
                setRenaming(true)
              }}
              aria-label={`Rename or delete ${deckName}`}
              className="-mr-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </button>
          </div>
        )}

        {(searchable || !formOpen) && (
          <div className="mb-3 flex items-center gap-2">
            {searchable && <div className="min-w-0 flex-1">{search}</div>}
            {!formOpen && (
              // Outline, like "Add notes" and "Add exam": the list is what this screen is for.
              <button
                onClick={openForm}
                className="flex h-11 flex-shrink-0 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.9375rem] font-bold"
              >
                Add card
              </button>
            )}
          </div>
        )}

        {formOpen ? <div className="mb-5">{form}</div> : error && <Notice tone="error" className="mb-3">{error}</Notice>}

        {list}
      </div>
    )
  }

  return (
    <div>
      <ConfirmDialog confirmation={confirmation} onCancel={cancel} />
      <BackButton onClick={() => onDone(libraryChanged)} className="mb-3">Back</BackButton>
      <p className="mb-5 text-sm text-[var(--text-muted)]">
        Type a question and the answer you'd accept as correct. Grading compares what you typed against
        this answer, so keep it to the points you'd want to get credit for.
      </p>

      <div className="mb-5">
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

      {form}

      {cards !== null && cards.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-bold">In this deck</span>
            <span className="text-[0.8125rem] text-[var(--text-muted)]">
              {cards.length} card{cards.length === 1 ? '' : 's'}
            </span>
          </div>
          {searchable && <div className="mb-3">{search}</div>}
          {list}
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
          className="on-accent min-h-[44px] rounded-[var(--r-full)] px-4 text-[0.875rem] font-bold disabled:opacity-50"
        >
          Save changes
        </button>
      </div>
    </div>
  )
}
