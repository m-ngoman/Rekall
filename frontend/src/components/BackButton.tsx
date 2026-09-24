import type { ReactNode } from 'react'
import { BackChevron } from './icons'

/** The way out of a sub-screen, top left: a chevron and where it goes. The negative margin lines
 * the chevron up with the content's edge while the tap target stays 44px tall. `className` is for
 * the space below it, which differs by screen. */
export default function BackButton({
  onClick,
  children,
  className,
  disabled,
  chevronSize,
}: {
  onClick: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
  chevronSize?: number
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`-ml-2 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]${className ? ` ${className}` : ''}`}
    >
      <BackChevron size={chevronSize} />
      {children}
    </button>
  )
}
