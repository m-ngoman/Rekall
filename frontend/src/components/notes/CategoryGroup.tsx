import { useState } from 'react'
import type { NoteGroup } from '../../lib/notes'
import CategoryNameInput from './CategoryNameInput'
import NoteTile from './NoteTile'

const PENCIL_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
  </svg>
)

/** A category and the notes filed under it. The whole block is the drop target, empty zone
 * included — aiming at a header is much harder than aiming at a region, especially with a thumb. */
export default function CategoryGroup({
  group,
  categories,
  isDropTarget,
  dragging,
  onRename,
  onRemove,
  onOpenNote,
  onMoveNote,
  onGrabNote,
}: {
  group: NoteGroup
  categories: NoteGroup[]
  isDropTarget: boolean
  dragging: boolean
  /** Absent for Unfiled, which is the absence of a category rather than one that can be renamed. */
  onRename?: (name: string) => void
  /** Also absent for Unfiled. Takes the category out of this tab; see handleRemoveCategory. */
  onRemove?: () => void
  onOpenNote: (id: string) => void
  onMoveNote: (id: string, dropKey: string) => void
  onGrabNote: (noteId: string, label: string) => (e: React.PointerEvent) => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      data-drop-key={group.key}
      className="-mx-2 rounded-[var(--r-md)] px-2 pb-2 transition-colors"
      style={isDropTarget ? { background: 'var(--accent-dim)' } : undefined}
    >
      {renaming && onRename ? (
        // Renaming is also where removing lives. Both used to be 13px glyphs six pixels apart in
        // the header — two tiny targets, one of them destructive, side by side. Putting remove
        // behind the rename state means you cannot hit it reaching for anything else.
        <div className="mb-3 flex items-center gap-2 pt-1">
          <div className="min-w-0 flex-1">
            <CategoryNameInput
              initial={group.name}
              placeholder="Category name"
              onCommit={(name) => {
                setRenaming(false)
                onRename(name)
              }}
              onCancel={() => setRenaming(false)}
            />
          </div>
          {onRemove && (
            <button
              onClick={() => {
                setRenaming(false)
                onRemove()
              }}
              title="The notes move to Unfiled; the deck keeps its cards."
              className="-mb-2.5 flex h-11 flex-shrink-0 items-center rounded-[var(--r-sm)] px-2 text-[0.875rem] font-semibold text-[var(--text-muted)]"
            >
              Remove from Notes
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[1.0625rem] font-bold tracking-[-0.01em]">{group.name}</span>
            <span className="numeral flex-shrink-0 text-[1.0625rem]">{group.notes.length}</span>
            <span className="flex-shrink-0 text-[0.8125rem] text-[var(--text-muted)]">
              note{group.notes.length === 1 ? '' : 's'}
            </span>
          </div>
          {onRename && (
            <button
              onClick={() => setRenaming(true)}
              aria-label={`Rename ${group.name}`}
              className="-mr-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)]"
            >
              {PENCIL_ICON}
            </button>
          )}
        </div>
      )}

      {group.notes.length === 0 ? (
        <div className="border-t border-[var(--rule)] py-4">
          <p className="text-[0.8125rem] text-[var(--text-muted)]">
            {dragging ? 'Drop here to file it under this category' : 'Nothing filed here yet. Drag a note in, or pick a category from its menu.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {group.notes.map((note) => (
            <NoteTile
              key={note.id}
              note={note}
              categories={categories}
              onOpen={() => onOpenNote(note.id)}
              onMove={(dropKey) => onMoveNote(note.id, dropKey)}
              onGrab={onGrabNote(note.id, note.title ?? (note.preview.slice(0, 40) || 'Note'))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
