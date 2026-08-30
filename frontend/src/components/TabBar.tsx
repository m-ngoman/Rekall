import { NAV_ITEMS, type Tab } from './navIcons'
import { useSlidingPill } from '../hooks/useSlidingPill'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
  /** Tabs that exist but can't be opened — currently Tutor with AI turned off. Kept visible and
   * greyed rather than removed: a nav that changes shape based on a setting is disorienting, and
   * the greyed tab is a reminder that the feature is there and switched off. */
  disabled?: Tab[]
}

export default function TabBar({ active, onChange, disabled = [] }: Props) {
  const { container, register, pillStyle, rejectTo } = useSlidingPill(active)

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
        const isDisabled = disabled.includes(tab.id)
        return (
          <button
            key={tab.id}
            ref={register(tab.id)}
            // Deliberately not the `disabled` attribute: a disabled button swallows the click,
            // and the click is what plays the bounce that explains the refusal.
            onClick={() => (isDisabled ? rejectTo(tab.id) : onChange(tab.id))}
            aria-disabled={isDisabled || undefined}
            // The visible caption disappears at large text sizes, so the button carries its own
            // name rather than relying on the label being rendered.
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            className="pill-option relative z-10 flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-2"
            // `currentColor` rather than a baked-in stroke, so the icon's colour is one CSS
            // property away from the label's and both can transition together.
            style={{
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
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
