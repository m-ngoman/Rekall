/** Card generation, from uploaded files, from notes in the library, or from a topic. */

import type { GenerationResult } from '../types'
import { streamResult } from './client'

/** Photos or a single PDF of notes -> flashcards. Two full LLM round-trips (draft, then verify)
 * happen server-side, so `onStage` drives a status label instead of leaving a bare spinner up.
 */
export function generateDeck(
  files: File[],
  deckId: string | null,
  deckName: string,
  onStage: (label: string) => void,
): Promise<GenerationResult> {
  const form = new FormData()
  if (deckId) form.append('deck_id', deckId)
  if (deckName.trim()) form.append('deck_name', deckName.trim())
  for (const file of files) form.append('files', file, file.name)

  return streamResult<GenerationResult>('/api/notes/generate', { method: 'POST', body: form }, {
    stage: (data: { label: string }) => onStage(data.label),
  })
}

/** Same generation pipeline as generateDeck, over notes already in the library. `noteIds` order
 * is preserved end to end — the backend hands the pages to the model in this order, so a
 * multi-page topic reads in sequence rather than however the database returned the rows.
 *
 * Note the Content-Type: unlike generateDeck this posts JSON, so it sets the header itself —
 * streamSSE, unlike request(), adds none.
 */
export function generateDeckFromNotes(
  noteIds: string[],
  deckId: string | null,
  deckName: string,
  onStage: (label: string) => void,
): Promise<GenerationResult> {
  // A failure after the stream opens can't arrive as an HTTP status — the response is already 200
  // and streaming — so it comes through as an `error` event, which streamSSE turns into a throw.
  return streamResult<GenerationResult>(
    '/api/notes/generate-from-notes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_ids: noteIds, deck_id: deckId ?? '', deck_name: deckName.trim() }),
    },
    { stage: (data: { label: string }) => onStage(data.label) },
  )
}

/** Cards from a described topic rather than the student's own material.
 *
 * `deckId` matters more here than it does for the other two entry points: when the chosen deck
 * already has notes filed under it, the backend feeds them to the model as grounding, so picking
 * an existing deck is what makes the cards match what the student was actually taught rather than
 * the model's general knowledge of the topic.
 */
export function generateDeckFromTopic(
  topic: { subject: string; topic: string; gradeLevel: string; curriculum: string },
  deckId: string | null,
  deckName: string,
  onStage: (label: string) => void,
): Promise<GenerationResult> {
  return streamResult<GenerationResult>(
    '/api/notes/generate-from-topic',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: topic.subject.trim(),
        topic: topic.topic.trim(),
        grade_level: topic.gradeLevel.trim(),
        curriculum: topic.curriculum.trim(),
        deck_id: deckId ?? '',
        deck_name: deckName.trim(),
      }),
    },
    { stage: (data: { label: string }) => onStage(data.label) },
  )
}
