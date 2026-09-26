import type { TutorVoice } from '../types'

interface Props {
  voiceId: string | null
  voices: TutorVoice[] | null
  onChange: (voiceId: string) => void
}

export default function VoicePicker({ voiceId, voices, onChange }: Props) {
  // As wide as the composer's chip row on a phone and 288px from sm up. Never taller than the room
  // above the row, which a short phone with the row on three lines doesn't have for the whole
  // list: the list is what gives, so the heading stays in view.
  return (
    <div className="flex max-h-[calc(100dvh-16rem)] w-full flex-col rounded-[var(--r-md)] border border-[var(--rule)] bg-[var(--surface)] p-4 sm:w-72">
      <div className="mb-2 text-[0.9375rem] font-bold">Voice</div>
      {voices === null ? (
        <p className="text-xs text-[var(--text-muted)]">Loading…</p>
      ) : (
        <div className="flex max-h-64 min-h-0 flex-col overflow-y-auto">
          {voices.map((v) => {
            // Falls back to the server's own default rather than to the first row. Those were the
            // same voice until the curated list was reordered by preference, at which point a
            // fresh account would have seen one name selected and heard another.
            const active = voiceId ? voiceId === v.id : v.is_default
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
