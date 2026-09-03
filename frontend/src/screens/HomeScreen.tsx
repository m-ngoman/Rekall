import { getDashboard, listDecks, listExams } from '../api'
import DeckTile from '../components/DeckTile'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil, formatCountdown } from '../lib/dates'
import type { Dashboard, Deck, Exam } from '../types'

interface Props {
  onStudy: (deckId: string) => void
  onGoToCards: () => void
  onOpenExams: () => void
}

/** Home is the countdown: the next exam, the days left, the cards due today, one button.
 * No greeting, no ring, no streak, no totals — the number is the whole message. */
export default function HomeScreen({ onStudy, onGoToCards, onOpenExams }: Props) {
  const [decks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const [exams] = useCachedResource<Exam[]>('exams', listExams, () => [])
  const [dashboard] = useCachedResource<Dashboard>('dashboard', getDashboard, () => ({
    reviewed_today: 0,
    goal_today: 0,
    streak_days: 0,
  }))

  if (decks === null || dashboard === null) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>
  }

  const active = decks.filter((d) => !d.exam_paused)
  const paused = decks.filter((d) => d.exam_paused)
  const dueToday = Math.max(0, dashboard.goal_today - dashboard.reviewed_today)

  const upcoming = (exams ?? [])
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const next = upcoming[0]
  const rest = upcoming.slice(1, 4)
  const daysLeft = next ? daysUntil(next.date) : null

  // The deck to open when "Start" is tapped: the one cramming for the nearest exam, else the one
  // with the most waiting. Study sessions are per deck, so Home has to pick.
  const withWork = active.filter((d) => d.due > 0 || d.new > 0)
  const startDeck =
    (next && withWork.find((d) => next.deck_ids.includes(d.id))) ??
    withWork.sort((a, b) => b.due + b.new - (a.due + a.new))[0]

  if (decks.length === 0) {
    return (
      <div className="flex flex-col gap-5 pt-6">
        <div className="text-[1.375rem] font-bold leading-snug">Nothing to remember yet.</div>
        <p className="max-w-sm text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
          Rekall quizzes you on your own notes and checks what you actually wrote. Add cards, link
          them to an exam date, and every card gets scheduled before the day.
        </p>
        <button onClick={onGoToCards} className="on-accent self-start rounded-[var(--r-full)] bg-[var(--accent)] px-6 py-3.5 text-[0.9375rem] font-bold">
          Add cards
        </button>
      </div>
    )
  }

  return (
    // Two columns from lg, the way the design lays Home out: the countdown and the exam rows on
    // the left, the deck list as a rail beside it rather than a band underneath. The `contents`
    // wrapper keeps the phone a single flex column with the same gap-8 rhythm.
    <div className="flex flex-col gap-8 pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-x-16 lg:gap-y-8">
      <div className="contents lg:flex lg:flex-col lg:gap-8">
      <div className="flex flex-col">
        {next ? (
          <>
            <button onClick={onOpenExams} className="self-start text-left text-[1.25rem] font-bold leading-snug">
              {next.name}
            </button>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="numeral text-[8.5rem] text-[var(--accent)]" aria-label={`${daysLeft} days until ${next.name}`}>
                {daysLeft}
              </span>
              <span className="text-[1.0625rem] font-semibold text-[var(--text-muted)]">
                {daysLeft === 1 ? 'day' : 'days'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="text-[1.25rem] font-bold leading-snug">No exam on the calendar</div>
            <button onClick={onOpenExams} className="mt-1 self-start text-left text-[0.9375rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4">
              Add one and every card gets scheduled before the day
            </button>
          </>
        )}

        <div className="mt-5 flex items-baseline gap-2">
          <span className="numeral text-[2rem]">{dueToday}</span>
          <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">
            {dueToday === 1 ? 'card due today' : 'cards due today'}
          </span>
        </div>

        {startDeck && dueToday > 0 ? (
          <button
            onClick={() => onStudy(startDeck.id)}
            className="on-accent mt-5 w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold lg:w-auto lg:self-start lg:px-10 lg:py-3"
          >
            Start today's {dueToday}
          </button>
        ) : (
          <div className="mt-5 rounded-[var(--r-full)] border border-[var(--rule)] py-4 text-center text-[0.9375rem] font-semibold text-[var(--text-muted)] lg:self-start lg:px-10 lg:py-3">
            Nothing due. Come back tomorrow.
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <div className="border-t border-[var(--rule)]">
          {rest.map((e) => (
            <button
              key={e.id}
              onClick={onOpenExams}
              className="flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left"
            >
              <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{e.name}</span>
              <span className="flex-shrink-0 text-[0.875rem] text-[var(--text-muted)]">{formatCountdown(daysUntil(e.date))}</span>
            </button>
          ))}
        </div>
      )}

      </div>

      <div>
        <div className="mb-3 text-[0.9375rem] font-bold">Decks</div>
        {/* One per row in the rail — a three-up grid only made sense while this was a full-width
            band under the countdown. */}
        <div className="flex flex-col gap-2 lg:gap-2.5">
          {[...active, ...paused].map((deck) => (
            <DeckTile key={deck.id} deck={deck} onClick={() => onStudy(deck.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}
