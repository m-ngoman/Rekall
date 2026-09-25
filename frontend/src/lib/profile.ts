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
  return line.stale && line.latest ? `${seen} · hasn't come up since ${formatDayLong(line.latest)}` : seen
}
