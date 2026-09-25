import MemoryPicker from '../MemoryPicker'
import PersonalityPicker, { PERSONALITY_PRESETS } from '../PersonalityPicker'
import VoicePicker from '../VoicePicker'
import type { MemoryCategory, MemoryNote, Settings, TutorPersonality, TutorSession, TutorVoice } from '../../types'
import type { Popover } from './types'

/** Derived from the picker's own presets rather than restated here — two hand-written copies of
 * the same five labels is exactly the kind of pair that quietly disagrees after a rename. */
const PERSONALITY_LABELS = Object.fromEntries(
  PERSONALITY_PRESETS.map((p) => [p.id, p.label]),
) as Record<TutorPersonality, string>

const MEMORY_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3.5h11a1 1 0 0 1 1 1V21l-6.5-3L4.5 21V4.5a1 1 0 0 1 1-1z" />
    <path d="M8.5 8h6" />
  </svg>
)

const PERSONALITY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 16.6l-1.9-4.9L5.2 9.8l4.9-1.9L12 3z" />
    <path d="M19 15l.8 2.1L22 18l-2.2.9L19 21l-.8-2.1L16 18l2.2-.9L19 15z" />
  </svg>
)

const VOICE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="M16 8a5 5 0 0 1 0 8" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
)

/** The composer's chips: tutor style, voice and memory, each opening its picker.
 *
 * The chips. They wrap among themselves on a narrow phone rather than squeezing until
 * their labels break apart: the design draws them as flat text chips, and an icon
 * alone doesn't say which style or voice is selected. */
export default function ComposerChips({
  session,
  settings,
  voices,
  voiceName,
  memoryNotes,
  open,
  onToggle,
  onPersonalityChange,
  onVoiceChange,
  onAddMemory,
  onDeleteMemory,
}: {
  session: TutorSession | null
  settings: Settings | null
  voices: TutorVoice[] | null
  voiceName: string | undefined
  memoryNotes: MemoryNote[] | null
  open: Popover | null
  onToggle: (which: Popover) => void
  onPersonalityChange: (personality: TutorPersonality, customPrompt?: string) => void
  onVoiceChange: (voiceId: string) => void
  onAddMemory: (category: MemoryCategory, content: string) => void
  onDeleteMemory: (id: string) => void
}) {
  return (
    <div className="relative z-20 flex flex-wrap items-end gap-1.5">
      <div className="relative">
        <button
          onClick={() => onToggle('personality')}
          aria-label={`Tutor style${session ? ': ' + PERSONALITY_LABELS[session.personality] : ''}`}
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
          style={{ background: open === 'personality' ? 'var(--bg)' : undefined }}
        >
          {PERSONALITY_ICON}
          {/* The value shows at every width: the design draws these as flat text chips
              ("Socratic", "Voice: Ada", "Memory"), and an icon alone doesn't say which
              style is selected. The row wraps rather than squeezing, so a narrow phone
              gets a second line instead of unlabelled glyphs. */}
          {/* Falls back to the saved default while the session request is in flight. A
              new session is created *from* that default, so this is the same word it will
              show a moment later — without it the chip grows when the response lands and
              shoves the composer's controls around. */}
          {(session?.personality ?? settings?.tutor_personality) && (
            <span className="inline">
              {PERSONALITY_LABELS[(session?.personality ?? settings?.tutor_personality)!]}
            </span>
          )}
        </button>
        {open === 'personality' && session && (
          <>
            <div className="absolute bottom-12 left-0 z-20">
              <PersonalityPicker
                personality={session.personality}
                customPrompt={session.custom_prompt ?? ''}
                onChange={onPersonalityChange}
              />
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => onToggle('voice')}
          aria-label={`Voice${voiceName ? ': ' + voiceName : ''}`}
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
          style={{ background: open === 'voice' ? 'var(--bg)' : undefined }}
        >
          {VOICE_ICON}
          {voiceName ? <span className="inline">{voiceName}</span> : null}
        </button>
        {open === 'voice' && session && (
          <>
            <div className="absolute bottom-12 left-0 z-20">
              <VoicePicker voiceId={session.voice_id} voices={voices} onChange={onVoiceChange} />
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => onToggle('memory')}
          aria-label={`Tutor memory: ${memoryNotes?.length ?? 0} saved`}
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
          style={{ background: open === 'memory' ? 'var(--bg)' : undefined }}
        >
          {MEMORY_ICON}
          {/* Always "Memory", with the count beside it. It used to turn into "6 notes" once
              anything was saved, which put a second meaning of "notes" one tab away from the
              Notes tab and its "No notes yet": two different things under one word. Named even
              at zero, like its neighbours, because an unlabelled glyph in a row of labelled
              chips reads as a different kind of control. */}
          <span className="inline">Memory</span>
          {memoryNotes && memoryNotes.length > 0 && <span className="font-bold tabular-nums">{memoryNotes.length}</span>}
        </button>
        {open === 'memory' && (
          <>
            <div className="absolute bottom-12 left-0 z-20">
              <MemoryPicker notes={memoryNotes} onAdd={onAddMemory} onDelete={onDeleteMemory} />
            </div>
          </>
        )}
      </div>

    </div>
  )
}
