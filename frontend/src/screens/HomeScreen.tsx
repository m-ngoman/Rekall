import { useEffect, useState } from 'react'
import { getDashboard, listDecks, listExams } from '../api'
import DeckTile from '../components/DeckTile'
import LoadNotice from '../components/LoadNotice'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil } from '../lib/dates'
import { upcomingExams } from '../lib/exams'
import { comingBackLine, firstScheduledDay, homeDay, leftToday, pickStartDeck, type NextReview } from '../lib/home'
import { getLoad, loadCache, loadKey } from '../lib/load'
import type { Dashboard, Deck, Exam } from '../types'

interface Props {
  onStudy: (deckId: string) => void
  onGoToCards: () => void
  onOpenExams: () => void
  /** Whether answers are graded by the AI. Decides only the line under the button, which says
   * what a session is going to do. */
  aiGrading: boolean
}

/** Home is the countdown: the next exam, the days left, the cards due today, one button.
 * No greeting, no ring, no streak, no totals — the number is the whole message. */
export default function HomeScreen({ onStudy, onGoToCards, onOpenExams, aiGrading }: Props) {
  const [decks, , decksStatus] = useCachedResource<Deck[]>('decks', listDecks)
  const [exams, , examsStatus] = useCachedResource<Exam[]>('exams', listExams)
  const [dashboard, , dashboardStatus] = useCachedResource<Dashboard>('dashboard', getDashboard)
  const statuses = [decksStatus, examsStatus, dashboardStatus]
  const failed = statuses.some((s) => s.failed)
  const retry = () => statuses.filter((s) => s.failed).forEach((s) => s.retry())

  const active = decks?.filter((d) => !d.exam_paused) ?? []
  const upcoming = upcomingExams(exams)
  const next = upcoming[0]
  const withWork = active.filter((d) => leftToday(d) > 0)
  const startDeck = pickStartDeck(active, next)

  // Three different days, which used to share one sentence — see homeDay.
  const goalLeft = dashboard ? Math.max(0, dashboard.goal_today - dashboard.reviewed_today) : 0
  const day = dashboard ? homeDay(dashboard, startDeck !== undefined) : 'caught-up'
  const loaded = decks !== null && dashboard !== null && exams !== null
  const comingBack = useNextReview(loaded && day === 'caught-up')

  // All three, not just the two the countdown needs: rendering before the exams land put "No exam
  // on the calendar" on screen for a beat, a statement of absence about something that exists.
  if (!loaded) {
    if (failed) return <LoadNotice stale={false} what="your cards" onRetry={retry} className="mt-4" />
    // Nothing, in a block the height of the countdown. "Loading…" at the top-left put a line of
    // text where the eye was already waiting for a number, then reflowed the page out from under
    // it. Reserving the height means the countdown lands where the placeholder was.
    return <div aria-busy className="min-h-[268px] lg:min-h-[400px]" />
  }

  const paused = decks.filter((d) => d.exam_paused)
  const rest = upcoming.slice(1, 4)
  const daysLeft = next ? daysUntil(next.date) : null
  // What the button will actually deliver, which is not the same as the day's total. The total
  // sums every deck; a session is one deck. The button used to promise the sum and hand over one
  // deck's worth with no explanation, so it names the deck and counts its cards.
  const startCount = startDeck ? leftToday(startDeck) : 0
  const acrossDecks = withWork.length

  if (decks.length === 0) {
    return (
      <div className="flex flex-col gap-5 pt-6">
        {failed && <LoadNotice stale what="your cards" onRetry={retry} />}
        <div className="text-[1.375rem] font-bold leading-snug">Nothing to remember yet.</div>
        <p className="max-w-sm text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
          Rekall quizzes you on your own notes and checks what you actually wrote. Add cards, link
          them to an exam date, and new cards get paced to land before the day.
        </p>
        <button onClick={onGoToCards} className="on-accent self-start rounded-[var(--r-full)] px-6 py-3.5 text-[0.9375rem] font-bold">
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
      {failed && <LoadNotice stale what="your cards" onRetry={retry} className="lg:col-span-2" />}
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

        {day === 'due' ? (
          <div className="mt-5 flex items-baseline gap-2">
            <span className="numeral text-[2rem]">{goalLeft}</span>
            <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">
              {goalLeft === 1 ? 'card due today' : 'cards due today'}
              {acrossDecks > 1 && `, across ${acrossDecks} decks`}
            </span>
          </div>
        ) : (
          // Goal met or caught up, the number worth showing is what got done. Not shown at zero:
          // "0 reviewed" under "0 due" was the second of three ways the old page said "nothing".
          dashboard.reviewed_today > 0 && (
            <div className="mt-5 flex items-baseline gap-2">
              <span className="numeral text-[2rem]">{dashboard.reviewed_today}</span>
              <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">
                reviewed today{day === 'goal-met' && '.'}
                {day === 'goal-met' && <span className="text-[var(--text)]"> Daily goal complete.</span>}
              </span>
            </div>
          )
        )}

        {startDeck && day !== 'caught-up' ? (
          <>
            {/* 19px bold, like the study screen's buttons. That size was what let the dark label
                pass on the light accent as large text; the light theme's fill has since been
                lightened for exactly this (see .on-accent), so it no longer has to, but the button
                keeps its weight. Height is unchanged; the padding gives the two extra pixels back. */}
            <button
              onClick={() => onStudy(startDeck.id)}
              className="on-accent mt-5 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] lg:w-auto lg:self-start lg:px-9 lg:py-[0.6875rem]"
            >
              {/* No count on "Keep studying": past the goal it's optional, and the label has to
                  fit on one line at this size. The deck's tile below still says how many. */}
              {day === 'due' ? `Start ${startDeck.name}, ${startCount} due` : `Keep studying ${startDeck.name}`}
            </button>
            {/* The one line that says what the button leads to. The countdown can read as a
                countdown app on its own, weeks out; this is the loop the number is counting for. */}
            {aiGrading && (
              <p className="mt-2.5 text-[0.8125rem] text-[var(--text-muted)]">
                Answer in your own words. Rekall checks what you missed.
              </p>
            )}
          </>
        ) : (
          // Ordinary status text, not a pill. The old outlined "Nothing due. Come back tomorrow."
          // was drawn like a button, and a button with nothing behind it reads as a disabled one.
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
            <span className="font-bold text-[var(--text)]">You're caught up.</span>
            {comingBack && ` ${comingBackLine(comingBack)}`}
          </p>
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

/** The first day after this moment with cards on it, for "You're caught up" to say when they
 * come back. Read off the calendar's own load timeline, so Home and the calendar can't name
 * different days or different counts. Only fetched once there is nothing left today. */
function useNextReview(enabled: boolean): NextReview | null {
  const [next, setNext] = useState<NextReview | null>(null)
  useEffect(() => {
    if (!enabled) return
    // A day early, as the calendar's run-up does: the backend buckets by UTC day and never emits
    // one before its own today, which for anyone east of UTC can still be local yesterday.
    const from = new Date(Date.now() - 86_400_000)
    const to = new Date(Date.now() + 120 * 86_400_000)
    const key = loadKey(from, to)
    const cached = loadCache.get(key)
    if (cached) setNext(firstScheduledDay(cached))
    let alive = true
    getLoad(from, to)
      .then((byDay) => {
        if (!alive) return
        loadCache.set(key, byDay)
        setNext(firstScheduledDay(byDay))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled])
  return enabled ? next : null
}
