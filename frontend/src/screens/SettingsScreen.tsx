import { useEffect, useState } from 'react'
import { exportUrl, listTutorVoices, logout, type Me } from '../api'
import { PERSONALITY_PRESETS } from '../components/PersonalityPicker'
import { ACCENT_PRESETS, DEFAULT_ACCENT, readCustomAccent, writeCustomAccent } from '../hooks/useAccent'
import Segmented from '../components/Segmented'
import type { GradingStrictness, Settings, SettingsPatch, Theme, TutorVoice } from '../types'

interface Props {
  me: Me
  settings: Settings | null
  error: string | null
  onChange: (patch: SettingsPatch) => void
  /** Opens the owner-only usage dashboard. The entry point is hidden for everyone else, and the
   * endpoint behind it 404s for them regardless — this only saves them a door they can't open. */
  onOpenAdmin: () => void
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
  { title: 'Account', rows: ['Tier & usage', 'Billing'] },
]

export default function SettingsScreen({ me, settings, error, onChange, onOpenAdmin }: Props) {
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
      {error && (
        <div className="rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
        </div>
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
                  className="h-7 w-7 rounded-[var(--r-full)]"
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
                className="h-7 w-7 rounded-[var(--r-full)]"
                style={{
                  background: customAccent,
                  outline: (settings.accent ?? DEFAULT_ACCENT) === customAccent ? '2px solid var(--text)' : undefined,
                  outlineOffset: 2,
                }}
              />
            )}
            <label
              title="Custom color"
              className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--r-full)] border-[1.5px] border-dashed border-[var(--text-muted)] text-[var(--text-muted)]"
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

        <Row label="Session size" hint="Caps the whole queue. Due cards are kept before new ones.">
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
          hint="Everything, in one file. CSV opens in a spreadsheet and can be imported back here. JSON also keeps each card's review schedule."
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

/** Tutor defaults.
 *
 * These are the same two values the composer's chips change mid-conversation — changing either
 * place writes to the same stored default, which is what makes a voice picked on a phone show up
 * on the desktop. Existing conversations keep whatever they were started with; only new ones read
 * from here.
 */
function TutorSection({ settings, onChange }: { settings: Settings; onChange: (patch: SettingsPatch) => void }) {
  const [voices, setVoices] = useState<TutorVoice[] | null>(null)

  useEffect(() => {
    listTutorVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
  }, [])

  return (
    <Section title="Tutor">
      <Row label="Personality" hint="How the tutor talks to you. New conversations start here.">
        <div className="flex w-full flex-col">
          {PERSONALITY_PRESETS.map((preset) => {
            const active = settings.tutor_personality === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => onChange({ tutor_personality: preset.id })}
                aria-pressed={active}
                className="flex items-start gap-3 rounded-[var(--r-sm)] py-2.5 text-left"
              >
                <span aria-hidden className="mt-1.5 block h-2 w-2 flex-shrink-0 rounded-[var(--r-full)]" style={{ background: active ? 'var(--accent)' : 'var(--rule)' }} />
                <div>
                <div className="text-sm font-bold" style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                  {preset.label}
                </div>
                <div className="text-xs text-[var(--text-muted)]">{preset.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </Row>

      {settings.tutor_personality === 'custom' && (
        <Row label="Custom instructions" hint="Added to the tutor's own base instructions, not replacing them.">
          <textarea
            defaultValue={settings.tutor_custom_prompt ?? ''}
            // Saved on blur rather than per keystroke: a PATCH per character would be absurd, and
            // debouncing a free-text field just moves the same problem behind a timer.
            onBlur={(e) => {
              const next = e.target.value.trim() || null
              if (next !== settings.tutor_custom_prompt) onChange({ tutor_custom_prompt: next })
            }}
            rows={4}
            placeholder="e.g. Always give a worked example before asking me anything."
            className="w-full resize-none rounded-[var(--r-sm)] px-3.5 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg)' }}
          />
        </Row>
      )}

      <Row label="Voice" hint="Used in voice mode and when the tutor reads a reply aloud.">
        <select
          value={settings.tutor_voice_id ?? ''}
          onChange={(e) => onChange({ tutor_voice_id: e.target.value || null })}
          className="w-full rounded-[var(--r-sm)] px-3.5 py-2.5 text-sm outline-none"
          style={{ background: 'var(--bg)' }}
        >
          <option value="">{voices === null ? 'Loading voices…' : 'Default voice'}</option>
          {voices?.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
              {voice.description ? ` — ${voice.description}` : ''}
            </option>
          ))}
        </select>
      </Row>

      <Row
        label="Let the tutor remember"
        hint={
          settings.tutor_auto_memory
            ? 'The tutor notes what it learns about how you study. Everything it writes is marked "auto" in Memory, and you can delete any of it.'
            : 'The tutor only remembers the notes you write yourself in Memory.'
        }
      >
        <Toggle
          value={settings.tutor_auto_memory}
          onChange={(tutor_auto_memory) => onChange({ tutor_auto_memory })}
        />
      </Row>
    </Section>
  )
}

/** The four AI toggles, behind one master switch.
 *
 * The master is derived (`anyOn`) rather than stored: a fifth boolean would be a second source of
 * truth for the same question and would eventually disagree with the four it claims to control.
 * Flipping it writes all four at once; the sub-toggles stay independently adjustable afterwards,
 * which is the point — "no AI" and "no AI except grading" are both positions people hold.
 *
 * Every one of these is enforced server-side too. A hidden button is a preference; someone who
 * turns AI off is entitled to a guarantee.
 */
function AISection({ settings, onChange }: { settings: Settings; onChange: (patch: SettingsPatch) => void }) {
  const anyOn = settings.ai_grading || settings.ai_generation || settings.ai_tutor || settings.ai_voice
  // Open when something is off, so a partial configuration is visible rather than hidden behind a
  // master switch that reads as a plain "on".
  const allOn = settings.ai_grading && settings.ai_generation && settings.ai_tutor && settings.ai_voice
  const [open, setOpen] = useState(!allOn)

  const setAll = (on: boolean) =>
    onChange({ ai_grading: on, ai_generation: on, ai_tutor: on, ai_voice: on })

  return (
    <Section title="AI features">
      <Row
        label="AI features"
        hint={anyOn ? 'Turn everything off in one go, then re-enable anything you want back.' : 'All AI is off. Cards are self-graded and made by hand.'}
      >
        <Toggle value={anyOn} onChange={setAll} />
      </Row>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-3.5 text-[0.9375rem] font-semibold"
      >
        {open ? 'Hide individual features' : 'Choose individually'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'} />
        </svg>
      </button>

      {open && (
        <>
          <Row label="Card grading" hint="Off: you see the answer and rate your own recall, like paper flashcards.">
            <Toggle value={settings.ai_grading} onChange={(ai_grading) => onChange({ ai_grading })} />
          </Row>
          <Row label="Card generation & note text" hint="Off: no cards made from photos or PDFs, and photos aren't read into searchable text. Notes still upload and open normally, and you can still write cards yourself or import a CSV.">
            <Toggle value={settings.ai_generation} onChange={(ai_generation) => onChange({ ai_generation })} />
          </Row>
          <Row label="Tutor mode" hint="Off: the Tutor tab stops working. Nothing pretends to replace it.">
            <Toggle value={settings.ai_tutor} onChange={(ai_tutor) => onChange({ ai_tutor })} />
          </Row>
          <Row label="Voice mode" hint="Off: no speech in or out. Tutor mode still works by typing.">
            <Toggle value={settings.ai_voice} onChange={(ai_voice) => onChange({ ai_voice })} />
          </Row>
        </>
      )}
    </Section>
  )
}

/** One surface per region. Rows inside are separated by inset rules, not by their own boxes. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[0.9375rem] font-bold">{title}</div>
      <div className="flex flex-col rounded-[var(--r-md)] bg-[var(--surface)] px-4 [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
        {children}
      </div>
    </section>
  )
}

/** Label and control share a line when the control is compact; the hint sits under both. */
/** `hint` is optional: a row whose hint only restates its own label is quieter without one, and
 * the design draws Settings as mostly bare label-and-control rows. Keep a hint where it carries
 * something the control can't say by itself. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
function Stepper({
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
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => set(value - step)}
        disabled={value <= min}
        aria-label="Decrease"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-lg text-[var(--text-muted)] disabled:opacity-40"
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
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] text-lg text-[var(--text-muted)] disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}


/** A plain on/off switch. Distinct from Segmented because a binary choice with two labels reads
 * as two options to pick between; a switch reads as one thing that is on or off. */
function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
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
