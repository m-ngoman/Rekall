import { useState } from 'react'
import { formatDayLong } from '../lib/dates'
import type { MemoryCategory, MemoryNote, StudentProfile } from '../types'

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: 'Preference',
  gap: 'Gap',
  context: 'Context',
  custom: 'Note',
}

interface Props {
  notes: MemoryNote[] | null
  profile: StudentProfile | null
  onAdd: (category: MemoryCategory, content: string) => void
  onDelete: (id: string) => void
  onDeleteProfileLine: (text: string) => void
}

export default function MemoryPicker({ notes, profile, onAdd, onDelete, onDeleteProfileLine }: Props) {
  const [category, setCategory] = useState<MemoryCategory>('preference')
  const [draft, setDraft] = useState('')

  const handleAdd = () => {
    const content = draft.trim()
    if (!content) return
    onAdd(category, content)
    setDraft('')
  }

  return (
    <div className="w-80 rounded-[var(--r-md)] border border-[var(--rule)] bg-[var(--surface)] p-4">
      <div className="mb-1 text-[0.9375rem] font-bold">Memory</div>
      <p className="mb-3.5 text-xs text-[var(--text-muted)]">
        What the tutor remembers about you across sessions.
      </p>

      {/* The tutor's own reading of you, kept visually apart from what you told it. Two different
          kinds of claim — one you wrote deliberately, one a model inferred from a transcript —
          and the tutor is told to weight them differently, so showing them as one list would be
          the wrong picture. Read-only: the way to correct it is to delete the line and write
          your own note, which is also the only way an edit provably survives the next pass. */}
      {profile && profile.lines.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[0.6875rem] font-bold text-[var(--text-muted)]">WHAT IT&rsquo;S NOTICED</span>
            {profile.chars > profile.max_chars * 0.8 && (
              <span className="text-[0.625rem] text-[var(--text-muted)]" title="At the limit it merges patterns instead of adding new ones">
                nearly full
              </span>
            )}
          </div>
          <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
            {profile.lines.map((line) => (
              <div
                key={line.text}
                className="flex items-start gap-2 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2.5"
                style={{ opacity: line.stale ? 0.55 : 1 }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs leading-relaxed text-[var(--text)]">{line.text}</div>
                  <div className="mt-0.5 text-[0.625rem] text-[var(--text-muted)]">
                    {line.sessions} {line.sessions === 1 ? 'session' : 'sessions'}
                    {line.stale && <> &middot; hasn&rsquo;t come up since {formatDayLong(line.latest)}</>}
                  </div>
                </div>
                <button
                  onClick={() => onDeleteProfileLine(line.text)}
                  aria-label="Delete this observation"
                  title="Delete — it won't be written again"
                  className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {notes !== null && (
        <div className="mb-1.5 text-[0.6875rem] font-bold text-[var(--text-muted)]">YOUR NOTES</div>
      )}

      {notes === null ? (
        <p className="text-xs text-[var(--text-muted)]">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mb-3 text-xs text-[var(--text-muted)]">Nothing yet — add something you want it to know.</p>
      ) : (
        <div className="mb-3 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.6875rem] font-bold text-[var(--text-muted)]">{CATEGORY_LABELS[n.category]}</span>
                </div>
                <div className="text-xs leading-relaxed text-[var(--text)]">{n.content}</div>
              </div>
              <button
                onClick={() => onDelete(n.id)}
                aria-label="Delete note"
                className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--rule)] pt-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          className="rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2 text-xs"
        >
          <option value="preference">Preference — how you like to learn</option>
          <option value="gap">Gap — something you keep struggling with</option>
          <option value="context">Context — what you're studying for</option>
          <option value="custom">Note — anything else</option>
        </select>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Add a note…"
            className="min-w-0 flex-1 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2 text-xs"
          />
          <button
            onClick={handleAdd}
            className="on-accent flex-shrink-0 rounded-[var(--r-full)] bg-[var(--accent)] px-3.5 py-2 text-xs font-bold"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
