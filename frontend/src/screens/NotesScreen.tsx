import { type ChangeEvent, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { createDeck, createTextNote, deleteNote, getNote, listDecks, listNotes, moveNote, noteFileUrl, renameDeck, saveNoteContent, uploadNotes } from '../api'

// The editor is ProseMirror plus a markdown parser — about half the app again — and most visits
// never open a note, so it stays out of the main bundle until one does.
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor'))
import { getCached, setCached, useCachedResource } from '../hooks/useCachedResource'
import { useCategoryDrag } from '../hooks/useCategoryDrag'
import type { Deck, Note, NoteDetail } from '../types'

interface Props {
  onGoToCards: () => void
  /** Notes can always be added. With generation off the upload skips transcription, so the tile
   * says what you'll get rather than refusing the route. */
  aiGeneration: boolean
}

const UNFILED = 'Unfiled'

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

const PDF_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2.5h7l4 4V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
    <path d="M14 2.5V7h4" />
  </svg>
)

const CAMERA_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
)

const LIBRARY_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="15" rx="2.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="8" cy="9.5" r="1.5" />
  </svg>
)

const FOLDER_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
)

const PENCIL_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
  </svg>
)

const BACK_CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)
const BACK_CLASS = '-ml-2 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]'

/** Unfiled isn't a deck, so it has no id — the empty string stands in for it as a drop target and
 * as a `<select>` value, and converts back to `null` at the API boundary. */
const UNFILED_KEY = ''

/** Where a note being written will be filed once there's something to save. `deckName` without a
 * `deckId` is a category that doesn't exist yet — the create call makes it. */
interface Draft {
  deckId: string | null
  deckName: string
}

function kindLabel(fileType: Note['file_type']): string {
  return fileType === 'pdf' ? 'PDF' : fileType === 'image' ? 'Photo' : 'Note'
}

interface Group {
  key: string
  name: string
  notes: Note[]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

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
  const [composing, setComposing] = useState<Draft | null>(null)
  const [justAdded, setJustAdded] = useState<{ count: number; deckName: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creatingCategory, setCreatingCategory] = useState(false)

  const { drag, onPointerDown, consumeClickSuppression } = useCategoryDrag((noteId, dropKey) =>
    handleMove(noteId, dropKey),
  )

  // Debounced so typing doesn't fire a full-text query per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => {
      listNotes(query)
        .then((rows) => {
          if (!query.trim()) setCached('notes', rows)
          setNotes(rows)
        })
        .catch(() => setError('Could not load your notes.'))
    }, 250)
    return () => clearTimeout(id)
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
  const handleCreate = async (draft: Draft, title: string, text: string): Promise<NoteDetail> => {
    const created = await createTextNote({ title, text, deckId: draft.deckId, deckName: draft.deckName })
    setNotes((prev) => [created, ...(prev ?? [])])
    setOpenNote(created)
    setComposing(null)
    // A category named in the draft was just made server-side; the list needs to know about it.
    if (!draft.deckId && draft.deckName.trim()) setReloadKey((k) => k + 1)
    return created
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
  // semester's worth of uploads pile up. Every category is rendered even when empty, so a new one
  // is visible the moment it's made and so there's somewhere to drop a note into it. Unfiled sorts
  // last so real categories lead.
  const byDeck = new Map<string, Note[]>()
  for (const note of notes ?? []) {
    const key = note.deck_id ?? UNFILED_KEY
    byDeck.set(key, [...(byDeck.get(key) ?? []), note])
  }
  const allGroups: Group[] = [
    ...[...decks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ key: d.id, name: d.name, notes: byDeck.get(d.id) ?? [] })),
    { key: UNFILED_KEY, name: UNFILED, notes: byDeck.get(UNFILED_KEY) ?? [] },
  ]
  // While searching, an empty category is just noise — it says nothing about the results.
  const searching = query.trim().length > 0
  const groups = searching ? allGroups.filter((g) => g.notes.length > 0) : allGroups
  const hasCategories = decks.length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <label className="flex h-11 flex-1 items-center gap-2.5 rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[var(--text-muted)]">
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
          className="on-accent h-11 flex-shrink-0 rounded-[var(--r-full)] bg-[var(--accent)] px-4 text-[0.875rem] font-bold"
        >
          Add notes
        </button>
      </div>

      {/* Notes are grouped by deck, not listed newest-first, so a new one can land well down the
          page — the banner is what confirms it actually arrived. */}
      {justAdded && (
        <div
          className="rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--grade-good-bg)', color: 'var(--grade-good)' }}
        >
          Added {justAdded.count} note{justAdded.count === 1 ? '' : 's'} to {justAdded.deckName}.
        </div>
      )}

      {error && (
        <div className="rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

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
              <div className="text-[1.25rem] font-bold leading-snug">No notes yet</div>
              <p className="mt-1.5 max-w-md text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
                Write a note here, or add a photo or PDF and it's kept with the text the AI read from it, so you
                can search it later. Notes you turn into flashcards from the Cards tab land here too.
              </p>
              <button onClick={onGoToCards} className="mt-4 text-[0.9375rem] font-semibold underline decoration-[var(--rule)] underline-offset-4">
                Generate flashcards from notes instead
              </button>
            </div>
          )}

          {(notes.length > 0 || hasCategories) && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[0.9375rem] font-bold">Categories</span>
                <button
                  onClick={() => setCreatingCategory(true)}
                  className="text-[0.8125rem] font-bold text-[var(--text-muted)]"
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

/** Writing is the first option and the only accent on the page; uploading is the rest of it.
 * Both file under the same category choice, made once at the top.
 *
 * Files are staged rather than uploaded the moment they're picked. Each one costs a vision call,
 * so a mis-tap would otherwise burn a request and leave a junk note to clean up; staging also
 * means the deck choice no longer has to be made *before* picking.
 */
/** Sentinel `<select>` value for "a category I'm about to name". Distinct from the empty string,
 * which already means Unfiled. */
const NEW_CATEGORY = '__new_category__'

function AddNotesPanel({
  decks,
  onWrite,
  onAdded,
  onCancel,
}: {
  decks: Deck[]
  onWrite: (draft: Draft) => void
  onAdded: (count: number, deckName: string) => void
  onCancel: () => void
}) {
  const [deckId, setDeckId] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const naming = deckId === NEW_CATEGORY

  /** The category as the API wants it: an id, a name to create, or neither. Null when the user
   * picked "new category" and hasn't named it. */
  const filing = (): Draft | null => {
    if (naming) return newCategory.trim() ? { deckId: null, deckName: newCategory.trim() } : null
    return { deckId: deckId || null, deckName: decks.find((d) => d.id === deckId)?.name ?? '' }
  }

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // so re-picking the same file still fires onChange
    if (picked.length === 0) return
    setFiles((prev) => [
      ...prev,
      // Unlike the card generator, photos and PDFs mix freely here: every file becomes its own
      // note, so there's no single "source material" for them to disagree about.
      ...picked.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size)),
    ])
    setError(null)
  }

  const handleWrite = () => {
    const draft = filing()
    if (!draft) {
      setError('Give the new category a name, or pick an existing one.')
      return
    }
    onWrite(draft)
  }

  const handleAdd = async () => {
    if (files.length === 0) return
    const draft = filing()
    if (!draft) {
      setError('Give the new category a name, or pick an existing one.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // NEW_CATEGORY is a UI-only sentinel; the API sees a real id or a name, never both.
      await uploadNotes(files, draft.deckId, draft.deckId ? '' : draft.deckName)
      onAdded(files.length, draft.deckName || UNFILED)
    } catch {
      setError('Could not upload that — check the file and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={onCancel} disabled={busy} className={`${BACK_CLASS} mb-4`}>
        {BACK_CHEVRON}
        Notes
      </button>

      <div className="mb-5">
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">File under</div>
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem] outline-none"
        >
          <option value="">{UNFILED}</option>
          <option value={NEW_CATEGORY}>New category, I'll name it</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {naming && (
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            disabled={busy}
            placeholder="Category name"
            maxLength={80}
            className="mt-2 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem] outline-none placeholder:text-[var(--text-muted)]"
          />
        )}
      </div>

      <button
        onClick={handleWrite}
        disabled={busy}
        className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        Write a note
      </button>

      <div className="mb-3 mt-7 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Or add photos and PDFs</div>
      <p className="mb-3 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
        Each file is kept with the text the AI reads out of it. This doesn't make any flashcards — the Cards tab
        does that.
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2.5">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addFiles} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />
        <input ref={pdfInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={addFiles} />

        <SourceButton disabled={busy} onClick={() => cameraInputRef.current?.click()} icon={CAMERA_ICON} label="Take a photo" />
        <SourceButton disabled={busy} onClick={() => libraryInputRef.current?.click()} icon={LIBRARY_ICON} label="Choose photos" />
        <SourceButton disabled={busy} onClick={() => pdfInputRef.current?.click()} icon={PDF_ICON} label="Choose a PDF" />
      </div>

      {files.length > 0 && (
        <div className="mb-5 border-t border-[var(--rule)]">
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-3">
              <span className="truncate text-[0.9375rem] font-semibold">{f.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={busy}
                className="flex-shrink-0 text-[0.875rem] font-semibold text-[var(--text-muted)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      {/* Secondary on purpose: the accent on this page is already spent on writing. Absent until
          there's something staged, since a button for zero files says nothing. */}
      {files.length > 0 && (
        <button
          onClick={handleAdd}
          disabled={busy}
          className="w-full rounded-[var(--r-full)] border border-[var(--rule)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
        >
          {busy ? 'Reading your notes' : `Add ${files.length} note${files.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

/** A category and the notes filed under it. The whole block is the drop target, empty zone
 * included — aiming at a header is much harder than aiming at a region, especially with a thumb. */
function CategoryGroup({
  group,
  categories,
  isDropTarget,
  dragging,
  onRename,
  onOpenNote,
  onMoveNote,
  onGrabNote,
}: {
  group: Group
  categories: Group[]
  isDropTarget: boolean
  dragging: boolean
  /** Absent for Unfiled, which is the absence of a category rather than one that can be renamed. */
  onRename?: (name: string) => void
  onOpenNote: (id: string) => void
  onMoveNote: (id: string, dropKey: string) => void
  onGrabNote: (noteId: string, label: string) => (e: React.PointerEvent) => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      data-drop-key={group.key}
      className="-mx-2 rounded-[var(--r-md)] px-2 pb-2 transition-colors"
      style={isDropTarget ? { background: 'var(--accent-dim)' } : undefined}
    >
      {renaming && onRename ? (
        <CategoryNameInput
          initial={group.name}
          placeholder="Category name"
          onCommit={(name) => {
            setRenaming(false)
            onRename(name)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div className="mb-3 flex items-baseline justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[0.9375rem] font-bold">{group.name}</span>
            {onRename && (
              <button
                onClick={() => setRenaming(true)}
                aria-label={`Rename ${group.name}`}
                className="flex-shrink-0 self-center text-[var(--text-muted)]"
              >
                {PENCIL_ICON}
              </button>
            )}
          </div>
          <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">
            {group.notes.length} note{group.notes.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {group.notes.length === 0 ? (
        <div className="border-t border-[var(--rule)] py-4">
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            {dragging ? 'Drop here to file it under this category' : 'Nothing filed here yet. Drag a note in, or pick a category from its menu.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {group.notes.map((note) => (
            <NoteTile
              key={note.id}
              note={note}
              categories={categories}
              onOpen={() => onOpenNote(note.id)}
              onMove={(dropKey) => onMoveNote(note.id, dropKey)}
              onGrab={onGrabNote(note.id, note.title ?? (note.preview.slice(0, 40) || 'Note'))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteTile({
  note,
  categories,
  onOpen,
  onMove,
  onGrab,
}: {
  note: Note
  categories: Group[]
  onOpen: () => void
  onMove: (dropKey: string) => void
  onGrab: (e: React.PointerEvent) => void
}) {
  return (
    <div
      onClick={onOpen}
      onPointerDown={onGrab}
      className="flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)] text-left"
    >
      {/* The preview is the tile. A photo shows itself; a PDF shows the text read from it, small
          and cropped, so either kind is recognised by what's on it rather than by its name. */}
      {note.file_type === 'image' ? (
        <img src={noteFileUrl(note.id)} alt="" draggable={false} className="aspect-[4/3] w-full object-cover" style={{ background: 'var(--bg)' }} />
      ) : (
        <div
          className="relative aspect-[4/3] w-full overflow-hidden border-b border-[var(--rule)] px-3 pt-2.5"
          style={{ background: 'color-mix(in oklab, var(--surface) 55%, var(--bg))' }}
        >
          <p className="text-[0.5625rem] leading-[1.5] text-[var(--text-muted)]">
            {note.preview || (note.file_type === 'text' ? 'Nothing written yet.' : 'No text was read from this file.')}
          </p>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-7"
            style={{ background: 'linear-gradient(to bottom, transparent, color-mix(in oklab, var(--surface) 55%, var(--bg)))' }}
          />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2 px-3 py-2.5">
        <span className="min-w-0 truncate text-[0.8125rem] font-bold">{note.title ?? (note.preview.slice(0, 40) || 'Untitled')}</span>
        <span className="flex-shrink-0 whitespace-nowrap text-[0.6875rem] text-[var(--text-muted)]">
          {note.file_type === 'pdf' ? 'PDF, ' : ''}
          {formatDate(note.created_at)}
        </span>
      </div>
      {/* The select is the path that always works — dragging is the shortcut, not the only way,
          since it's unreachable by keyboard and awkward one-handed on a phone. Its own pointer
          and click events stop here so opening the picker never grabs or opens the note. */}
      <div
        className="flex items-center gap-1 border-t border-[var(--rule)] px-3 py-1.5 text-[var(--text-muted)]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {FOLDER_ICON}
        <select
          value={note.deck_id ?? UNFILED_KEY}
          onChange={(e) => onMove(e.target.value)}
          aria-label="Move to category"
          className="min-w-0 max-w-full cursor-pointer truncate rounded-[var(--r-sm)] bg-transparent py-0.5 text-[0.6875rem] font-semibold outline-none"
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/** Shared by "new category" and rename. Enter and blur commit, Escape abandons — blur-commits so
 * tapping away on a phone saves rather than silently discarding what was typed. */
function CategoryNameInput({
  initial = '',
  placeholder,
  allowEmpty = false,
  onCommit,
  onCancel,
}: {
  initial?: string
  placeholder: string
  /** Categories must always have a name, so an emptied box there means "abandon". A note title is
   * optional — emptying it is a real instruction to drop back to the transcription preview. */
  allowEmpty?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const committed = useRef(false)

  const commit = () => {
    if (committed.current) return
    committed.current = true
    const next = value.trim()
    if (next !== initial.trim() && (next || allowEmpty)) onCommit(value)
    else onCancel()
  }

  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          committed.current = true
          onCancel()
        }
      }}
      className="mb-2.5 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold outline-none"
     
    />
  )
}

function SourceButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void
  disabled: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--surface)] py-5 text-[var(--text-muted)] disabled:opacity-50"
     
    >
      {icon}
      <span className="text-xs font-bold">{label}</span>
    </button>
  )
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

/** One editor for every note. A typed note is nothing but its text; a photo or PDF shows the
 * original above the text the AI read out of it, and that text is just as editable — fixing a
 * misread word here is the whole reason the transcription is markdown.
 *
 * Saves itself. There's no Save button because there's nothing to decide: edits go up ~1s after
 * you stop typing, and whatever's pending is flushed when you leave or the app goes to the
 * background. A note being written doesn't exist server-side until the first save that has
 * something in it, so backing out of an empty draft leaves nothing behind — and a typed note
 * that's been emptied out is discarded on the way out for the same reason. Saves are queued one
 * behind another rather than raced: the first one is a create, and every later one needs the id
 * it comes back with. */
function NoteEditorView({
  note,
  draft,
  onBack,
  onDelete,
  onDiscard,
  onCreate,
  onSaved,
}: {
  note: NoteDetail | null
  draft: Draft | null
  onBack: () => void
  /** Absent while the note is still a draft — there's nothing to delete yet. */
  onDelete?: () => void
  /** Quietly remove a typed note that's been left empty. */
  onDiscard: (id: string) => void
  onCreate: (title: string, text: string) => Promise<NoteDetail>
  onSaved: (note: Note) => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.ocr_text ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')

  // The save pipeline lives in refs so a debounced or unmount-time save always reads what's on
  // screen now, not what was there when the timer was set.
  const latest = useRef({ title, text })
  latest.current = { title, text }
  const persisted = useRef({ title: note?.title ?? '', text: note?.ocr_text ?? '' })
  const noteId = useRef<string | null>(note?.id ?? null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | null>(null)
  const abandoned = useRef(false)
  const callbacks = useRef({ onCreate, onSaved, onDiscard })
  callbacks.current = { onCreate, onSaved, onDiscard }
  // Only notes that are nothing but text get discarded when empty; a photo with its
  // transcription cleared is still a photo.
  const isTyped = note === null || note.file_type === 'text'

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  /** Queue a save of whatever's current. Resolves once that save (and any before it) is done. */
  const save = () => {
    cancelTimer()
    queue.current = queue.current.then(async () => {
      if (abandoned.current) return
      const title = latest.current.title.trim()
      const { text } = latest.current
      if (title === persisted.current.title && text === persisted.current.text) return
      if (!noteId.current && !title && !text.trim()) return // an empty draft isn't a note yet
      setStatus('saving')
      try {
        if (noteId.current) {
          callbacks.current.onSaved(await saveNoteContent(noteId.current, title, text))
        } else {
          noteId.current = (await callbacks.current.onCreate(title, text)).id
        }
        persisted.current = { title, text }
        setStatus('saved')
      } catch {
        setStatus('failed')
      }
    })
    return queue.current
  }

  const scheduleSave = () => {
    cancelTimer()
    timer.current = window.setTimeout(save, 900)
  }

  const isDirty = () => latest.current.title.trim() !== persisted.current.title || latest.current.text !== persisted.current.text
  const isEmpty = () => !latest.current.title.trim() && !latest.current.text.trim()

  /** Called on the way out: a saved typed note with nothing left in it goes. */
  const discardIfEmpty = () => {
    if (isTyped && noteId.current && isEmpty()) {
      abandoned.current = true
      callbacks.current.onDiscard(noteId.current)
      return true
    }
    return false
  }

  // Leaving the app on a phone can be the last thing that ever happens to this tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && isDirty()) void save()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (discardIfEmpty()) return
      if (isDirty()) void save()
    }
    // save/isDirty read refs; they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBack = async () => {
    await queue.current // a create still in flight decides whether there's anything to discard
    if (discardIfEmpty()) return // onDiscard closes the editor
    if (isDirty()) {
      await save()
      if (isDirty() && !confirm("This note couldn't be saved. Leave anyway and lose the changes?")) return
    }
    abandoned.current = true
    onBack()
  }

  const handleDelete = () => {
    if (!onDelete || !confirm('Delete this note? Cards already generated from it are kept.')) return
    abandoned.current = true // no point flushing edits into a note that's about to go
    cancelTimer()
    onDelete()
  }

  const kind = note ? kindLabel(note.file_type) : 'Note'
  const filedUnder = note ? (note.deck_name ?? UNFILED) : draft?.deckName || UNFILED
  const isFile = note !== null && note.file_type !== 'text'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button onClick={handleBack} className={BACK_CLASS}>
          {BACK_CHEVRON}
          Notes
        </button>
        <div className="flex items-center gap-4 text-[0.8125rem] font-semibold">
          {status === 'saving' && <span className="text-[var(--text-muted)]">Saving</span>}
          {status === 'saved' && <span className="text-[var(--text-muted)]">Saved</span>}
          {status === 'failed' && <span style={{ color: 'var(--grade-forgot)' }}>Couldn't save</span>}
          {onDelete && (
            <button onClick={handleDelete} className="flex h-11 items-center font-bold" style={{ color: 'var(--grade-forgot)' }}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          placeholder="Untitled note"
          aria-label="Note title"
          maxLength={200}
          className="w-full bg-transparent text-[1.25rem] font-bold leading-tight outline-none placeholder:text-[var(--text-muted)]"
        />
        <div className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
          {filedUnder}, {kind}
          {note ? `, ${formatDate(note.created_at)}` : ''}
        </div>
      </div>

      {/* Original first, transcription second: the original is what you check against when the
          text looks wrong, so it should be what you see first. */}
      {isFile && (
        <div className="overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]">
          {note.file_type === 'pdf' ? (
            <embed src={noteFileUrl(note.id)} type="application/pdf" className="h-[70vh] w-full" />
          ) : (
            <img src={noteFileUrl(note.id)} alt="Original note" className="max-h-[70vh] w-full object-contain" />
          )}
        </div>
      )}

      <Suspense fallback={<div className="min-h-[16rem] rounded-[var(--r-md)] bg-[var(--surface)]" />}>
        <MarkdownEditor
          value={text}
          onChange={(v) => {
            setText(v)
            scheduleSave()
          }}
          label={isFile ? 'What the AI read' : undefined}
          placeholder={isFile ? 'No text was read from this file. You can type it here.' : 'Start writing'}
          autoFocus={note === null}
        />
      </Suspense>
    </div>
  )
}
