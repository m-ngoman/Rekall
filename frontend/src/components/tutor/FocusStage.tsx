import type { RefObject } from 'react'
import MaybeMath from '../MaybeMath'
import VoiceOrb, { type OrbState } from '../VoiceOrb'
import { StageExamOffer } from './ExamOffer'
import type { ExamOffer, Message } from './types'

/** How long the focus overlay takes to fade. Also the unmount delay on exit — the orb's FLIP
 * back onto the mic button (160ms) finishes first, then the backdrop melts away around it. */
export const OVERLAY_FADE_MS = 300

/** Bare words for the focus view's status line — the ellipsis variants in the composer suit its
 * strip, but uppercase-tracked status text reads cleaner without punctuation. */
const FOCUS_STATUS: Record<OrbState, string> = {
  idle: '',
  waiting: 'Waiting for you',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

/** FOCUS MODE — a full-screen takeover, not a chat with an orb floating over it. The text
 * being spoken is the star: large type on a bare dark stage, the sentence currently being
 * read lit up and the rest dimmed, with the orb reduced to a control at the bottom. The
 * stage is deliberately literal-black in both themes — same "own immersive treatment"
 * decision as the orb itself. Mounted/unmounted around the orb's FLIP flight so the grow-
 * out-of-the-button motion still lands. */
export default function FocusStage({
  voiceModeActive,
  overlayIn,
  focusTextRef,
  focusBottomRef,
  messages,
  orbState,
  voiceSentences,
  speakingIdx,
  currentWords,
  litCount,
  liveTranscript,
  revealedTranscript,
  micDebug,
  examOffer,
  onDismissOffer,
  onAddOffer,
  orbCircleRef,
  getAnalyser,
  onEnd,
}: {
  voiceModeActive: boolean
  overlayIn: boolean
  focusTextRef: RefObject<HTMLDivElement>
  focusBottomRef: RefObject<HTMLDivElement>
  messages: Message[]
  orbState: OrbState
  voiceSentences: string[]
  speakingIdx: number
  currentWords: { word: string; start: number }[] | null
  litCount: number
  liveTranscript: string
  revealedTranscript: string
  /** Why the last listening turn ended, when ?mic=debug is on the URL; null otherwise. */
  micDebug: string | null
  examOffer: ExamOffer | null
  onDismissOffer: () => void
  onAddOffer: () => void
  orbCircleRef: RefObject<HTMLButtonElement>
  getAnalyser: () => AnalyserNode | null
  onEnd: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice session"
      className="fixed inset-0 z-30 flex touch-none flex-col transition-opacity"
      style={{
        transitionDuration: `${OVERLAY_FADE_MS}ms`,
        opacity: voiceModeActive && overlayIn ? 1 : 0,
        background:
          'radial-gradient(ellipse 95% 60% at 50% 104%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 68%), rgb(13 10 8 / 0.96)',
      }}
    >
      <div className="flex min-h-0 flex-1 items-end justify-center px-7 pt-[calc(3.5rem+env(safe-area-inset-top))]">
        <div
          ref={focusTextRef}
          className="max-h-[55vh] w-full max-w-xl touch-auto overflow-y-auto overscroll-contain transition-transform duration-500 lg:max-h-[60vh]"
          style={{
            transform: overlayIn ? 'translateY(0)' : 'translateY(12px)',
            // Text dissolves at the container's edges instead of clipping against an
            // invisible line — the scroll boundary shouldn't read as a box edge when the
            // whole design is about not having boxes.
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
            maskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
          }}
        >
          {/* The running conversation, not a one-utterance-at-a-time card: entering voice
              mode mid-chat picks up right where the typed exchange left off, and everything
              said by voice stays on stage above the live line. One type size throughout —
              brightness carries time (past turns recede, the live moment is lit) and
              alignment carries speaker, so nothing needs a bubble. */}
          <div className="flex flex-col gap-9 px-1 py-6 text-[1.35rem] font-semibold leading-[1.5] lg:text-[1.6rem]">
            {/* System messages (the /bug commands) are dropped here: they're the app talking
                to itself, and on the voice stage they'd read as something that was said. */}
            {(orbState === 'speaking' && voiceSentences.length > 0 ? messages.slice(0, -1) : messages)
              .filter((m) => m.role !== 'system')
              .map(
              (m, i) =>
                m.text ? (
                  <p
                    key={i}
                    className={`focus-line ${m.role === 'user' ? 'self-end text-right' : 'self-start text-left'}`}
                    style={{
                      maxWidth: '88%',
                      color:
                        m.role === 'user'
                          ? 'color-mix(in oklab, var(--accent) 55%, rgb(255 255 255 / 0.45))'
                          : 'rgb(255 255 255 / 0.42)',
                    }}
                  >
                    {m.role === 'user' ? m.text : <MaybeMath text={m.text} />}
                  </p>
                ) : null,
            )}

            {micDebug && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-10 px-4 text-center font-mono text-[0.6875rem] leading-snug text-white/70">
                {micDebug}
              </div>
            )}
            {orbState === 'listening' && liveTranscript && (
              <p className="max-w-[88%] self-end text-right text-white">{revealedTranscript}</p>
            )}

            {orbState === 'thinking' && (
              <p aria-label="Thinking" className="animate-pulse self-start tracking-[0.35em] text-white/40">
                •••
              </p>
            )}

            {orbState === 'speaking' && voiceSentences.length > 0 && (
              /* Karaoke, at sentence granularity — that's the honest unit: audio arrives one
                 sentence per blob, so playback genuinely knows sentence boundaries and
                 nothing finer. The sentence being read is lit, spoken ones stay readable,
                 arrived-but-unspoken ones are barely there. */
              <p className="max-w-[88%] self-start text-left">
                {voiceSentences.map((sentence, i) =>
                  i === speakingIdx && currentWords ? (
                    <span key={i} data-sentence={i} className="focus-line-inline">
                      {currentWords.map(({ word }, wi) => (
                        <span key={wi} className={wi < litCount ? 'focus-word' : 'focus-word-idle'}>
                          {word + ' '}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span
                      key={i}
                      data-sentence={i}
                      className="focus-line-inline"
                      style={{
                        color: i < speakingIdx ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.16)',
                        transition: 'color 350ms ease',
                      }}
                    >
                      {sentence}{' '}
                    </span>
                  ),
                )}
              </p>
            )}
            <div ref={focusBottomRef} />
          </div>
        </div>
      </div>

      {/* The offer has to be reachable from in here: the overlay covers the chat, so the card
          in the log behind it is invisible until you leave voice mode. Tapping is the primary
          path — a spoken "yes" also works (see runVoiceTurn), but speech gets misheard and
          this one writes to their calendar. */}
      {examOffer && (
        <StageExamOffer offer={examOffer} onDismiss={onDismissOffer} onAdd={onAddOffer} />
      )}

      <div className="flex flex-col items-center gap-1 pb-10 lg:pb-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">
          {FOCUS_STATUS[orbState]}
        </span>
        {/* The grow-out-of-the-button motion is done on orbCircleRef via direct transform
            manipulation (see the FLIP effects above) — imperative on purpose. */}
        <button
          ref={orbCircleRef}
          onClick={onEnd}
          title="End voice mode"
          className="relative flex origin-center cursor-pointer items-center justify-center rounded-full p-2"
        >
          <VoiceOrb state={orbState} getAnalyser={getAnalyser} size={230} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="oklch(0.99 0.005 90)">
              <rect x="5" y="5" width="14" height="14" rx="4" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}
