import { type ChangeEvent, useRef } from 'react'
import { CameraIcon, PhotoIcon } from '../icons'

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/** The composer's photo button: a picker between the camera and the library, and the hidden file
 * inputs behind them. `attached` says a photo is already waiting to be sent. */
export default function PhotoAttach({
  attached,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  attached: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onSelect}
        className="hidden"
      />
      <input ref={libraryInputRef} type="file" accept="image/*" onChange={onSelect} className="hidden" />
      <button
        onClick={onToggle}
        aria-label={attached ? 'Photo attached' : 'Attach a photo'}
        className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
        style={{ background: attached || open ? 'var(--bg)' : undefined }}
      >
        <PhotoIcon size={16} />
        {attached && <span className="inline">1 photo</span>}
      </button>
      {open && (
        <div className="absolute bottom-12 left-0 z-20 flex w-44 flex-col gap-1 rounded-[var(--r-md)] border border-[var(--rule)] bg-[var(--surface)] p-1.5">
          <button
            onClick={() => {
              cameraInputRef.current?.click()
              onClose()
            }}
            className="flex items-center gap-2.5 rounded-[var(--r-sm)] px-3 py-2.5 text-left text-sm font-semibold text-[var(--text)]"
          >
            <CameraIcon size={16} />
            Take Photo
          </button>
          <button
            onClick={() => {
              libraryInputRef.current?.click()
              onClose()
            }}
            className="flex items-center gap-2.5 rounded-[var(--r-sm)] px-3 py-2.5 text-left text-sm font-semibold text-[var(--text)]"
          >
            <PhotoIcon size={16} />
            Choose from Library
          </button>
        </div>
      )}
    </div>
  )
}

/** The photo waiting to go with the next message, with a way to take it back off. */
export function PendingPhoto({ file, url, onRemove }: { file: File; url: string | null; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-1">
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-[var(--r-sm)]">
        <img src={url ?? undefined} alt="Selected photo" className="h-full w-full object-cover" />
        <button
          onClick={onRemove}
          aria-label="Remove photo"
          className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-[var(--r-full)] border border-[var(--rule)] bg-[var(--surface)] text-[var(--text)]"
        >
          {CLOSE_ICON}
        </button>
      </div>
      <span className="truncate text-xs text-[var(--text-muted)]">{file.name}</span>
    </div>
  )
}
