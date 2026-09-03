import { toISODate } from './dates'

/** Cards scheduled per day, `YYYY-MM-DD` → count. Missing key = 0. */
export type LoadByDay = Record<string, number>

/** GET /api/dashboard/load — see backend/app/api/dashboard.py. Kept out of api.ts so the
 * calendar's window-keyed cache below lives next to the one caller that uses it. */
export async function getLoad(start: Date, end: Date): Promise<LoadByDay> {
  const res = await fetch(`/api/dashboard/load?start=${toISODate(start)}&end=${toISODate(end)}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/** Last known load per window, kept across tab switches. The calendar renders this first, then
 * the fresh response — the difference between the two is what the drain animation shows. */
export const loadCache = new Map<string, LoadByDay>()

export function loadKey(start: Date, end: Date): string {
  return `${toISODate(start)}:${toISODate(end)}`
}
