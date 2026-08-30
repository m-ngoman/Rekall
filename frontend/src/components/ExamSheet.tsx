import { useEffect, useState } from 'react'
import { createExam, deleteExam, updateExam } from '../api'
import { formatDayLong } from '../lib/dates'
import type { Deck, Exam } from '../types'

interface Props {
  /** An existing exam to edit, or null to create. */
  exam: Exam | null
  /** Pre-filled date for a create (the tapped calendar day). Ignored when editing. */
  initialDate: string
  /** False when the sheet was opened by tapping a specific day — the tap already chose the date,
   * so re-asking is noise (the header still echoes which day). True for "+ Add" and edits. */
  showDatePicker: boolean
  decks: Deck[]
  onClose: () => void
  /** Called with the server's result after any successful save/delete, so the caller can update
   * its exam list without a refetch. `null` means the exam was deleted. */
  onSaved: (exam: Exam | null, deletedId?: string) => void
}

/** Bottom sheet on mobile, centered dialog on desktop. Selection state is local and only lands
 * on Save — backing out leaves the exam untouched, same contract as the note picker. */
export default function ExamSheet({ exam, initialDate, showDatePicker, decks, onClose, onSaved }: Props) {
  const [name, setName] = useState(exam?.name ?? '')
  const [date, setDate] = useState(exam?.date ?? initialDate)
  const [deckIds, setDeckIds] = useState<Set<string>>(() => new Set(exam?.deck_ids ?? []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleDeck = (id: string) =>
    setDeckIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (!name.trim() || !date || busy) return
    setBusy(true)
    setError(null)
    try {
      const ids = [...deckIds]
      const saved = exam
        ? await updateExam(exam.id, { name: name.trim(), date, deck_ids: ids })
        : await createExam(name.trim(), date, ids)
      onSaved(saved)
      onClose()
    } catch {
      setError("Couldn't save the exam. Please try again.")
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!exam || busy) return
    if (!confirm('Delete this exam? Its decks go back to normal scheduling.')) return
    setBusy(true)
    try {
      await deleteExam(exam.id)
      onSaved(null, exam.id)
      onClose()
    } catch {
      setError("Couldn't delete the exam. Please try again.")
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgb(0_0_0_/_0.45)] lg:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={exam ? 'Edit exam' : 'Add exam'}
    >
      <div
        className="w-full max-w-md rounded-t-[22px] bg-[var(--bg-card)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:rounded-[22px]"
        style={{ boxShadow: 'var(--shadow-md)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-base font-extrabold">{exam ? 'Edit exam' : 'Add exam'}</span>
          <span className="text-xs font-semibold text-[var(--text-secondary)]">{date ? formatDayLong(date) : ''}</span>
        </div>

        <input
          autoFocus={!exam}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder="Exam name (e.g. Bio 12 final)"
          maxLength={80}
          className="w-full rounded-xl bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        />

        {showDatePicker && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-xl bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none"
            style={{ boxShadow: 'var(--shadow-sm)', colorScheme: 'inherit' }}
          />
        )}

        <div className="mt-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            Decks for this exam
          </div>
          {decks.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No decks yet — you can link some later.</p>
          ) : (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {decks.map((d) => {
                const on = deckIds.has(d.id)
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleDeck(d.id)}
                    disabled={busy}
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                  >
                    <span
                      aria-hidden
                      className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-extrabold"
                      style={{
                        borderColor: on ? 'var(--accent)' : 'var(--ring-track)',
                        background: on ? 'var(--accent)' : 'transparent',
                        color: 'oklch(0.99 0.005 90)',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.name}</span>
                    <span className="flex-shrink-0 text-[0.6875rem] text-[var(--text-secondary)]">
                      {d.total} card{d.total === 1 ? '' : 's'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-[var(--grade-forgot)]">{error}</p>}

        <div className="mt-5 flex items-center gap-2.5">
          {exam && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--grade-forgot)]"
              style={{ background: 'var(--grade-forgot-bg)' }}
            >
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)]">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !name.trim() || !date}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
            style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
