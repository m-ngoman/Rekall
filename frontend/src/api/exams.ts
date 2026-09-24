/** Exams on the calendar. */

import type { Exam } from '../types'
import { request } from './client'

export function listExams(): Promise<Exam[]> {
  return request('/exams')
}

export function createExam(name: string, date: string, deckIds: string[]): Promise<Exam> {
  return request('/exams', { method: 'POST', body: JSON.stringify({ name, date, deck_ids: deckIds }) })
}

/** `deck_ids`, when present, replaces the exam's whole link set — the sheet always knows the full
 * selection, so there's no add/remove delta protocol to get out of sync. */
export function updateExam(
  id: string,
  patch: { name?: string; date?: string; deck_ids?: string[] },
): Promise<Exam> {
  return request(`/exams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteExam(id: string): Promise<void> {
  return request(`/exams/${id}`, { method: 'DELETE' })
}
