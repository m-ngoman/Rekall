import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comingBackLine, firstScheduledDay, homeDay, leftToday, pickStartDeck } from './home'
import type { Deck, Exam } from '../types'

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

const deck = (id: string, due: number, newToday: number, newAll = newToday): Deck => ({
  id,
  name: id,
  total: due + newAll,
  due,
  new: newAll,
  new_today: newToday,
  learned: due,
  exam_paused: false,
  next_exam: null,
})
const exam = (...deckIds: string[]): Exam => ({ id: 'e', name: 'Exam', date: '2026-10-01', deck_ids: deckIds })

describe('leftToday', () => {
  it("counts today's new cards, not every card the cap is holding back", () => {
    expect(leftToday(deck('bio', 4, 20, 100))).toBe(24)
    expect(leftToday(deck('bio', 0, 0, 80))).toBe(0)
  })
})

describe('pickStartDeck', () => {
  it('opens the deck cramming for the next exam', () => {
    const decks = [deck('bio', 30, 0), deck('chem', 2, 0)]
    expect(pickStartDeck(decks, exam('chem'))?.id).toBe('chem')
  })

  it('passes over a deck whose day is done, however many new cards it still holds', () => {
    const decks = [deck('bio', 0, 0, 80), deck('chem', 3, 0)]
    expect(pickStartDeck(decks, exam('bio'))?.id).toBe('chem')
    expect(pickStartDeck([deck('bio', 0, 0, 80)], undefined)).toBeUndefined()
  })

  it('else takes the deck with the most left today', () => {
    const decks = [deck('bio', 1, 2, 90), deck('chem', 6, 0)]
    expect(pickStartDeck(decks, undefined)?.id).toBe('chem')
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
