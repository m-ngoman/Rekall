import type { BugReport } from '../types'

/** The open bugs as the `/bugs` command lists them: numbered, so one can be cleared by position,
 * with how long ago each was filed. */
export function renderBugs(bugs: BugReport[], now: number = Date.now()): string {
  if (!bugs.length) return 'No open bugs.'
  const lines = bugs.map((b, i) => {
    const days = Math.floor((now - new Date(b.created_at).getTime()) / 86400000)
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
    return `${i + 1}. ${b.text}  (${when})`
  })
  return `${bugs.length} open:\n${lines.join('\n')}\n\n/bugs done <number> to clear one.`
}

/** The bug `/bugs done <key>` means. A list position is far easier to type on a phone than a UUID,
 * so a plain number means "the nth of the listing you just showed me"; anything else is matched as
 * an id prefix. */
export function findListedBug(list: BugReport[], key: string): BugReport | undefined {
  const byIndex = /^\d+$/.test(key) ? list[Number(key) - 1] : undefined
  return byIndex ?? list.find((b) => b.id.startsWith(key.toLowerCase()))
}
