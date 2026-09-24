/** The notes library. */

import type { Note, NoteDetail } from '../types'
import { request } from './client'

/** `q` runs Postgres full-text search over each note's stored transcription, matching word
 * prefixes (so "chloro" finds "chloroplasts"), and matches titles too; empty means list
 * everything, newest first.
 */
export function listNotes(q = ''): Promise<Note[]> {
  return request(`/notes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
}

/** Saves notes to the library without generating cards — the Notes tab's own upload path, as
 * opposed to generateDeck() which is card-first. Each file becomes its own note.
 */
export function uploadNotes(files: File[], deckId: string | null, deckName = ''): Promise<Note[]> {
  const form = new FormData()
  if (deckId) form.append('deck_id', deckId)
  // Naming a category here creates it server-side in the same transaction as the notes, so a
  // failed upload can't leave an empty category behind. An existing category with that name is
  // reused rather than duplicated.
  if (deckName.trim()) form.append('deck_name', deckName.trim())
  for (const file of files) form.append('files', file, file.name)
  // Empty headers deliberately clears request()'s default application/json — the browser has to
  // set Content-Type itself for FormData so it can include the multipart boundary.
  return request('/notes', { method: 'POST', body: form, headers: {} })
}

/** Refiles a note under a different category, or under none (`null` = Unfiled). The null is sent
 * explicitly rather than omitted — the backend treats an absent field as "leave it alone", so
 * omitting it would make Unfiled unreachable. */
export function moveNote(id: string, deckId: string | null): Promise<Note> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ deck_id: deckId }) })
}

/** Takes a category out of the Notes tab: its notes go to Unfiled and stay. The deck and its
 * cards are untouched — unless the deck had no cards, in which case nothing was left of it and
 * the server removes it; `deck_deleted` says which happened so the deck list can follow. */
export function unfileCategory(deckId: string): Promise<{ unfiled: number; deck_deleted: boolean }> {
  return request('/notes/unfile', { method: 'POST', body: JSON.stringify({ deck_id: deckId }) })
}

export function getNote(id: string): Promise<NoteDetail> {
  return request(`/notes/${id}`)
}

/** A note written in the app rather than uploaded. Only called once there's something to keep —
 * the editor doesn't create a row for a note that was opened and abandoned. Either a category id
 * or a new category's name files it, as with uploadNotes. */
export function createTextNote(
  input: { title: string; text: string; deckId: string | null; deckName?: string },
): Promise<NoteDetail> {
  return request('/notes/text', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title.trim() || null,
      text: input.text,
      deck_id: input.deckId,
      deck_name: input.deckName?.trim() ?? '',
    }),
  })
}

/** Saves the editor's title and body together. One call, not two, so the two fields can't be
 * left half-saved if the second request fails. deck_id is omitted so this can't refile. */
export function saveNoteContent(id: string, title: string, text: string): Promise<Note> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ title, text }) })
}

export function deleteNote(id: string): Promise<void> {
  return request(`/notes/${id}`, { method: 'DELETE' })
}

/** The original upload, served by the backend from local disk — used directly as an <img>/<embed>
 * src rather than fetched, so the browser streams it instead of us buffering it into memory. */
export function noteFileUrl(id: string): string {
  return `/api/notes/${id}/file`
}
