import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comingBackLine, firstScheduledDay, homeDay } from './home'

const dash = (reviewed: number, goal: number, remaining: number) => ({
  reviewed_today: reviewed,
  goal_today: goal,
  streak_days: 0,
  remaining_today: remaining,
})

describe('homeDay', () => {
  it('is due while the goal has cards left in it', () => {
    expect(homeDay(dash(3, 20, 40), true)).toBe('due')
  })

  it('tells a met goal with cards waiting from an empty plate', () => {
    // Both leave the goal at what was reviewed; only what the queues still hold differs.
    expect(homeDay(dash(20, 20, 15), true)).toBe('goal-met')
    expect(homeDay(dash(20, 20, 0), true)).toBe('caught-up')
  })

  it('is caught up with nothing to start, whatever the numbers say', () => {
    expect(homeDay(dash(0, 20, 20), false)).toBe('caught-up')
  })
})

describe('firstScheduledDay', () => {
  it('takes the earliest day with cards on it', () => {
    expect(firstScheduledDay({ '2026-09-30': 4, '2026-09-27': 0, '2026-09-28': 12 })).toEqual({ iso: '2026-09-28', cards: 12 })
  })

  it('is null for an empty timeline', () => {
    expect(firstScheduledDay({})).toBeNull()
  })
})

describe('comingBackLine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 25, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('says when, in the plainest words that fit', () => {
    expect(comingBackLine({ iso: '2026-09-25', cards: 3 })).toBe('3 cards come back later today.')
    expect(comingBackLine({ iso: '2026-09-24', cards: 3 })).toBe('3 cards come back later today.')
    expect(comingBackLine({ iso: '2026-09-26', cards: 1 })).toBe('1 card comes back tomorrow.')
    expect(comingBackLine({ iso: '2026-09-29', cards: 12 })).toBe('12 cards come back in 4 days.')
    expect(comingBackLine({ iso: '2026-10-06', cards: 12 })).toMatch(/^12 cards come back on \w+ 6 \w+\.$/)
  })
})
