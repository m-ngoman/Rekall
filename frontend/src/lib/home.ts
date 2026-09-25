import { daysUntil, formatDayShort } from './dates'
import type { LoadByDay } from './load'
import type { Dashboard } from '../types'

/** Which of Home's three days this is. They used to share one sentence: "Nothing due. Come back
 * tomorrow." stood both for a plate that was genuinely empty and for a daily goal that had merely
 * been met with cards still waiting, which turned a personal target into a scheduling fact.
 *
 * - `due`: the goal has cards left in it.
 * - `goal-met`: the goal is done and the queues would still serve more.
 * - `caught-up`: nothing left today, goal or no goal.
 *
 * `hasDeckToStart` is whether Home found a deck with work to open. Without one there is nothing
 * a button could start, whatever the numbers say. */
export function homeDay(dashboard: Dashboard, hasDeckToStart: boolean): 'due' | 'goal-met' | 'caught-up' {
  if (!hasDeckToStart || dashboard.remaining_today === 0) return 'caught-up'
  return dashboard.goal_today > dashboard.reviewed_today ? 'due' : 'goal-met'
}

export interface NextReview {
  /** `YYYY-MM-DD`, as the load timeline buckets it. */
  iso: string
  cards: number
}

/** The earliest day in a load timeline with any cards on it. */
export function firstScheduledDay(byDay: LoadByDay): NextReview | null {
  const iso = Object.keys(byDay)
    .filter((d) => byDay[d] > 0)
    .sort()[0]
  return iso ? { iso, cards: byDay[iso] } : null
}

/** "12 cards come back tomorrow." Nothing in today's bucket is due yet once you're caught up —
 * those are cards missed earlier, back in minutes — so today reads "later today". A bucket can
 * be local yesterday for anyone east of UTC, whose day starts before the server's; that is
 * still today to them. */
export function comingBackLine({ iso, cards }: NextReview): string {
  const days = daysUntil(iso)
  const when = days <= 0 ? 'later today' : days === 1 ? 'tomorrow' : days < 7 ? `in ${days} days` : `on ${formatDayShort(iso)}`
  return `${cards} ${cards === 1 ? 'card comes' : 'cards come'} back ${when}.`
}
