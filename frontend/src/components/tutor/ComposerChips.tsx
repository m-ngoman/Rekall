import MemoryPicker from '../MemoryPicker'
import PersonalityPicker, { PERSONALITY_PRESETS } from '../PersonalityPicker'
import VoicePicker from '../VoicePicker'
import type { MemoryCategory, MemoryNote, Settings, StudentProfile, TutorPersonality, TutorSession, TutorVoice } from '../../types'
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

/** A fresh page with a pen — "start a new one", not a plus, which reads as "add an attachment"
 * in a row that already has one of those. */
const NEW_CHAT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
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
  profile,
  open,
  onToggle,
  onPersonalityChange,
  onVoiceChange,
  onAddMemory,
  onDeleteMemory,
  onDeleteProfileLine,
  onNewConversation,
}: {
  session: TutorSession | null
  settings: Settings | null
  voices: TutorVoice[] | null
  voiceName: string | undefined
  memoryNotes: MemoryNote[] | null
  /** The tutor's own reading of the student, kept apart from the notes they wrote. */
  profile: StudentProfile | null
  open: Popover | null
  onToggle: (which: Popover) => void
  onPersonalityChange: (personality: TutorPersonality, customPrompt?: string) => void
  onVoiceChange: (voiceId: string) => void
  onAddMemory: (category: MemoryCategory, content: string) => void
  onDeleteMemory: (id: string) => void
  onDeleteProfileLine: (text: string) => void
  /** Offered only once there is something to leave behind; null hides the chip. */
  onNewConversation: (() => void) | null
}) {
  const memoryCount = (memoryNotes?.length ?? 0) + (profile?.lines.length ?? 0)
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
          aria-label={`Tutor memory: ${memoryCount} saved`}
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
          style={{ background: open === 'memory' ? 'var(--bg)' : undefined }}
        >
          {MEMORY_ICON}
          {/* Always "Memory", with the count beside it. It used to turn into "6 notes" once
              anything was saved, which put a second meaning of "notes" one tab away from the
              Notes tab and its "No notes yet": two different things under one word. Named even
              at zero, like its neighbours, because an unlabelled glyph in a row of labelled
              chips reads as a different kind of control. The count covers both halves of the
              panel — what you told it and what it has noticed — because the question the chip
              answers is "how much does it hold about me", not one of the two. */}
          <span className="inline">Memory</span>
          {memoryCount > 0 && <span className="font-bold tabular-nums">{memoryCount}</span>}
        </button>
        {open === 'memory' && (
          <>
            <div className="absolute bottom-12 left-0 z-20">
              <MemoryPicker
                notes={memoryNotes}
                profile={profile}
                onAdd={onAddMemory}
                onDelete={onDeleteMemory}
                onDeleteProfileLine={onDeleteProfileLine}
              />
            </div>
          </>
        )}
      </div>

      {/* Only once there is something to leave behind. On an empty log it would be a
          button that does nothing visible, and on a fresh visit it is the wrong offer —
          the conversation is already new. Sits with the other chips rather than up in the
          log, because it belongs to the same row of things you can change about the
          conversation you're in. */}
      {onNewConversation && (
        <button
          onClick={onNewConversation}
          aria-label="Start a new conversation"
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]"
        >
          {NEW_CHAT_ICON}
          <span className="inline">New</span>
        </button>
      )}

    </div>
  )
}
