import { useEffect, useRef, useState } from 'react'
import { generateDeck, generateDeckFromNotes, listDecks, listNotes } from '../api'
import type { Deck, GenerationResult, Note } from '../types'

interface Props {
  onDone: () => void
  onCancel: () => void
}

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

const PDF_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2.5h7l4 4V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
    <path d="M14 2.5V7h4" />
  </svg>
)

const NOTES_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

/** Sentinel `<select>` value for "new deck, but I'll name it". Not a real deck id, and not the
 * empty string either — the empty string already means "new deck, let the AI name it", and the two
 * have to stay distinguishable. */
const NAME_IT = '__name_it__'

export default function GenerateScreen({ onDone, onCancel }: Props) {
  const [decks, setDecks] = useState<Deck[] | null>(null)
  const [targetDeckId, setTargetDeckId] = useState('')
  const [customDeckName, setCustomDeckName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  /** Full Note objects rather than ids, so the staged list can show what you picked without
   * another round-trip. Source is deliberately one-or-the-other: whichever you choose last is
   * what gets generated from, and the staged list below always shows exactly that. */
  const [pickedNotes, setPickedNotes] = useState<Note[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listDecks().then(setDecks).catch(() => setDecks([]))
  }, [])

  const addImages = (list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev.filter((f) => f.type !== 'application/pdf'), ...Array.from(list)])
    setPickedNotes([])
    setError(null)
  }

  const setPdf = (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    setFiles([file])
    setPickedNotes([])
    setError(null)
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (files.length === 0 && pickedNotes.length === 0) {
      setError('Add a photo or PDF, or pick from notes you\'ve already saved.')
      return
    }
    const namingIt = targetDeckId === NAME_IT
    if (namingIt && !customDeckName.trim()) {
      setError('Give the new deck a name, or switch back to letting the AI name it.')
      return
    }
    // NAME_IT is a UI-only sentinel; the API only ever sees a real deck id or nothing.
    const deckId = namingIt ? null : targetDeckId || null
    const deckName = namingIt ? customDeckName : ''

    setBusy(true)
    setError(null)
    setStage('Starting…')
    try {
      const res = pickedNotes.length
        ? await generateDeckFromNotes(pickedNotes.map((n) => n.id), deckId, deckName, setStage)
        : await generateDeck(files, deckId, deckName, setStage)
      if (res.cards_added.length === 0) {
        setError(
          pickedNotes.length
            ? "Couldn't find any flashcard-worthy material in those notes."
            : "Couldn't find any flashcard-worthy material in that upload.",
        )
        return
      }
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  if (picking) {
    return (
      <NotePicker
        initial={pickedNotes}
        onCancel={() => setPicking(false)}
        onConfirm={(notes) => {
          setPickedNotes(notes)
          if (notes.length > 0) setFiles([])
          setPicking(false)
          setError(null)
        }}
      />
    )
  }

  if (result) {
    return (
      <div>
        <div className="mb-1 text-lg font-extrabold">Added to {result.deck_name}</div>
        <p className="mb-5 text-sm text-[var(--text-secondary)]">
          {result.cards_added.length} card{result.cards_added.length === 1 ? '' : 's'} added
          {result.cards_dropped.length > 0 &&
            ` · ${result.cards_dropped.length} dropped during verification (didn't hold up against your notes)`}
          .
        </p>

        <div className="mb-5 flex flex-col gap-2">
          {result.cards_added.map((c) => (
            <div key={c.id} className="rounded-2xl bg-[var(--bg-card)] p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
              {c.subtopic && (
                <div className="mb-1 text-[0.625rem] font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
                  {c.subtopic}
                </div>
              )}
              <div className="text-sm font-bold">{c.question}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{c.answer}</div>
            </div>
          ))}
        </div>

        {result.cards_dropped.length > 0 && (
          <div className="mb-5 flex flex-col gap-1.5 rounded-2xl px-4 py-3" style={{ background: 'var(--grade-hard-bg)' }}>
            <div className="text-xs font-bold" style={{ color: 'var(--grade-hard)' }}>
              Dropped during verification
            </div>
            {result.cards_dropped.map((d, i) => (
              <div key={i} className="text-xs text-[var(--text-secondary)]">
                <span className="font-semibold">{d.question}</span> — {d.reason}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onDone}
          className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-bold text-[oklch(0.99_0.005_90)]"
          style={{ boxShadow: 'var(--accent-shadow)' }}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={onCancel} className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">
        ← Back
      </button>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Upload photos of your notes or a PDF, or pull from notes you've already saved — the AI drafts flashcards,
        then double-checks each one against your notes before adding them.
      </p>

      <div className="mb-5">
        <div className="mb-2 text-xs font-bold text-[var(--text-secondary)]">Add to</div>
        <select
          value={targetDeckId}
          onChange={(e) => setTargetDeckId(e.target.value)}
          disabled={busy}
          className="w-full rounded-xl bg-[var(--bg-card)] px-3.5 py-2.5 text-sm outline-none"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <option value="">New deck (AI names it)</option>
          <option value={NAME_IT}>New deck — I'll name it</option>
          {decks?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {targetDeckId === NAME_IT && (
          <input
            autoFocus
            value={customDeckName}
            onChange={(e) => setCustomDeckName(e.target.value)}
            disabled={busy}
            placeholder="Deck name"
            maxLength={80}
            className="mt-2 w-full rounded-xl bg-[var(--bg-card)] px-3.5 py-2.5 text-sm outline-none"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          />
        )}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2.5">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
        <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setPdf(e.target.files)} />

        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-1.5 rounded-[14px] bg-[var(--bg-card)] py-5 text-[var(--text-secondary)]"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {CAMERA_ICON}
          <span className="text-xs font-bold">Take Photo</span>
        </button>
        <button
          onClick={() => libraryInputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-1.5 rounded-[14px] bg-[var(--bg-card)] py-5 text-[var(--text-secondary)]"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {LIBRARY_ICON}
          <span className="text-xs font-bold">Library</span>
        </button>
        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-1.5 rounded-[14px] bg-[var(--bg-card)] py-5 text-[var(--text-secondary)]"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {PDF_ICON}
          <span className="text-xs font-bold">PDF</span>
        </button>
      </div>

      <button
        onClick={() => setPicking(true)}
        disabled={busy}
        className="mb-3 flex w-full items-center gap-3 rounded-[14px] bg-[var(--bg-card)] px-4 py-3.5 text-left"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <span className="text-[var(--text-secondary)]">{NOTES_ICON}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold">Use notes you've already saved</span>
          <span className="block text-[0.6875rem] text-[var(--text-secondary)]">
            {pickedNotes.length > 0
              ? `${pickedNotes.length} note${pickedNotes.length === 1 ? '' : 's'} selected`
              : 'Skip the upload — build cards from your library'}
          </span>
        </span>
        <span className="flex-shrink-0 text-xs font-bold" style={{ color: 'var(--accent)' }}>
          {pickedNotes.length > 0 ? 'Change' : 'Choose'}
        </span>
      </button>

      {pickedNotes.length > 0 && (
        <div className="mb-5 flex flex-col gap-1.5">
          {pickedNotes.map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded-xl bg-[var(--bg-card)] px-3.5 py-2.5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <span className="truncate text-xs font-semibold text-[var(--text-secondary)]">
                {n.preview || `${n.file_type === 'pdf' ? 'PDF' : 'Photo'} with no readable text`}
              </span>
              <button
                onClick={() => setPickedNotes((prev) => prev.filter((p) => p.id !== n.id))}
                disabled={busy}
                className="ml-2 flex-shrink-0 text-xs font-bold text-[var(--grade-forgot)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-5 flex flex-col gap-1.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-[var(--bg-card)] px-3.5 py-2.5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <span className="truncate text-xs font-semibold text-[var(--text-secondary)]">{f.name}</span>
              <button onClick={() => removeFile(i)} disabled={busy} className="ml-2 flex-shrink-0 text-xs font-bold text-[var(--grade-forgot)]">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-2xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={busy || files.length === 0}
        className="w-full rounded-xl bg-[var(--accent)] py-3.5 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
        style={{ boxShadow: 'var(--accent-shadow)' }}
      >
        {busy ? stage || 'Generating…' : 'Generate flashcards →'}
      </button>
    </div>
  )
}

const UNFILED = 'Unfiled'

interface Group {
  key: string
  name: string
  notes: Note[]
}

function Check({ state }: { state: 'none' | 'some' | 'all' }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-extrabold"
      style={{
        borderColor: state === 'none' ? 'var(--ring-track)' : 'var(--accent)',
        background: state === 'all' ? 'var(--accent)' : 'transparent',
        color: state === 'all' ? 'oklch(0.99 0.005 90)' : 'var(--accent)',
      }}
    >
      {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
    </span>
  )
}

/** Multi-select over the saved notes library.
 *
 * Selection is held locally and only handed back on confirm, so backing out leaves whatever was
 * already staged untouched — the alternative (writing straight through to the parent) makes Cancel
 * a lie once you've tapped anything.
 */
function NotePicker({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: Note[]
  onCancel: () => void
  onConfirm: (notes: Note[]) => void
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [chosen, setChosen] = useState<Note[]>(initial)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listNotes()
      .then(setNotes)
      .catch(() => setError('Could not load your notes.'))
  }, [])

  const isChosen = (note: Note) => chosen.some((p) => p.id === note.id)

  const toggle = (note: Note) =>
    setChosen((prev) => (prev.some((p) => p.id === note.id) ? prev.filter((p) => p.id !== note.id) : [...prev, note]))

  /** A partly-selected category fills up rather than clearing — tapping a half-filled box to
   * discard the selections you already made would be the more destructive reading of an ambiguous
   * gesture, and it's the one that's harder to undo. */
  const toggleGroup = (group: Group) => {
    const ids = new Set(group.notes.map((n) => n.id))
    const all = group.notes.every((n) => chosen.some((c) => c.id === n.id))
    setChosen((prev) =>
      all ? prev.filter((c) => !ids.has(c.id)) : [...prev.filter((c) => !ids.has(c.id)), ...group.notes],
    )
  }

  // Same grouping the Notes tab uses, so the library reads the same way in both places: categories
  // A-Z, Unfiled last because it's the absence of a category rather than one of them.
  const byDeck = new Map<string, Note[]>()
  for (const note of notes ?? []) {
    const key = note.deck_name ?? UNFILED
    const list = byDeck.get(key)
    if (list) list.push(note)
    else byDeck.set(key, [note])
  }
  const groups: Group[] = [...byDeck.entries()]
    .sort(([a], [b]) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ key: name, name, notes: list }))

  return (
    <div>
      <button onClick={onCancel} className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">
        ← Back
      </button>
      <p className="mb-5 text-sm text-[var(--text-secondary)]">
        Pick the notes to build cards from. They stay in your library — nothing is uploaded again.
      </p>

      {error && (
        <div className="mb-5 rounded-2xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      {notes === null && !error && <p className="text-sm text-[var(--text-secondary)]">Loading…</p>}

      {notes?.length === 0 && (
        <div className="rounded-[16px] border border-dashed border-[var(--ring-track)] p-10 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            You haven't saved any notes yet. Add some from the Notes tab first.
          </p>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-5">
        {groups.map((group) => {
          const picked = group.notes.filter((n) => isChosen(n)).length
          const all = picked === group.notes.length
          return (
            <div key={group.key}>
              <div
                onClick={() => toggleGroup(group)}
                className="mb-2 flex cursor-pointer items-center gap-2.5 px-1"
              >
                {/* Three states, not two: none / some / all. A half-filled box is the only honest
                    thing to show when a category is partly selected, and it's what tells you a tap
                    here will select the rest rather than clear what you have. */}
                <Check state={all ? 'all' : picked > 0 ? 'some' : 'none'} />
                <span className="min-w-0 flex-1 truncate text-base font-extrabold">{group.name}</span>
                <span className="flex-shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                  {picked > 0 ? `${picked}/${group.notes.length}` : `${group.notes.length}`}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {group.notes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => toggle(note)}
                    className="flex cursor-pointer items-start gap-3 rounded-[16px] border p-3.5"
                    style={{
                      borderColor: isChosen(note) ? 'transparent' : 'var(--ring-track)',
                      background: isChosen(note) ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-card))' : undefined,
                      boxShadow: isChosen(note) ? 'var(--highlight-shadow)' : undefined,
                    }}
                  >
                    <Check state={isChosen(note) ? 'all' : 'none'} />
                    <span className="min-w-0 flex-1">
                      <span className="mb-0.5 block text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        {note.file_type === 'pdf' ? 'PDF' : 'Photo'}
                      </span>
                      {note.title && <span className="mb-0.5 block truncate text-xs font-bold">{note.title}</span>}
                      <span className="line-clamp-2 block text-xs leading-relaxed text-[var(--text-secondary)]">
                        {note.preview || 'No text was read from this file.'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => onConfirm(chosen)}
        disabled={chosen.length === 0}
        className="w-full rounded-xl bg-[var(--accent)] py-3.5 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
        style={{ boxShadow: 'var(--accent-shadow)' }}
      >
        {chosen.length === 0 ? 'Select notes' : `Use ${chosen.length} note${chosen.length === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
