/** One surface per region. Rows inside are separated by inset rules, not by their own boxes. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[1.0625rem] font-bold tracking-[-0.01em]">{title}</div>
      <div className="flex flex-col rounded-[var(--r-md)] bg-[var(--surface)] px-4 [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
        {children}
      </div>
    </section>
  )
}

/** Label and control share a line when the control is compact; the hint sits under both.
 *
 * `hint` is optional: a row whose hint only restates its own label is quieter without one, and
 * the design draws Settings as mostly bare label-and-control rows. Keep a hint where it carries
 * something the control can't say by itself. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-3.5">
      <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="text-[0.9375rem] font-semibold">{label}</div>
        <div className="flex min-w-0 max-w-full items-center">{children}</div>
      </div>
      {hint && <div className="text-[0.8125rem] leading-snug text-[var(--text-muted)]">{hint}</div>}
    </div>
  )
}

/** Buttons rather than a number input: on a phone a number field opens a keyboard and invites
 * typing something out of range, and these are all values you nudge rather than type.
 */
export function Stepper({
  value,
  min,
  max,
  step,
  zeroLabel,
  format,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  zeroLabel?: string
  /** For values whose raw number isn't what you'd want to read — milliseconds, mainly. */
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  // Clamped here as well as on the server: the buttons should go inert at the ends rather than
  // firing a request the server is only going to reject.
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)))

  return (
    // 44px buttons, overhanging the panel's own padding by 8px on the right so the row does not
    // get wider for it. They were 36px, under the touch floor on a control you tap repeatedly.
    <div className="-mr-2 flex items-center gap-0.5">
      <button
        onClick={() => set(value - step)}
        disabled={value <= min}
        aria-label="Decrease"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-xl text-[var(--text-muted)] disabled:opacity-40"
      >
        −
      </button>
      <span className={`min-w-[44px] whitespace-nowrap text-center ${value === 0 && zeroLabel ? 'text-[0.875rem] font-semibold text-[var(--text-muted)]' : 'numeral text-[1.25rem]'}`}>
        {value === 0 && zeroLabel ? zeroLabel : format ? format(value) : value}
      </span>
      <button
        onClick={() => set(value + step)}
        disabled={value >= max}
        aria-label="Increase"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-xl text-[var(--text-muted)] disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}

/** A plain on/off switch. Distinct from Segmented because a binary choice with two labels reads
 * as two options to pick between; a switch reads as one thing that is on or off. */
export function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      // Every dimension in px, and none in rem. Mixing them was one of two things wrong here: the
      // track was a fixed 52px while the knob was `w-6` (1.5rem), which index.css scales to
      // 25.44px via `html { font-size: 106% }`. A control whose parts must line up to the pixel
      // can't have half of them resizing with the root font size. (The larger error was the
      // knob's missing `left-0` — see below.)
      className="relative h-[32px] w-[52px] flex-shrink-0 rounded-[var(--r-full)] transition-colors"
      style={{ background: value ? 'var(--accent)' : 'var(--rule)' }}
    >
      <span
        // `left-0` is load-bearing, not decoration. An absolutely positioned box with no left or
        // right resolves to its *static* position — and a <button> carries `text-align: center`
        // from the UA stylesheet, which shifts that static position to the middle of the track.
        // The knob therefore started 14px in ((52-24)/2) and the transforms below stacked on top
        // of it, so the "on" state pushed it 10px clear of the track entirely.
        className="absolute left-0 top-[4px] h-[24px] w-[24px] rounded-[var(--r-full)]"
        style={{
          background: value ? 'oklch(from var(--accent) 0.17 0.02 h)' : 'var(--text-muted)',
          // 4px inset either end: off sits at 4, on at 52 - 4 - 24 = 24. Symmetric by construction
          // rather than by a number that happened to look right.
          transform: value ? 'translateX(24px)' : 'translateX(4px)',
          // Same easing family as the sliding pill, so the two controls in this screen agree about
          // how things move.
          transition: 'transform 260ms cubic-bezier(0.22, 1.12, 0.36, 1)',
        }}
      />
    </button>
  )
}
