import { useState } from 'react'
import { createSampleDeck } from '../api'
import Logo from '../components/Logo'
import Segmented from '../components/Segmented'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../hooks/useAccent'
import type { Settings, SettingsPatch, Theme } from '../types'

interface Props {
  /** Needed as well as onChange so the appearance step can show what's currently selected —
   * these settings apply live as they're tapped, so the step has to reflect real state. */
  settings: Settings
  onChange: (patch: SettingsPatch) => void
  onFinish: (opts: { goToCards: boolean }) => void
}

const GOALS = [10, 20, 30, 50]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const STEPS = 4

/**
 * First run. Three steps, each doing real work — no feature tour.
 *
 * The shape is deliberate: an empty study app can't demonstrate itself, and the usual first-run
 * failure is asking someone to supply content before they've seen why they'd bother. So the last
 * step offers a starter deck, which gets you to a graded answer in seconds rather than after a
 * photo upload. Everything here is skippable; nothing is asked twice.
 */
export default function OnboardingScreen({ settings, onChange, onFinish }: Props) {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = (goToCards: boolean) => {
    onChange({ onboarded: true })
    onFinish({ goToCards })
  }

  const startWithSample = async () => {
    setBusy(true)
    setError(null)
    try {
      await createSampleDeck()
      finish(false)
    } catch {
      setError("Couldn't set that up — you can still add your own cards.")
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <div className="rounded-[20px] bg-[var(--bg-card)] px-7 py-12 text-center" style={{ boxShadow: 'var(--shadow-md)' }}>
        {step === 0 && (
          <>
            <div className="mb-5 flex justify-center">
              <Logo size={92} />
            </div>
            <h1 className="mb-2 text-xl font-extrabold">Welcome to Rekall</h1>
            <p className="mx-auto mb-7 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
              Most flashcard apps ask whether you got it right. Rekall reads what you actually wrote
              or said, and tells you what you missed.
            </p>
            <Primary onClick={() => setStep(1)}>Get started</Primary>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="mb-2 text-xl font-extrabold">Make it yours</h1>
            <p className="mx-auto mb-7 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
              Applies as you tap, so you can see it straight away.
            </p>

            <div className="mx-auto mb-7 max-w-xs">
              <div className="mb-2 text-xs font-bold text-[var(--text-secondary)]">Theme</div>
              <Segmented options={THEMES} value={settings.theme} onChange={(theme) => onChange({ theme })} />
            </div>

            <div className="mx-auto mb-7 max-w-xs">
              <div className="mb-2.5 text-xs font-bold text-[var(--text-secondary)]">Colour</div>
              <div className="flex justify-center gap-3">
                {ACCENT_PRESETS.map((preset) => {
                  const active = (settings.accent ?? DEFAULT_ACCENT) === preset.value
                  return (
                    <button
                      key={preset.name}
                      onClick={() => onChange({ accent: preset.value })}
                      aria-label={preset.name}
                      aria-pressed={active}
                      className="h-10 w-10 rounded-full border-2"
                      style={{ background: preset.value, borderColor: active ? 'var(--text)' : 'transparent' }}
                    />
                  )
                })}
              </div>
            </div>

            <p className="mb-7 text-xs text-[var(--text-secondary)] opacity-80">
              (you can change this later in Settings)
            </p>
            <Primary onClick={() => setStep(2)}>Continue</Primary>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="mb-2 text-xl font-extrabold">How many cards a day?</h1>
            <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
              Your daily review target — it's what the ring on your home screen fills up. A goal,
              not a limit: you can always keep going past it.
            </p>
            <div className="mx-auto mb-7 grid max-w-xs grid-cols-4 gap-2">
              {GOALS.map((n) => {
                const active = n === goal
                return (
                  <button
                    key={n}
                    onClick={() => setGoal(n)}
                    aria-pressed={active}
                    className="rounded-[14px] py-3 text-sm font-bold"
                    style={{
                      background: active ? 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))' : 'var(--bg)',
                      boxShadow: active ? 'var(--highlight-shadow)' : undefined,
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
            <p className="-mt-4 mb-1.5 text-xs font-semibold text-[var(--text-secondary)]">
              {goal} cards a day
            </p>
            {/* Sits immediately above the button rather than up in the body copy: this is the last
                thing read before committing, which is exactly when it does its job. Nobody should
                stall on this screen over a number they can change in ten seconds. */}
            <p className="mb-7 text-xs text-[var(--text-secondary)] opacity-80">
              (you can change this later in Settings)
            </p>
            <Primary
              onClick={() => {
                onChange({ daily_goal: goal })
                setStep(3)
              }}
            >
              Continue
            </Primary>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="mb-2 text-xl font-extrabold">Let's get some cards in</h1>
            <p className="mx-auto mb-7 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
              Rekall builds cards from photos of your notes or a PDF. Or start with a small sample
              deck to see how the answering works first.
            </p>

            {error && (
              <div className="mx-auto mb-5 max-w-sm rounded-2xl px-4 py-2.5 text-sm font-semibold"
                   style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
                {error}
              </div>
            )}

            <div className="mx-auto flex max-w-sm flex-col gap-2.5">
              <Primary onClick={startWithSample} disabled={busy}>
                {busy ? 'Setting it up…' : 'Start with a sample deck'}
              </Primary>
              <button
                onClick={() => finish(true)}
                disabled={busy}
                className="rounded-xl py-3 text-sm font-bold"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}
              >
                Add my own notes
              </button>
              <button
                onClick={() => finish(false)}
                disabled={busy}
                className="pt-1 text-xs font-semibold text-[var(--text-secondary)]"
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {/* Progress, not navigation — three dots is enough to say "this is short" without
            inviting anyone to jump around a flow whose steps depend on each other. */}
        <div className="mt-9 flex justify-center gap-1.5">
          {Array.from({ length: STEPS }, (_, i) => i).map((i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 18 : 6,
                background: i === step ? 'var(--accent)' : 'var(--ring-track)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl px-6 py-3.5 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
      style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
    >
      {children}
    </button>
  )
}
