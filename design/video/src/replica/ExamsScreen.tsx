// Replica of frontend/src/screens/ExamsScreen.tsx and components/ExamCalendar.tsx: the countdown
// with its run-up, the month as a load timeline, and the exams coming up. Today is the demo's, not
// the clock's (lib/calendar monthCells), and the bars can be growing in (`bars`), which in the app
// they never are — appearing is instant there. At rest every number is the app's own.
import { formatDayShort, formatMonth } from '@app/lib/dates'
import type { Exam } from '@app/types'
import { daysFromToday, demo, upcomingExams } from '../data/demo'
import { cardsBefore, monthCells } from '../lib/calendar'
import type { Press } from './StudyScreen'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export interface ExamsView {
  year: number
  /** 0-based. */
  month: number
  /** How far each future day's bar has grown, by its order from today; 1 at rest. */
  bars?: (order: number) => number
  /** How far each countdown digit still has to rise. */
  digits?: number[]
  nextMonth?: Press
  touch?: boolean
}

export function ExamsScreen({ year, month, bars, digits, nextMonth, touch }: ExamsView) {
  const exams = demo.exams as Exam[]
  const upcoming = upcomingExams() as Exam[]
  const next = upcoming[0]
  const nextDays = daysFromToday(next.date)
  const cardsBeforeNext = cardsBefore(demo.load, demo.today, next.date)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthExams = exams.filter((e) => e.date.startsWith(monthPrefix))
  const pressFilter = (p?: Press) => (p?.down ? `brightness(${touch ? 0.9 : 0.92})` : p?.hover && !touch ? 'brightness(1.06)' : undefined)

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-14">
      <div className="lg:order-2 lg:pt-1.5">
        <button className="flex w-full flex-col text-left">
          <div className="flex w-full items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[1.125rem] font-bold">{next.name}</span>
            <span className="flex-shrink-0 text-[0.875rem] text-[var(--text-muted)]">{formatDayShort(next.date)}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2.5 lg:mt-1.5 lg:gap-3">
            <span className="numeral text-[3.5rem] text-[var(--accent)] lg:text-[6rem]" style={digits ? { clipPath: 'inset(-0.5em -0.2em 0 -0.2em)' } : undefined}>
              {digits
                ? String(nextDays)
                    .split('')
                    .map((d, j) => (
                      <span key={j} style={{ display: 'inline-block', transform: `translateY(${(digits[j] ?? 0) * 100}%)` }}>
                        {d}
                      </span>
                    ))
                : nextDays}
            </span>
            <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)] lg:text-[1rem]">{nextDays === 1 ? 'day' : 'days'}</span>
            <span className="ml-auto whitespace-nowrap text-[0.875rem] text-[var(--text-muted)] lg:hidden">{cardsBeforeNext} cards before it</span>
          </div>
          <div className="mt-3.5 hidden text-[0.875rem] text-[var(--text-muted)] lg:block">{cardsBeforeNext} cards before it</div>
        </button>

        <div className="mb-1 mt-9 hidden items-center justify-between gap-3 lg:flex">
          <span className="text-[1.0625rem] font-bold tracking-[-0.01em]">Coming up</span>
          <button className="flex h-9 flex-shrink-0 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-3.5 text-[0.8125rem] font-bold">Add exam</button>
        </div>
        <div className="hidden lg:block">
          <ExamRows exams={upcoming} />
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:order-1 lg:gap-6">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="text-[1.0625rem] font-bold tracking-[-0.01em] lg:mr-2">{formatMonth(year, month)}</div>
          <div className="flex items-center">
            <MonthNavButton dir="prev" />
            <MonthNavButton dir="next" filter={pressFilter(nextMonth)} />
            <button className="ml-1 flex h-10 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-4 text-[0.875rem] font-bold lg:hidden">Add exam</button>
          </div>
        </div>
        <ExamCalendar year={year} month={month} exams={exams} bars={bars} />
      </div>

      {monthExams.length > 0 && (
        <div className="lg:hidden">
          <ExamRows exams={monthExams} />
        </div>
      )}
    </div>
  )
}

function ExamRows({ exams }: { exams: Exam[] }) {
  return (
    <div className="border-t border-[var(--rule)]">
      {exams.map((e) => {
        const days = daysFromToday(e.date)
        return (
          <button key={e.id} className={`flex w-full items-center justify-between gap-4 border-b border-[var(--rule)] py-3 text-left ${days < 0 ? 'opacity-55' : ''}`}>
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

function MonthNavButton({ dir, filter }: { dir: 'prev' | 'next'; filter?: string }) {
  return (
    <button
      aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      className="flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
      style={{ filter }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'prev' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  )
}

export function ExamCalendar({ year, month, exams, bars }: { year: number; month: number; exams: Exam[]; bars?: (order: number) => number }) {
  const { cells, min, max } = monthCells(year, month, demo.today, demo.load)
  const byDate = new Map<string, Exam[]>()
  for (const e of exams) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  // The order bars grow in: today first, then each day after it.
  const order = (iso: string) => cells.filter((c) => c.iso >= demo.today && c.iso < iso).length

  return (
    <div>
      <div className="mb-2.5 flex items-end gap-1.5 text-[0.8125rem] leading-none text-[var(--text-muted)]">
        <span>Cards per day,</span>
        <span aria-hidden className="block h-1.5 w-[3px] bg-[var(--accent-dim)] lg:w-1.5 lg:rounded-[3px]" />
        <span>{min}</span>
        <span>to</span>
        <span aria-hidden className="block h-3.5 w-[3px] bg-[var(--accent)] lg:h-4 lg:w-1.5 lg:rounded-[3px]" />
        <span>{max}</span>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-2 text-center text-[0.625rem] font-bold uppercase tracking-wide text-[var(--text-muted)] lg:pl-2.5 lg:text-left lg:text-[0.6875rem]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 border-t border-[var(--rule)] pt-1 [grid-template-columns:repeat(7,minmax(0,1fr))] lg:gap-0.5">
        {cells.map(({ iso, day, inMonth, isToday, isPast, count, mix, height }) => {
          const dayExams = byDate.get(iso) ?? []
          const grown = count > 0 && bars ? bars(order(iso)) : 1
          const barColor = `color-mix(in oklab, var(--accent) ${mix}%, var(--accent-dim))`
          const bar = (className: string) =>
            count > 0 && (
              <span
                aria-hidden
                className={className}
                style={{ background: barColor, height: `${height}%`, transformOrigin: 'center bottom', transform: grown < 1 ? `scaleY(${grown})` : undefined }}
              />
            )
          return (
            <div
              key={iso}
              className={`relative box-border flex h-11 min-w-0 flex-col items-center rounded-[var(--r-sm)] pt-1.5 lg:h-[76px] lg:items-start lg:bg-[var(--surface)] lg:py-2 lg:pl-2.5 lg:pr-[22px] ${
                isPast ? 'opacity-40' : 'cursor-pointer'
              } ${inMonth ? '' : 'opacity-30'}`}
            >
              {isToday && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-px bg-[var(--accent)] lg:bottom-2 lg:top-2 lg:w-0.5 lg:rounded-[1px]" />}
              <div aria-hidden className="absolute bottom-2 right-2 top-2 hidden w-1.5 items-end rounded-[3px] bg-[var(--bg)] lg:flex">
                {bar('block w-full rounded-[3px]')}
              </div>
              <div className="flex h-4 items-end gap-[3px]">
                <span className={`text-[0.875rem] leading-none tabular-nums lg:text-[0.9375rem] ${isToday ? 'font-bold text-[var(--accent)]' : 'font-semibold text-[var(--text)]'}`}>{day}</span>
                <div className="flex h-4 w-[3px] items-end lg:hidden">{bar('block w-[3px]')}</div>
              </div>
              {isToday && count > 0 && <span className="mt-1 text-[0.625rem] font-bold leading-none tabular-nums text-[var(--accent)] lg:hidden">{count}</span>}
              {count > 0 && (
                <span className="mt-1.5 hidden whitespace-nowrap text-[0.75rem] leading-none tabular-nums text-[var(--text-muted)] lg:block" style={{ opacity: bars ? grown : undefined }}>
                  {count} {count === 1 ? 'card' : 'cards'}
                </span>
              )}
              {dayExams.length > 0 && <span aria-hidden className="absolute bottom-[3px] left-1/2 block h-0.5 w-3 -translate-x-1/2 rounded-[1px] bg-[var(--accent)] lg:hidden" />}
              {dayExams.slice(0, 1).map((e) => (
                <button key={e.id} title={e.name} className="static mt-auto hidden w-full min-w-0 truncate text-left text-[0.75rem] font-bold leading-tight text-[var(--accent)] lg:block">
                  {e.name}
                  {dayExams.length > 1 ? ` +${dayExams.length - 1}` : ''}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
