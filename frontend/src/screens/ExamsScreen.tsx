import { useEffect, useRef, useState } from 'react'
import { listDecks, listExams } from '../api'
import ExamCalendar, { gridRange } from '../components/ExamCalendar'
import ExamSheet from '../components/ExamSheet'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil, formatCountdown, formatDayShort, formatMonth, toISODate } from '../lib/dates'
import { getLoad, loadCache, loadKey, type LoadByDay } from '../lib/load'
import type { Deck, Exam } from '../types'

interface Props {
  onChanged: () => void
}

/** The Calendar tab. Reads as "what's coming": the next exam and its countdown on top, then the
 * month as a load timeline — every day shows how many cards FSRS has put on it. */
export default function ExamsScreen({ onChanged }: Props) {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [exams, setExams] = useCachedResource<Exam[]>('exams', listExams, () => [])
  const [decks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const [sheet, setSheet] = useState<{ exam: Exam | null; date: string; pickDate: boolean } | null>(null)

  const { start, end } = gridRange(cursor.year, cursor.month)
  const key = loadKey(start, end)
  const [load, setLoad] = useState<LoadByDay>(() => loadCache.get(key) ?? {})
  // What was on screen before the fresh numbers arrived — the calendar drains the difference.
  const prevLoad = useRef<LoadByDay>(load)

  useEffect(() => {
    const cached = loadCache.get(key)
    prevLoad.current = cached ?? {}
    setLoad(cached ?? {})
    let alive = true
    getLoad(start, end)
      .then((fresh) => {
        if (!alive) return
        loadCache.set(key, fresh)
        setLoad(fresh)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // start/end are derived from key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const moveMonth = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  const handleSaved = (saved: Exam | null, deletedId?: string) => {
    setExams((prev) => {
      const list = prev ?? []
      if (saved === null) return list.filter((e) => e.id !== deletedId)
      const rest = list.filter((e) => e.id !== saved.id)
      return [...rest, saved].sort((a, b) => a.date.localeCompare(b.date))
    })
    // Scheduling changed, so the load did too; drop the cache so the next fetch re-baselines.
    loadCache.delete(key)
    onChanged()
  }

  const upcoming = (exams ?? []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))
  const next = upcoming[0]
  const nextDays = next ? daysUntil(next.date) : null
  const todayISO = toISODate(new Date())
  const cardsBeforeNext = next
    ? Object.entries(load).reduce((sum, [iso, n]) => (iso >= todayISO && iso <= next.date ? sum + n : sum), 0)
    : 0

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const monthExams = (exams ?? []).filter((e) => e.date.startsWith(monthPrefix))
  const openExam = (e: Exam) => setSheet({ exam: e, date: e.date, pickDate: true })

  // Phone: countdown, month, this month's exams, top to bottom. Desktop: the month on the left,
  // and the countdown with everything coming up in a column beside it — the calendar is the
  // thing you scan, the column is the thing you read.
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-14">
      <div className="lg:order-2 lg:pt-1.5">
        {next ? (
          <button onClick={() => openExam(next)} className="flex w-full flex-col text-left">
            <div className="flex w-full items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[1.125rem] font-bold">{next.name}</span>
              <span className="flex-shrink-0 text-[0.875rem] text-[var(--text-muted)]">{formatDayShort(next.date)}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2.5 lg:mt-1.5 lg:gap-3">
              <span className="numeral text-[3.5rem] text-[var(--accent)] lg:text-[6rem]">{nextDays}</span>
              <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)] lg:text-[1rem]">{nextDays === 1 ? 'day' : 'days'}</span>
              {cardsBeforeNext > 0 && (
                <span className="ml-auto whitespace-nowrap text-[0.875rem] text-[var(--text-muted)] lg:hidden">{cardsBeforeNext} cards before it</span>
              )}
            </div>
            {cardsBeforeNext > 0 && (
              <div className="mt-3.5 hidden text-[0.875rem] text-[var(--text-muted)] lg:block">{cardsBeforeNext} cards before it</div>
            )}
          </button>
        ) : (
          <div className="flex flex-col">
            <div className="text-[1.125rem] font-bold">No exam coming up</div>
            <div className="mt-0.5 text-[0.875rem] text-[var(--text-muted)]">
              Tap a day to add one. Linked decks get every card in before the date.
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="hidden lg:block">
            <div className="mb-1 mt-9 text-[0.9375rem] font-bold">Coming up</div>
            <ExamRows exams={upcoming} onOpen={openExam} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:order-1 lg:gap-6">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="text-[1.0625rem] font-bold lg:mr-2">{formatMonth(cursor.year, cursor.month)}</div>
          <div className="flex items-center">
            <MonthNavButton dir="prev" onClick={() => moveMonth(-1)} />
            <MonthNavButton dir="next" onClick={() => moveMonth(1)} />
            <button
              onClick={() => setSheet({ exam: null, date: toISODate(new Date()), pickDate: true })}
              className="on-accent ml-1 rounded-[var(--r-full)] bg-[var(--accent)] px-4 py-2.5 text-[0.875rem] font-bold lg:ml-2"
            >
              Add exam
            </button>
          </div>
        </div>

        <ExamCalendar
          year={cursor.year}
          month={cursor.month}
          exams={exams ?? []}
          load={load}
          prevLoad={prevLoad.current}
          onDayTap={(iso) => setSheet({ exam: null, date: iso, pickDate: false })}
          onExamTap={openExam}
        />
      </div>

      {monthExams.length > 0 && (
        <div className="lg:hidden">
          <ExamRows exams={monthExams} onOpen={openExam} />
        </div>
      )}

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

/** Ruled rows of exams, name left and "date, countdown" right. Past ones fade rather than vanish
 * so the month still tells its whole story. */
function ExamRows({ exams, onOpen }: { exams: Exam[]; onOpen: (e: Exam) => void }) {
  return (
    <div className="border-t border-[var(--rule)]">
      {exams.map((e) => {
        const days = daysUntil(e.date)
        return (
          <button
            key={e.id}
            onClick={() => onOpen(e)}
            className={`flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left ${days < 0 ? 'opacity-55' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{e.name}</span>
            <span className="flex-shrink-0 whitespace-nowrap text-[0.875rem] text-[var(--text-muted)]">
              {formatDayShort(e.date)}, {formatCountdown(days)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function MonthNavButton({ dir, onClick }: { dir: 'prev' | 'next'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      className="flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'prev' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  )
}
