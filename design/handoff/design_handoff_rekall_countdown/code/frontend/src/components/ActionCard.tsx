import type { ReactNode } from 'react'

/** One "way in" row at the top of the Cards tab: icon, title, and a line saying what the route
 * does rather than just naming it. Rows, not cards — the routes are choices on one surface, and
 * the parent draws the surface and the dividers between them. */
export default function ActionCard({
  onClick,
  title,
  description,
  icon,
  disabled = false,
  disabledHint,
}: {
  onClick: () => void
  title: string
  description: string
  icon: ReactNode
  disabled?: boolean
  /** Replaces `description` when disabled, so the row says why it's off rather than describing a
   * route you can't take. */
  disabledHint?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left disabled:cursor-not-allowed"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <span className="flex flex-shrink-0 text-[var(--text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold">{title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-[var(--text-muted)]">{disabled && disabledHint ? disabledHint : description}</span>
      </span>
    </button>
  )
}
