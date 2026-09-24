import { useEffect, useState } from 'react'
import { createDeck, createTextNote, deleteNote, getNote, listDecks, listNotes, moveNote, renameDeck, unfileCategory } from '../api'
import { getCached, setCached, useCachedResource } from '../hooks/useCachedResource'
import Notice from '../components/Notice'
import ConfirmDialog from '../components/ConfirmDialog'
import { useConfirm } from '../hooks/useConfirm'
import { useCategoryDrag } from '../hooks/useCategoryDrag'
import AddNotesPanel from '../components/notes/AddNotesPanel'
import CategoryGroup from '../components/notes/CategoryGroup'
import CategoryNameInput from '../components/notes/CategoryNameInput'
import NoteEditorView from '../components/notes/NoteEditorView'
import { type NoteDraft, type NoteGroup, UNFILED, UNFILED_KEY } from '../lib/notes'
import type { Deck, Note, NoteDetail } from '../types'

interface Props {
  onGoToCards: () => void
  /** Notes can always be added. With generation off the upload skips transcription, so the tile
   * says what you'll get rather than refusing the route. */
  aiGeneration: boolean
}

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

export default function NotesScreen({ onGoToCards, aiGeneration }: Props) {
  // Seeded from cache so returning to this tab renders the previous list immediately instead of
  // collapsing to "Loading…" and jerking the page height. Only the unfiltered list is cached —
  // a search result is transient and shouldn't come back when you reopen the tab.
  const [notes, setNotes] = useState<Note[] | null>(() => getCached<Note[]>('notes') ?? null)
  const [query, setQuery] = useState('')
  const [openNote, setOpenNote] = useState<NoteDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Coalesced to [] at the boundary: every consumer below treats "no categories yet" and "not
  // loaded yet" the same way, and the note list already owns the screen's loading state.
  const [cachedDecks, setDecks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const decks = cachedDecks ?? []
  const [adding, setAdding] = useState(false)
  // A note being written that hasn't been saved yet. Becomes `openNote` on its first save.
  const [composing, setComposing] = useState<NoteDraft | null>(null)
  const [justAdded, setJustAdded] = useState<{ count: number; deckName: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const { confirmation, ask, cancel } = useConfirm()
  /** Decks made from this tab in this session. A category is only listed once it holds notes
   * (see the grouping below), but one you just created has to be visible before anything is in
   * it, or "New category" would appear to do nothing. Mirrored into the tab cache: this screen
   * unmounts on every tab switch, and a category made a minute ago vanishing on the way back
   * from Cards would read as it having been deleted. */
  const [revealed, setRevealedState] = useState<Set<string>>(
    () => new Set(getCached<string[]>('revealed-categories') ?? []),
  )
  const setRevealed = (update: (prev: Set<string>) => Set<string>) =>
    setRevealedState((prev) => {
      const next = update(prev)
      setCached('revealed-categories', [...next])
      return next
    })

  const { drag, onPointerDown, consumeClickSuppression } = useCategoryDrag((noteId, dropKey) =>
    handleMove(noteId, dropKey),
  )

  // Debounced so typing doesn't fire a full-text query per keystroke. `current` goes false once
  // the query moves on, so a slow answer to an older search can't land after a newer one and
  // leave its matches under a search box that no longer says that.
  useEffect(() => {
    let current = true
    const id = window.setTimeout(() => {
      listNotes(query)
        .then((rows) => {
          if (!current) return
          if (!query.trim()) setCached('notes', rows)
          setNotes(rows)
        })
        .catch(() => current && setError('Could not load your notes.'))
    }, 250)
    return () => {
      current = false
      clearTimeout(id)
    }
  }, [query, reloadKey])

  // The cache hook fetches decks on mount; this covers the explicit reload points that used to
  // share an effect with it — a failed move, a rename rollback, and a finished upload, which can
  // land notes under a category this screen hasn't seen yet. Skipped on the initial render so it
  // doesn't duplicate the hook's own first fetch.
  useEffect(() => {
    if (reloadKey === 0) return
    listDecks()
      .then(setDecks)
      .catch(() => {})
  }, [reloadKey, setDecks])

  /** Applied locally before the request so a dropped note lands in its new group immediately —
   * a drag that visibly does nothing for a round-trip reads as a failed drag. */
  const handleMove = async (noteId: string, dropKey: string) => {
    const deckId = dropKey || null
    const note = notes?.find((n) => n.id === noteId)
    if (!note || note.deck_id === deckId) return

    const deckName = decks.find((d) => d.id === deckId)?.name ?? null
    setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, deck_id: deckId, deck_name: deckName } : n)) ?? null)
    setJustAdded(null)
    try {
      await moveNote(noteId, deckId)
    } catch {
      setError('Could not move that note.')
      setReloadKey((k) => k + 1) // put the list back the way the server sees it
    }
  }

  const handleCreateCategory = async (name: string) => {
    setCreatingCategory(false)
    if (!name.trim()) return
    try {
      const deck = await createDeck(name.trim())
      setDecks((prev) => [...(prev ?? []), deck])
      setRevealed((prev) => new Set(prev).add(deck.id))
    } catch {
      setError('Could not create that category.')
    }
  }

  /** The editor saved: keep the tile behind it current so backing out doesn't show a stale
   * name or preview for a beat. */
  const handleSaved = (saved: Note) => {
    setNotes((prev) => prev?.map((n) => (n.id === saved.id ? { ...n, title: saved.title, preview: saved.preview } : n)) ?? null)
  }

  /** First save of a note being written. From here on the editor patches it like any other. */
  const handleCreate = async (draft: NoteDraft, title: string, text: string): Promise<NoteDetail> => {
    const created = await createTextNote({ title, text, deckId: draft.deckId, deckName: draft.deckName })
    setNotes((prev) => [created, ...(prev ?? [])])
    setOpenNote(created)
    setComposing(null)
    // A category named in the draft was just made server-side; the list needs to know about it.
    if (!draft.deckId && draft.deckName.trim()) setReloadKey((k) => k + 1)
    return created
  }

  /** Takes a category out of this tab. Its notes go to Unfiled and stay; the deck keeps its
   * cards. Applied locally first, like a move, so the group folds away on the tap. */
  const handleRemoveCategory = (deckId: string) => {
    const count = notes?.filter((n) => n.deck_id === deckId).length ?? 0
    const keepsDeck = (decks.find((d) => d.id === deckId)?.total ?? 0) > 0
    // Mid-search the list only holds the matches, so a count from it would understate what the
    // server is about to move. The wording goes general rather than quoting a wrong number.
    // Mid-search the list only holds the matches, so a count from it would understate what the
    // server is about to move. The wording goes general rather than quoting a wrong number.
    const moved = query.trim()
      ? "Every note in it moves to Unfiled."
      : count === 0
        ? 'It has no notes in it.'
        : `${count} note${count === 1 ? '' : 's'} move${count === 1 ? 's' : ''} to Unfiled.`
    const name = decks.find((d) => d.id === deckId)?.name ?? 'this category'
    ask({
      title: `Remove ${name} from Notes?`,
      body: `${moved} ${keepsDeck ? 'The deck and its cards stay.' : 'The deck has no cards, so it goes too.'}`,
      confirmLabel: 'Remove',
      destructive: !keepsDeck,
      onConfirm: () => void removeCategory(deckId),
    })
  }

  const removeCategory = async (deckId: string) => {
    const wasRevealed = revealed.has(deckId)
    setNotes((prev) => prev?.map((n) => (n.deck_id === deckId ? { ...n, deck_id: null, deck_name: null } : n)) ?? null)
    setRevealed((prev) => {
      const next = new Set(prev)
      next.delete(deckId)
      return next
    })
    setJustAdded(null)
    try {
      const { deck_deleted } = await unfileCategory(deckId)
      if (deck_deleted) setDecks((prev) => (prev ? prev.filter((d) => d.id !== deckId) : prev))
    } catch {
      setError('Could not remove that category.')
      // The refetch below puts the notes back; an empty just-made category has no notes to
      // come back with, so its visibility is restored by hand.
      if (wasRevealed) setRevealed((prev) => new Set(prev).add(deckId))
      setReloadKey((k) => k + 1)
    }
  }

  const handleRenameCategory = async (deckId: string, name: string) => {
    if (!name.trim()) return
    const previous = decks
    setDecks((prev) => (prev ?? []).map((d) => (d.id === deckId ? { ...d, name: name.trim() } : d)))
    setNotes((prev) => prev?.map((n) => (n.deck_id === deckId ? { ...n, deck_name: name.trim() } : n)) ?? null)
    try {
      await renameDeck(deckId, name.trim())
    } catch {
      setError('Could not rename that category.')
      setDecks(previous)
      setReloadKey((k) => k + 1)
    }
  }

  const handleOpen = async (id: string) => {
    if (consumeClickSuppression()) return // the click the browser fires after a drag
    setJustAdded(null)
    try {
      setOpenNote(await getNote(id))
    } catch {
      setError('Could not open that note.')
    }
  }

  /** A typed note left with nothing in it isn't worth a tile. No confirm: there's nothing to lose. */
  const handleDiscard = (id: string) => {
    setOpenNote(null)
    setNotes((prev) => prev?.filter((n) => n.id !== id) ?? null)
    deleteNote(id).catch(() => {})
  }

  /** The editor has already asked. */
  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      setOpenNote(null)
      setNotes((prev) => prev?.filter((n) => n.id !== id) ?? null)
    } catch {
      setError('Could not delete that note.')
    }
  }

  if (openNote || composing) {
    // One mount for the whole visit: a draft turning into a saved note must not remount the
    // editor mid-sentence, so the key is fixed rather than the note's id. Opening a different
    // note always passes through the list first, which unmounts this.
    return (
      <NoteEditorView
        key="editor"
        note={openNote}
        draft={composing}
        onBack={() => {
          setOpenNote(null)
          setComposing(null)
        }}
        onDelete={openNote ? () => handleDelete(openNote.id) : undefined}
        onDiscard={handleDiscard}
        onCreate={(title, text) => handleCreate(composing ?? { deckId: null, deckName: '' }, title, text)}
        onSaved={handleSaved}
      />
    )
  }

  if (adding) {
    return (
      <AddNotesPanel
        decks={decks}
        onCancel={() => setAdding(false)}
        onWrite={(draft) => {
          setAdding(false)
          setQuery('')
          setComposing(draft)
        }}
        onAdded={(count, deckName) => {
          setAdding(false)
          setJustAdded({ count, deckName })
          setQuery('') // a fresh upload shouldn't land behind a stale filter that hides it
          setReloadKey((k) => k + 1)
        }}
      />
    )
  }

  // Deck-grouped by default, per the notes-system plan — a flat list stops being navigable once a
  // semester's worth of uploads pile up. Unfiled sorts last so real categories lead.
  //
  // A deck is listed here only once it holds notes, or was just made from this tab. Every deck
  // used to appear, so generating a deck put an empty category in Notes that nobody had asked for
  // and this tab had no way to remove. The full list still backs the move menus and the upload
  // picker, so a note can be filed under any deck — and filing one is what makes it appear.
  const byDeck = new Map<string, Note[]>()
  for (const note of notes ?? []) {
    const key = note.deck_id ?? UNFILED_KEY
    byDeck.set(key, [...(byDeck.get(key) ?? []), note])
  }
  const allGroups: NoteGroup[] = [
    ...[...decks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ key: d.id, name: d.name, notes: byDeck.get(d.id) ?? [] })),
    { key: UNFILED_KEY, name: UNFILED, notes: byDeck.get(UNFILED_KEY) ?? [] },
  ]
  // While searching, an empty category is just noise — it says nothing about the results.
  const searching = query.trim().length > 0
  const groups = allGroups.filter(
    (g) => g.notes.length > 0 || (!searching && (g.key === UNFILED_KEY || revealed.has(g.key))),
  )
  const hasCategories = groups.some((g) => g.key !== UNFILED_KEY)

  return (
    <div className="flex flex-col gap-5">
      <ConfirmDialog confirmation={confirmation} onCancel={cancel} />
      <div className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[var(--text-muted)]">
          {SEARCH_ICON}
          <input
            value={query}
            onChange={(e) => {
              setJustAdded(null)
              setQuery(e.target.value)
            }}
            placeholder="Search your notes"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </label>
        <button
          onClick={() => {
            setJustAdded(null)
            setAdding(true)
          }}
          title={aiGeneration ? 'Write one, or add a photo or PDF' : 'Write one, or add a photo or PDF (not read into text while AI is off)'}
          className="h-11 flex-shrink-0 rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.9375rem] font-bold"
        >
          Add notes
        </button>
      </div>

      {/* Notes are grouped by deck, not listed newest-first, so a new one can land well down the
          page — the banner is what confirms it actually arrived. */}
      {justAdded && (
        <Notice tone="success">
          Added {justAdded.count} note{justAdded.count === 1 ? '' : 's'} to {justAdded.deckName}.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {notes === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : notes.length === 0 && searching ? (
        <div className="rounded-[var(--r-md)] border border-dashed border-[var(--rule)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">No notes match "{query.trim()}".</p>
        </div>
      ) : (
        <>
          {notes.length === 0 && (
            <div className="pt-4">
              <div className="text-[1.25rem] font-bold leading-snug tracking-[-0.02em]">No notes yet</div>
              <p className="mt-1.5 max-w-md text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
                Write a note here, or add a photo or PDF and it's kept with the text the AI read from it, so you
                can search it later.
              </p>
              <button onClick={onGoToCards} className="mt-4 text-[0.9375rem] font-semibold underline decoration-[var(--rule)] underline-offset-4">
                Generate flashcards from notes instead
              </button>
            </div>
          )}

          {(notes.length > 0 || hasCategories) && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[1.0625rem] font-bold tracking-[-0.01em]">Categories</span>
                <button
                  onClick={() => setCreatingCategory(true)}
                  className="-mr-2 flex h-11 items-center rounded-[var(--r-sm)] px-2 text-[0.875rem] font-bold text-[var(--text-muted)]"
                >
                  New category
                </button>
              </div>

              {creatingCategory && (
                <CategoryNameInput
                  placeholder="Category name"
                  onCommit={handleCreateCategory}
                  onCancel={() => setCreatingCategory(false)}
                />
              )}

              {groups.map((group) => (
                <CategoryGroup
                  key={group.key}
                  group={group}
                  isDropTarget={drag?.overKey === group.key}
                  dragging={drag !== null}
                  onRename={group.key ? (name) => handleRenameCategory(group.key, name) : undefined}
                  onRemove={group.key ? () => handleRemoveCategory(group.key) : undefined}
                  onOpenNote={handleOpen}
                  onMoveNote={handleMove}
                  onGrabNote={onPointerDown}
                  categories={allGroups}
                />
              ))}
            </>
          )}
        </>
      )}

      {/* Follows the pointer during a drag. `pointer-events-none` is load-bearing: the hook finds
          the category under the cursor with elementFromPoint, which would otherwise just keep
          hitting this. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 max-w-[60vw] truncate rounded-[var(--r-sm)] border border-[var(--rule)] px-3.5 py-2 text-xs font-bold"
          style={{ left: drag.x, top: drag.y, transform: 'translate(-50%, -140%)', background: 'var(--surface)', color: 'var(--text)' }}
        >
          {drag.label}
        </div>
      )}
    </div>
  )
}
