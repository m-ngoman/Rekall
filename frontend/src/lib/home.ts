import { daysUntil, formatDayShort } from './dates'
import type { LoadByDay } from './load'
import type { Dashboard, Deck, Exam } from '../types'

/** What a deck has left to do today: its due cards and the new cards today's queue will still
 * serve. Not every new card in it: the daily cap holds the rest for later days, and counting
 * them promised a session the queue would never hand over. */
export function leftToday(deck: Pick<Deck, 'due' | 'new_today'>): number {
  return deck.due + deck.new_today
}

/** The deck Home's button opens, from the decks on the daily list: the one cramming for the
 * nearest exam, else the one with the most left today. Study sessions are per deck, so Home has
 * to pick, and only a deck with something left today can be picked, or the button would open
 * an empty session. */
export function pickStartDeck(decks: Deck[], nextExam: Exam | undefined): Deck | undefined {
  const withWork = decks.filter((d) => leftToday(d) > 0)
  return (
    (nextExam && withWork.find((d) => nextExam.deck_ids.includes(d.id))) ??
    [...withWork].sort((a, b) => leftToday(b) - leftToday(a))[0]
  )
}

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
