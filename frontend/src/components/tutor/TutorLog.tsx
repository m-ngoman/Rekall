import { lazy, Suspense } from 'react'
// Typed replies carry LaTeX (the prompt asks for it — see tutor_prompt._TYPED_PROMPT), so every
// assistant message goes through MaybeMath, which loads KaTeX the first time a reply renders.
// Spoken replies are plain words by instruction, so they pass through unchanged.
import MaybeMath from '../MaybeMath'
import NodeLoader from '../NodeLoader'
import type { Message } from './types'

/** The plot renderer and its parser, as a third lazy chunk. A conversation about history never
 * downloads a maths evaluator. */
const FunctionPlot = lazy(() => import('../FunctionPlot'))

/** The conversation, as the log shows it.
 *
 * Not bubble-on-bubble chat styling: the tutor's words sit directly on the page like
 * prose, and only the user's turns get a (quiet, tinted) pill to mark whose line is
 * whose. One bubble per exchange is enough attribution — two was wallpaper. */
export default function TutorLog({ messages, replyPending }: { messages: Message[]; replyPending: boolean }) {
  return (
    <>
      {messages.map((m, i) =>
        m.role === 'system' ? (
          // The app talking, not the tutor: monospaced, dimmed and centred so a /bug listing
          // never reads as something the model said.
          <div
            key={i}
            className="max-w-[94%] self-center whitespace-pre-line rounded-[var(--r-sm)] px-4 py-2.5 text-center font-mono text-xs leading-relaxed"
            style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}
          >
            {m.text}
          </div>
        ) : m.role === 'user' ? (
          <div
            key={i}
            className="max-w-[85%] self-end rounded-[var(--r-md)] px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: 'var(--surface)', color: 'var(--text)' }}
          >
            {m.imageUrl && (
              <img src={m.imageUrl} alt="Attached photo" className="mb-2 max-h-48 w-full rounded-[var(--r-sm)] object-cover" />
            )}
            {m.text}
          </div>
        ) : (
          <div key={i} className="max-w-[94%] self-start px-1 text-[0.9375rem] leading-relaxed text-[var(--text)]">
            {replyPending && i === messages.length - 1 && !m.text ? (
              // The mark, in a box one line tall where the first words will land, so they take its
              // place without the row changing height.
              <NodeLoader size={22} delay={0} label="Thinking" className="flex h-[1.625em] items-center" />
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
          </div>
        ),
      )}
    </>
  )
}
