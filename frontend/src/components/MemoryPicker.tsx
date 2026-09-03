import { useState } from 'react'
import type { MemoryCategory, MemoryNote } from '../types'

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: 'Preference',
  gap: 'Gap',
  context: 'Context',
  custom: 'Note',
}

interface Props {
  notes: MemoryNote[] | null
  onAdd: (category: MemoryCategory, content: string) => void
  onDelete: (id: string) => void
}

export default function MemoryPicker({ notes, onAdd, onDelete }: Props) {
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
        What the tutor remembers about you across sessions. Notes marked <span className="font-bold">auto</span> are
        ones it wrote itself — delete any that are wrong.
      </p>

      {notes === null ? (
        <p className="text-xs text-[var(--text-muted)]">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mb-3 text-xs text-[var(--text-muted)]">No notes yet — add one below.</p>
      ) : (
        <div className="mb-3 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.6875rem] font-bold text-[var(--text-muted)]">{CATEGORY_LABELS[n.category]}</span>
                  {/* The tutor's own inferences are marked, not hidden: writing them without an
                      approval step is only fair if you can see which ones it made up. */}
                  {n.source === 'auto' && (
                    <span
                      className="rounded-[var(--r-full)] px-1.5 py-px text-[0.625rem] font-bold text-[var(--text-muted)]"
                      style={{ background: 'var(--rule)' }}
                      title="Written by the tutor from your conversations"
                    >
                      auto
                    </span>
                  )}
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
