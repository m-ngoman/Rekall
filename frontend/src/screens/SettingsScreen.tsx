import { useEffect, useState } from 'react'
import { exportUrl, getBillingStatus, logout } from '../api'
import { ACCENT_PRESETS, DEFAULT_ACCENT, readCustomAccent, writeCustomAccent } from '../lib/accent'
import Segmented from '../components/Segmented'
import Notice from '../components/Notice'
import type { BillingStatus, GradingStrictness, Me, Settings, SettingsPatch, Theme } from '../types'
import { Row, Section, Stepper, Toggle } from '../components/settings/controls'
import TutorSection from '../components/settings/TutorSection'
import AISection from '../components/settings/AISection'

interface Props {
  me: Me
  settings: Settings | null
  error: string | null
  onChange: (patch: SettingsPatch) => void
  /** Opens the owner-only usage dashboard. The entry point is hidden for everyone else, and the
   * endpoint behind it 404s for them regardless — this only saves them a door they can't open. */
  onOpenAdmin: () => void
  /** Opens the plans screen. Same disclosure-row idiom as the usage dashboard. */
  onOpenPricing: () => void
}

const STRICTNESS: { value: GradingStrictness; label: string }[] = [
  { value: 'lenient', label: 'Lenient' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'strict', label: 'Strict' },
]

// Only ever describes what happens to *partly* right answers. A wrong answer is Forgot at every
// setting, so promising otherwise here would be a lie about what the control does.
const STRICTNESS_HINTS: Record<GradingStrictness, string> = {
  lenient: 'A half-remembered answer still counts as knowing it.',
  balanced: 'A half-remembered answer counts as hard, and comes back sooner.',
  strict: 'Only a complete answer counts. Half-remembered is treated as forgotten.',
}

const SPEEDS: { value: number; label: string }[] = [
  { value: 75, label: '0.75x' },
  { value: 100, label: '1x' },
  { value: 125, label: '1.25x' },
  { value: 150, label: '1.5x' },
]

/** Presets rather than a free number: the useful choices are "never let a card vanish for
 * longer than X", and X is realistically a month, a term, or a year. */
const MAX_INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 30, label: '1 mo' },
  { value: 90, label: '3 mo' },
  { value: 365, label: '1 yr' },
]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Still-unbuilt areas, kept as one quiet roadmap card rather than six stub panels — six greyed-out
 * sections read as a broken settings screen competing with the ones that work. */
const ROADMAP: { title: string; rows: string[] }[] = [
  { title: 'Notifications', rows: ['Daily reminder time', 'Streak reminders', 'Per-deck reminders'] },
  { title: 'Data & account', rows: ['Google Drive sync', 'Notes storage'] },
]

export default function SettingsScreen({ me, settings, error, onChange, onOpenAdmin, onOpenPricing }: Props) {
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  useEffect(() => {
    getBillingStatus()
      .then(setBilling)
      .catch(() => setBilling(null))
  }, [])
  // Progressive disclosure: the scheduler's knobs are genuinely useful but nobody should have to
  // scroll past them to reach the daily goal.
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Seeded from the accent in force when it isn't one of the presets, so a colour chosen on
  // another device still shows up here rather than only ones picked on this one.
  const [customAccent, setCustomAccent] = useState<string | null>(() => {
    const inForce = settings?.accent
    if (inForce && !ACCENT_PRESETS.some((p) => p.value === inForce)) return inForce
    return readCustomAccent()
  })

  if (!settings) {
    return <p className="text-sm text-[var(--text-muted)]">{error ?? 'Loading…'}</p>
  }

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10">
      {/* Spans both columns on desktop: a failure that only covers half the page reads as
          belonging to the section beneath it rather than to the screen. */}
      {error && (
        <Notice tone="error" className="lg:col-span-2" action={{ label: 'Retry', onClick: () => window.location.reload() }}>
          {error}
        </Notice>
      )}

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            options={THEMES}
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
          />
        </Row>

        <Row label="Accent">
          <div className="flex flex-wrap gap-2.5 py-1">
            {ACCENT_PRESETS.map((preset) => {
              const active = (settings.accent ?? DEFAULT_ACCENT) === preset.value
              return (
                <button
                  key={preset.name}
                  onClick={() => onChange({ accent: preset.value })}
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={active}
                  className="h-9 w-9 rounded-[var(--r-full)]"
                  style={{ background: preset.value, outline: active ? '2px solid var(--text)' : undefined, outlineOffset: 2 }}
                />
              )
            })}
            {/* The colour you picked keeps its place in the row — selectable again with one tap,
                and visibly the active one, which nothing showed before. */}
            {customAccent && (
              <button
                onClick={() => onChange({ accent: customAccent })}
                title="Your colour"
                aria-label="Your colour"
                aria-pressed={(settings.accent ?? DEFAULT_ACCENT) === customAccent}
                className="h-9 w-9 rounded-[var(--r-full)]"
                style={{
                  background: customAccent,
                  outline: (settings.accent ?? DEFAULT_ACCENT) === customAccent ? '2px solid var(--text)' : undefined,
                  outlineOffset: 2,
                }}
              />
            )}
            <label
              title="Custom color"
              className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--r-full)] border-[1.5px] border-dashed border-[var(--text-muted)] text-[var(--text-muted)]"
            >
              <span className="text-sm font-bold">+</span>
              <input
                type="color"
                // Opens the wheel on the colour you already chose rather than black. Only a hex
                // value is legal here: the swatch beside it can render any CSS colour, but a
                // seeded `oklch(...)` accent would silently reset this input to black.
                value={customAccent && /^#[0-9a-f]{6}$/i.test(customAccent) ? customAccent : '#e8825d'}
                onChange={(e) => {
                  setCustomAccent(e.target.value)
                  writeCustomAccent(e.target.value)
                  onChange({ accent: e.target.value })
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </Row>
      </Section>

      <Section title="Study behavior">
        <Row label="New cards per day">
          <Stepper
            value={settings.new_cards_per_day}
            min={0}
            max={500}
            step={5}
            onChange={(new_cards_per_day) => onChange({ new_cards_per_day })}
          />
        </Row>

        <Row label="Session size" hint="Caps the whole queue. Due cards are kept before new ones. Lifted for decks with an exam coming up, so the pacing still fits everything in.">
          <Stepper
            value={settings.session_size}
            min={0}
            max={1000}
            step={5}
            zeroLabel="No limit"
            onChange={(session_size) => onChange({ session_size })}
          />
        </Row>

        <Row label="Grading" hint={`Wrong answers always count as forgotten. ${STRICTNESS_HINTS[settings.grading_strictness]}`}>
          <Segmented
            options={STRICTNESS}
            value={settings.grading_strictness}
            onChange={(grading_strictness) => onChange({ grading_strictness })}
          />
        </Row>

        <Row label="Daily goal" hint="Caps how many cards Home counts as due today. 0 uses everything due.">
          <Stepper
            value={settings.daily_goal}
            min={0}
            max={1000}
            step={5}
            zeroLabel="Everything due"
            onChange={(daily_goal) => onChange({ daily_goal })}
          />
        </Row>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex w-full items-center justify-between py-3.5 text-[0.9375rem] font-semibold"
        >
          {showAdvanced ? 'Hide scheduling details' : 'Scheduling details'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={showAdvanced ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'} />
          </svg>
        </button>

        {showAdvanced && (
          <>
            <Row
              label="Target retention"
              hint={`How likely you want to be to remember a card when it comes back. Lower means longer gaps and fewer reviews — and more forgetting. ${
                settings.fsrs_retention_pct >= 93
                  ? 'At this level you will see cards often.'
                  : settings.fsrs_retention_pct <= 84
                    ? 'At this level expect to forget a fair few.'
                    : '90% is the standard balance.'
              }`}
            >
              <Stepper
                value={settings.fsrs_retention_pct}
                min={80}
                max={95}
                step={1}
                format={(v) => `${v}%`}
                onChange={(fsrs_retention_pct) => onChange({ fsrs_retention_pct })}
              />
            </Row>

            <Row
              label="Maximum interval"
              hint="The longest a card can disappear for. Useful when an exam is months out and you'd rather not lose sight of anything."
            >
              <Segmented
                options={MAX_INTERVALS}
                value={settings.fsrs_max_interval_days}
                onChange={(fsrs_max_interval_days) => onChange({ fsrs_max_interval_days })}
              />
            </Row>

            <p className="py-3 text-xs leading-relaxed text-[var(--text-muted)]">
              Both apply from your next review onward — cards already scheduled keep the date they
              have, and nothing you've learned is reset.
            </p>
          </>
        )}
      </Section>

      <Section title="Voice & audio">
        <Row label="Playback speed" hint="How fast the tutor speaks. Pitch is preserved.">
          <Segmented
            options={SPEEDS}
            value={settings.tts_speed_pct}
            onChange={(tts_speed_pct) => onChange({ tts_speed_pct })}
          />
        </Row>

        <Row
          label="Push to talk"
          hint={
            settings.push_to_talk
              ? 'The mic stays open until you tap it again.'
              : 'Your turn ends automatically when you stop speaking.'
          }
        >
          <Toggle value={settings.push_to_talk} onChange={(push_to_talk) => onChange({ push_to_talk })} />
        </Row>

        {/* Both of these only govern automatic turn-ending, so they're meaningless while
            push-to-talk is on — hidden rather than disabled, since a greyed-out control invites
            you to wonder what's wrong with it. */}
        {!settings.push_to_talk && (
          <>
            <Row label="Mic sensitivity" hint="Lower picks up quieter speech. Raise it in a noisy room.">
              <Stepper
                value={settings.mic_sensitivity}
                min={1}
                max={60}
                step={2}
                onChange={(mic_sensitivity) => onChange({ mic_sensitivity })}
              />
            </Row>

            <Row label="Pause before your turn ends" hint="Raise this if you get cut off while thinking.">
              <Stepper
                value={settings.mic_silence_ms}
                min={400}
                max={5000}
                step={250}
                format={(v) => `${(v / 1000).toFixed(2).replace(/0$/, '')}s`}
                onChange={(mic_silence_ms) => onChange({ mic_silence_ms })}
              />
            </Row>
          </>
        )}
      </Section>

      <TutorSection settings={settings} onChange={onChange} />

      <Section title="Your data">
        <Row
          label="Export your cards"
          hint="Every deck and card, in one file. CSV opens in a spreadsheet and can be imported back here. JSON also records each card's review schedule."
        >
          <div className="flex gap-2.5">
            {/* Anchors rather than buttons + fetch: the browser's own download handling is the
                only thing that reliably offers to save a file on iOS. */}
            <a
              href={exportUrl(null, 'csv')}
              download
              className="flex-1 whitespace-nowrap rounded-[var(--r-sm)] px-3 py-2.5 text-center text-[0.8125rem] font-bold"
              style={{ background: 'var(--bg)', color: 'var(--text)' }}
            >
              Download CSV
            </a>
            <a
              href={exportUrl(null, 'json')}
              download
              className="flex-1 whitespace-nowrap rounded-[var(--r-sm)] px-3 py-2.5 text-center text-[0.8125rem] font-bold"
              style={{ background: 'var(--bg)', color: 'var(--text)' }}
            >
              Download JSON
            </a>
          </div>
        </Row>
      </Section>

      <Section title="Account">
        <div className="flex items-center gap-3.5 py-3.5">
          {me.avatar_url ? (
            <img src={me.avatar_url} alt="" className="h-10 w-10 flex-shrink-0 rounded-[var(--r-full)]" />
          ) : (
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--r-full)] text-base font-bold"
              style={{ background: 'var(--rule)', color: 'var(--text)' }}
            >
              {(me.name || me.email || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {me.name && <div className="truncate text-sm font-bold">{me.name}</div>}
            <div className="truncate text-xs text-[var(--text-muted)]">{me.email}</div>
          </div>
          <button
            onClick={async () => {
              await logout()
              // Full reload rather than clearing React state: it drops every cached value at once
              // and guarantees no fragment of the previous account is left on screen.
              window.location.href = '/'
            }}
            className="flex-shrink-0 py-2 text-[0.875rem] font-bold text-[var(--text-muted)]"
          >
            Sign out
          </button>
        </div>

        {billing && (
          <>
            <div className="flex items-baseline justify-between gap-4 py-3.5">
              <span className="text-[0.9375rem] font-semibold">Rekall AI</span>
              <span className="text-[0.875rem] text-[var(--text-muted)]">
                {billing.tier === 'friend'
                  ? 'Included'
                  : billing.text_ai_lifetime
                    ? 'Yours, forever'
                    : billing.text_ai
                      ? 'Active'
                      : 'Not active'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3.5">
              <span className="text-[0.9375rem] font-semibold">Voice</span>
              <span className="text-[0.875rem] text-[var(--text-muted)]">
                {billing.tier === 'friend' ? 'Included' : `${billing.voice_hours} h left`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3.5">
              <span className="text-[0.9375rem] font-semibold">Card generation</span>
              <span className="text-[0.875rem] text-[var(--text-muted)]">
                {billing.tier === 'friend'
                  ? 'Included'
                  : `${billing.generation_pages_today} pages left today` +
                    (billing.generation_pages ? ` · ${billing.generation_pages} bought` : '')}
              </span>
            </div>
          </>
        )}
        <button onClick={onOpenPricing} className="flex w-full items-center justify-between py-3.5 text-[0.9375rem] font-semibold">
          Plans
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>

        {/* Owner only, and it lives in Account rather than getting its own section: it is a
            property of who is signed in, not a preference anyone can change. Same disclosure row
            as "Scheduling details" — a muted chevron, not an accent link. */}
        {me.is_owner && (
          <button onClick={onOpenAdmin} className="flex w-full items-center justify-between py-3.5 text-[0.9375rem] font-semibold">
            Usage dashboard
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </Section>

      <AISection settings={settings} onChange={onChange} />

      <section>
        <div className="mb-2 text-[0.9375rem] font-bold">Not built yet</div>
        <div className="border-t border-[var(--rule)]">
          {ROADMAP.map((group) => (
            <div key={group.title} className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3">
              <div className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">{group.title}</div>
              <div className="text-right text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">{group.rows.join(', ')}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
