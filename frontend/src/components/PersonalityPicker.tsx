import { useState } from 'react'
import type { TutorPersonality } from '../types'

/** Exported so Settings can render the same names and descriptions without a second copy that
 * drifts. The popover shell below stays private — it's shaped for the composer, not for a row in
 * a settings list. */
export const PERSONALITY_PRESETS: { id: TutorPersonality; label: string; description: string }[] = [
  { id: 'direct', label: 'Direct', description: 'Explains freely, actually teaches' },
  { id: 'strict_socratic', label: 'Socratic', description: 'Guides with questions, never gives the answer' },
  { id: 'encouraging', label: 'Encouraging', description: 'Warm and patient, celebrates progress' },
  { id: 'terse', label: 'Terse', description: 'Minimal chat, moves fast' },
  { id: 'custom', label: 'Custom', description: 'Write your own instructions' },
]

interface Props {
  personality: TutorPersonality
  customPrompt: string
  onChange: (personality: TutorPersonality, customPrompt?: string) => void
}

export default function PersonalityPicker({ personality, customPrompt, onChange }: Props) {
  const [draft, setDraft] = useState(customPrompt)

  return (
    <div className="w-72 rounded-[var(--r-md)] border border-[var(--rule)] bg-[var(--surface)] p-4">
      <div className="mb-2 text-[0.9375rem] font-bold">Personality</div>
      <div className="flex flex-col">
        {PERSONALITY_PRESETS.map((p) => {
          const active = personality === p.id
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id, p.id === 'custom' ? draft : undefined)}
              aria-pressed={active}
              className="flex items-start gap-3 rounded-[var(--r-sm)] py-2.5 text-left"
            >
              {/* Same row as the Settings presets: the dot is the selection, not a wash. */}
              <span aria-hidden className="mt-1.5 block h-2 w-2 flex-shrink-0 rounded-[var(--r-full)]" style={{ background: active ? 'var(--accent)' : 'var(--rule)' }} />
              <div>
                <div className="text-sm font-bold" style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                  {p.label}
                </div>
                <div className="text-xs text-[var(--text-muted)]">{p.description}</div>
              </div>
            </button>
          )
        })}
      </div>
      {personality === 'custom' && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange('custom', draft)}
          placeholder="e.g. Focus only on quizzing me, never explain unless I ask twice…"
          className="mt-3 min-h-[80px] w-full rounded-[var(--r-sm)] bg-[var(--bg)] p-3 text-xs"
        />
      )}
    </div>
  )
}
