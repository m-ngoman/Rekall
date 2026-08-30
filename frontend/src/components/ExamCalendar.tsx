import { toISODate } from '../lib/dates'
import type { Exam } from '../types'

interface Props {
  year: number
  /** 0-based, like Date#getMonth. */
  month: number
  exams: Exam[]
  /** Tapping an empty (non-past) day — opens the add sheet pre-filled with that date. */
  onDayTap: (iso: string) => void
  onExamTap: (exam: Exam) => void
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** Month grid, Monday-first (a study app's week ends with the weekend, it doesn't start there).
 * Plain Date math throughout — no date library. */
export default function ExamCalendar({ year, month, exams, onDayTap, onExamTap }: Props) {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = (first.getDay() + 6) % 7 // getDay(): 0=Sun; shift so 0=Mon
  const todayISO = toISODate(new Date())

  const byDate = new Map<string, Exam[]>()
  for (const e of exams) {
    const list = byDate.get(e.date)
    if (list) list.push(e)
    else byDate.set(e.date, [e])
  }

  // Always six weeks (42 cells): months span 4-6 rows depending on where they start, and letting
  // the grid's height change per month makes everything below it jump on every prev/next tap.
  // Leading cells carry the previous month's tail, trailing cells the next month's start —
  // greyed and inert, context rather than destinations.
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const trailing = 42 - leadingBlanks - daysInMonth
  const cells: { day: number; inMonth: boolean }[] = [
    ...Array.from({ length: leadingBlanks }, (_, i) => ({ day: daysInPrevMonth - leadingBlanks + 1 + i, inMonth: false })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, inMonth: true })),
    ...Array.from({ length: trailing }, (_, i) => ({ day: i + 1, inMonth: false })),
  ]

  return (
    <div className="rounded-[20px] border border-[var(--ring-track)] p-3 lg:p-4">
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[0.625rem] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ day, inMonth }, i) => {
          if (!inMonth) {
            return (
              <div key={`adj-${i}`} className="flex min-h-[58px] items-center justify-center lg:min-h-[84px]">
                <span className="text-[0.9375rem] font-extrabold text-[var(--text-secondary)] opacity-35 lg:text-lg">
                  {day}
                </span>
              </div>
            )
          }
          const iso = toISODate(new Date(year, month, day))
          const dayExams = byDate.get(iso) ?? []
          const isToday = iso === todayISO
          const isPast = iso < todayISO // ISO strings compare correctly as strings

          return (
            <div
              key={iso}
              onClick={() => {
                // A past day can't get a *new* exam (nothing there would ever affect scheduling
                // forward), but its existing exams stay tappable below for edit/delete.
                if (!isPast) onDayTap(iso)
              }}
              className={`flex min-h-[58px] flex-col items-stretch justify-center gap-0.5 rounded-lg p-1 lg:min-h-[84px] ${
                isPast ? 'opacity-45' : 'cursor-pointer hover:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]'
              }`}
            >
              <span
                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[0.9375rem] font-extrabold lg:h-10 lg:w-10 lg:text-lg ${
                  isToday ? 'text-[oklch(0.99_0.005_90)]' : 'text-[var(--text)]'
                }`}
                style={isToday ? { background: 'var(--accent)' } : undefined}
              >
                {day}
              </span>
              {dayExams.slice(0, 2).map((e) => (
                <button
                  key={e.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onExamTap(e)
                  }}
                  title={e.name}
                  className="w-full truncate rounded-md px-1 py-0.5 text-left text-[0.5625rem] font-bold leading-tight lg:text-[0.6875rem]"
                  style={{
                    color: 'var(--accent)',
                    background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-card))',
                  }}
                >
                  {e.name}
                </button>
              ))}
              {dayExams.length > 2 && (
                <span className="px-1 text-[0.5625rem] font-bold text-[var(--text-secondary)]">
                  +{dayExams.length - 2}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
