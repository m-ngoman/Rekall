import { useEffect, useRef, useState } from 'react'
import { generateDeck, generateDeckFromNotes, listDecks, listNotes } from '../api'
import ActionCard from '../components/ActionCard'
import type { Deck, GenerationResult, Note } from '../types'

const BACK_CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)
const BACK_CLASS = '-ml-2 mb-3 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]'

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
    const added = result.cards_added.length
    const dropped = result.cards_dropped.length
    return (
      <div>
        <div className="mb-1 text-[1.25rem] font-bold">Added to {result.deck_name}</div>
        <p className="mb-5 text-[0.9375rem] text-[var(--text-muted)]">
          {added} card{added === 1 ? '' : 's'} added
          {dropped > 0 && `, ${dropped} dropped because ${dropped === 1 ? 'it' : 'they'} didn't hold up against your notes`}.
        </p>

        <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
          {result.cards_added.map((c) => (
            <div key={c.id} className="border-b border-[var(--rule)] py-3.5">
              {c.subtopic && <div className="mb-0.5 text-[0.8125rem] font-semibold text-[var(--text-muted)]">{c.subtopic}</div>}
              <div className="text-[0.9375rem] font-bold">{c.question}</div>
              <div className="mt-0.5 text-sm text-[var(--text-muted)]">{c.answer}</div>
            </div>
          ))}
        </div>

        {dropped > 0 && (
          <div className="mb-5">
            <div className="mb-2 text-[0.9375rem] font-bold">Dropped during verification</div>
            <div className="flex flex-col border-t border-[var(--rule)]">
              {result.cards_dropped.map((d, i) => (
                <div key={i} className="border-b border-[var(--rule)] py-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text)]">{d.question}</span> {d.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onDone} className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold">
          Done
        </button>
      </div>
    )
  }

  const staged: { key: string; label: string; remove: () => void }[] = [
    ...pickedNotes.map((n) => ({
      key: `note-${n.id}`,
      label: n.title || n.preview || (n.file_type === 'text' ? 'Empty note' : `${n.file_type === 'pdf' ? 'PDF' : 'Photo'} with no readable text`),
      remove: () => setPickedNotes((prev) => prev.filter((p) => p.id !== n.id)),
    })),
    ...files.map((f, i) => ({ key: `file-${i}-${f.name}`, label: f.name, remove: () => removeFile(i) })),
  ]

  return (
    <div>
      <button onClick={onCancel} className={BACK_CLASS}>
        {BACK_CHEVRON}
        Back
      </button>
      <p className="mb-5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
        Upload photos of your notes or a PDF, or pull from notes you've already saved. The AI drafts flashcards, then
        checks each one against your notes before adding it.
      </p>

      <div className="mb-5">
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Add to</div>
        <select
          value={targetDeckId}
          onChange={(e) => setTargetDeckId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
        >
          <option value="">New deck, the AI names it</option>
          <option value={NAME_IT}>New deck, I'll name it</option>
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
            className="mt-2 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
          />
        )}
      </div>

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
      <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
      <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setPdf(e.target.files)} />

      {/* The four sources are rows on one surface, same as the ways in on the Cards tab. */}
      <div className="mb-3 rounded-[var(--r-md)] bg-[var(--surface)] [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
        <ActionCard onClick={() => cameraInputRef.current?.click()} disabled={busy} title="Take a photo" description="Point the camera at a page of notes" icon={CAMERA_ICON} />
        <ActionCard onClick={() => libraryInputRef.current?.click()} disabled={busy} title="Choose photos" description="From your photo library" icon={LIBRARY_ICON} />
        <ActionCard onClick={() => pdfInputRef.current?.click()} disabled={busy} title="Choose a PDF" description="Lecture slides, a handout, a chapter" icon={PDF_ICON} />
        <ActionCard
          onClick={() => setPicking(true)}
          disabled={busy}
          title="Use saved notes"
          description={
            pickedNotes.length > 0
              ? `${pickedNotes.length} note${pickedNotes.length === 1 ? '' : 's'} chosen. Tap to change.`
              : 'Build cards from what is already in your library'
          }
          icon={NOTES_ICON}
        />
      </div>

      {staged.length > 0 && (
        <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
          {staged.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-2.5">
              <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{item.label}</span>
              <button
                onClick={item.remove}
                disabled={busy}
                className="-mr-2 flex-shrink-0 rounded-[var(--r-sm)] px-2 py-2 text-[0.8125rem] font-bold text-[var(--text-muted)]"
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
        onClick={handleGenerate}
        disabled={busy || (files.length === 0 && pickedNotes.length === 0)}
        className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {busy ? stage || 'Generating' : 'Generate flashcards'}
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

/** Three states, not two: none / some / all. The Settings presets' dot, plus a hollow one for
 * "some of this group" — the only honest thing to show when a category is partly selected. */
function Check({ state }: { state: 'none' | 'some' | 'all' }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 box-border block h-2 w-2 flex-shrink-0 rounded-[var(--r-full)]"
      style={{
        background: state === 'all' ? 'var(--accent)' : state === 'some' ? 'transparent' : 'var(--rule)',
        border: state === 'some' ? '2px solid var(--accent)' : undefined,
      }}
    />
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
      <button onClick={onCancel} className={BACK_CLASS}>
        {BACK_CHEVRON}
        Back
      </button>
      <p className="mb-5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
        Pick the notes to build cards from. They stay in your library, nothing is uploaded again.
      </p>

      {error && (
        <div className="mb-5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      {notes === null && !error && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

      {notes?.length === 0 && (
        <div className="rounded-[var(--r-md)] border border-dashed border-[var(--rule)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">You haven't saved any notes yet. Add some from the Notes tab first.</p>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-6">
        {groups.map((group) => {
          const picked = group.notes.filter((n) => isChosen(n)).length
          const all = picked === group.notes.length
          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group)}
                aria-pressed={all}
                className="mb-1 flex min-h-[44px] w-full items-center gap-3 text-left"
              >
                {/* A tap on a half-filled group selects the rest rather than clearing what you
                    have — the less destructive reading of an ambiguous gesture. */}
                <Check state={all ? 'all' : picked > 0 ? 'some' : 'none'} />
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{group.name}</span>
                <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">
                  {picked > 0 ? `${picked} of ${group.notes.length}` : `${group.notes.length}`}
                </span>
              </button>

              <div className="flex flex-col border-t border-[var(--rule)]">
                {group.notes.map((note) => {
                  const on = isChosen(note)
                  return (
                    <button
                      key={note.id}
                      onClick={() => toggle(note)}
                      role="checkbox"
                      aria-checked={on}
                      className="flex items-start gap-3 border-b border-[var(--rule)] py-3 text-left"
                    >
                      <Check state={on ? 'all' : 'none'} />
                      <span className="min-w-0 flex-1" style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}>
                        <span className="block truncate text-[0.9375rem] font-semibold">
                          {note.title || (note.file_type === 'pdf' ? 'PDF' : note.file_type === 'image' ? 'Photo' : 'Note')}
                        </span>
                        <span className="line-clamp-2 block text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                          {note.preview || (note.file_type === 'text' ? 'Nothing written yet.' : 'No text was read from this file.')}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => onConfirm(chosen)}
        disabled={chosen.length === 0}
        className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {chosen.length === 0 ? 'Choose some notes' : `Use ${chosen.length} note${chosen.length === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
