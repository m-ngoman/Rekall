// Replica of frontend/src/components/TabBar.tsx. The pill's geometry comes from lib/pill (the
// motion of useSlidingPill, on the video's clock) instead of from measuring the options; the
// `sliding-pill` and `pill-option` classes are left off because they carry CSS transitions.
import { NAV_ITEMS } from '@app/components/navIcons'
import type { Tab } from '@app/lib/route'

/** The options' boxes: the bar spans the 390 px viewport less 20 px each side, 1 px border, 14 px
 * padding, and five equal flex-1 options — 64 px each, the first 14 px in. */
export const TAB_OPTION = { first: 14, width: 64 }
export const tabIndex = (tab: Tab) => NAV_ITEMS.findIndex((t) => t.id === tab)
export const tabBox = (tab: Tab) => ({ x: TAB_OPTION.first + tabIndex(tab) * TAB_OPTION.width, w: TAB_OPTION.width })

export function TabBar({
  active,
  pill,
}: {
  active: Tab
  /** Where the pill is this frame; defaults to resting on the active tab. */
  pill?: { x: number; w: number; scaleX: number }
}) {
  const at = pill ?? { ...tabBox(active), scaleX: 1 }
  return (
    <div className="fixed inset-x-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-[440px] items-center justify-around rounded-[var(--r-full)] border border-[var(--rule)] bg-[var(--surface)] px-3.5 py-2.5 lg:hidden">
      {tabIndex(active) >= 0 && (
        <span
          aria-hidden
          className="pointer-events-none rounded-[var(--r-full)] bg-[var(--accent-dim)]"
          style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: at.w, translate: `${at.x}px 0px`, scale: `${at.scaleX} 1` }}
        />
      )}
      {NAV_ITEMS.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            className="relative z-10 flex min-h-[44px] min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[var(--r-full)] px-1 py-2"
            style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            {tab.icon('currentColor')}
            <span className="tab-label max-w-full truncate text-[0.625rem] font-bold">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
