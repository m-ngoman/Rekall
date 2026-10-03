import { APP_EASE, lerp, progress } from './ease'

/** The score landing, over 16 frames. In the app the graded layout replaces the grading one in a
 * single render; the video eases between the two so the eye can follow where the number came from,
 * and ends on exactly the app's graded layout: every value here reaches the app's own at `land+16`. */
export function gradeLanding(frame: number, land: number) {
  return {
    /** The question shrinking to its graded size, and the score block opening above the explanation. */
    open: progress(frame, land, 10, APP_EASE),
    /** The numeral rising into place. */
    numeral: progress(frame, land + 4, 8, APP_EASE),
    /** "/5" a beat after it. */
    outOf: progress(frame, land + 6, 6, APP_EASE),
    /** The five-segment bar: each earned segment turns the grade's colour in turn. */
    segment: (n: number) => progress(frame, land + 6 + 2 * n, 4, APP_EASE),
    /** "Hard" and "Back in 7 days". */
    label: progress(frame, land + 10, 6, APP_EASE),
    /** Everything that swaps rather than moves: the rail, the progress bar, the action row. */
    swap: progress(frame, land + 2, 8, APP_EASE),
  }
}

/** The question's size while the block opens: `from` px to the graded 18 px. */
export const questionSize = (open: number, from: number) => lerp(from, 18, open)
