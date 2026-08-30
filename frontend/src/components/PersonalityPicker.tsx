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
    <div className="w-72 rounded-[18px] bg-[var(--bg-card)] p-5" style={{ boxShadow: 'var(--shadow-lg)' }}>
      <div className="mb-3.5 text-sm font-bold">Personality</div>
      <div className="flex flex-col gap-1">
        {PERSONALITY_PRESETS.map((p) => {
          const active = personality === p.id
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id, p.id === 'custom' ? draft : undefined)}
              className="rounded-2xl px-3.5 py-2.5 text-left"
              style={
                active
                  ? { background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))', boxShadow: 'var(--highlight-shadow)' }
                  : undefined
              }
            >
              <div className="text-sm font-bold" style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>
                {p.label}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">{p.description}</div>
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
          className="mt-3 min-h-[80px] w-full rounded-2xl bg-[var(--bg)] p-3 text-xs outline-none"
        />
      )}
    </div>
  )
}
