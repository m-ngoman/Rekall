import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exam } from '../types'
import { upcomingExams } from './exams'

const exam = (name: string, date: string): Exam => ({ id: name, name, date, deck_ids: [] })

describe('upcomingExams', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 24, 15, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps today and later, soonest first, and drops what has passed', () => {
    const exams = [exam('Later', '2026-10-30'), exam('Passed', '2026-09-23'), exam('Today', '2026-09-24'), exam('Soon', '2026-09-30')]
    expect(upcomingExams(exams).map((e) => e.name)).toEqual(['Today', 'Soon', 'Later'])
  })

  it('treats nothing loaded yet as no exams, and leaves its input alone', () => {
    expect(upcomingExams(null)).toEqual([])
    expect(upcomingExams(undefined)).toEqual([])
    const exams = [exam('B', '2026-10-02'), exam('A', '2026-10-01')]
    upcomingExams(exams)
    expect(exams.map((e) => e.name)).toEqual(['B', 'A'])
  })
})
