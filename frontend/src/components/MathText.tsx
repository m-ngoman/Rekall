import { useMemo } from 'react'
import katex from 'katex'
// Imported here rather than in index.css so it travels in this component's lazy chunk: a user
// who never meets a maths card should not download a maths stylesheet.
import 'katex/dist/katex.min.css'

/** Text that may contain LaTeX between delimiters, rendered as maths.
 *
 * Used on cards the generator flagged `is_math`, and on every tutor reply. The gate matters for
 * cards: "$" is an ordinary character in an ordinary card, and treating it as a delimiter
 * everywhere would mangle the first card anyone wrote about money. The tutor is instead told that
 * dollar signs are only ever delimiters, and the money case is guarded below besides.
 *
 * `$$…$$` and `\[…\]` are display blocks on their own line, `$…$` and `\(…\)` are inline. The
 * backslash forms are accepted because models emit them whatever the prompt asks for. Anything
 * KaTeX can't parse is left as the literal text it came from rather than throwing — a malformed
 * formula should look wrong, not take the screen down mid-session.
 *
 * Inline "$" follows Pandoc's rule so that money is not maths: no whitespace directly inside
 * either delimiter, and no digit directly after the closing one. "$5 and $10; solve $x+1=2$"
 * used to render "10; solve " as a formula and leave the real one literal; now only the real one
 * matches. An opening "$" may not itself follow a "$", so a display block that is still
 * streaming in ("$$x^2$") stays literal instead of flashing as inline maths for a tick.
 *
 * An unterminated delimiter matches nothing and stays literal, which is what makes this safe to
 * run on a reply that is still streaming in.
 */
const SEGMENT = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\$)\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d))/g

/** The formula inside a matched delimiter pair, and whether it is a display block. */
function unwrap(chunk: string): { display: boolean; body: string } {
  const display = chunk.startsWith('$$') || chunk.startsWith('\\[')
  const width = chunk.startsWith('$$') || chunk.startsWith('\\') ? 2 : 1
  return { display, body: chunk.slice(width, -width) }
}

export default function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    // One capture group, so split() alternates: even indices are prose, odd ones are the matches.
    // Parity rather than re-testing the chunk's edges — a prose chunk that happens to start and
    // end with "$" (because the delimiter around it was rejected) must stay prose.
    return text.split(SEGMENT).map((chunk, i) => {
      if (i % 2 === 0) return { key: i, math: false, value: chunk }
      const { display, body } = unwrap(chunk)
      try {
        // `trust` and `strict` are left at their safe defaults: this text comes from a language
        // model, so KaTeX must not be allowed to emit arbitrary HTML from it.
        return { key: i, math: true, display, value: katex.renderToString(body, { displayMode: display, throwOnError: true }) }
      } catch {
        return { key: i, math: false, value: chunk }
      }
    })
  }, [text])

  return (
    <span className={className}>
      {parts.map((p) =>
        p.math ? (
          <span key={p.key} className={p.display ? 'my-2 block overflow-x-auto' : ''} dangerouslySetInnerHTML={{ __html: p.value }} />
        ) : (
          <span key={p.key}>{p.value}</span>
        ),
      )}
    </span>
  )
}
