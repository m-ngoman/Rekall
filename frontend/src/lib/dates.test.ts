import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysUntil, formatMonth, parseISODate, toISODate } from './dates'

afterEach(() => {
  vi.useRealTimers()
})

describe('calendar dates', () => {
  it('parses as a local day, never as UTC midnight', () => {
    const d = parseISODate('2026-03-09')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 9, 0])
    expect(toISODate(d)).toBe('2026-03-09')
  })

  it('counts whole days from today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 24, 23, 30))
    expect(daysUntil('2026-09-24')).toBe(0)
    expect(daysUntil('2026-09-25')).toBe(1)
    expect(daysUntil('2026-10-24')).toBe(30)
    expect(daysUntil('2026-09-20')).toBe(-4)
  })

  it('names a month', () => {
    expect(formatMonth(2026, 0)).toBe('January 2026')
  })
})
