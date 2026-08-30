import { getDashboard, listDecks, listExams } from '../api'
import DeckTile from '../components/DeckTile'
import Logo from '../components/Logo'
import { useCachedResource } from '../hooks/useCachedResource'
import { daysUntil, formatCountdown } from '../lib/dates'
import type { Dashboard, Deck, Exam } from '../types'

interface Props {
  onStudy: (deckId: string) => void
  onGoToCards: () => void
  onOpenExams: () => void
}

const CIRCUMFERENCE = 2 * Math.PI * 39

export default function HomeScreen({ onStudy, onGoToCards, onOpenExams }: Props) {
  const [decks] = useCachedResource<Deck[]>('decks', listDecks, () => [])
  const [exams] = useCachedResource<Exam[]>('exams', listExams, () => [])
  const [dashboard] = useCachedResource<Dashboard>('dashboard', getDashboard, () => ({
    reviewed_today: 0,
    goal_today: 0,
    streak_days: 0,
  }))

  if (decks === null || dashboard === null) {
    return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
  }

  const pct = dashboard.goal_today > 0 ? Math.min(1, dashboard.reviewed_today / dashboard.goal_today) : 1
  const remaining = Math.max(0, dashboard.goal_today - dashboard.reviewed_today)

  // Paused decks (all their exams passed) are off the daily plate: excluded from the Due/New sums
  // so these tiles agree with the server-filtered goal ring, and listed after the active decks.
  const active = decks.filter((d) => !d.exam_paused)
  const paused = decks.filter((d) => d.exam_paused)

  // A deck cramming for the nearest exam wins "Jump back in"; otherwise the old due>new order.
  const withWork = active.filter((d) => d.due > 0 || d.new > 0)
  const nearestExamDeck = withWork
    .filter((d) => d.next_exam)
    .sort((a, b) => a.next_exam!.date.localeCompare(b.next_exam!.date))[0]
  const jumpBackTo =
    nearestExamDeck ?? active.find((d) => d.due > 0) ?? active.find((d) => d.new > 0) ?? active[0] ?? decks[0]

  const totalCards = decks.reduce((sum, d) => sum + d.total, 0)
  const totalDue = active.reduce((sum, d) => sum + d.due, 0)
  const totalNew = active.reduce((sum, d) => sum + d.new, 0)

  const upcomingExams = (exams ?? [])
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)

  if (decks.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-5 rounded-[20px] bg-[var(--bg-card)] px-8 py-16 text-center"
        style={{ boxShadow: 'var(--shadow-md)' }}
      >
        <Logo size={92} />
        <div>
          <div className="mb-1.5 text-lg font-extrabold">Welcome to Rekall</div>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
            Rekall quizzes you on your own notes and checks what you actually wrote or said — not
            just whether you tapped "I knew it". Start by getting some cards in.
          </p>
        </div>
        <button
          onClick={onGoToCards}
          className="mt-1 rounded-xl px-6 py-3 text-sm font-bold text-[oklch(0.99_0.005_90)]"
          style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
        >
          Add cards →
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex items-center gap-5 rounded-[20px] bg-[var(--bg-card)] p-5 lg:p-6" style={{ boxShadow: 'var(--shadow-md)' }}>
          <div className="relative h-[92px] w-[92px] flex-shrink-0 lg:h-[104px] lg:w-[104px]">
            <svg width="100%" height="100%" viewBox="0 0 92 92">
              <circle cx="46" cy="46" r="39" fill="none" stroke="var(--ring-track)" strokeWidth="10" />
              <circle
                cx="46"
                cy="46"
                r="39"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${pct * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                transform="rotate(-90 46 46)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold leading-none">{dashboard.reviewed_today}</span>
              <span className="text-[0.625rem] font-semibold text-[var(--text-secondary)]">of {dashboard.goal_today}</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="var(--streak)"
                  d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-1-2-1-2 2 1 3 3 3 5a5 5 0 0 1-10 0c0-5 3-6 5-11z"
                />
              </svg>
              <span className="text-[0.9375rem] font-bold">{dashboard.streak_days}-day streak</span>
            </div>
            <div className="text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]">
              {remaining > 0
                ? `You're on a roll — ${remaining} more card${remaining > 1 ? 's' : ''} to hit today's goal.`
                : 'All caught up for today. Nice work!'}
            </div>
          </div>
        </div>

        {/* Was desktop-only, which had it backwards — one-tap resume matters most on mobile. */}
        {jumpBackTo && (
          <div className="flex flex-col justify-center gap-2.5 rounded-[20px] bg-[var(--bg-card)] p-5 lg:p-6" style={{ boxShadow: 'var(--shadow-md)' }}>
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Jump back in</div>
            <div className="text-lg font-extrabold">{jumpBackTo.name}</div>
            <div className="mb-1.5 text-[0.84375rem] text-[var(--text-secondary)]">
              {jumpBackTo.due} due · {jumpBackTo.new} new
            </div>
            <button
              onClick={() => onStudy(jumpBackTo.id)}
              className="self-start rounded-xl px-5 py-2.5 text-sm font-bold text-[oklch(0.99_0.005_90)]"
              style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
            >
              Study now →
            </button>
          </div>
        )}
      </div>

      {/* At-a-glance totals across every deck — the deck list below answers "which one", this
          answers "how much is on my plate overall", which nothing else on the page did. */}
      <div className="grid grid-cols-4 gap-2.5 lg:gap-4">
        <StatTile label="Decks" value={decks.length} />
        <StatTile label="Cards" value={totalCards} />
        <StatTile label="Due" value={totalDue} accent={totalDue > 0 ? 'var(--grade-forgot)' : undefined} />
        <StatTile label="New" value={totalNew} accent={totalNew > 0 ? 'var(--accent)' : undefined} />
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-base font-extrabold">Exams</span>
          <button onClick={onOpenExams} className="text-xs font-bold text-[var(--accent)]">
            Calendar →
          </button>
        </div>
        {upcomingExams.length === 0 ? (
          <button
            onClick={onOpenExams}
            className="w-full rounded-[16px] border border-dashed border-[var(--ring-track)] px-4 py-4 text-center text-sm font-semibold text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
          >
            + Add an exam date — linked decks get every card in before the day
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingExams.map((e) => {
              const days = daysUntil(e.date)
              return (
                <button
                  key={e.id}
                  onClick={onOpenExams}
                  className="flex items-center gap-3 rounded-[16px] border border-[var(--ring-track)] px-4 py-3 text-left hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9375rem] font-bold">{e.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {e.deck_ids.length} deck{e.deck_ids.length === 1 ? '' : 's'} linked
                    </div>
                  </div>
                  <span
                    className="flex-shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold"
                    style={{ color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-card))' }}
                  >
                    {formatCountdown(days)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 text-base font-extrabold">Your Decks</div>
        <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
          {[...active, ...paused].map((deck, i) => (
            <DeckTile key={deck.id} deck={deck} index={i} onClick={() => onStudy(deck.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--ring-track)] px-3 py-3 text-center lg:py-4">
      <div className="text-xl font-extrabold leading-none lg:text-2xl" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}
