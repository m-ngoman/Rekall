import { describe, expect, it } from 'vitest'
import { afterReport } from './study'

const card = (id: string) => ({ id })

describe('afterReport', () => {
  it('takes a requeued card out of the session and out of the total', () => {
    // Two cards; `a` was missed first time and queued for a second showing behind `b`.
    const queue = [card('b'), card('a')]
    const stats = { total: 3, done: 0, correct: 0 }
    expect(afterReport(queue, stats, 'a')).toEqual({ queue: [card('b')], stats: { total: 2, done: 0, correct: 0 } })
  })

  it('changes nothing when the card has no showing left', () => {
    const queue = [card('b')]
    const stats = { total: 2, done: 1, correct: 1 }
    const next = afterReport(queue, stats, 'a')
    expect(next.queue).toEqual([card('b')])
    expect(next.stats).toBe(stats)
  })

  it('leaves its inputs alone', () => {
    const queue = [card('a')]
    const stats = { total: 2, done: 1, correct: 0 }
    afterReport(queue, stats, 'a')
    expect(queue).toEqual([card('a')])
    expect(stats).toEqual({ total: 2, done: 1, correct: 0 })
  })
})
