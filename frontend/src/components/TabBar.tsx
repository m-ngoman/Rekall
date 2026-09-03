import { NAV_ITEMS, type Tab } from './navIcons'
import { useSlidingPill } from '../hooks/useSlidingPill'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
  disabled?: Tab[]
}

export default function TabBar({ active, onChange, disabled = [] }: Props) {
  const { container, register, pillStyle, rejectTo } = useSlidingPill(active)

  return (
    <div
      ref={container}
      className="fixed inset-x-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-[440px] items-center justify-around rounded-[var(--r-full)] border border-[var(--rule)] bg-[var(--surface)] px-3.5 py-2.5 lg:hidden"
    >
      {pillStyle && (
        <span
          aria-hidden
          className="sliding-pill pointer-events-none rounded-[var(--r-full)] bg-[var(--accent-dim)]"
          style={pillStyle}
        />
      )}

      {NAV_ITEMS.map((tab) => {
        const isActive = tab.id === active
        const isDisabled = disabled.includes(tab.id)
        return (
          <button
            key={tab.id}
            ref={register(tab.id)}
            onClick={() => (isDisabled ? rejectTo(tab.id) : onChange(tab.id))}
            aria-disabled={isDisabled || undefined}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            className="pill-option relative z-10 flex min-h-[44px] min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[var(--r-full)] px-1 py-2"
            style={{
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              opacity: isDisabled ? 0.4 : 1,
            }}
          >
            {tab.icon('currentColor')}
            <span className="tab-label max-w-full truncate text-[0.625rem] font-bold">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
