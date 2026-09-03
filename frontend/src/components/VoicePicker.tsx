import type { TutorVoice } from '../types'

interface Props {
  voiceId: string | null
  voices: TutorVoice[] | null
  onChange: (voiceId: string) => void
}

export default function VoicePicker({ voiceId, voices, onChange }: Props) {
  return (
    <div className="w-72 rounded-[var(--r-md)] border border-[var(--rule)] bg-[var(--surface)] p-4">
      <div className="mb-2 text-[0.9375rem] font-bold">Voice</div>
      {voices === null ? (
        <p className="text-xs text-[var(--text-muted)]">Loading…</p>
      ) : (
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {voices.map((v, i) => {
            const active = voiceId ? voiceId === v.id : i === 0
            return (
              <button
                key={v.id}
                onClick={() => onChange(v.id)}
                aria-pressed={active}
                className="flex items-start gap-3 rounded-[var(--r-sm)] py-2.5 text-left"
              >
                <span aria-hidden className="mt-1.5 block h-2 w-2 flex-shrink-0 rounded-[var(--r-full)]" style={{ background: active ? 'var(--accent)' : 'var(--rule)' }} />
                <div>
                  <div className="text-sm font-bold" style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                    {v.name}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{v.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
