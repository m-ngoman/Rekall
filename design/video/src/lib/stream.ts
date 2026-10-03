/** The grader's explanation, typed out a character at a time at an even pace: the first character
 * on `start`, the whole of it by `end`. The app itself shows the explanation as the grader's
 * chunks arrive, a few words at a time; the video types it out instead, like a typewriter.
 * Returns how many characters are on screen. */
export function typedChars(frame: number, text: string, start: number, end: number): number {
  if (frame < start) return 0
  if (frame >= end) return text.length
  return Math.min(text.length, 1 + Math.floor(((frame - start) / (end - start)) * text.length))
}
