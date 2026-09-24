import { parseISODate } from '../../lib/dates'

export function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** "1 Sep" — short enough for an axis tick, unambiguous without a year at these ranges. */
export function formatDay(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Mon, 1 Sep" — the hover readout, where there's room to say which day of the week it was. */
export function formatDayLong(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** `many` is only needed where adding an "s" doesn't work — "3 persons" is not English. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}
