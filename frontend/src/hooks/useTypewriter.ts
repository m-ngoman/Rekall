import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'

/** Reveals an assistant message's text a few characters at a time instead of popping in
 * whatever chunk just arrived over the wire — used by both the typed and voice reply paths so
 * there's one typewriter, not two. Chunk size varies a lot between the two (typed replies
 * stream near-per-token; voice replies arrive a whole synthesized sentence at a time), so the
 * per-tick step is adaptive: small step when text is trickling in (smooth per-character feel),
 * bigger step when a large chunk just landed (catches up in ~15 ticks instead of visibly
 * lagging behind the real content for a second-plus).
 *
 * `typeInto(fullText)` sets what the trailing assistant message should end up saying;
 * `stopTypewriter()` freezes the reveal where it is.
 */
export function useTypewriter<M extends { role: string; text: string }>(setMessages: Dispatch<SetStateAction<M[]>>) {
  const typewriterRef = useRef<{ target: string; timer: number | null }>({ target: '', timer: null })

  const typeInto = (fullText: string) => {
    const state = typewriterRef.current
    state.target = fullText
    if (state.timer) return
    state.timer = window.setInterval(() => {
      setMessages((prev) => {
        // Always types into the trailing assistant message rather than a captured index. The old
        // index was captured inside a setMessages updater, which React runs later — so on a
        // reply's FIRST chunk it was still -1 and the reveal wrote into array[-1], i.e. nowhere.
        // Multi-chunk replies self-healed on chunk two; a single-sentence voice reply never got
        // one, stayed empty forever, and vanished when the karaoke cleared. While a reply is
        // being revealed it is by construction the last message, so "the last message, if it's
        // the assistant's" is both simpler and correct.
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant' || last.text.length >= state.target.length) {
          if (state.timer) {
            clearInterval(state.timer)
            state.timer = null
          }
          return prev
        }
        const behind = state.target.length - last.text.length
        const step = Math.max(1, Math.ceil(behind / 15))
        const next = [...prev]
        next[next.length - 1] = { ...last, text: state.target.slice(0, last.text.length + step) }
        return next
      })
    }, 20)
  }

  /** Freezes the typewriter mid-reveal — for a pause/barge-in interrupt, where the point is that
   * the tutor stops talking right now, not that the remaining text pops in immediately.
   */
  const stopTypewriter = () => {
    const state = typewriterRef.current
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
  }

  useEffect(() => stopTypewriter, [])

  return { typeInto, stopTypewriter }
}
