import { useState } from 'react'
import { createSampleDeck } from '../api'
import Logo from '../components/Logo'
import Notice from '../components/Notice'
import type { SettingsPatch } from '../types'

interface Props {
  onChange: (patch: SettingsPatch) => void
  /** Where to go once this is done: a session on the sample deck, the Cards tab, or Home. */
  onFinish: (next: { goToCards?: boolean; studyDeckId?: string }) => void
}

/**
 * First run. One screen, and its first button is a question.
 *
 * An empty study app can't demonstrate itself, and the usual first-run failure is asking someone
 * to set things up before they've seen why they'd bother. This used to be four steps, with the
 * theme, the accent colour and a daily target all ahead of the sample deck. Pleasant, but the
 * thing that shows what Rekall is for is answering one question in your own words and seeing
 * what the grader makes of it, so that comes first: the sample deck is made and opened in one
 * tap. Appearance and the daily goal live in Settings, where they always also were, and both
 * already have defaults that work. Everything here is skippable; nothing is asked twice.
 */
export default function OnboardingScreen({ onChange, onFinish }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = (next: { goToCards?: boolean; studyDeckId?: string }) => {
    onChange({ onboarded: true })
    onFinish(next)
  }

  const trySample = async () => {
    setBusy(true)
    setError(null)
    try {
      const deck = await createSampleDeck()
      finish({ studyDeckId: deck.id })
    } catch {
      setError("Couldn't set that up — you can still add your own cards.")
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <div className="rounded-[var(--r-md)] bg-[var(--surface)] px-7 py-12 text-center">
        <div className="mb-5 flex justify-center">
          <Logo size={92} />
        </div>
        <h1 className="mb-2 text-[1.375rem] font-bold tracking-tight">Welcome to Rekall</h1>
        <p className="mx-auto mb-7 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
          Most flashcard apps ask whether you got it right. Rekall reads what you actually
          wrote, and tells you what you missed. See for yourself on a few sample cards.
        </p>

        {error && (
          <Notice tone="error" className="mx-auto mb-5 max-w-sm text-left">
            {error}
          </Notice>
        )}

        <div className="mx-auto flex max-w-sm flex-col gap-2.5">
          <button
            onClick={trySample}
            disabled={busy}
            className="on-accent w-full rounded-[var(--r-full)] px-6 py-4 text-[1.0625rem] font-bold disabled:opacity-50"
          >
            {busy ? 'Setting it up' : 'Try a sample question'}
          </button>
          <button
            onClick={() => finish({ goToCards: true })}
            disabled={busy}
            className="min-h-[44px] rounded-[var(--r-full)] border border-[var(--rule)] px-6 py-3 text-[0.9375rem] font-bold text-[var(--text)]"
          >
            Add my own cards
          </button>
          <button
            onClick={() => finish({})}
            disabled={busy}
            className="min-h-[44px] pt-1 text-[0.875rem] font-semibold text-[var(--text-muted)]"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
