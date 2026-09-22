import type { TutorMessageOut } from '../../types'
import type { Message } from './types'

/** The line the backend leaves behind in place of a graph it can no longer redraw — see
 * `describe()` in tutor_figures.py, appended bracketed at the end of the stored reply.
 *
 * Anchored on the full literal prefix, not just a leading bracket, so it cannot swallow a
 * bracketed sentence the tutor wrote itself. */
const GRAPH_TRACE = /^\[Graph shown: .*\]$/

/** Stored turns → what the log renders.
 *
 * Lossy by design, and the losses are the ones the backend already chose: a photo was never
 * persisted, and a graph survives only as prose. Both are shown as what they are rather than
 * papered over — printing the raw `[Sent a photo]` or leaving a bracketed sentence inline would
 * read as something the tutor said.
 */
export function hydrate(rows: TutorMessageOut[]): Message[] {
  return rows.map((row): Message => {
    if (row.role === 'user') {
      return row.content === '[Sent a photo]'
        ? { role: 'user', text: '', photoDropped: true }
        : { role: 'user', text: row.content }
    }
    const lines = row.content.split('\n')
    const captions: string[] = []
    while (lines.length) {
      const last = lines[lines.length - 1].trim()
      if (last === '') {
        lines.pop()
        continue
      }
      if (!GRAPH_TRACE.test(last)) break
      lines.pop()
      captions.unshift(last.slice(1, -1))
    }
    return {
      role: 'assistant',
      text: lines.join('\n').trim(),
      ...(captions.length ? { captions } : {}),
    }
  })
}
