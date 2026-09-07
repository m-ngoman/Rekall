import { useMemo } from 'react'
import katex from 'katex'
// Imported here rather than in index.css so it travels in this component's lazy chunk: a user
// who never meets a maths card should not download a maths stylesheet.
import 'katex/dist/katex.min.css'

/** Text that may contain LaTeX between dollar signs, rendered as maths.
 *
 * Only used on cards the generator flagged `is_math`. That gate matters: "$" is an ordinary
 * character in an ordinary card, and treating it as a delimiter everywhere would mangle the first
 * card anyone wrote about money.
 *
 * `$$…$$` is a display block on its own line, `$…$` is inline. Anything KaTeX can't parse is left
 * as the literal text it came from rather than throwing — a malformed formula should look wrong,
 * not take the review screen down mid-session.
 */
const SEGMENT = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g

export default function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    return text.split(SEGMENT).map((chunk, i) => {
      const display = chunk.startsWith('$$') && chunk.endsWith('$$') && chunk.length > 4
      const inline = !display && chunk.startsWith('$') && chunk.endsWith('$') && chunk.length > 2
      if (!display && !inline) return { key: i, math: false, value: chunk }
      const body = chunk.slice(display ? 2 : 1, display ? -2 : -1)
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
