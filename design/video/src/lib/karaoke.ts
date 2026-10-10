import { APP_EASE, CSS_EASE, clamp, lerp } from './ease'

/** TutorScreen: "A small lead keeps the light-up feeling simultaneous with the voice; strictly
 * on-time reads as lagging." */
export const WORD_LEAD_S = 0.08
/** index.css: focus-word-pop 460ms cubic-bezier(0.22, 1, 0.36, 1), turning at 55%. */
export const WORD_POP_MS = 460
export const WORD_POP_TURN = 0.55
/** index.css: focus-line-in 420ms (the app curve), focus-line-fade 420ms ease. */
export const LINE_IN_MS = 420

/** The first frame a word is lit, `speakStart` being the frame the audio starts on. The app lights
 * a word once `currentTime + WORD_LEAD_S` reaches its start; the epsilon keeps a start that lands
 * exactly on a frame boundary from being pushed a frame late by floating point. */
export function litFrame(start: number, speakStart: number, fps: number): number {
  return speakStart + Math.max(0, Math.ceil((start - WORD_LEAD_S) * fps - 1e-6))
}

/** How many words are lit `t` seconds into the audio: monotonic, like the app's (a word never goes
 * dark again). */
export function litCount(t: number, starts: number[]): number {
  let n = 0
  while (n < starts.length && starts[n] <= t + WORD_LEAD_S) n++
  return n
}

/** A word `ms` after it lit, as focus-word-pop draws it. CSS eases each keyframe segment on its
 * own, so the app's curve runs twice: 0 → 55% (dim to white, rising past its line) and 55% → 100%
 * (settling onto it). Returned as white's alpha and the vertical offset in em. */
export function focusWord(ms: number | null): { alpha: number; y: number } {
  if (ms === null || ms < 0) return { alpha: 0.2, y: 0.12 } // .focus-word-idle
  const turn = WORD_POP_MS * WORD_POP_TURN
  if (ms < turn) {
    const e = APP_EASE(ms / turn)
    return { alpha: lerp(0.2, 1, e), y: lerp(0.12, -0.07, e) }
  }
  const e = APP_EASE(clamp((ms - turn) / (WORD_POP_MS - turn)))
  return { alpha: 1, y: lerp(-0.07, 0, e) }
}

/** `.focus-line`: a past turn arriving on the stage — fades in and rises 0.35em. */
export function focusLine(ms: number): { opacity: number; y: number } {
  const e = APP_EASE(clamp(ms / LINE_IN_MS))
  return { opacity: e, y: lerp(0.35, 0, e) }
}

/** `.focus-line-inline`: the sentence being spoken fading in. */
export const focusLineInline = (ms: number) => CSS_EASE(clamp(ms / LINE_IN_MS))
