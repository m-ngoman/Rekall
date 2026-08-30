import Logo from './Logo'
import { NAV_ITEMS, SETTINGS_ICON, type Tab } from './navIcons'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

export default function DesktopSidebar({ active, onChange }: Props) {
  return (
    <div className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col bg-[var(--bg-card)] p-[18px] shadow-[2px_0_14px_oklch(0.4_0.03_50_/_0.05)] lg:flex">
      <div className="flex items-center gap-2.5 px-2.5 pb-7 pt-2 text-lg font-extrabold tracking-tight">
        <Logo size={26} />
        Re<span style={{ color: 'var(--accent)' }}>kall</span>
      </div>

      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active
          const color = isActive ? 'var(--accent)' : 'var(--text-secondary)'
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className="flex items-center gap-3 rounded-full px-3.5 py-2.5"
              style={{
                background: isActive ? 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))' : undefined,
                boxShadow: isActive ? 'var(--highlight-shadow)' : undefined,
              }}
            >
              {item.icon(color)}
              <span className="text-sm font-bold" style={{ color }}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex-1" />

      <button
        onClick={() => onChange('settings')}
        className="flex items-center gap-3 rounded-full px-3.5 py-2.5"
        style={{
          background: active === 'settings' ? 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))' : undefined,
          boxShadow: active === 'settings' ? 'var(--highlight-shadow)' : undefined,
        }}
      >
        {SETTINGS_ICON(active === 'settings' ? 'var(--accent)' : 'var(--text-secondary)')}
        <span className="text-sm font-bold" style={{ color: active === 'settings' ? 'var(--accent)' : 'var(--text-secondary)' }}>
          Settings
        </span>
      </button>
    </div>
  )
}
