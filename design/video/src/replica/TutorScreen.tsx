// Replica of frontend/src/screens/TutorScreen.tsx's page — the empty state with its starters, or
// the log — and its fixed composer (components/tutor/{EmptyState,TutorLog,ComposerChips,
// PhotoAttach}.tsx). The voice stage is FocusStage.tsx, drawn over this.
import { PhotoIcon } from '@app/components/icons'
import { daysFromToday, demo, nextExam } from '../data/demo'
import type { Press } from './StudyScreen'

const MIC_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
)
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
const STARTER_PROMPTS = ['Quiz me on my weak cards', 'Explain a concept I keep missing', 'Help me study for an exam']
const PERSONALITY_LABELS: Record<string, string> = { direct: 'Direct', strict_socratic: 'Socratic', encouraging: 'Encouraging', terse: 'Terse', custom: 'Custom' }

/** Where the mic button's middle is, in replica pixels — the point the orb grows out of. The
 * composer is fixed 24 px (desktop) or 96 px (phone) up from the bottom; the mic is its last
 * control, 40 px, 8 px in from the right of a 640 px (desktop) or 350 px (phone) card. */
export const MIC_CENTRE = { landscape: { x: 1052, y: 626 }, portrait: { x: 342, y: 477 } } as const

export interface TutorView {
  messages: { role: 'user' | 'assistant'; text: string }[]
  /** Voice mode is on: the composer's text row becomes a status label, the mic hides. */
  voiceActive?: boolean
  statusLabel?: string
  /** The mic button's own fade as the orb takes its place (0 = gone). */
  micOpacity?: number
  mic?: Press
  composerFocused?: boolean
  touch?: boolean
}

export function TutorPage({ messages }: { messages: TutorView['messages'] }) {
  const next = nextExam()
  const starters = [
    { prompt: STARTER_PROMPTS[0] },
    { prompt: STARTER_PROMPTS[1] },
    { prompt: `Help me plan for ${next.name}`, meta: `${daysFromToday(next.date)} days` },
  ]
  return (
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 pb-64">
        {messages.length === 0 ? (
          <div className="flex min-h-[calc(var(--vh)*58)] flex-col justify-end pt-4 lg:min-h-[calc(var(--vh)*62)]">
            <div className="flex flex-1 flex-col justify-center">
              <div className="text-[1.5rem] font-bold leading-snug tracking-[-0.02em] lg:text-[1.75rem]">What are we working on?</div>
              <p className="mt-2 max-w-[320px] text-[0.9375rem] leading-[1.55] text-[var(--text-muted)] lg:max-w-[440px]">
                Type, attach a photo of your notes, or tap the mic and talk. It keeps listening until you tap again.
              </p>
            </div>
            <div className="mt-6 border-t border-[var(--rule)]">
              {starters.map(({ prompt, meta }) => (
                <button key={prompt} className="flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left text-[0.9375rem] font-semibold">
                  <span className="min-w-0 truncate">{prompt}</span>
                  {meta && (
                    <span className="flex flex-shrink-0 items-baseline gap-1">
                      <span className="numeral text-[1.125rem] text-[var(--text)]">{meta.split(' ')[0]}</span>
                      <span className="text-[0.8125rem] text-[var(--text-muted)]">{meta.split(' ').slice(1).join(' ')}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="max-w-[85%] self-end rounded-[var(--r-md)] px-4 py-2.5 text-sm leading-relaxed" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                {m.text}
              </div>
            ) : (
              <div key={i} className="max-w-[94%] self-start px-1 text-[0.9375rem] leading-relaxed text-[var(--text)]">
                {m.text}
              </div>
            ),
          )
        )}
        <div />
      </div>
    </div>
  )
}

export function Composer({ voiceActive, statusLabel, micOpacity = 1, mic, composerFocused, touch }: Omit<TutorView, 'messages'>) {
  const micFilter = mic?.down ? `brightness(${touch ? 0.9 : 0.92})` : mic?.hover && !touch ? 'brightness(1.06)' : undefined
  return (
    <div className="fixed inset-x-0 bottom-24 z-20 flex justify-center px-5 lg:bottom-6 lg:left-60 lg:px-10">
      <div className="relative flex w-full max-w-xl flex-col gap-1.5 rounded-[var(--r-md)] bg-[var(--surface)] p-2 lg:max-w-[640px]">
        <div className="relative z-20 flex items-end gap-1.5">
          {!voiceActive && (
            <div className="relative">
              <button className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]">
                <PhotoIcon size={16} />
              </button>
            </div>
          )}
          {!voiceActive ? (
            // The textarea, one row tall (useAutosizeTextarea keeps it to its content).
            <div
              className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-[0.9375rem] leading-snug outline-none"
              style={{ boxShadow: composerFocused ? '0 0 0 2px var(--rule)' : undefined, color: 'var(--text-muted)' }}
            >
              Message the tutor
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-2.5">
              <span className="text-xs font-bold text-[var(--text-muted)]">{statusLabel}</span>
            </div>
          )}
          <button className="on-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--r-full)]" style={{ opacity: micOpacity, filter: micFilter }}>
            {MIC_ICON}
          </button>
        </div>
        <div className="relative z-20 flex flex-wrap items-end gap-1.5">
          <div className="relative">
            <button className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]">
              {PERSONALITY_ICON}
              <span className="inline">{PERSONALITY_LABELS[demo.tutor.personality]}</span>
            </button>
          </div>
          <div className="relative">
            <button className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]">
              {VOICE_ICON}
              <span className="inline">{demo.tutor.voice}</span>
            </button>
          </div>
          <div className="relative">
            <button className="flex h-9 items-center gap-1.5 rounded-[var(--r-sm)] px-3 text-[0.75rem] font-semibold text-[var(--text-muted)]">
              {MEMORY_ICON}
              <span className="inline">Memory</span>
              <span className="font-bold tabular-nums">{demo.tutor.memoryNotes}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
