import type { Exam } from '../types'
import { daysUntil } from './dates'

/** Exams still to come, soonest first. Exam day counts as still to come: it is the day the
 * countdown reads 0, not a day after it. */
export function upcomingExams(exams: Exam[] | null | undefined): Exam[] {
  return (exams ?? []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))
}
