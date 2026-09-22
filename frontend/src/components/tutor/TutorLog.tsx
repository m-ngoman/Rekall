import { Fragment, lazy, Suspense } from 'react'
// Typed replies carry LaTeX (the prompt asks for it — see tutor_prompt._TYPED_PROMPT), so every
// assistant message goes through MaybeMath, which loads KaTeX the first time a reply renders.
// Spoken replies are plain words by instruction, so they pass through unchanged.
import MaybeMath from '../MaybeMath'
import type { Message } from './types'

/** The plot renderer and its parser, as a third lazy chunk. A conversation about history never
 * downloads a maths evaluator. */
const FunctionPlot = lazy(() => import('../FunctionPlot'))

/** The conversation, as the log shows it.
 *
 * Not bubble-on-bubble chat styling: the tutor's words sit directly on the page like
 * prose, and only the user's turns get a (quiet, tinted) pill to mark whose line is
 * whose. One bubble per exchange is enough attribution — two was wallpaper. */
export default function TutorLog({
  messages,
  replyPending,
  resumedDay = null,
  condensedBefore = -1,
}: {
  messages: Message[]
  replyPending: boolean
  /** "Tue, Sep 16" above a conversation carried over from another day, or null. */
  resumedDay?: string | null
  /** Index of the first turn the tutor still holds verbatim; -1 when it holds all of them. */
  condensedBefore?: number
}) {
  return (
    <>
      {resumedDay && <div className="self-center py-1 text-xs text-[var(--text-muted)]">{resumedDay}</div>}
      {messages.map((m, i) => (
        <Fragment key={i}>
          {/* Everything above is still on screen — a student's own record of a conversation
              isn't ours to shorten. The line says where the tutor's recall stops being word for
              word, so a vaguer answer about something earlier isn't a surprise. */}
          {i === condensedBefore && (
            <div className="flex w-full items-center gap-3 self-stretch py-1 text-[0.6875rem] text-[var(--text-muted)]">
              <span className="h-px flex-1 bg-[var(--rule)]" />
              the tutor remembers everything above as a summary
              <span className="h-px flex-1 bg-[var(--rule)]" />
            </div>
          )}
          {m.role === 'system' ? (
          // The app talking, not the tutor: monospaced, dimmed and centred so a /bug listing
          // never reads as something the model said.
          <div
            className="max-w-[94%] self-center whitespace-pre-line rounded-[var(--r-sm)] px-4 py-2.5 text-center font-mono text-xs leading-relaxed"
            style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}
          >
            {m.text}
          </div>
        ) : m.role === 'user' ? (
          <div
            className="max-w-[85%] self-end rounded-[var(--r-md)] px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: 'var(--surface)', color: 'var(--text)' }}
          >
            {m.imageUrl && (
              <img src={m.imageUrl} alt="Attached photo" className="mb-2 max-h-48 w-full rounded-[var(--r-sm)] object-cover" />
            )}
            {/* A photo from a turn taken before this page load. The image was only ever sent
                to the model, never stored, so there is nothing to show — say that, rather
                than printing the placeholder the backend keeps in the transcript. */}
            {m.photoDropped && <span className="text-xs italic text-[var(--text-muted)]">Photo sent</span>}
            {m.text}
          </div>
        ) : (
          <div className="max-w-[94%] self-start px-1 text-[0.9375rem] leading-relaxed text-[var(--text)]">
            {replyPending && i === messages.length - 1 && !m.text ? (
              // Same three dots the voice stage shows while the tutor thinks.
              <span aria-label="Thinking" className="animate-pulse tracking-[0.35em] text-[var(--text-muted)]">
                •••
              </span>
            ) : (
              <MaybeMath text={m.text} />
            )}
            {/* Below the words, attached to the reply that drew it. No fallback: a graph has
                no readable degraded form, and the sentence above already carries the answer. */}
            {m.plots?.map((plot, pi) => (
              <Suspense key={pi} fallback={null}>
                <FunctionPlot spec={plot} />
              </Suspense>
            ))}
            {/* A graph drawn before this page load. Only the backend's one-sentence
                description survives in the transcript — enough to know what was on screen
                and to ask the tutor about it, which is what the sentence was written for. */}
            {m.captions?.map((caption, ci) => (
              <div key={ci} className="mt-2 text-xs italic text-[var(--text-muted)]">
                {caption}
              </div>
            ))}
          </div>
        )}
        </Fragment>
      ))}
    </>
  )
}
