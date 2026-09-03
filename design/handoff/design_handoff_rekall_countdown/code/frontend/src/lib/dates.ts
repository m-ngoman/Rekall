/** Calendar-date helpers for exam dates (`YYYY-MM-DD` strings). Everything is *local* time on
 * purpose — an exam date is a day on the user's own calendar. Never `new Date('YYYY-MM-DD')`,
 * which parses as UTC midnight and renders as the previous day west of Greenwich. */

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole days from today (local midnight) to the date. 0 = today, negative = past. */
export function daysUntil(iso: string): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((parseISODate(iso).getTime() - today.getTime()) / 86_400_000)
}

/** "in 12 days" / "tomorrow" / "today" / "passed" — for exam rows. */
export function formatCountdown(days: number): string {
  if (days < 0) return 'passed'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`
}

/** "Mon, Sep 1" — the sheet's human echo of the date being edited. */
export function formatDayLong(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Tue 6 Oct" — the date beside a countdown, where the number already carries the urgency. */
export function formatDayShort(iso: string): string {
  const d = parseISODate(iso)
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' })
  const mo = d.toLocaleDateString(undefined, { month: 'short' })
  return `${wd} ${d.getDate()} ${mo}`
}
