import type { ReactNode } from 'react'

/** The one message block in the app: errors, neutral status, and confirmations.
 *
 * There used to be three shapes — Settings drew `r-sm` semibold, Study drew `r-md` with relaxed
 * leading, Tutor drew a self-centred pill — which meant three places to fix when the light theme's
 * error colours turned out to fail contrast. One component is one place.
 *
 * `neutral` exists for its own reason: falling back to text when voice is unavailable is expected
 * behaviour, and styling it red told the user something had broken when nothing had.
 */
export default function Notice({
  tone,
  children,
  action,
  className = '',
}: {
  tone: 'error' | 'neutral' | 'success'
  children: ReactNode
  /** An inline way out of the state the notice describes — "Retry", "See plans". */
  action?: { label: string; onClick: () => void }
  className?: string
}) {
  const palette = {
    error: { background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' },
    neutral: { background: 'var(--surface)', color: 'var(--text)' },
    success: { background: 'var(--grade-good-bg)', color: 'var(--grade-good)' },
  }[tone]

  return (
    <div
      // `alert` interrupts a screen reader, which is right for a failure and wrong for the other
      // two — a confirmation that talks over you is worse than one you find on your own.
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-3 rounded-[var(--r-sm)] px-4 py-3 text-[0.875rem] font-semibold leading-snug ${className}`}
      style={palette}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action && (
        <button
          onClick={action.onClick}
          className="flex-shrink-0 text-[0.875rem] font-bold underline underline-offset-4"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
