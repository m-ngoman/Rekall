import { formatDayLong } from './dates'
import type { ProfileLine, StudentProfile } from '../types'

/** How many lines the file holds, yours and the tutor's: what the Memory chip counts. */
export function profileLineCount(profile: StudentProfile | null): number {
  return profile ? profile.sections.reduce((n, s) => n + s.lines.length, 0) : 0
}

/** The quiet note under one of the tutor's lines: how often it saw this, and whether it has gone
 * quiet. Null for your own lines, which have no evidence to show and never go stale. */
export function lineEvidence(line: ProfileLine): string | null {
  if (line.yours || line.sessions === null) return null
  const seen = `${line.sessions} ${line.sessions === 1 ? 'session' : 'sessions'}`
  return line.stale && line.latest
    ? `${seen} · hasn't come up since ${formatDayLong(line.latest)}, so it's left out for now`
    : seen
}

/** One line of the file as edited, keyed by the section it sits in and what it says. */
interface Entry {
  section: string
  key: string
  raw: string
}

/** What a line says, as the server matches it: bullet off, spacing squeezed. */
const lineKey = (line: string) => line.replace(/^[-*•](\s+|$)/, '').split(/\s+/).join(' ').trim()

/** The file's lines, each with the section it sits in. Read the way the server reads an edit: a
 * heading counts only if it names a section, and lines above every heading are the first's. */
function entries(text: string, sections: string[]): Entry[] {
  const known = new Map(sections.map((name) => [name.toLowerCase(), name]))
  let section = sections[0]
  const out: Entry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    const name = heading && known.get(heading[1].split(/\s+/).join(' ').toLowerCase())
    if (name) {
      section = name
      continue
    }
    const key = lineKey(line)
    if (key) out.push({ section, key, raw: line })
  }
  return out
}

/** Carries an edit made on `base` over to `latest`, a version saved since (usually by the tutor).
 *
 * The lines the student took out come out of `latest`, and the lines they added or moved go into
 * it under the same heading. Everything else is `latest` as it is — including whatever the tutor
 * wrote meanwhile, which saving the old edit would have taken out and marked removed for good.
 * The result goes back into the editor for the student to check, never straight to the server.
 */
export function rebaseEdit(base: string, draft: string, latest: string, sections: string[]): string {
  const id = (e: Entry) => `${e.section}\n${e.key}`
  const before = new Set(entries(base, sections).map(id))
  const mine = entries(draft, sections)
  const kept = new Set(mine.map(id))
  const takenOut = new Set([...before].filter((k) => !kept.has(k)))

  const out = new Map(sections.map((name) => [name, [] as string[]]))
  for (const e of entries(latest, sections)) if (!takenOut.has(id(e))) out.get(e.section)!.push(e.raw)
  for (const e of mine) {
    if (before.has(id(e))) continue
    const lines = out.get(e.section)!
    if (!lines.some((line) => lineKey(line) === e.key)) lines.push(e.raw)
  }
  return sections.map((name) => [`## ${name}`, ...out.get(name)!].join('\n')).join('\n\n')
}
