import { useEffect, useState } from 'react'
import { listNotes } from '../../api'
import BackButton from '../BackButton'
import { kindLabel, type NoteGroup, previewText, UNFILED } from '../../lib/notes'
import type { Note } from '../../types'

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
export default function NotePicker({
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
  const toggleGroup = (group: NoteGroup) => {
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
  const groups: NoteGroup[] = [...byDeck.entries()]
    .sort(([a], [b]) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ key: name, name, notes: list }))

  return (
    <div>
      <BackButton onClick={onCancel} className="mb-3">Back</BackButton>
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
                          {note.title || kindLabel(note.file_type)}
                        </span>
                        <span className="line-clamp-2 block text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                          {previewText(note)}
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
        className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {chosen.length === 0 ? 'Choose some notes' : `Use ${chosen.length} note${chosen.length === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
