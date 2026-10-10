import { EASE_OUT, progress } from './ease'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export interface CalendarCell {
  iso: string
  day: number
  inMonth: boolean
  isToday: boolean
  isPast: boolean
  count: number
  /** 0-100: the day's share of the busiest day in view — ExamCalendar's `mix`. */
  mix: number
  /** Bar height, as ExamCalendar sets it: `max(25, mix)%`. */
  height: number
}

/** ExamCalendar's 42 cells for a month (six Monday-first weeks), with `today` fixed rather than
 * read from the clock, and every number computed the way the app computes it. */
export function monthCells(year: number, month: number, today: string, load: Record<string, number>): { cells: CalendarCell[]; min: number; max: number } {
  const first = new Date(Date.UTC(year, month, 1))
  const leading = (first.getUTCDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(year, month, 1 - leading + i)))
  const counts = days.map((d) => load[iso(d)] ?? 0)
  const max = Math.max(1, ...counts)
  const future = days.map((d, i) => ({ d: iso(d), n: counts[i] })).filter((c) => c.d >= today)
  const min = future.length ? Math.min(...future.map((c) => c.n)) : 0
  const cells = days.map((d, i) => {
    const mix = Math.round((counts[i] / max) * 100)
    return {
      iso: iso(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
      isToday: iso(d) === today,
      isPast: iso(d) < today,
      count: counts[i],
      mix,
      height: Math.max(25, mix),
    }
  })
  return { cells, min, max }
}

/** The bars filling in, day by day from today: each grows from the bottom over 10 frames, a frame
 * after the day before it. (In the app they are simply there; appearing is instant. The video lets
 * the eye run along the month once.) */
export function barGrowth(frame: number, start: number, order: number): number {
  return progress(frame, start + order, 10, EASE_OUT)
}

/** Everything from `today` to `until` inclusive: the calendar's "N cards before it". */
export function cardsBefore(load: Record<string, number>, today: string, until: string): number {
  return Object.entries(load).reduce((sum, [day, n]) => (day >= today && day <= until ? sum + n : sum), 0)
}
