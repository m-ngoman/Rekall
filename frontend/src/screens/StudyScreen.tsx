import { useEffect, useState } from 'react'
import { NotSignedIn, addToStudyList, getStudyQueue, listExams, reportCard, revealAnswer, submitReviewStream, submitSelfAssessedReview } from '../api'
import { daysUntil } from '../lib/dates'
import type { Exam, ReviewResult, StudyCard } from '../types'

interface Props {
  deckId: string
  onExit: () => void
  /** False when AI grading is off in settings: the card reveals its answer and you rate your own
   * recall instead of typing an answer for the grader. */
  aiGrading: boolean
  /** Whether the tutor is switched on. Only decides whether the offer to go over a missed card is
   * shown — the list itself is a note the student makes to themselves and is recorded either way. */
  aiTutor: boolean
}

type Phase = 'loading' | 'answering' | 'grading' | 'graded' | 'done' | 'empty' | 'unavailable'

/** Self-assessment ratings, in the order they're shown. Same 1-4 FSRS scale the grader emits —
 * nothing downstream can tell the difference, which is exactly why this path is cheap. */
const SELF_GRADES = [
  { grade: 1, label: 'Forgot', token: 'forgot' },
  { grade: 2, label: 'Hard', token: 'hard' },
  { grade: 3, label: 'Good', token: 'good' },
  { grade: 4, label: 'Easy', token: 'good' },
] as const

const GRADE_LABEL: Record<number, string> = { 1: 'Forgot', 2: 'Hard', 3: 'Good', 4: 'Easy' }
/** Grade colours are the one non-accent hue in the app: they're feedback, not decoration.
 * Easy shares Good's green — two greens would ask the eye to tell 3 from 4, and the word does that. */
const GRADE_COLOR: Record<number, string> = {
  1: 'var(--grade-forgot)',
  2: 'var(--grade-hard)',
  3: 'var(--grade-good)',
  4: 'var(--grade-good)',
}

/** What to put on screen for a failed action.
 *
 * The backend's streaming endpoints send a written sentence when they fail mid-stream, and that
 * sentence is better than anything this file could invent — so it is preferred. What is filtered
 * out is the machine wording: a bare `500 Internal Server Error: ...` dump tells a student
 * nothing, and `fetch` says "Failed to fetch" when the network drops.
 */
function message(error: unknown, fallback: string): string {
  if (error instanceof NotSignedIn) return 'You have been signed out. Reload to sign in again.'
  if (!(error instanceof Error)) return fallback
  const raw = error.message
  if (!raw || /^\d{3}\s/.test(raw) || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return `${fallback} Check your connection and try again.`
  }
  return raw
}

/** "back in 6 days" — when the card comes round again, from its new FSRS due date. */
function formatDue(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'Back later today'
  if (days === 1) return 'Back tomorrow'
  return `Back in ${days} days`
}

export default function StudyScreen({ deckId, onExit, aiGrading, aiTutor }: Props) {
  const [queue, setQueue] = useState<StudyCard[]>([])
  const [deckName, setDeckName] = useState('')
  const [current, setCurrent] = useState<StudyCard | null>(null)
  const [answer, setAnswer] = useState('')
  const [streamedExplanation, setStreamedExplanation] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [stats, setStats] = useState({ total: 0, done: 0, correct: 0 })
  const [relearn, setRelearn] = useState<Set<string>>(new Set())
  // Self-assessment only: the answer is fetched on demand, so null means 'not revealed yet'.
  const [revealed, setRevealed] = useState<string | null>(null)
  // The reference answer shown in the desktop rail once a card has been graded. Same on-demand
  // endpoint as `revealed` — the queue payload deliberately withholds answers so it can't leak
  // them before the cards are attempted, and that stays true whichever way we ask for one.
  const [modelAnswer, setModelAnswer] = useState<string | null>(null)
  const [exams, setExams] = useState<Exam[]>([])
  // Anything that went wrong in the last action. Study is a loop with no other way out: a
  // failed grade used to leave `phase` on 'grading' forever, with the only button disabled and
  // reading "Checking". Showing the reason and returning to 'answering' is what makes it a
  // retry rather than a dead end.
  const [error, setError] = useState<string | null>(null)
  // Reporting is a per-card thing, so this resets with the card rather than with the session.
  const [reported, setReported] = useState(false)
  const [queued, setQueued] = useState(false)

  useEffect(() => {
    getStudyQueue(deckId)
      .then((q) => {
        setDeckName(q.deck_name)
        if (q.cards.length === 0) {
          setPhase('empty')
          return
        }
        const [first, ...rest] = q.cards
        setCurrent(first)
        setQueue(rest)
        setStats({ total: q.cards.length, done: 0, correct: 0 })
        setPhase('answering')
      })
      // Without this the screen sat on "Loading…" indefinitely whenever the queue request failed.
      .catch(() => setPhase('unavailable'))
    listExams()
      .then(setExams)
      .catch(() => {})
  }, [deckId])

  const advance = () => {
    setAnswer('')
    setError(null)
    setResult(null)
    setStreamedExplanation('')
    setRevealed(null)
    setModelAnswer(null)
    setReported(false)
    setQueued(false)
    setQueue((prevQueue) => {
      if (prevQueue.length === 0) {
        setCurrent(null)
        setPhase('done')
        return prevQueue
      }
      const [next, ...rest] = prevQueue
      setCurrent(next)
      setPhase('answering')
      return rest
    })
  }

  /** The bookkeeping after any grade, whoever produced it: a 1 puts the card back in this
   * session's queue once, anything else counts as done. Shared so the self-assessed path can't
   * drift away from the graded one. */
  const applyResult = (res: ReviewResult, card: StudyCard) => {
    setResult(res)
    setPhase('graded')
    // Only the desktop rail shows this, but it's fetched either way: the request is small and
    // gating it on a media query would make the rail pop in a beat late on a resize.
    revealAnswer(card.id)
      .then((r) => setModelAnswer(r.answer))
      .catch(() => {})
    // "Right first time" has to mean that. A card you forgot goes back in the queue, and getting
    // it right on the second showing was counted here as if it had never been missed — which made
    // the end-of-session percentage climb the more you struggled.
    const firstAttempt = !relearn.has(card.id)
    setStats((s) => ({ ...s, correct: s.correct + (firstAttempt && res.grade >= 3 ? 1 : 0) }))
    if (res.grade === 1 && firstAttempt) {
      setRelearn((prev) => new Set(prev).add(card.id))
      setQueue((prev) => [...prev, card])
      setStats((s) => ({ ...s, total: s.total + 1 }))
    } else {
      setStats((s) => ({ ...s, done: s.done + 1 }))
    }
  }

  const handleSelfGrade = async (grade: number) => {
    if (!current) return
    setPhase('grading')
    setError(null)
    try {
      applyResult(await submitSelfAssessedReview(current.id, grade), current)
    } catch (e) {
      setPhase('answering')
      setError(message(e, "That rating didn't save."))
    }
  }

  const handleSubmit = async () => {
    if (!current) return
    setPhase('grading')
    setStreamedExplanation('')
    setError(null)
    try {
      const res = await submitReviewStream(current.id, answer, (chunk) => {
        setStreamedExplanation((prev) => prev + chunk)
      })
      applyResult(res, current)
    } catch (e) {
      // Back to 'answering' with what they typed intact, so retrying is one tap and not a retype.
      setPhase('answering')
      setStreamedExplanation('')
      setError(message(e, 'Grading failed.'))
    }
  }

  const handleAddToStudyList = async () => {
    if (!current) return
    try {
      await addToStudyList(current.id)
      setQueued(true)
    } catch (e) {
      setError(message(e, "Couldn't add that to your study list."))
    }
  }

  const handleReport = async () => {
    if (!current) return
    // Marked reported straight away rather than after the round-trip: the student has made their
    // judgement, and the card is going out of the queue either way. A failure here loses a report,
    // not a card — so it says so and lets them try again rather than pretending it worked.
    try {
      await reportCard(current.id)
      setReported(true)
    } catch (e) {
      setError(message(e, "Couldn't report that card."))
    }
  }

  const handleReveal = async () => {
    if (!current) return
    setError(null)
    try {
      setRevealed((await revealAnswer(current.id)).answer)
    } catch (e) {
      setError(message(e, "Couldn't load the answer."))
    }
  }

  // Cards still ahead of you, counting the one on screen. This is the number the header carries.
  const left = queue.length + (current ? 1 : 0)
  const nextExam = exams
    .filter((e) => e.deck_ids.includes(deckId) && daysUntil(e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  if (phase === 'loading') return <p className="text-sm text-[var(--text-muted)]">Loading…</p>

  const header = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button onClick={onExit} className="-ml-2 flex h-11 items-center gap-1.5 rounded-[var(--r-sm)] px-2 text-[0.9375rem] font-semibold text-[var(--text-muted)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="truncate">{deckName || 'Back'}</span>
        </button>
        {/* Phone only: on a wide screen the count is the rail's headline instead, at four times
            this size, and having it in both places would say the same thing twice. */}
        {left > 0 && (
          <div className="flex flex-shrink-0 items-baseline gap-1.5 lg:hidden">
            <span className="numeral text-[1.75rem]">{left}</span>
            <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">left</span>
          </div>
        )}
      </div>
      {/* The session's load, draining: track is everything queued, fill is what's done. */}
      <div className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-[var(--rule)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%` }} />
      </div>
    </div>
  )

  if (phase === 'unavailable') {
    return (
      <div className="flex flex-col gap-10">
        {header}
        <div>
          <div className="text-[1.25rem] font-bold leading-snug">Couldn't load this deck</div>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
            Something went wrong fetching today's cards. Your progress is safe.
          </p>
          <button onClick={onExit} className="on-accent mt-6 w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold">
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'empty') {
    return (
      <div className="flex flex-col gap-10">
        {header}
        <div>
          <div className="text-[1.25rem] font-bold leading-snug">Nothing due in this deck</div>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">Every card is scheduled for later. Come back when the calendar says so.</p>
          <button onClick={onExit} className="on-accent mt-6 w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold">
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    const pct = stats.done > 0 ? Math.round((stats.correct / stats.done) * 100) : 0
    return (
      <div className="flex flex-col gap-12">
        {header}
        <div>
          <div className="text-[1.25rem] font-bold leading-snug">Done for today</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="numeral text-[8.5rem] text-[var(--accent)]">{stats.done}</span>
            <span className="text-[1.0625rem] font-semibold text-[var(--text-muted)]">{stats.done === 1 ? 'card' : 'cards'}</span>
          </div>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="numeral text-[2rem]">{pct}%</span>
            <span className="text-[0.9375rem] font-semibold text-[var(--text-muted)]">right first time</span>
          </div>
          {nextExam && (
            <div className="mt-7 border-t border-[var(--rule)]">
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5">
                <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{nextExam.name}</span>
                <span className="flex-shrink-0 text-[0.875rem] text-[var(--text-muted)]">
                  <span className="numeral text-[1rem] text-[var(--text)]">{daysUntil(nextExam.date)}</span> days left
                </span>
              </div>
            </div>
          )}
          <button onClick={onExit} className="on-accent mt-8 w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold">
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!current) return null

  const graded = phase === 'graded' && result !== null
  const gradeColor = result ? GRADE_COLOR[result.grade] ?? GRADE_COLOR[1] : undefined
  const score = result?.score ?? null

  /** The desktop rail. Wide screens have room the phone doesn't, and the design spends it on the
   * things you want beside the card rather than under it: how much is left, and — once a card is
   * graded — what you wrote next to what the card actually says. Hidden below `lg`, where every
   * one of these has its own place in the single column. */
  const rail = (
    <aside className="hidden lg:flex lg:flex-col lg:gap-6">
      {left > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="numeral text-[6rem]">{left}</span>
          <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">left</span>
        </div>
      )}

      {graded ? (
        <div className="flex flex-col gap-5">
          <div className="border-t border-[var(--rule)] pt-3">
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{answer || <em>Nothing</em>}</p>
          </div>
          {modelAnswer && (
            <div className="border-t border-[var(--rule)] pt-3">
              <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">Model answer</div>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{modelAnswer}</p>
            </div>
          )}
        </div>
      ) : (
        // Answering: the session so far. Not shown once graded, where the card itself is the
        // subject and these numbers would compete with the score.
        <div className="border-t border-[var(--rule)]">
          {[
            { label: 'Done', value: `${stats.done}` },
            { label: 'Right first time', value: `${stats.correct} of ${stats.done}` },
            ...(nextExam ? [{ label: 'Exam', value: `${daysUntil(nextExam.date)} days` }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-2.5">
              <span className="text-[0.8125rem] text-[var(--text-muted)]">{label}</span>
              <span className="text-[0.8125rem] font-semibold">{value}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )

  return (
    <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-[4.5rem] lg:gap-y-10">
      <div className="lg:col-span-2">{header}</div>

      {/* The card's own column. On a phone this contents-collapses so its children stay direct
          children of the page's flex column and keep the gap-10 rhythm; from `lg` it becomes the
          grid's first cell, with the rail beside it. */}
      <div className="contents lg:flex lg:flex-col lg:gap-10">
      <div>
        {current.subtopic && <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{current.subtopic}</div>}
        <div className={`mt-2 font-bold leading-snug [text-wrap:pretty] ${graded ? 'text-[1.125rem]' : 'text-[1.5rem] lg:text-[2rem]'}`}>{current.question}</div>
      </div>

      {!aiGrading ? (
        revealed !== null && (
          <div>
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">Answer</div>
            <div className="mt-1.5 text-[0.9375rem] leading-relaxed">{revealed}</div>
            {/* Confirms what actually got recorded — you chose it, but seeing it land is the
                difference between "I tapped Hard" and "Hard was saved". */}
            {result && (
              <div className="mt-5 text-[1.5rem] font-bold" style={{ color: gradeColor }}>
                {GRADE_LABEL[result.grade]}
                <span className="ml-2.5 text-[0.875rem] font-medium text-[var(--text-muted)]">{formatDue(result.due)}</span>
              </div>
            )}
          </div>
        )
      ) : phase === 'answering' ? (
        <textarea
          autoFocus
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          placeholder="Type your answer"
          className="min-h-[132px] w-full resize-none rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-[var(--text-muted)]"
        />
      ) : (
        <div>
          {/* The score is the hero: a numeral out of 5 in its grade colour. While grading, the
              explanation streams in first and the number lands with it. */}
          {graded && (
            <>
              <div className="flex items-end gap-4" style={{ color: gradeColor }}>
                {score !== null && (
                  <div className="flex items-baseline gap-1">
                    <span className="numeral text-[4.5rem]">{score}</span>
                    <span className="numeral text-[1.75rem] opacity-70">/5</span>
                  </div>
                )}
                <div className="pb-1">
                  <div className="text-[1.0625rem] font-bold">{GRADE_LABEL[result.grade]}</div>
                  <div className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{formatDue(result.due)}</div>
                </div>
              </div>
              {score !== null && (
                <div aria-hidden className="mt-4 flex gap-[3px]">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className="h-[3px] flex-1 rounded-[2px]" style={{ background: n <= score ? gradeColor : 'var(--rule)' }} />
                  ))}
                </div>
              )}
            </>
          )}
          <p className={`text-[0.9375rem] leading-relaxed ${graded ? 'mt-4' : ''}`}>
            {streamedExplanation}
            {phase === 'grading' && <span className="ml-0.5 inline-block h-[18px] w-[2px] align-text-bottom bg-[var(--accent)]" />}
          </p>
          <div className="mt-5 border-t border-[var(--rule)] pt-3 lg:hidden">
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
            <p className="mt-1.5 line-clamp-3 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{answer || <em>Nothing</em>}</p>
          </div>
        </div>
      )}

      {/* Sits directly above the action button, so the explanation and the retry are one glance
          apart. --grade-forgot rather than a new hue: the palette already owns one colour for
          "this did not go well", and a second would be a fifth thing to keep in step. */}
      {error && (
        <div
          role="alert"
          className="rounded-[var(--r-md)] bg-[var(--grade-forgot-bg)] px-4 py-3 text-[0.875rem] leading-relaxed"
          style={{ color: 'var(--grade-forgot)' }}
        >
          {error}
        </div>
      )}

      {!aiGrading && phase !== 'graded' ? (
        revealed === null ? (
          <button
            onClick={handleReveal}
            className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold"
          >
            Show the answer
          </button>
        ) : (
          // Four buttons rather than a "did you get it?" yes/no: FSRS needs the full 1-4 spread to
          // schedule well, and collapsing it would quietly make the algorithm worse.
          <div className="grid grid-cols-4 gap-2">
            {SELF_GRADES.map(({ grade, label, token }) => (
              <button
                key={grade}
                onClick={() => handleSelfGrade(grade)}
                disabled={phase === 'grading'}
                className="rounded-[var(--r-full)] bg-[var(--surface)] py-3.5 text-[0.875rem] font-bold disabled:opacity-50"
                style={{ color: `var(--grade-${token})` }}
              >
                {label}
              </button>
            ))}
          </div>
        )
      ) : phase === 'answering' || phase === 'grading' ? (
        <div className="lg:flex lg:items-center lg:gap-4">
          <button
            onClick={handleSubmit}
            disabled={phase === 'grading'}
            className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50 lg:w-auto lg:px-8 lg:py-3"
          >
            {phase === 'grading' ? 'Checking' : 'Check my answer'}
          </button>
          <div className="mt-3 hidden text-[0.8125rem] text-[var(--text-muted)] lg:mt-0 lg:block">⌘ Enter also checks</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <button
            onClick={advance}
            className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold lg:w-auto lg:self-start lg:px-8 lg:py-3"
          >
            {queue.length > 0 ? `Next card, ${queue.length} left` : 'Finish'}
          </button>
          {/* Offered after grading rather than before, so a card can't be dismissed instead of
              attempted — and this is the point where the student has seen the model answer and
              actually knows whether the card was wrong. It is the only check on cards generated
              from a topic rather than from their own notes, which have no review screen by
              design. Muted, not accent: it's an escape hatch, not an action to encourage. */}
          {/* Only on a card they actually missed. Offering to queue a card they just got right
              would be noise on the majority of reviews, and the tutor's list is worth more when
              everything on it is there for a reason. */}
          {aiTutor && result !== null && result.grade <= 2 && (
            queued ? (
              <span className="self-start text-[0.8125rem] text-[var(--text-muted)] lg:self-auto">
                Added — the tutor will start here.
              </span>
            ) : (
              <button
                onClick={handleAddToStudyList}
                className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto"
              >
                Go over this with the tutor
              </button>
            )
          )}
          {!reported ? (
            <button
              onClick={handleReport}
              className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto"
            >
              This card doesn't look right
            </button>
          ) : (
            <span className="self-start text-[0.8125rem] text-[var(--text-muted)] lg:self-auto">
              Reported. You won't see it again.
            </span>
          )}
        </div>
      )}
      </div>

      {rail}
    </div>
  )
}
