/** Studying a deck: its queue, answering a card, and what can be done to a card mid-review. */

import type { ReviewResult, StudyQueue } from '../types'
import { request, streamResult } from './client'

/** Today's cards for one deck, or with `ahead`, the ones not due yet, soonest first: what the
 * study screen offers when a deck has nothing due. Reviewing ahead goes through the ordinary
 * review endpoint; FSRS reschedules an early review from the moment it happens. */
export function getStudyQueue(deckId: string, { ahead = false }: { ahead?: boolean } = {}): Promise<StudyQueue> {
  return request(`/decks/${deckId}/study-queue${ahead ? '?ahead=true' : ''}`)
}

/** Streams the grading explanation as it's generated (for a typewriter display) via SSE, then
 * resolves with the final result once the `done` event arrives.
 */
export function submitReviewStream(
  cardId: string,
  answerInput: string,
  onToken: (text: string) => void,
): Promise<ReviewResult> {
  return streamResult<ReviewResult>(
    `/api/cards/${cardId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_input: answerInput, input_mode: 'typed' }),
    },
    { token: (data: { text: string }) => onToken(data.text) },
  )
}

/** A self-assessed review: no answer was submitted and nothing is graded, so this returns the
 * same `ReviewResult` shape without any token stream. Kept separate from `submitReviewStream`
 * rather than bolted on with a flag — the two have genuinely different inputs, and the streaming
 * version's `onToken` would be dead weight here.
 */
export function submitSelfAssessedReview(cardId: string, grade: number): Promise<ReviewResult> {
  return streamResult<ReviewResult>(`/api/cards/${cardId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer_input: '', input_mode: 'self_assessed', grade }),
  })
}

/** The reference answer for one card, fetched only when the user taps "Show answer" in the
 * self-assessment flow. Not part of the study queue on purpose — see the endpoint's docstring.
 */
export function revealAnswer(cardId: string): Promise<{ answer: string }> {
  return request(`/cards/${cardId}/answer`)
}

/** Flags a card as wrong and takes it out of the study queue.
 *
 * Suspends rather than deletes: the card is kept because it's the evidence for whether generated
 * cards are any good, and because the student may have been mistaken.
 */
export function reportCard(cardId: string): Promise<void> {
  return request(`/cards/${cardId}/report`, { method: 'POST' })
}

/** Undoes reportCard: the card is back in the schedule and the report is withdrawn. */
export function unreportCard(cardId: string): Promise<void> {
  return request(`/cards/${cardId}/report`, { method: 'DELETE' })
}

/** Adds a card to the list the tutor opens on. Idempotent server-side, so a double tap or a
 * relearn of the same card is harmless. */
export function addToStudyList(cardId: string): Promise<void> {
  return request(`/cards/${cardId}/study-list`, { method: 'POST' })
}
