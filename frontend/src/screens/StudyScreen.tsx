import { useEffect, useRef, useState } from 'react'
import BackButton from '../components/BackButton'
import MaybeMath from '../components/MaybeMath'
import Notice from '../components/Notice'
import { PaymentRequired, addToStudyList, getStudyQueue, listExams, reportCard, revealAnswer, submitReviewStream, submitSelfAssessedReview, unreportCard } from '../api'

import { daysUntil } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import { upcomingExams } from '../lib/exams'
import { afterReport, type SessionStats } from '../lib/study'
import type { Exam, ReviewResult, StudyCard, StudyQueue } from '../types'

interface Props {
  deckId: string
  onExit: () => void
  /** False when AI grading is off in settings: the card reveals its answer and you rate your own
   * recall instead of typing an answer for the grader. */
  aiGrading: boolean
  /** Whether the tutor is switched on. Only decides whether the offer to save a missed card for
   * it is shown — the list itself is a note the student makes to themselves and is recorded
   * either way. */
  aiTutor: boolean
  /** Where a 402 on grading sends you. */
  onOpenPricing: () => void
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

/** "back in 6 days" — when the card comes round again, from its new FSRS due date. */
function formatDue(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'Back later today'
  if (days === 1) return 'Back tomorrow'
  return `Back in ${days} days`
}

/** What a phone keyboard can't reach. Unicode rather than LaTeX: the student is writing an
 * answer, not authoring notation, and the grader is explicitly told to accept these as equal to
 * the properly-typeset form. Ordered by how often a school-level answer needs them. */
const MATH_SYMBOLS = ['√', 'π', '²', '³', '^', '≤', '≥', '≠', '±', '×', '÷', '∫', 'θ', 'Δ', '∞', '°']

export default function StudyScreen({ deckId, onExit, aiGrading, aiTutor, onOpenPricing }: Props) {
  const [queue, setQueue] = useState<StudyCard[]>([])
  const [deckName, setDeckName] = useState('')
  const [current, setCurrent] = useState<StudyCard | null>(null)
  const [answer, setAnswer] = useState('')
  const [streamedExplanation, setStreamedExplanation] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [stats, setStats] = useState<SessionStats>({ total: 0, done: 0, correct: 0 })
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
  // 'done' is when the undo is on offer, and it only is once the report has landed: an undo sent
  // while the report is still in flight could reach the server first and be overtaken by it.
  const [report, setReport] = useState<'idle' | 'sending' | 'done' | 'undoing'>('idle')
  /** The session as it was before the report took the card out, for the undo to put back. */
  const beforeReport = useRef<{ queue: StudyCard[]; stats: SessionStats } | null>(null)
  const [queued, setQueued] = useState(false)
  // Phone only: the model answer, and the whole of what you wrote, behind one row once graded.
  // The desktop rail shows both beside the card; a phone has room for them only on request.
  const [comparing, setComparing] = useState(false)
  // Nothing was due and the student asked to review ahead. Changes nothing but the done screen's
  // wording: these are early reviews, not the day's.
  const [ahead, setAhead] = useState(false)
  const [later, setLater] = useState(0)
  const [waiting, setWaiting] = useState(0)
  // The last error was a 402: the panel gets a link to plans instead of just a sentence.
  const [paywall, setPaywall] = useState(false)
  const answerRef = useRef<HTMLTextAreaElement>(null)

  const startSession = (q: StudyQueue) => {
    setDeckName(q.deck_name)
    setLater(q.later)
    setWaiting(q.waiting)
    if (q.cards.length === 0) {
      setPhase('empty')
      return
    }
    const [first, ...rest] = q.cards
    setCurrent(first)
    setQueue(rest)
    setRelearn(new Set())
    setStats({ total: q.cards.length, done: 0, correct: 0 })
    setPhase('answering')
  }

  useEffect(() => {
    getStudyQueue(deckId)
      .then(startSession)
      // Without this the screen sat on "Loading…" indefinitely whenever the queue request failed.
      .catch(() => setPhase('unavailable'))
    listExams()
      .then(setExams)
      .catch(() => {})
  }, [deckId])

  /** "Nothing due" used to be a dead end with one way out, even from a tile that said "Study
   * anytime". This is the way in: the cards scheduled soonest, answered early. */
  const handleReviewAhead = async () => {
    setError(null)
    setPhase('loading')
    try {
      setAhead(true)
      startSession(await getStudyQueue(deckId, { ahead: true }))
    } catch (e) {
      setAhead(false)
      setPhase('empty')
      setError(errorMessage(e, "Couldn't load those cards."))
    }
  }

  const advance = () => {
    setAnswer('')
    setError(null)
    setResult(null)
    setStreamedExplanation('')
    setRevealed(null)
    setModelAnswer(null)
    setReport('idle')
    beforeReport.current = null
    setQueued(false)
    setComparing(false)
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
      setError(errorMessage(e, "That rating didn't save."))
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
      setPaywall(e instanceof PaymentRequired)
      setError(errorMessage(e, 'Grading failed.'))
    }
  }

  /** Puts a symbol where the caret is and leaves it there, so a student can keep typing.
   * Appending to the end instead would make anything but the last character a nuisance. */
  const insertSymbol = (sym: string) => {
    const el = answerRef.current
    if (!el) {
      setAnswer((a) => a + sym)
      return
    }
    const { selectionStart: start, selectionEnd: end } = el
    setAnswer((a) => a.slice(0, start) + sym + a.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + sym.length, start + sym.length)
    })
  }

  const handleAddToStudyList = async () => {
    if (!current) return
    try {
      await addToStudyList(current.id)
      setQueued(true)
    } catch (e) {
      setError(errorMessage(e, "Couldn't add that to your study list."))
    }
  }

  const handleReport = async () => {
    if (!current || report !== 'idle') return
    // Out of this session straight away, before the round-trip: the student has made their
    // judgement, and the card is going out of the queue either way. Only the confirmation waits
    // for the server. A failure here loses a report, not a card — so it says so and lets them try
    // again rather than pretending it worked.
    beforeReport.current = { queue, stats }
    const next = afterReport(queue, stats, current.id)
    setQueue(next.queue)
    setStats(next.stats)
    setReport('sending')
    try {
      await reportCard(current.id)
      setReport('done')
    } catch (e) {
      setReport('idle')
      setError(errorMessage(e, "Couldn't report that card."))
    }
  }

  /** Reporting takes a card out of every future review at one tap, so the tap gets an undo: the
   * card goes back into the schedule, and into this session where it was. */
  const handleUndoReport = async () => {
    if (!current || report !== 'done') return
    setReport('undoing')
    try {
      await unreportCard(current.id)
      if (beforeReport.current) {
        setQueue(beforeReport.current.queue)
        setStats(beforeReport.current.stats)
      }
      beforeReport.current = null
      setReport('idle')
    } catch (e) {
      setReport('done')
      setError(errorMessage(e, "Couldn't bring that card back."))
    }
  }

  const handleReveal = async () => {
    if (!current) return
    setError(null)
    try {
      setRevealed((await revealAnswer(current.id)).answer)
    } catch (e) {
      setError(errorMessage(e, "Couldn't load the answer."))
    }
  }

  // Cards still ahead of you, counting the one on screen. This is the number the header carries.
  const left = queue.length + (current ? 1 : 0)
  const nextExam = upcomingExams(exams.filter((e) => e.deck_ids.includes(deckId)))[0]

  if (phase === 'loading') return <p className="text-sm text-[var(--text-muted)]">Loading…</p>

  const header = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <BackButton onClick={onExit}>
          <span className="truncate">{deckName || 'Back'}</span>
        </BackButton>
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
          <button onClick={onExit} className="on-accent mt-6 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]">
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
        {later > 0 ? (
          <div>
            <div className="text-[1.25rem] font-bold leading-snug">Nothing due in this deck</div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
              Every card is scheduled for later. You can still review the next ones early: each is
              rescheduled from today, so nothing is wasted.
            </p>
            {error && <Notice tone="error" className="mt-5">{error}</Notice>}
            <button onClick={handleReviewAhead} className="on-accent mt-6 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]">
              Review ahead
            </button>
            <button
              onClick={onExit}
              className="mt-1.5 flex h-11 items-center text-[0.875rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4"
            >
              Back to Home
            </button>
          </div>
        ) : waiting > 0 ? (
          // Today's new cards are met and none of them is due again yet (or they were reported):
          // a deck done for the day, not an empty one, so "add some cards" would be wrong advice.
          <div>
            <div className="text-[1.25rem] font-bold leading-snug">Done for today</div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
              {waiting} new {waiting === 1 ? 'card is' : 'cards are'} still to come in this deck, a
              day's worth at a time. New cards per day, in Settings, sets how many a day brings.
            </p>
            <button onClick={onExit} className="on-accent mt-6 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]">
              Back to Home
            </button>
          </div>
        ) : (
          <div>
            <div className="text-[1.25rem] font-bold leading-snug">Nothing to review in this deck yet</div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
              Add some cards to it from the Cards tab and they'll show up here.
            </p>
            <button onClick={onExit} className="on-accent mt-6 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]">
              Back to Home
            </button>
          </div>
        )}
      </div>
    )
  }

  if (phase === 'done') {
    const pct = stats.done > 0 ? Math.round((stats.correct / stats.done) * 100) : 0
    return (
      <div className="flex flex-col gap-12">
        {header}
        <div>
          <div className="text-[1.25rem] font-bold leading-snug">{ahead ? 'Reviewed ahead' : 'Done for today'}</div>
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
          <button onClick={onExit} className="on-accent mt-8 w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]">
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
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
                <MaybeMath text={modelAnswer} math={current.is_math} />
              </p>
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
        <div className={`mt-2 font-bold leading-snug [text-wrap:pretty] ${graded ? 'text-[1.125rem]' : 'text-[1.5rem] lg:text-[2rem]'}`}>
          <MaybeMath text={current.question} math={current.is_math} />
        </div>
      </div>

      {!aiGrading ? (
        revealed !== null && (
          <div>
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">Answer</div>
            <div className="mt-1.5 text-[0.9375rem] leading-relaxed"><MaybeMath text={revealed} math={current.is_math} /></div>
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
        <div>
        <textarea
          ref={answerRef}
          autoFocus
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          placeholder="Type your answer"
          className="min-h-[132px] w-full resize-none rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-[var(--text-muted)]"
        />
        {current.is_math && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MATH_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                aria-label={`Insert ${sym}`}
                onClick={() => insertSymbol(sym)}
                className="h-9 min-w-[2.25rem] rounded-[var(--r-sm)] bg-[var(--surface)] px-2 text-[0.9375rem] font-semibold"
              >
                {sym}
              </button>
            ))}
          </div>
        )}
        </div>
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
          <p className={`text-[0.9375rem] leading-relaxed [text-wrap:pretty] ${graded ? 'mt-4' : ''}`}>
            <MaybeMath text={streamedExplanation} math={current.is_math} />
            {phase === 'grading' && <span className="ml-0.5 inline-block h-[18px] w-[2px] align-text-bottom bg-[var(--accent)]" />}
          </p>
          {/* Phone: what you wrote, three lines of it, and the model answer one tap below. The
              desktop rail shows the pair side by side; a phone used to show only the clipped half
              of it, in an app whose whole promise is the comparison. The explanation stays first,
              and opening the row un-clips your answer too, so the two read together. */}
          <div className="mt-5 border-t border-[var(--rule)] pt-3 lg:hidden">
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
            <p className={`mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)] ${comparing ? '' : 'line-clamp-3'}`}>
              {answer || <em>Nothing</em>}
            </p>
          </div>
          {graded && modelAnswer !== null && (
            <div className="mt-3 border-t border-[var(--rule)] lg:hidden">
              <button
                onClick={() => setComparing((open) => !open)}
                aria-expanded={comparing}
                className="flex w-full items-center justify-between py-3 text-[0.8125rem] font-semibold text-[var(--text-muted)]"
              >
                {comparing ? 'Model answer' : 'Show model answer'}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={comparing ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'} />
                </svg>
              </button>
              {comparing && (
                <p className="-mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)] [text-wrap:pretty]">
                  <MaybeMath text={modelAnswer} math={current.is_math} />
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sits directly above the action button, so the explanation and the retry are one glance
          apart. --grade-forgot rather than a new hue: the palette already owns one colour for
          "this did not go well", and a second would be a fifth thing to keep in step. */}
      {error && (
        <Notice tone="error" action={paywall ? { label: 'See plans', onClick: onOpenPricing } : undefined}>
          {error}
        </Notice>
      )}

      {!aiGrading && phase !== 'graded' ? (
        revealed === null ? (
          <button
            onClick={handleReveal}
            className="on-accent w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2]"
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
            className="on-accent w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] disabled:opacity-50 lg:w-auto lg:px-8 lg:py-[0.6875rem]"
          >
            {phase === 'grading' ? 'Checking' : 'Check my answer'}
          </button>
          <div className="mt-3 hidden text-[0.8125rem] text-[var(--text-muted)] lg:mt-0 lg:block">⌘ Enter also checks</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <button
            onClick={advance}
            className="on-accent w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] lg:w-auto lg:self-start lg:px-8 lg:py-[0.6875rem]"
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
          {/* "Save", not "Go over this with the tutor": that read as a way to the tutor, and the
              tap only adds the card to the list its next session opens on. */}
          {aiTutor && result !== null && result.grade <= 2 && (
            queued ? (
              <span className="self-start text-[0.8125rem] text-[var(--text-muted)] lg:self-auto">
                Saved. The tutor will start here next time.
              </span>
            ) : (
              <button
                onClick={handleAddToStudyList}
                className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto"
              >
                Save for tutor
              </button>
            )
          )}
          {/* The label says what the tap does. "This card doesn't look right" read like the start
              of a feedback form, and the tap reported and suspended the card outright. */}
          {report === 'done' || report === 'undoing' ? (
            <span className="flex items-baseline gap-2 self-start text-[0.8125rem] text-[var(--text-muted)] lg:self-auto">
              Removed from your reviews.
              <button
                onClick={handleUndoReport}
                disabled={report === 'undoing'}
                className="font-semibold text-[var(--text)] underline decoration-[var(--rule)] underline-offset-4"
              >
                Undo
              </button>
            </span>
          ) : (
            <button
              onClick={handleReport}
              disabled={report === 'sending'}
              className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto"
            >
              Report and remove this card
            </button>
          )}
        </div>
      )}
      </div>

      {rail}
    </div>
  )
}
