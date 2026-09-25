import { type ChangeEvent, type ReactNode, useRef, useState } from 'react'
import { uploadNotes, serverDetail } from '../../api'
import BackButton from '../BackButton'
import { CameraIcon, PdfIcon, PhotoIcon } from '../icons'
import { type NoteDraft, UNFILED } from '../../lib/notes'
import type { Deck } from '../../types'

/** Sentinel `<select>` value for "a category I'm about to name". Distinct from the empty string,
 * which already means Unfiled. */
const NEW_CATEGORY = '__new_category__'

/** Writing is the first option and the only accent on the page; uploading is the rest of it.
 * Both file under the same category choice, made once at the top.
 *
 * Files are staged rather than uploaded the moment they're picked. Each one costs a vision call,
 * so a mis-tap would otherwise burn a request and leave a junk note to clean up; staging also
 * means the deck choice no longer has to be made *before* picking.
 */
export default function AddNotesPanel({
  decks,
  onWrite,
  onAdded,
  onCancel,
}: {
  decks: Deck[]
  onWrite: (draft: NoteDraft) => void
  onAdded: (count: number, deckName: string) => void
  onCancel: () => void
}) {
  const [deckId, setDeckId] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const naming = deckId === NEW_CATEGORY

  /** The category as the API wants it: an id, a name to create, or neither. Null when the user
   * picked "new category" and hasn't named it. */
  const filing = (): NoteDraft | null => {
    if (naming) return newCategory.trim() ? { deckId: null, deckName: newCategory.trim() } : null
    return { deckId: deckId || null, deckName: decks.find((d) => d.id === deckId)?.name ?? '' }
  }

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // so re-picking the same file still fires onChange
    if (picked.length === 0) return
    setFiles((prev) => [
      ...prev,
      // Unlike the card generator, photos and PDFs mix freely here: every file becomes its own
      // note, so there's no single "source material" for them to disagree about.
      ...picked.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size)),
    ])
    setError(null)
  }

  const handleWrite = () => {
    const draft = filing()
    if (!draft) {
      setError('Give the new category a name, or pick an existing one.')
      return
    }
    onWrite(draft)
  }

  const handleAdd = async () => {
    if (files.length === 0) return
    const draft = filing()
    if (!draft) {
      setError('Give the new category a name, or pick an existing one.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // NEW_CATEGORY is a UI-only sentinel; the API sees a real id or a name, never both.
      await uploadNotes(files, draft.deckId, draft.deckId ? '' : draft.deckName)
      onAdded(files.length, draft.deckName || UNFILED)
    } catch (e) {
      // The server's own sentence when it sent one. An upload that is refused for a reason
      // (too large, wrong type, out of pages) used to read as a file problem the user could not
      // act on, because every failure got the same fixed string.
      setError(serverDetail(e) ?? 'Could not upload that — check the file and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <BackButton onClick={onCancel} disabled={busy} className="mb-4" chevronSize={18}>
        Notes
      </BackButton>

      <div className="mb-5">
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">File under</div>
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem] outline-none"
        >
          <option value="">{UNFILED}</option>
          <option value={NEW_CATEGORY}>New category, I'll name it</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {naming && (
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            disabled={busy}
            placeholder="Category name"
            maxLength={80}
            className="mt-2 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem] outline-none placeholder:text-[var(--text-muted)]"
          />
        )}
      </div>

      <button
        onClick={handleWrite}
        disabled={busy}
        className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        Write a note
      </button>

      <div className="mb-3 mt-7 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Or add photos and PDFs</div>
      <p className="mb-3 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
        Each file is kept with the text the AI reads out of it. This doesn't make any flashcards — the Cards tab
        does that.
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2.5">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addFiles} />
        <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />
        <input ref={pdfInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={addFiles} />

        <SourceButton disabled={busy} onClick={() => cameraInputRef.current?.click()} icon={<CameraIcon />} label="Take a photo" />
        <SourceButton disabled={busy} onClick={() => libraryInputRef.current?.click()} icon={<PhotoIcon />} label="Choose photos" />
        <SourceButton disabled={busy} onClick={() => pdfInputRef.current?.click()} icon={<PdfIcon />} label="Choose a PDF" />
      </div>

      {files.length > 0 && (
        <div className="mb-5 border-t border-[var(--rule)]">
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-3">
              <span className="truncate text-[0.9375rem] font-semibold">{f.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={busy}
                className="flex-shrink-0 text-[0.875rem] font-semibold text-[var(--text-muted)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
      )}

      {/* Secondary on purpose: the accent on this page is already spent on writing. Absent until
          there's something staged, since a button for zero files says nothing. */}
      {files.length > 0 && (
        <button
          onClick={handleAdd}
          disabled={busy}
          className="w-full rounded-[var(--r-full)] border border-[var(--rule)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
        >
          {busy ? 'Reading your notes' : `Add ${files.length} note${files.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

function SourceButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void
  disabled: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--surface)] py-5 text-[var(--text-muted)] disabled:opacity-50"
     
    >
      {icon}
      <span className="text-xs font-bold">{label}</span>
    </button>
  )
}
