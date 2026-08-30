import { NAV_ITEMS, type Tab } from './navIcons'
import { useSlidingPill } from '../hooks/useSlidingPill'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

export default function TabBar({ active, onChange }: Props) {
  const { container, register, pillStyle } = useSlidingPill(active)

  return (
    <div
      ref={container}
      className="fixed inset-x-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-[440px] items-center justify-around rounded-full bg-[var(--bg-card)] px-3.5 py-2.5 lg:hidden"
      style={{ boxShadow: 'var(--shadow-lg)' }}
    >
      {pillStyle && (
        <span
          aria-hidden
          className="sliding-pill pointer-events-none rounded-full"
          style={{
            ...pillStyle,
            background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))',
            boxShadow: 'var(--highlight-shadow)',
          }}
        />
      )}

      {NAV_ITEMS.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            ref={register(tab.id)}
            onClick={() => onChange(tab.id)}
            // The visible caption disappears at large text sizes, so the button carries its own
            // name rather than relying on the label being rendered.
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            className="pill-option relative z-10 flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-2"
            // `currentColor` rather than a baked-in stroke, so the icon's colour is one CSS
            // property away from the label's and both can transition together.
            style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            {tab.icon('currentColor')}
            <span className="tab-label max-w-full truncate text-[0.625rem] font-bold">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
