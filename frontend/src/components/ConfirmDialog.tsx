import { useEffect, useRef } from 'react'

export interface Confirmation {
  title: string
  /** What happens, in the app's own words. Skip it when the title already says everything. */
  body?: string
  /** The button that does the thing. Says what happens: "Delete deck", not "OK". */
  confirmLabel: string
  /** Destructive actions get the forgot colour and an explicit warning tone. */
  destructive?: boolean
  onConfirm: () => void
}

/** The app asking before it does something it cannot take back.
 *
 * Replaces `window.confirm`, which was doing this job in six places. The native dialog is a
 * different typeface, a different button order per platform, and a title bar that says
 * "rekall.study says" — the one moment the app most needs to sound like itself was the one moment
 * it sounded like the browser. It also cannot say which button is the dangerous one.
 *
 * Same shell as ExamSheet: bottom sheet on a phone, centred dialog from `lg`. Cancel is first in
 * the DOM so it takes focus, and Escape or a tap outside both cancel — the safe way out is the
 * easy one.
 */
export default function ConfirmDialog({ confirmation, onCancel }: { confirmation: Confirmation | null; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!confirmation) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    // Focus the safe button, not the destructive one: a stray Enter should do nothing.
    cancelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmation, onCancel])

  if (!confirmation) return null
  const { title, body, confirmLabel, destructive, onConfirm } = confirmation

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(0_0_0_/_0.45)] lg:items-center"
      onClick={onCancel}
      role="alertdialog"
      aria-modal
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-t-[var(--r-md)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:rounded-[var(--r-md)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[1.0625rem] font-bold tracking-[-0.01em]">{title}</div>
        {body && <p className="mt-2 text-[0.9375rem] leading-[1.55] text-[var(--text-muted)]">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="flex h-11 items-center rounded-[var(--r-full)] border border-[var(--rule)] px-5 text-[0.9375rem] font-bold"
          >
            Cancel
          </button>
          {/* Destructive carries the forgot pair, which measures 5.4:1 in light and 4.5:1 in
              dark. Anything else is the ordinary primary button, so it takes .on-accent, fill and all. */}
          <button
            onClick={() => {
              onConfirm()
              onCancel()
            }}
            className={`flex h-11 items-center rounded-[var(--r-full)] px-5 text-[0.9375rem] font-bold ${destructive ? '' : 'on-accent'}`}
            style={destructive ? { background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
