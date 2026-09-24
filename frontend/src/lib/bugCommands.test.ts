import { describe, expect, it } from 'vitest'
import type { BugReport } from '../types'
import { findListedBug, renderBugs } from './bugCommands'

const NOW = Date.UTC(2026, 8, 24, 12)
const bug = (id: string, text: string, daysAgo: number): BugReport => ({
  id,
  text,
  created_at: new Date(NOW - daysAgo * 86400000 - 60000).toISOString(),
  resolved_at: null,
})

describe('renderBugs', () => {
  it('numbers the open bugs and says when each was filed', () => {
    const text = renderBugs([bug('a1', 'Orb flickers', 0), bug('b2', 'Pill overlaps', 1), bug('c3', 'Slow export', 5)], NOW)
    expect(text).toBe(
      '3 open:\n1. Orb flickers  (today)\n2. Pill overlaps  (yesterday)\n3. Slow export  (5d ago)\n\n/bugs done <number> to clear one.',
    )
  })

  it('says so when there are none', () => {
    expect(renderBugs([], NOW)).toBe('No open bugs.')
  })
})

describe('findListedBug', () => {
  const list = [bug('af2a0c', 'first', 0), bug('cbd1e4', 'second', 0)]

  it('reads a number as a position in the last listing', () => {
    expect(findListedBug(list, '2')?.text).toBe('second')
    expect(findListedBug(list, '3')).toBeUndefined()
  })

  it('reads anything else as an id prefix, in any case', () => {
    expect(findListedBug(list, 'CBD')?.text).toBe('second')
    expect(findListedBug(list, 'zz')).toBeUndefined()
  })
})
