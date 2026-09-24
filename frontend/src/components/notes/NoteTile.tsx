import { noteFileUrl } from '../../api'
import { formatNoteDate, type NoteGroup, previewText, UNFILED_KEY } from '../../lib/notes'
import type { Note } from '../../types'

const FOLDER_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
)

export default function NoteTile({
  note,
  categories,
  onOpen,
  onMove,
  onGrab,
}: {
  note: Note
  categories: NoteGroup[]
  onOpen: () => void
  onMove: (dropKey: string) => void
  onGrab: (e: React.PointerEvent) => void
}) {
  return (
    // Keyboard-reachable like a button — role, tab stop, Enter and Space — though it is a div:
    // note tiles were the one list in the app that a keyboard could not reach at all.
    // No surface fill either — only a deck is a card. The preview is a bordered block and the
    // title sits on the page underneath it.
    <div
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      onPointerDown={onGrab}
      className="flex min-w-0 cursor-pointer flex-col text-left"
    >
      {/* The preview is the tile. A photo shows itself; a PDF shows the text read from it, small
          and cropped, so either kind is recognised by what's on it rather than by its name. */}
      {note.file_type === 'image' ? (
        <img src={noteFileUrl(note.id)} alt="" draggable={false} className="aspect-[4/3] w-full rounded-[var(--r-sm)] border border-[var(--rule)] object-cover" style={{ background: 'var(--bg)' }} />
      ) : (
        <div
          className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-sm)] border border-[var(--rule)] px-3 pt-2.5"
          style={{ background: 'color-mix(in oklab, var(--surface) 55%, var(--bg))' }}
        >
          <p className="text-[0.5625rem] leading-[1.5] text-[var(--text-muted)]">
            {previewText(note)}
          </p>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-7"
            style={{ background: 'linear-gradient(to bottom, transparent, color-mix(in oklab, var(--surface) 55%, var(--bg)))' }}
          />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2 px-0.5 pt-2">
        <span className="min-w-0 truncate text-[0.8125rem] font-bold">{note.title ?? (note.preview.slice(0, 40) || 'Untitled')}</span>
        <span className="flex-shrink-0 whitespace-nowrap text-[0.6875rem] text-[var(--text-muted)]">
          {note.file_type === 'pdf' ? 'PDF, ' : ''}
          {formatNoteDate(note.created_at)}
        </span>
      </div>
      {/* The select is the path that always works — dragging is the shortcut, not the only way,
          since it's unreachable by keyboard and awkward one-handed on a phone. Its own pointer
          and click events stop here so opening the picker never grabs or opens the note.
          36px tall: it measured 21px, below the 24px floor, on the control that is the only way
          to refile a note without a mouse. */}
      <div
        className="-ml-1.5 flex h-9 items-center gap-1 px-1.5 text-[var(--text-muted)]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {FOLDER_ICON}
        <select
          value={note.deck_id ?? UNFILED_KEY}
          onChange={(e) => onMove(e.target.value)}
          aria-label="Move to category"
          // Height on the select itself, not just the row around it: the select *is* the target,
          // and a 36px row containing a 22px control is still a 22px control.
          className="h-9 min-w-0 max-w-full cursor-pointer truncate rounded-[var(--r-sm)] bg-transparent text-[0.75rem] font-semibold outline-none"
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
