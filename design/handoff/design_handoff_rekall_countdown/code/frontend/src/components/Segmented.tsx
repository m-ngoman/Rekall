import { useSlidingPill } from '../hooks/useSlidingPill'

/** A row of mutually exclusive options with a selection pill that travels between them.
 *
 * Shared by Settings and onboarding. The motion is the same one the tab bar uses — see
 * useSlidingPill — because these are the controls people tap repeatedly to compare options, and
 * an instant swap reads as dead in both places.
 */
export default function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  // Same travelling indicator as the tab bar — these are the other control in the app you tap
  // repeatedly to compare options, so an instant swap felt equally dead here.
  const { container, register, pillStyle } = useSlidingPill(value)

  return (
    <div ref={container} className="relative flex gap-0.5 rounded-[var(--r-sm)] p-0.5" style={{ background: 'var(--bg)' }}>
      {pillStyle && (
        <span
          aria-hidden
          className="sliding-pill pointer-events-none rounded-[4px]"
          style={{ ...pillStyle, background: 'var(--surface)' }}
        />
      )}
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={register(option.value)}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className="pill-option relative z-10 flex-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-[0.8125rem]"
            style={{ color: active ? 'var(--text)' : 'var(--text-muted)', fontWeight: active ? 700 : 600 }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
