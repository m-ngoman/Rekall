import { useEffect, useState } from 'react'
import { getStudyQueue, listExams, revealAnswer, submitReviewStream, submitSelfAssessedReview } from '../api'
import { daysUntil } from '../lib/dates'
import type { Exam, ReviewResult, StudyCard } from '../types'

interface Props {
  deckId: string
  onExit: () => void
  /** False when AI grading is off in settings: the card reveals its answer and you rate your own
   * recall instead of typing an answer for the grader. */
  aiGrading: boolean
}

type Phase = 'loading' | 'answering' | 'grading' | 'graded' | 'done' | 'empty'

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

export default function StudyScreen({ deckId, onExit, aiGrading }: Props) {
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
  const [exams, setExams] = useState<Exam[]>([])

  useEffect(() => {
    getStudyQueue(deckId).then((q) => {
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
    listExams()
      .then(setExams)
      .catch(() => {})
  }, [deckId])

  const advance = () => {
    setAnswer('')
    setResult(null)
    setStreamedExplanation('')
    setRevealed(null)
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
    setStats((s) => ({ ...s, correct: s.correct + (res.grade >= 3 ? 1 : 0) }))
    if (res.grade === 1 && !relearn.has(card.id)) {
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
    applyResult(await submitSelfAssessedReview(current.id, grade), current)
  }

  const handleSubmit = async () => {
    if (!current) return
    setPhase('grading')
    setStreamedExplanation('')
    const res = await submitReviewStream(current.id, answer, (chunk) => {
      setStreamedExplanation((prev) => prev + chunk)
    })
    applyResult(res, current)
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
        {left > 0 && (
          <div className="flex flex-shrink-0 items-baseline gap-1.5">
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

  return (
    <div className="flex flex-col gap-10">
      {header}

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
          <div className="mt-5 border-t border-[var(--rule)] pt-3">
            <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
            <p className="mt-1.5 line-clamp-3 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{answer || <em>Nothing</em>}</p>
          </div>
        </div>
      )}

      {!aiGrading && phase !== 'graded' ? (
        revealed === null ? (
          <button
            onClick={async () => setRevealed((await revealAnswer(current.id)).answer)}
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
        <div>
          <button
            onClick={handleSubmit}
            disabled={phase === 'grading'}
            className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
          >
            {phase === 'grading' ? 'Checking' : 'Check my answer'}
          </button>
          <div className="mt-3 hidden text-center text-[0.8125rem] text-[var(--text-muted)] lg:block">⌘ Enter also checks</div>
        </div>
      ) : (
        <button onClick={advance} className="on-accent w-full rounded-[var(--r-full)] bg-[var(--accent)] py-4 text-[1.0625rem] font-bold">
          {queue.length > 0 ? `Next card, ${queue.length} left` : 'Finish'}
        </button>
      )}
    </div>
  )
}
