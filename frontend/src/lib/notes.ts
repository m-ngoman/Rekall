import type { Note } from '../types'

/** What a note filed under no category is listed as. Unfiled isn't a deck, so it has no id of its
 * own; both lists that group notes by category put it last. */
export const UNFILED = 'Unfiled'

/** One category's notes, as the Notes tab and the note picker list them. */
export interface NoteGroup {
  key: string
  name: string
  notes: Note[]
}

/** What a note is, in a word: the stand-in when it has no title. */
export function kindLabel(fileType: Note['file_type']): string {
  return fileType === 'pdf' ? 'PDF' : fileType === 'image' ? 'Photo' : 'Note'
}

/** The note's opening text, or why there is none: a typed note that is still empty, or a file
 * nothing could be read from. */
export function previewText(note: Pick<Note, 'file_type' | 'preview'>): string {
  return note.preview || (note.file_type === 'text' ? 'Nothing written yet.' : 'No text was read from this file.')
}

/** Unfiled isn't a deck, so it has no id — the empty string stands in for it as a drop target and
 * as a `<select>` value, and converts back to `null` at the API boundary. */
export const UNFILED_KEY = ''

/** Where a note being written will be filed once there's something to save. `deckName` without a
 * `deckId` is a category that doesn't exist yet — the create call makes it. */
export interface NoteDraft {
  deckId: string | null
  deckName: string
}

/** When a note was added: day and month, and the year only when it isn't this one. */
export function formatNoteDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
