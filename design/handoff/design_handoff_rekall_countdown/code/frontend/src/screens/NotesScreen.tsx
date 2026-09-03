import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { createDeck, deleteNote, getNote, listDecks, listNotes, moveNote, noteFileUrl, renameDeck, renameNote, uploadNotes } from '../api'
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

/** Unfiled isn't a deck, so it has no id — the empty string stands in for it as a drop target and
 * as a `<select>` value, and converts back to `null` at the API boundary. */
const UNFILED_KEY = ''

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

  /** Applied to the open note and to the list behind it, so backing out doesn't show the old name
   * for a beat. On failure both are put back from the server rather than guessed at. */
  const handleRenameNote = async (noteId: string, title: string) => {
    const next = title.trim() || null
    setOpenNote((prev) => (prev && prev.id === noteId ? { ...prev, title: next } : prev))
    setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, title: next } : n)) ?? null)
    try {
      await renameNote(noteId, title)
    } catch {
      setError('Could not rename that note.')
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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this note? Cards already generated from it are kept.')) return
    try {
      await deleteNote(id)
      setOpenNote(null)
      setNotes((prev) => prev?.filter((n) => n.id !== id) ?? null)
    } catch {
      setError('Could not delete that note.')
    }
  }

  if (openNote) {
    return (
      <NoteDetailView
        note={openNote}
        onBack={() => setOpenNote(null)}
        onDelete={() => handleDelete(openNote.id)}
        onRename={(title) => handleRenameNote(openNote.id, title)}
      />
    )
  }

  if (adding) {
    return (
      <AddNotesPanel
        decks={decks}
        onCancel={() => setAdding(false)}
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
          title={aiGeneration ? 'A photo, a PDF, or a page from your notebook' : 'Photos save as-is; not read into text while AI is off'}
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
        <div className="rounded-[var(--r-md)] border border-dashed border-[var(--ring-track)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">No notes match "{query.trim()}".</p>
        </div>
      ) : (
        <>
          {notes.length === 0 && (
            <div className="pt-4">
              <div className="text-[1.25rem] font-bold leading-snug">No notes yet</div>
              <p className="mt-1.5 max-w-md text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
                Add a photo or PDF and it's kept here with the text the AI read from it, so you can search it later.
                Notes you turn into flashcards from the Cards tab land here too.
              </p>
              <button onClick={onGoToCards} className="mt-4 text-[0.9375rem] font-semibold underline decoration-[var(--rule)] underline-offset-4">
                Generate flashcards from notes instead
              </button>
            </div>
          )}

          {(notes.length > 0 || hasCategories) && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-base font-extrabold">Categories</span>
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

/** Laid out to match the Cards tab's generator panel — same "Add to / File under" select above the
 * same three source buttons, same staged file list, same primary action at the bottom.
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
  onAdded,
  onCancel,
}: {
  decks: Deck[]
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

  const handleAdd = async () => {
    if (files.length === 0) {
      setError('Add at least one photo or PDF first.')
      return
    }
    const naming = deckId === NEW_CATEGORY
    if (naming && !newCategory.trim()) {
      setError('Give the new category a name, or pick an existing one.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // NEW_CATEGORY is a UI-only sentinel; the API sees a real id or a name, never both.
      await uploadNotes(files, naming ? null : deckId || null, naming ? newCategory : '')
      onAdded(
        files.length,
        naming ? newCategory.trim() : (decks.find((d) => d.id === deckId)?.name ?? UNFILED),
      )
    } catch {
      setError('Could not upload that — check the file and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={onCancel} disabled={busy} className="mb-4 text-sm font-semibold text-[var(--text-muted)]">
        Back to notes
      </button>
      <p className="mb-5 text-sm text-[var(--text-muted)]">
        Photos or PDFs of your notes are kept here alongside the text the AI reads out of them, so you can search
        them later. This doesn't make any flashcards — the Cards tab does that.
      </p>

      <div className="mb-5">
        <div className="mb-2 text-xs font-bold text-[var(--text-muted)]">File under</div>
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          disabled={busy}
          className="w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none"
         
        >
          <option value="">{UNFILED}</option>
          <option value={NEW_CATEGORY}>New category — I'll name it</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {deckId === NEW_CATEGORY && (
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            disabled={busy}
            placeholder="Category name"
            maxLength={80}
            className="mt-2 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none"
           
          />
        )}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2.5">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addFiles} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />
        <input ref={pdfInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={addFiles} />

        <SourceButton disabled={busy} onClick={() => cameraInputRef.current?.click()} icon={CAMERA_ICON} label="Take Photo" />
        <SourceButton disabled={busy} onClick={() => libraryInputRef.current?.click()} icon={LIBRARY_ICON} label="Library" />
        <SourceButton disabled={busy} onClick={() => pdfInputRef.current?.click()} icon={PDF_ICON} label="PDF" />
      </div>

      {files.length > 0 && (
        <div className="mb-5 flex flex-col gap-1.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}`} className="flex items-center justify-between rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2.5">
              <span className="truncate text-xs font-semibold text-[var(--text-muted)]">{f.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={busy}
                className="ml-2 flex-shrink-0 text-xs font-bold text-[var(--grade-forgot)]"
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

      <button
        onClick={handleAdd}
        disabled={busy || files.length === 0}
        className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {busy
          ? 'Reading your notes'
          : files.length === 0
            ? 'Add notes'
            : `Add ${files.length} note${files.length === 1 ? '' : 's'}`}
      </button>
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
              onGrab={onGrabNote(note.id, note.preview.slice(0, 40) || 'Note')}
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
          <p className="text-[0.5625rem] leading-[1.5] text-[var(--text-muted)]">{note.preview || 'No text was read from this file.'}</p>
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

function NoteDetailView({
  note,
  onBack,
  onDelete,
  onRename,
}: {
  note: NoteDetail
  onBack: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [renamingNote, setRenamingNote] = useState(false)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm font-semibold text-[var(--text-muted)]">
          Back to notes
        </button>
        <button onClick={onDelete} className="text-sm font-bold" style={{ color: 'var(--grade-forgot)' }}>
          Delete
        </button>
      </div>

      <div>
        {renamingNote ? (
          <CategoryNameInput
            initial={note.title ?? ''}
            placeholder="Name this note"
            allowEmpty
            onCommit={(name) => {
              setRenamingNote(false)
              onRename(name)
            }}
            onCancel={() => setRenamingNote(false)}
          />
        ) : (
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="min-w-0 truncate text-lg font-extrabold">
              {note.title ?? <span className="text-[var(--text-muted)]">Untitled note</span>}
            </span>
            <button onClick={() => setRenamingNote(true)} aria-label="Rename note" className="flex-shrink-0 self-center text-[var(--text-muted)]">
              {PENCIL_ICON}
            </button>
          </div>
        )}
        <div className="text-xs font-semibold text-[var(--text-muted)]">
          {note.deck_name ?? UNFILED} · {note.file_type === 'pdf' ? 'PDF' : 'Photo'} · {formatDate(note.created_at)}
        </div>
      </div>

      {/* Original first, transcription second — the doc's reasoning is that the original is the
          user's visual reference and the text is what the machine uses; when they disagree the
          original is the source of truth, so it should be what you see first. */}
      <div className="overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]">
        {note.file_type === 'pdf' ? (
          <embed src={noteFileUrl(note.id)} type="application/pdf" className="h-[70vh] w-full" />
        ) : (
          <img src={noteFileUrl(note.id)} alt="Original note" className="max-h-[70vh] w-full object-contain" />
        )}
      </div>

      <div>
        <div className="mb-2 text-base font-extrabold">What the AI read</div>
        <div className="rounded-[var(--r-md)] bg-[var(--surface)] p-5">
          {note.ocr_text?.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.ocr_text}</p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No text was read from this file.</p>
          )}
        </div>
      </div>
    </div>
  )
}
