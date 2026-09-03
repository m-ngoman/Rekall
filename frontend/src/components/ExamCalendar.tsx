import { toISODate } from '../lib/dates'
import type { LoadByDay } from '../lib/load'
import type { Exam } from '../types'

interface Props {
  year: number
  /** 0-based, like Date#getMonth. */
  month: number
  exams: Exam[]
  /** Cards scheduled per day. Missing = 0. */
  load: LoadByDay
  /** The load that was on screen before `load` arrived. A day whose count fell drains its bar. */
  prevLoad: LoadByDay
  onDayTap: (iso: string) => void
  onExamTap: (exam: Exam) => void
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** The 42 days (six Monday-first weeks) the grid for a month shows. Exported so the screen can
 * fetch load for exactly this window. */
export function gridRange(year: number, month: number): { start: Date; end: Date } {
  const first = new Date(year, month, 1)
  const leading = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - leading)
  const end = new Date(year, month, 1 - leading + 41)
  return { start, end }
}

/** Month grid as a load timeline. Each day carries a bar whose brightness is its share of the
 * heaviest day in view — dim is light, full accent is heavy, nothing is nothing. Today is marked
 * by an edge, not a fill: the line the load is about to cross. Exams are a tick and a name.
 *
 * Two layouts in one markup. On a phone a day is bare: number, a 3px tick beside it, and the
 * count only under today, because 44px cells have no room for more. From `lg` up each day is a
 * surface tile with the count spelled out under the number and the bar as a gauge in a track on
 * the right edge — the wider cell can afford to say "14 cards" instead of making you read a tick. */
export default function ExamCalendar({ year, month, exams, load, prevLoad, onDayTap, onExamTap }: Props) {
  const { start } = gridRange(year, month)
  const todayISO = toISODate(new Date())

  const byDate = new Map<string, Exam[]>()
  for (const e of exams) {
    const list = byDate.get(e.date)
    if (list) list.push(e)
    else byDate.set(e.date, [e])
  }

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return { iso: toISODate(d), day: d.getDate(), inMonth: d.getMonth() === month }
  })
  const max = Math.max(1, ...cells.map((c) => load[c.iso] ?? 0))
  const future = cells.filter((c) => c.iso >= todayISO).map((c) => load[c.iso] ?? 0)
  const min = future.length ? Math.min(...future) : 0

  return (
    <div>
      {/* The key. Without it a first-time user has no way to know the bars are card counts. */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] text-[var(--text-muted)]">
          <span className="lg:hidden">Bar beside each day</span>
          <span className="hidden lg:inline">Gauge on each day</span> is its card load
        </span>
        <span className="flex items-end gap-1.5 text-[0.75rem] leading-none text-[var(--text-muted)]">
          <span aria-hidden className="block h-1.5 w-[3px] bg-[var(--accent-dim)] lg:w-1.5 lg:rounded-[3px]" />
          <span>{min}</span>
          <span aria-hidden className="block h-3.5 w-[3px] bg-[var(--accent)] lg:h-4 lg:w-1.5 lg:rounded-[3px]" />
          <span>{max}</span>
        </span>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-2 text-center text-[0.625rem] font-bold uppercase tracking-wide text-[var(--text-muted)] lg:pl-2.5 lg:text-left lg:text-[0.6875rem]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 border-t border-[var(--rule)] pt-1 [grid-template-columns:repeat(7,minmax(0,1fr))] lg:gap-0.5">
        {cells.map(({ iso, day, inMonth }) => {
          const count = load[iso] ?? 0
          const before = prevLoad[iso] ?? 0
          const drain = before > count
          const shown = drain ? before : count
          const dayExams = byDate.get(iso) ?? []
          const isToday = iso === todayISO
          const isPast = iso < todayISO
          // Brightness is the only encoding: 0 → --accent-dim, max → --accent.
          const mix = Math.round((shown / max) * 100)
          // Height and brightness both grow with count so the scale reads without the key.
          const barHeight = `${Math.max(25, mix)}%`
          const barColor = `color-mix(in oklab, var(--accent) ${mix}%, var(--accent-dim))`

          return (
            <div
              key={iso}
              role={isPast ? undefined : 'button'}
              tabIndex={isPast ? -1 : 0}
              aria-label={`${iso}${count ? `, ${count} cards` : ''}${dayExams.length ? `, ${dayExams.map((e) => e.name).join(', ')}` : ''}`}
              onClick={() => !isPast && onDayTap(iso)}
              onKeyDown={(e) => {
                if (!isPast && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onDayTap(iso)
                }
              }}
              className={`relative box-border flex h-11 min-w-0 flex-col items-center rounded-[var(--r-sm)] pt-1.5 lg:h-[76px] lg:items-start lg:bg-[var(--surface)] lg:py-2 lg:pl-2.5 lg:pr-[22px] ${
                isPast ? 'opacity-40' : 'cursor-pointer'
              } ${inMonth ? '' : 'opacity-30'}`}
            >
              {isToday && (
                <span aria-hidden className="absolute bottom-1 left-0 top-1 w-px bg-[var(--accent)] lg:bottom-2 lg:top-2 lg:w-0.5 lg:rounded-[1px]" />
              )}
              {/* Desktop gauge: a track on the right edge, filled from the bottom. */}
              <div aria-hidden className="absolute bottom-2 right-2 top-2 hidden w-1.5 items-end rounded-[3px] bg-[var(--bg)] lg:flex">
                {shown > 0 && (
                  <span
                    className="load-bar block w-full rounded-[3px]"
                    data-drain={drain ? 'true' : undefined}
                    style={{ background: barColor, height: barHeight }}
                  />
                )}
              </div>
              <div className="flex h-4 items-end gap-[3px]">
                <span className={`text-[0.875rem] leading-none tabular-nums lg:text-[0.9375rem] ${isToday ? 'font-bold text-[var(--accent)]' : 'font-semibold text-[var(--text)]'}`}>
                  {day}
                </span>
                {/* Phone tick, beside the number. */}
                <div className="flex h-4 w-[3px] items-end lg:hidden">
                  {shown > 0 && (
                    <span
                      aria-hidden
                      className="load-bar block w-[3px]"
                      data-drain={drain ? 'true' : undefined}
                      style={{ background: barColor, height: barHeight }}
                    />
                  )}
                </div>
              </div>
              {isToday && count > 0 && (
                <span className="mt-1 text-[0.625rem] font-bold leading-none tabular-nums text-[var(--accent)] lg:hidden">{count}</span>
              )}
              {count > 0 && (
                <span className="mt-1.5 hidden whitespace-nowrap text-[0.75rem] leading-none tabular-nums text-[var(--text-muted)] lg:block">
                  {count} {count === 1 ? 'card' : 'cards'}
                </span>
              )}
              {dayExams.slice(0, 1).map((e) => (
                <button
                  key={e.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onExamTap(e)
                  }}
                  title={e.name}
                  className="absolute inset-x-0 bottom-0 block w-full min-w-0 truncate px-0.5 text-center text-[0.625rem] font-bold leading-tight text-[var(--accent)] lg:static lg:mt-auto lg:px-0 lg:text-left lg:text-[0.75rem]"
                >
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
