// Replica of frontend/src/screens/HomeScreen.tsx on the day the demo shows: an exam ahead, cards
// due, the goal not yet met. The app's own helpers pick the deck the button opens and word it.
import DeckTile from '@app/components/DeckTile'
import { homeDay, leftToday, pickStartDeck } from '@app/lib/home'
import type { Dashboard, Deck, Exam } from '@app/types'
import { daysFromToday, demo, upcomingExams } from '../data/demo'
import type { Press } from './StudyScreen'

export interface HomeView {
  /** How far each digit of the countdown still has to rise, 0 at rest (lib/countdown). */
  digits?: number[]
  /** The exam's name is a button to the calendar. */
  examName?: Press
  touch?: boolean
}

const decks = demo.decks.map((d) => ({ ...d, next_exam: null })) as Deck[]
const dashboard = demo.dashboard as Dashboard

export function HomeScreen({ digits, examName, touch }: HomeView) {
  const active = decks.filter((d) => !d.exam_paused)
  const paused = decks.filter((d) => d.exam_paused)
  const upcoming = upcomingExams() as Exam[]
  const next = upcoming[0]
  const withWork = active.filter((d) => leftToday(d) > 0)
  const startDeck = pickStartDeck(active, next)!
  const goalLeft = Math.max(0, dashboard.goal_today - dashboard.reviewed_today)
  const day = homeDay(dashboard, startDeck !== undefined)
  const rest = upcoming.slice(1, 4)
  const daysLeft = daysFromToday(next.date)
  const startCount = leftToday(startDeck)
  const acrossDecks = withWork.length
  const filter = examName?.down ? `brightness(${touch ? 0.9 : 0.92})` : examName?.hover && !touch ? 'brightness(1.06)' : undefined

  return (
    <div className="flex flex-col gap-8 pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end lg:gap-x-14 lg:gap-y-8">
      <div className="contents">
        <div className="flex flex-col">
          <button className="self-start text-left text-[1.25rem] font-bold leading-snug" style={{ filter }}>
            {next.name}
          </button>
          <div className="mt-1 flex items-baseline gap-3">
            <span
              className="numeral text-[8.5rem] text-[var(--accent)] lg:text-[14rem]"
              aria-label={`${daysLeft} days until ${next.name}`}
              style={digits ? { clipPath: 'inset(-0.5em -0.2em 0 -0.2em)' } : undefined}
            >
              {digits
                ? String(daysLeft)
                    .split('')
                    .map((d, j) => (
                      <span key={j} style={{ display: 'inline-block', transform: `translateY(${(digits[j] ?? 0) * 100}%)` }}>
                        {d}
                      </span>
                    ))
                : daysLeft}
            </span>
            <span className="text-[1.0625rem] font-semibold text-[var(--text-muted)]">{daysLeft === 1 ? 'day' : 'days'}</span>
          </div>

          {day === 'due' && (
            <div className="mt-5 flex items-baseline gap-2">
              <span className="numeral text-[2rem]">{goalLeft}</span>
              <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">
                {goalLeft === 1 ? 'card due today' : 'cards due today'}
                {acrossDecks > 1 && `, across ${acrossDecks} decks`}
              </span>
            </div>
          )}

          <button className="on-accent mt-5 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] lg:w-auto lg:self-start lg:px-9 lg:py-[0.6875rem]">
            {day === 'due' ? `Start ${startDeck.name}, ${startCount} due` : `Keep studying ${startDeck.name}`}
          </button>
          <p className="mt-2.5 text-[0.8125rem] text-[var(--text-muted)]">Answer in your own words. Rekall checks what you missed.</p>
        </div>

        {rest.length > 0 && (
          <div className="border-t border-[var(--rule)]">
            {rest.map((e) => (
              <button key={e.id} className="flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left">
                <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{e.name}</span>
                <span className="flex flex-shrink-0 items-baseline gap-1">
                  <span className="numeral text-[1.125rem]">{daysFromToday(e.date)}</span>
                  <span className="text-[0.8125rem] text-[var(--text-muted)]">{daysFromToday(e.date) === 1 ? 'day' : 'days'}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <div className="mb-3 text-[1.0625rem] font-bold tracking-[-0.01em]">Decks</div>
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-4 lg:gap-5">
          {[...active, ...paused].map((deck) => (
            <DeckTile key={deck.id} deck={deck} onClick={() => {}} />
          ))}
        </div>
      </div>
    </div>
  )
}
