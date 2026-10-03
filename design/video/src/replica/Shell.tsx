// Replica of the tabbed branch of frontend/src/App.tsx: the sidebar on desktop, the header, the
// page, and the floating tab bar on a phone. `min-h-screen` is `h-full` for the same reason as in
// DesktopSidebar. `scrollY` stands in for the page having been scrolled: the page moves, the fixed
// tab bar and the sidebar don't.
import type { ReactNode } from 'react'
import Logo from '@app/components/Logo'
import type { Tab } from '@app/lib/route'
import { DesktopSidebar } from './DesktopSidebar'
import { TabBar } from './TabBar'

const TAB_TITLES: Record<Exclude<Tab, 'home'>, string> = {
  cards: 'Your Cards',
  calendar: 'Calendar',
  notes: 'Notes',
  tutor: 'Tutor',
  settings: 'Settings',
}

export function Shell({
  tab,
  children,
  pill,
  pressedNav,
  scrollY = 0,
  overlay,
}: {
  tab: Tab
  children: ReactNode
  pill?: { x: number; w: number; scaleX: number }
  pressedNav?: Tab | null
  scrollY?: number
  /** Fixed layers drawn over the page and the bars (the tutor's composer and voice stage). */
  overlay?: ReactNode
}) {
  return (
    <div className="flex h-full text-[var(--text)]">
      <DesktopSidebar active={tab} pressed={pressedNav} />
      <div className="min-w-0 flex-1">
        <main
          className="mx-auto w-full max-w-xl px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] lg:max-w-5xl lg:px-10 lg:pb-10"
          style={scrollY ? { transform: `translateY(${-scrollY}px)` } : undefined}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              {tab === 'home' ? (
                <span className="flex items-center gap-2.5 lg:hidden">
                  <Logo size={22} />
                  <span className="text-[0.9375rem] font-bold text-[var(--text-muted)]">Rekall</span>
                </span>
              ) : (
                <div className="truncate text-[1.5rem] font-bold tracking-[-0.02em] lg:text-[1.75rem]">{TAB_TITLES[tab]}</div>
              )}
            </div>
            {tab !== 'settings' && (
              <button
                aria-label="Settings"
                className="-mr-3 flex h-11 w-11 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-muted)] lg:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <circle cx="15" cy="6" r="2.4" fill="var(--bg)" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <circle cx="9" cy="12" r="2.4" fill="var(--bg)" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                  <circle cx="17" cy="18" r="2.4" fill="var(--bg)" />
                </svg>
              </button>
            )}
          </div>
          {children}
        </main>
      </div>
      <TabBar active={tab} pill={pill} />
      {overlay}
    </div>
  )
}
