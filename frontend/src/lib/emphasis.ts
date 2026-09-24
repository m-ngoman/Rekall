/** The only markup the tutor is allowed besides maths: `**bold**` and `*italic*`.
 *
 * Deliberately not a markdown parser. The tutor writes one to three conversational sentences, and
 * the prompt forbids headings, lists, tables and code fences — so what is needed here is emphasis
 * on a key term, not a document renderer. Pulling in markdown-it for that would add a parser, a
 * sanitiser and a bundle to solve a problem two regexes solve.
 *
 * Three properties matter, and each is a constraint the obvious implementation would miss:
 *
 * **Streaming-safe.** Replies arrive through a typewriter on a 20ms tick and this runs on every
 * one of them. Both patterns require their closing marker, so a half-arrived `**bol` matches
 * nothing and stays literal until the rest lands. Same principle as MathText's unterminated
 * delimiters. Both are also newline-bounded, so an unclosed marker can never swallow the rest of
 * a reply the way an unclosed markdown code fence would.
 *
 * **Asterisks only, never underscores.** `_x_` is subscript territory in anything adjacent to
 * maths, and this app is full of maths. Standard markdown treats `_italic_` as emphasis; here
 * that would italicise half of `a_1 + b_2` whenever it appeared outside a `$` pair.
 *
 * **No whitespace directly inside the markers**, which is what keeps `2 * 3 * 4` from
 * italicising " 3 ". Borrowed from the money rule in MathText's own segmenter.
 *
 * Applied only to the *prose* chunks MathText has already split out, so `*` inside a formula is
 * unreachable from here. One consequence worth knowing: emphasis cannot span a formula —
 * `**the value $x$ matters**` splits into two prose chunks, neither holding a complete pair, so
 * the asterisks render literally. It fails to plain text rather than to broken markup, and the
 * prompt asks the model not to do it.
 */

/** One capture group, so `split()` alternates: even indices are plain, odd ones are matches.
 *
 * The lookarounds exclude `*` as well as whitespace, and that is load-bearing rather than tidy.
 * With a plain `(?=\S)` the italic branch matches a bare `**` as an empty pair — an asterisk is
 * itself non-whitespace, so both guards pass with nothing between them. That turned every
 * half-streamed `the **` into an emphasis span for as long as it took the rest to arrive, which
 * is the precise failure this was written to avoid. Caught by emphasis.test.ts, not by reading.
 *
 * The italic branch additionally refuses to open on an asterisk that follows another one. Without
 * it, a bold marker caught mid-close — `the **carbocation*`, three of the four closing asterisks
 * arrived — matches as italic and flashes for a tick before snapping to bold. MathText's
 * segmenter carries the same guard for the same reason, in its own words: "An opening '$' may not
 * itself follow a '$', so a display block that is still streaming in stays literal instead of
 * flashing as inline maths for a tick."
 */
export const EMPHASIS = /(\*\*(?=[^\s*])[^\n]*?(?<=[^\s*])\*\*|(?<!\*)\*(?=[^\s*])[^*\n]*?(?<=[^\s*])\*)/g

/** Whether a matched chunk is bold (`**`) rather than italic (`*`). */
export function isBold(chunk: string): boolean {
  return chunk.startsWith('**')
}

/** The text inside the markers. */
export function unwrapEmphasis(chunk: string): string {
  const width = isBold(chunk) ? 2 : 1
  return chunk.slice(width, -width)
}

/** The same text with the markers taken out and nothing emphasised.
 *
 * For PlainMath, the placeholder shown for the instant before the KaTeX chunk loads: it should
 * read as an ordinary sentence, and bare asterisks read as markup someone forgot to render.
 */
export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, (chunk) => unwrapEmphasis(chunk))
}
