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
