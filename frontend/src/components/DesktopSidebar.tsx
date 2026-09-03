import Logo from './Logo'
import { NAV_ITEMS, SETTINGS_ICON, type Tab } from './navIcons'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
  /** See TabBar — same rule, minus the bounce: the sidebar has no sliding pill to throw. */
  disabled?: Tab[]
}

/** The wordmark is plain text. The accent belongs to the active item, the countdown, the load
 * and the primary action; putting it in the logo would make it decoration. */
export default function DesktopSidebar({ active, onChange, disabled = [] }: Props) {
  const item = (id: Tab, label: string, icon: (color: string) => React.ReactNode, isDisabled = false) => {
    const isActive = id === active
    const color = isActive ? 'var(--accent)' : 'var(--text-muted)'
    return (
      <button
        key={id}
        onClick={() => isDisabled || onChange(id)}
        aria-disabled={isDisabled || undefined}
        aria-current={isActive ? 'page' : undefined}
        className="flex items-center gap-3 rounded-[var(--r-full)] px-3.5 py-2.5 text-[0.875rem] font-bold"
        style={{ background: isActive ? 'var(--accent-dim)' : undefined, color, opacity: isDisabled ? 0.4 : undefined }}
      >
        {icon(color)}
        {label}
      </button>
    )
  }

  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--surface)] p-[18px] lg:flex">
      <div className="flex items-center gap-2.5 px-2.5 pb-7 pt-2 text-lg font-bold tracking-tight">
        <Logo size={26} />
        Rekall
      </div>
      <div className="flex flex-col gap-1">{NAV_ITEMS.map((t) => item(t.id, t.label, t.icon, disabled.includes(t.id)))}</div>
      <div className="flex-1" />
      {item('settings', 'Settings', SETTINGS_ICON)}
    </nav>
  )
}
