import { useEffect, useState } from 'react'
import { getStudentProfile, listTutorVoices } from '../../api'
import type { Settings, SettingsPatch, StudentProfile, TutorVoice } from '../../types'
import { PERSONALITY_PRESETS } from '../PersonalityPicker'
import ProfileFile from '../ProfileFile'
import { Row, Section, Toggle } from './controls'

/** Tutor defaults.
 *
 * These are the same two values the composer's chips change mid-conversation — changing either
 * place writes to the same stored default, which is what makes a voice picked on a phone show up
 * on the desktop. Existing conversations keep whatever they were started with; only new ones read
 * from here.
 */
export default function TutorSection({ settings, onChange }: { settings: Settings; onChange: (patch: SettingsPatch) => void }) {
  const [voices, setVoices] = useState<TutorVoice[] | null>(null)
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)

  useEffect(() => {
    listTutorVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
    getStudentProfile()
      .then(setProfile)
      .catch(() => setProfileFailed(true))
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

      <Row label="Voice" hint="Used in voice mode.">
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
            ? 'The tutor adds to your profile when it sees the same thing in two sessions. You can change or take out anything it writes.'
            : 'The tutor keeps your profile as it is and only reads it. You can still edit it yourself.'
        }
      >
        <Toggle
          value={settings.tutor_auto_memory}
          onChange={(tutor_auto_memory) => onChange({ tutor_auto_memory })}
        />
      </Row>
      {/* The same file as the Memory chip in the tutor, with the page's width to read it in. */}
      <div className="flex flex-col gap-2 py-3.5">
        <div>
          <div className="text-[0.9375rem] font-semibold">What the tutor knows about you</div>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--text-muted)]">
            One file. The tutor reads all of it before every reply.
          </p>
        </div>
        <ProfileFile profile={profile} failed={profileFailed} onChange={setProfile} />
      </div>
    </Section>
  )
}
