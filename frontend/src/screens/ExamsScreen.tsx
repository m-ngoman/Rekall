import { useState } from 'react'
import { listDecks, listExams } from '../api'
import ExamCalendar from '../components/ExamCalendar'
import ExamSheet from '../components/ExamSheet'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil, formatCountdown, formatDayLong, formatMonth, toISODate } from '../lib/dates'
import type { Deck, Exam } from '../types'

interface Props {
  /** Exam saves/deletes change deck scheduling — the parent bumps refreshKey so Home and Cards
   * refetch on their next visit. */
  onChanged: () => void
}

/** The Calendar tab: a month grid where exams live. Everything exam-related is done from here —
 * tap a day to add one, tap a chip or row to edit — never from the deck side. */
export default function ExamsScreen({ onChanged }: Props) {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [exams, setExams] = useCachedResource<Exam[]>('exams', listExams, () => [])
  const [decks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const [sheet, setSheet] = useState<{ exam: Exam | null; date: string; pickDate: boolean } | null>(null)

  const moveMonth = (delta: number) => {
    // Date normalizes month overflow, so Dec+1 rolls the year without special-casing.
    const d = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  /** Write-through on save/delete so the calendar updates instantly. */
  const handleSaved = (saved: Exam | null, deletedId?: string) => {
    setExams((prev) => {
      const list = prev ?? []
      if (saved === null) return list.filter((e) => e.id !== deletedId)
      const rest = list.filter((e) => e.id !== saved.id)
      return [...rest, saved].sort((a, b) => a.date.localeCompare(b.date))
    })
    onChanged()
  }

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const monthExams = (exams ?? []).filter((e) => e.date.startsWith(monthPrefix))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <div className="text-[1.375rem] font-extrabold tracking-tight">{formatMonth(cursor.year, cursor.month)}</div>
        <div className="flex items-center gap-1.5">
          <MonthNavButton dir="prev" onClick={() => moveMonth(-1)} />
          <MonthNavButton dir="next" onClick={() => moveMonth(1)} />
          <button
            onClick={() => setSheet({ exam: null, date: toISODate(new Date()), pickDate: true })}
            className="ml-1 rounded-full px-4 py-2 text-sm font-bold text-[oklch(0.99_0.005_90)]"
            style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
          >
            + Add
          </button>
        </div>
      </div>

      <ExamCalendar
        year={cursor.year}
        month={cursor.month}
        exams={exams ?? []}
        onDayTap={(iso) => setSheet({ exam: null, date: iso, pickDate: false })}
        onExamTap={(exam) => setSheet({ exam, date: exam.date, pickDate: true })}
      />

      {exams !== null && exams.length === 0 ? (
        <p className="px-1 text-center text-sm text-[var(--text-secondary)]">
          Tap a day to add your first exam. Decks you link get every card scheduled before the
          date, then come off the daily list once it's behind you.
        </p>
      ) : monthExams.length > 0 ? (
        <div>
          <div className="mb-2.5 px-1 text-base font-extrabold">This month</div>
          <div className="flex flex-col gap-2">
            {monthExams.map((e) => {
              const days = daysUntil(e.date)
              return (
                <button
                  key={e.id}
                  onClick={() => setSheet({ exam: e, date: e.date, pickDate: true })}
                  className={`flex items-center gap-3 rounded-[16px] border border-[var(--ring-track)] px-4 py-3 text-left hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)] ${
                    days < 0 ? 'opacity-55' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9375rem] font-bold">{e.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {formatDayLong(e.date)} · {e.deck_ids.length} deck{e.deck_ids.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span
                    className="flex-shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                    style={
                      days < 0
                        ? { color: 'var(--text-secondary)', background: 'var(--ring-track)' }
                        : { color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-card))' }
                    }
                  >
                    {formatCountdown(days)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {sheet && (
        <ExamSheet
          exam={sheet.exam}
          initialDate={sheet.date}
          showDatePicker={sheet.pickDate}
          decks={decks ?? []}
          onClose={() => setSheet(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function MonthNavButton({ dir, onClick }: { dir: 'prev' | 'next'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'prev' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  )
}
