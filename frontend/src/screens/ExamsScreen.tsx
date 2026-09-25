import { useEffect, useRef, useState } from 'react'
import { listDecks, listExams } from '../api'
import ExamCalendar, { gridRange } from '../components/ExamCalendar'
import ExamSheet from '../components/ExamSheet'
import LoadNotice from '../components/LoadNotice'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil, formatDayFull, formatDayShort, formatMonth, toISODate } from '../lib/dates'
import { upcomingExams } from '../lib/exams'
import { getDayLoad, getLoad, loadCache, loadKey, type LoadByDay } from '../lib/load'
import type { DayDeck, Deck, Exam } from '../types'

interface Props {
  onChanged: () => void
}

/** The Calendar tab. Reads as "what's coming": the next exam and its countdown on top, then the
 * month as a load timeline — every day shows how many cards FSRS has put on it. Tapping a day
 * opens that day: its cards by deck, its exams, and adding one. It used to go straight to "Add
 * exam", which a grid drawn as a workload doesn't lead anyone to expect. */
export default function ExamsScreen({ onChanged }: Props) {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [exams, setExams, examsStatus] = useCachedResource<Exam[]>('exams', listExams)
  const [decks] = useCachedResource<Deck[]>('decks', listDecks)
  const [sheet, setSheet] = useState<{ exam: Exam | null; date: string; pickDate: boolean } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const { start, end } = gridRange(cursor.year, cursor.month)
  const key = loadKey(start, end)
  const [load, setLoad] = useState<LoadByDay>(() => loadCache.get(key) ?? {})
  // Bumped whenever scheduling changes, so the run-up count refetches even if the date did not.
  const [loadToken, setLoadToken] = useState(0)
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
    // start/end are derived from key. loadToken is here so a saved exam re-baselines the bars
    // as well as the run-up count — handleSaved clears the cache, and this is what refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadToken])

  const moveMonth = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
    // The open day's count is read off this month's grid, so it closes with the month.
    setSelectedDay(null)
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
    setLoadToken((t) => t + 1)
    onChanged()
  }

  const upcoming = upcomingExams(exams)
  const next = upcoming[0]
  const nextDays = next ? daysUntil(next.date) : null

  // The run-up spans today → exam, which is usually not the month on screen, so it gets its own
  // fetch. Summing the grid's `load` undercounted whenever the exam fell outside the visible
  // month, and the number moved as you paged even though the exam had not — an exam five weeks
  // out read as almost no work.
  const nextDate = next?.date
  const [cardsBeforeNext, setCardsBeforeNext] = useState<number | null>(null)
  useEffect(() => {
    if (!nextDate) {
      setCardsBeforeNext(null)
      return
    }
    // A day early on purpose: the backend buckets against UTC today and folds every overdue card
    // onto it, so a window starting at local today drops the whole overdue pile for anyone east
    // of UTC in the small hours. It never emits a day before its own today, so the extra day
    // costs nothing and no lower bound is needed when summing.
    const from = new Date(Date.now() - 86_400_000)
    const to = new Date(`${nextDate}T00:00:00`)
    const runUpKey = loadKey(from, to)
    const sum = (byDay: LoadByDay) =>
      Object.entries(byDay).reduce((acc, [iso, n]) => (iso <= nextDate ? acc + n : acc), 0)

    // Render the last known total for *this* exam immediately; null while it is a different one,
    // so a stale count never sits under a new exam's name.
    const cached = loadCache.get(runUpKey)
    setCardsBeforeNext(cached ? sum(cached) : null)

    let alive = true
    getLoad(from, to)
      .then((byDay) => {
        if (!alive) return
        loadCache.set(runUpKey, byDay)
        setCardsBeforeNext(sum(byDay))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [nextDate, loadToken])

  // The selected day's cards, by deck. Fetched here rather than in the panel because the panel is
  // drawn twice (under the grid on a phone, in the column on desktop) and one request serves both.
  // Refetched when scheduling changes, so the rows keep adding up to the bar above them.
  const [dayDecks, setDayDecks] = useState<DayDeck[] | null>(null)
  useEffect(() => {
    setDayDecks(null)
    if (!selectedDay) return
    let alive = true
    getDayLoad(selectedDay)
      .then((rows) => alive && setDayDecks(rows))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [selectedDay, loadToken])

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const monthExams = (exams ?? []).filter((e) => e.date.startsWith(monthPrefix))
  const openExam = (e: Exam) => setSheet({ exam: e, date: e.date, pickDate: true })
  const dayPanel = selectedDay && (
    <DayPanel
      iso={selectedDay}
      total={load[selectedDay] ?? 0}
      decks={dayDecks}
      exams={(exams ?? []).filter((e) => e.date === selectedDay)}
      onOpenExam={openExam}
      onAddExam={() => setSheet({ exam: null, date: selectedDay, pickDate: false })}
    />
  )

  // Phone: countdown, month, this month's exams, top to bottom. Desktop: the month on the left,
  // and the countdown with everything coming up in a column beside it — the calendar is the
  // thing you scan, the column is the thing you read.
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-14">
      {/* Without the exams the countdown would say there are none, which is the one thing it
          can't say without knowing. */}
      {examsStatus.failed && (
        <LoadNotice stale={exams !== null} what="your exams" onRetry={examsStatus.retry} className="lg:col-span-2" />
      )}
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
              {(cardsBeforeNext ?? 0) > 0 && (
                <span className="ml-auto whitespace-nowrap text-[0.875rem] text-[var(--text-muted)] lg:hidden">{cardsBeforeNext} cards before it</span>
              )}
            </div>
            {(cardsBeforeNext ?? 0) > 0 && (
              <div className="mt-3.5 hidden text-[0.875rem] text-[var(--text-muted)] lg:block">{cardsBeforeNext} cards before it</div>
            )}
          </button>
        ) : exams === null ? null : (
          <div className="flex flex-col">
            <div className="text-[1.125rem] font-bold">No exam coming up</div>
            <div className="mt-0.5 text-[0.875rem] text-[var(--text-muted)]">
              Tap its day, or Add exam. Linked decks pace their new cards to land before the date.
            </div>
          </div>
        )}

        {/* Desktop: the open day reads in the column, between the countdown and what's coming,
            since the column is the thing you read and the grid the thing you scan. */}
        {dayPanel && <div className="mt-9 hidden lg:block">{dayPanel}</div>}

        {/* Desktop puts Add exam here rather than beside the month title. A filled accent pill
            sitting next to the countdown numeral was a second accent fill competing with the one
            thing on the screen that is supposed to be loud. */}
        <div className="mb-1 mt-9 hidden items-center justify-between gap-3 lg:flex">
          <span className="text-[1.0625rem] font-bold tracking-[-0.01em]">Coming up</span>
          <button
            onClick={() => setSheet({ exam: null, date: toISODate(new Date()), pickDate: true })}
            className="flex h-9 flex-shrink-0 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-3.5 text-[0.8125rem] font-bold"
          >
            Add exam
          </button>
        </div>
        {upcoming.length > 0 && (
          <div className="hidden lg:block">
            <ExamRows exams={upcoming} onOpen={openExam} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:order-1 lg:gap-6">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="text-[1.0625rem] font-bold tracking-[-0.01em] lg:mr-2">{formatMonth(cursor.year, cursor.month)}</div>
          <div className="flex items-center">
            <MonthNavButton dir="prev" onClick={() => moveMonth(-1)} />
            <MonthNavButton dir="next" onClick={() => moveMonth(1)} />
            {/* Outline, not filled — see the Coming up header, where the desktop copy lives. */}
            <button
              onClick={() => setSheet({ exam: null, date: toISODate(new Date()), pickDate: true })}
              className="ml-1 flex h-10 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.875rem] font-bold lg:hidden"
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
          selected={selectedDay}
          onDayTap={(iso) => setSelectedDay((open) => (open === iso ? null : iso))}
          onExamTap={openExam}
        />
        {/* Phone: straight under the grid, where the tap was. */}
        {dayPanel && <div className="mt-4 lg:hidden">{dayPanel}</div>}
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

/** One day, opened from the grid: what's on it and what can be added to it. Its cards come by
 * deck, because a study session is one deck; its exams are the ordinary rows; and "Add exam" is
 * the outline pill it is everywhere else on this screen, second to what the day already holds. */
function DayPanel({
  iso,
  total,
  decks,
  exams,
  onOpenExam,
  onAddExam,
}: {
  iso: string
  /** The day's bar in the grid. Shown straight away; the rows under it follow. */
  total: number
  /** Null while loading, or if the breakdown couldn't be fetched: the total still stands. */
  decks: DayDeck[] | null
  exams: Exam[]
  onOpenExam: (e: Exam) => void
  onAddExam: () => void
}) {
  const today = daysUntil(iso) === 0
  return (
    <section aria-label={formatDayFull(iso)}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[1.0625rem] font-bold tracking-[-0.01em]">
          {today ? `Today, ${formatDayShort(iso)}` : formatDayFull(iso)}
        </span>
        <button
          onClick={onAddExam}
          className="flex h-10 flex-shrink-0 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.875rem] font-bold"
        >
          Add exam
        </button>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {total > 0 ? (
          <>
            <span className="numeral text-[1.5rem]">{total}</span>
            <span className="text-[0.875rem] text-[var(--text-muted)]">
              {total === 1 ? 'card' : 'cards'} {today ? 'left today' : 'scheduled'}
            </span>
          </>
        ) : (
          <span className="text-[0.875rem] text-[var(--text-muted)]">
            {today ? 'Nothing left today.' : 'Nothing scheduled yet.'}
          </span>
        )}
      </div>
      {total > 0 && decks && decks.length > 0 && (
        <div className="mt-3 border-t border-[var(--rule)]">
          {decks.map((d) => (
            <div key={d.id} className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-2.5">
              <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{d.name}</span>
              <span className="flex flex-shrink-0 items-baseline gap-1">
                <span className="numeral text-[1.125rem]">{d.cards}</span>
                <span className="text-[0.8125rem] text-[var(--text-muted)]">{d.cards === 1 ? 'card' : 'cards'}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {exams.length > 0 && (
        <div className="mt-3">
          <ExamRows exams={exams} onOpen={onOpenExam} />
        </div>
      )}
    </section>
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
            className={`flex w-full items-center justify-between gap-4 border-b border-[var(--rule)] py-3 text-left ${days < 0 ? 'opacity-55' : ''}`}
          >
            {/* Name over date on the left, the count in the condensed face on the right. The
                old single line ("Fri 2 Oct, in 16 days") was the same shape as a deck row. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-semibold">{e.name}</span>
              <span className="mt-0.5 block text-[0.8125rem] text-[var(--text-muted)]">{formatDayShort(e.date)}</span>
            </span>
            {days < 0 ? (
              <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">passed</span>
            ) : (
              <span className="flex flex-shrink-0 items-baseline gap-1">
                <span className="numeral text-[1.125rem]">{days}</span>
                <span className="text-[0.8125rem] text-[var(--text-muted)]">{days === 1 ? 'day' : 'days'}</span>
              </span>
            )}
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
