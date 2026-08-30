import type { TutorVoice } from '../types'

interface Props {
  voiceId: string | null
  voices: TutorVoice[] | null
  onChange: (voiceId: string) => void
}

export default function VoicePicker({ voiceId, voices, onChange }: Props) {
  return (
    <div className="w-72 rounded-[18px] bg-[var(--bg-card)] p-5" style={{ boxShadow: 'var(--shadow-lg)' }}>
      <div className="mb-3.5 text-sm font-bold">Voice</div>
      {voices === null ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {voices.map((v, i) => {
            const active = voiceId ? voiceId === v.id : i === 0
            return (
              <button
                key={v.id}
                onClick={() => onChange(v.id)}
                className="rounded-2xl px-3.5 py-2.5 text-left"
                style={
                  active
                    ? { background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))', boxShadow: 'var(--highlight-shadow)' }
                    : undefined
                }
              >
                <div className="text-sm font-bold" style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>
                  {v.name}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">{v.description}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
