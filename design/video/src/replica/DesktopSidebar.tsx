// Replica of frontend/src/components/DesktopSidebar.tsx. One change: `h-screen` is `h-full`, since
// "the screen" here is the replica's viewport, not the video frame.
import Logo from '@app/components/Logo'
import { NAV_ITEMS, SETTINGS_ICON } from '@app/components/navIcons'
import type { Tab } from '@app/lib/route'

export function DesktopSidebar({ active, pressed }: { active: Tab; pressed?: Tab | null }) {
  const item = (id: Tab, label: string, icon: (color: string) => JSX.Element) => {
    const isActive = id === active
    const color = isActive ? 'var(--accent)' : 'var(--text-muted)'
    return (
      <button
        key={id}
        aria-current={isActive ? 'page' : undefined}
        className="flex items-center gap-3 rounded-[var(--r-full)] px-3.5 py-2.5 text-[0.875rem] font-bold"
        style={{ background: isActive ? 'var(--accent-dim)' : undefined, color, filter: pressed === id ? 'brightness(0.92)' : undefined }}
      >
        {icon(color)}
        {label}
      </button>
    )
  }
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-full w-60 flex-shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--surface)] p-[18px] lg:flex">
      <div className="flex items-center gap-2.5 px-2.5 pb-7 pt-2 text-lg font-bold tracking-tight">
        <Logo size={26} />
        Rekall
      </div>
      <div className="flex flex-col gap-1">{NAV_ITEMS.map((t) => item(t.id, t.label, t.icon))}</div>
      <div className="flex-1" />
      {item('settings', 'Settings', SETTINGS_ICON)}
    </nav>
  )
}

/** Where each sidebar item's middle is, in replica pixels, for a pointer to aim at: 18 px padding,
 * the wordmark row, then 40 px items 4 px apart. */
export function sidebarItemCentre(tab: Tab): { x: number; y: number } {
  const i = NAV_ITEMS.findIndex((t) => t.id === tab)
  return { x: 100, y: 18 + 8 + 26 + 28 + i * 44 + 20 }
}
