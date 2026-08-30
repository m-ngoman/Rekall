import type { ReactNode } from 'react'

/** The "way in" tile that sits at the top of the Cards and Notes tabs: icon, title, and a line
 * saying what the route actually does rather than just naming it.
 *
 * Shared rather than duplicated because the two tabs' entry points are the same affordance doing
 * the same job, and they only read as a pattern if they stay pixel-identical as the design moves.
 */
export default function ActionCard({
  onClick,
  title,
  description,
  icon,
}: {
  onClick: () => void
  title: string
  description: string
  icon: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-[16px] bg-[var(--bg-card)] p-4 text-left"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))',
          color: 'var(--accent)',
          boxShadow: 'var(--highlight-shadow)',
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold">{title}</div>
        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</div>
      </div>
    </button>
  )
}
