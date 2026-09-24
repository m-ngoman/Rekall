import { getDashboard, listDecks, listExams } from '../api'
import DeckTile from '../components/DeckTile'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil } from '../lib/dates'
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
    // Nothing, in a block the height of the countdown. "Loading…" at the top-left put a line of
    // text where the eye was already waiting for a number, then reflowed the page out from under
    // it. Reserving the height means the countdown lands where the placeholder was.
    return <div aria-busy className="min-h-[268px] lg:min-h-[400px]" />
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
  // What the button will actually deliver, which is not the same as `dueToday`. `dueToday` sums
  // every deck; a session is one deck. The button used to promise the sum and hand over one
  // deck's worth with no explanation, so it now names the deck and counts its cards.
  const startCount = startDeck ? startDeck.due + startDeck.new : 0
  const acrossDecks = withWork.length

  if (decks.length === 0) {
    return (
      <div className="flex flex-col gap-5 pt-6">
        <div className="text-[1.375rem] font-bold leading-snug">Nothing to remember yet.</div>
        <p className="max-w-sm text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
          Rekall quizzes you on your own notes and checks what you actually wrote. Add cards, link
          them to an exam date, and new cards get paced to land before the day.
        </p>
        <button onClick={onGoToCards} className="on-accent self-start rounded-[var(--r-full)] bg-[var(--accent)] px-6 py-3.5 text-[0.9375rem] font-bold">
          Add cards
        </button>
      </div>
    )
  }

  return (
    // Desktop is its own composition, not the phone column with a rail bolted on. The countdown
    // and the button take the left; the exam rows sit in a 320px column aligned to the bottom of
    // the countdown; the decks run full width underneath as a four-up grid. The phone stays a
    // single stacked column, with the same gap-8 rhythm.
    <div className="flex flex-col gap-8 pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end lg:gap-x-14 lg:gap-y-8">
      {/* `contents` at every width, so the countdown block and the exam rows are each a grid
          item of the parent rather than two things inside one. On a phone that means they flow
          in the parent's flex column with its gap; on desktop the countdown takes column one and
          the rows take the 320px column beside it, which is what stops the rows running the full
          width under the button. */}
      <div className="contents">
      <div className="flex flex-col">
        {next ? (
          <>
            <button onClick={onOpenExams} className="self-start text-left text-[1.25rem] font-bold leading-snug">
              {next.name}
            </button>
            <div className="mt-1 flex items-baseline gap-3">
              {/* 136px on a phone, 224px from lg — the design scales the countdown with the
                  screen rather than keeping one size, and it is the headline of the whole app.
                  Both numbers are measured off the mock's own Home boards. */}
              <span className="numeral text-[8.5rem] text-[var(--accent)] lg:text-[14rem]" aria-label={`${daysLeft} days until ${next.name}`}>
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
              Add one and new cards get paced to land before the day
            </button>
          </>
        )}

        <div className="mt-5 flex items-baseline gap-2">
          <span className="numeral text-[2rem]">{dueToday}</span>
          <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">
            {dueToday === 1 ? 'card due today' : 'cards due today'}
            {acrossDecks > 1 && `, across ${acrossDecks} decks`}
          </span>
        </div>

        {startDeck && dueToday > 0 ? (
          // 19px bold, not 17px. On the light theme the dark .on-accent text measures 3.9:1
          // against the accent fill, which fails AA at 17px but passes the 3:1 large-text
          // threshold at 19px — so the button keeps its dark-on-warm look in both themes rather
          // than flipping to a pale label in one of them. Height is unchanged; the padding gives
          // the two extra pixels back.
          <button
            onClick={() => onStudy(startDeck.id)}
            className="on-accent mt-5 w-full rounded-[var(--r-full)] bg-[var(--accent)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] lg:w-auto lg:self-start lg:px-9 lg:py-[0.6875rem]"
          >
            Start {startDeck.name}, {startCount} due
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
            // The count sets in the condensed face, which is what stops an exam row and a deck
            // row reading as the same row with different words in it.
            <button
              key={e.id}
              onClick={onOpenExams}
              className="flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left"
            >
              <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{e.name}</span>
              <span className="flex flex-shrink-0 items-baseline gap-1">
                <span className="numeral text-[1.125rem]">{daysUntil(e.date)}</span>
                <span className="text-[0.8125rem] text-[var(--text-muted)]">
                  {daysUntil(e.date) === 1 ? 'day' : 'days'}
                </span>
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
            <DeckTile key={deck.id} deck={deck} onClick={() => onStudy(deck.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}
