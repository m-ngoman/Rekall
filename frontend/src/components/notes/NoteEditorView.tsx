import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { noteFileUrl, saveNoteContent } from '../../api'
import BackButton from '../BackButton'
import ConfirmDialog from '../ConfirmDialog'
import { useConfirm } from '../../hooks/useConfirm'
import { formatNoteDate, kindLabel, type NoteDraft, UNFILED } from '../../lib/notes'
import type { Note, NoteDetail } from '../../types'

// The editor is ProseMirror plus a markdown parser — about half the app again — and most visits
// never open a note, so it stays out of the main bundle until one does.
const MarkdownEditor = lazy(() => import('../MarkdownEditor'))

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

/** One editor for every note. A typed note is nothing but its text; a photo or PDF shows the
 * original above the text the AI read out of it, and that text is just as editable — fixing a
 * misread word here is the whole reason the transcription is markdown.
 *
 * Saves itself. There's no Save button because there's nothing to decide: edits go up ~1s after
 * you stop typing, and whatever's pending is flushed when you leave or the app goes to the
 * background. A note being written doesn't exist server-side until the first save that has
 * something in it, so backing out of an empty draft leaves nothing behind — and a typed note
 * that's been emptied out is discarded on the way out for the same reason. Saves are queued one
 * behind another rather than raced: the first one is a create, and every later one needs the id
 * it comes back with. */
export default function NoteEditorView({
  note,
  draft,
  onBack,
  onDelete,
  onDiscard,
  onCreate,
  onSaved,
}: {
  note: NoteDetail | null
  draft: NoteDraft | null
  onBack: () => void
  /** Absent while the note is still a draft — there's nothing to delete yet. */
  onDelete?: () => void
  /** Quietly remove a typed note that's been left empty. */
  onDiscard: (id: string) => void
  onCreate: (title: string, text: string) => Promise<NoteDetail>
  onSaved: (note: Note) => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.ocr_text ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')

  // The save pipeline lives in refs so a debounced or unmount-time save always reads what's on
  // screen now, not what was there when the timer was set.
  const latest = useRef({ title, text })
  latest.current = { title, text }
  const persisted = useRef({ title: note?.title ?? '', text: note?.ocr_text ?? '' })
  const noteId = useRef<string | null>(note?.id ?? null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | null>(null)
  const abandoned = useRef(false)
  const callbacks = useRef({ onCreate, onSaved, onDiscard })
  callbacks.current = { onCreate, onSaved, onDiscard }
  // Only notes that are nothing but text get discarded when empty; a photo with its
  // transcription cleared is still a photo.
  const isTyped = note === null || note.file_type === 'text'

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  /** Queue a save of whatever's current. Resolves once that save (and any before it) is done. */
  const save = () => {
    cancelTimer()
    queue.current = queue.current.then(async () => {
      if (abandoned.current) return
      const title = latest.current.title.trim()
      const { text } = latest.current
      if (title === persisted.current.title && text === persisted.current.text) return
      if (!noteId.current && !title && !text.trim()) return // an empty draft isn't a note yet
      setStatus('saving')
      try {
        if (noteId.current) {
          callbacks.current.onSaved(await saveNoteContent(noteId.current, title, text))
        } else {
          noteId.current = (await callbacks.current.onCreate(title, text)).id
        }
        persisted.current = { title, text }
        setStatus('saved')
      } catch {
        setStatus('failed')
      }
    })
    return queue.current
  }

  const scheduleSave = () => {
    cancelTimer()
    timer.current = window.setTimeout(save, 900)
  }

  const isDirty = () => latest.current.title.trim() !== persisted.current.title || latest.current.text !== persisted.current.text
  const isEmpty = () => !latest.current.title.trim() && !latest.current.text.trim()

  /** Called on the way out: a saved typed note with nothing left in it goes. */
  const discardIfEmpty = () => {
    if (isTyped && noteId.current && isEmpty()) {
      abandoned.current = true
      callbacks.current.onDiscard(noteId.current)
      return true
    }
    return false
  }

  // Leaving the app on a phone can be the last thing that ever happens to this tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && isDirty()) void save()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (discardIfEmpty()) return
      if (isDirty()) void save()
    }
    // save/isDirty read refs; they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { confirmation, ask, cancel } = useConfirm()

  const handleBack = async () => {
    await queue.current // a create still in flight decides whether there's anything to discard
    if (discardIfEmpty()) return // onDiscard closes the editor
    if (isDirty()) {
      await save()
      if (isDirty()) {
        ask({
          title: "This note couldn't be saved",
          body: 'Leaving now loses the changes you just made.',
          confirmLabel: 'Leave anyway',
          destructive: true,
          onConfirm: () => {
            abandoned.current = true
            onBack()
          },
        })
        return
      }
    }
    abandoned.current = true
    onBack()
  }

  const handleDelete = () => {
    if (!onDelete) return
    ask({
      title: 'Delete this note?',
      body: 'Cards already generated from it are kept.',
      confirmLabel: 'Delete note',
      destructive: true,
      onConfirm: () => {
        abandoned.current = true // no point flushing edits into a note that's about to go
        cancelTimer()
        onDelete()
      },
    })
  }

  const kind = note ? kindLabel(note.file_type) : 'Note'
  const filedUnder = note ? (note.deck_name ?? UNFILED) : draft?.deckName || UNFILED
  const isFile = note !== null && note.file_type !== 'text'

  return (
    <div className="flex flex-col gap-5">
      <ConfirmDialog confirmation={confirmation} onCancel={cancel} />
      <div className="flex items-center justify-between">
        <BackButton onClick={handleBack} chevronSize={18}>
          Notes
        </BackButton>
        <div className="flex items-center gap-4 text-[0.8125rem] font-semibold">
          {status === 'saving' && <span className="text-[var(--text-muted)]">Saving</span>}
          {status === 'saved' && <span className="text-[var(--text-muted)]">Saved</span>}
          {status === 'failed' && <span style={{ color: 'var(--grade-forgot)' }}>Couldn't save</span>}
          {onDelete && (
            <button onClick={handleDelete} className="flex h-11 items-center font-bold" style={{ color: 'var(--grade-forgot)' }}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          placeholder="Untitled note"
          aria-label="Note title"
          maxLength={200}
          className="w-full bg-transparent text-[1.25rem] font-bold leading-tight outline-none placeholder:text-[var(--text-muted)]"
        />
        <div className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
          {filedUnder}, {kind}
          {note ? `, ${formatNoteDate(note.created_at)}` : ''}
        </div>
      </div>

      {/* Original first, transcription second: the original is what you check against when the
          text looks wrong, so it should be what you see first. */}
      {isFile && (
        <div className="overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]">
          {note.file_type === 'pdf' ? (
            <embed src={noteFileUrl(note.id)} type="application/pdf" className="h-[70vh] w-full" />
          ) : (
            <img src={noteFileUrl(note.id)} alt="Original note" className="max-h-[70vh] w-full object-contain" />
          )}
        </div>
      )}

      <Suspense fallback={<div className="min-h-[16rem] rounded-[var(--r-md)] bg-[var(--surface)]" />}>
        <MarkdownEditor
          value={text}
          onChange={(v) => {
            setText(v)
            scheduleSave()
          }}
          label={isFile ? 'What the AI read' : undefined}
          placeholder={isFile ? 'No text was read from this file. You can type it here.' : 'Start writing'}
          autoFocus={note === null}
        />
      </Suspense>
    </div>
  )
}
