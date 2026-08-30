import { useEffect, useState } from 'react'
import { getStudyQueue, revealAnswer, submitReviewStream, submitSelfAssessedReview } from '../api'
import type { ReviewResult, StudyCard } from '../types'

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
  { grade: 4, label: 'Easy', token: 'easy' },
] as const

export default function StudyScreen({ deckId, onExit, aiGrading }: Props) {
  const [, setQueue] = useState<StudyCard[]>([])
  const [current, setCurrent] = useState<StudyCard | null>(null)
  const [answer, setAnswer] = useState('')
  const [streamedExplanation, setStreamedExplanation] = useState('')
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [stats, setStats] = useState({ total: 0, done: 0, correct: 0 })
  const [relearn, setRelearn] = useState<Set<string>>(new Set())
  // Self-assessment only: the answer is fetched on demand, so null means 'not revealed yet'.
  const [revealed, setRevealed] = useState<string | null>(null)

  useEffect(() => {
    getStudyQueue(deckId).then((q) => {
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

  if (phase === 'loading') return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>

  if (phase === 'empty') {
    return <EndPanel icon="📭" title="Nothing due!" subtitle="All caught up. Come back later." onExit={onExit} />
  }

  if (phase === 'done') {
    const pct = stats.done > 0 ? Math.round((stats.correct / stats.done) * 100) : 0
    return (
      <EndPanel
        icon={pct >= 80 ? '🎉' : pct >= 60 ? '💪' : '📖'}
        title="Session complete"
        subtitle={`${stats.done} cards · ${pct}% correct`}
        onExit={onExit}
      />
    )
  }

  if (!current) return null

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <button onClick={onExit} className="text-sm font-bold text-[var(--text-secondary)]">
          ← Back
        </button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ring-track)]">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%`, background: 'var(--accent)' }}
          />
        </div>
        <span className="whitespace-nowrap text-xs font-bold text-[var(--text-secondary)]">
          {stats.done}/{stats.total}
        </span>
      </div>

      <div className="mb-5 flex flex-col gap-5 rounded-[20px] bg-[var(--bg-card)] p-7" style={{ boxShadow: 'var(--shadow-md)' }}>
        <div className="flex items-center gap-2">
          {current.subtopic && (
            <span
              className="self-start rounded-full px-3 py-1 text-xs font-bold"
              style={{
                color: 'var(--accent)',
                background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))',
                boxShadow: 'var(--highlight-shadow)',
              }}
            >
              {current.subtopic}
            </span>
          )}
          {current.is_new && (
            <span className="rounded-full px-2.5 py-1 text-[0.625rem] font-extrabold" style={{ color: 'var(--grade-good)', background: 'var(--grade-good-bg)' }}>
              New
            </span>
          )}
        </div>

        <div className="text-[1.375rem] font-bold leading-snug">{current.question}</div>

        {!aiGrading ? (
          revealed !== null && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-xs font-bold text-[var(--text-secondary)]">Answer</div>
                <div className="text-base leading-relaxed">{revealed}</div>
              </div>
              {/* Confirms what actually got recorded — you chose it, but seeing it land is the
                  difference between "I tapped Hard" and "Hard was saved". */}
              {result && <GradeBadge grade={result.grade} />}
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
            placeholder="Type your answer… (⌘/Ctrl+Enter to submit)"
            className="min-h-[84px] w-full rounded-2xl bg-[var(--bg)] p-4 text-sm outline-none"
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-xs font-bold text-[var(--text-secondary)]">Your answer</div>
              <div className="text-base">{answer || <em>(no answer)</em>}</div>
            </div>
            {result && <GradeBadge grade={result.grade} />}
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {streamedExplanation}
              {phase === 'grading' && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm align-middle" style={{ background: 'var(--text-secondary)' }} />
              )}
            </p>
          </div>
        )}
      </div>

      {!aiGrading && phase !== 'graded' ? (
        revealed === null ? (
          <button
            onClick={async () => setRevealed((await revealAnswer(current.id)).answer)}
            className="w-full rounded-full py-4 text-sm font-bold text-[oklch(0.99_0.005_90)]"
            style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
          >
            Show answer
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
                className="rounded-full py-4 text-sm font-bold disabled:opacity-50"
                style={{ color: `var(--grade-${token})`, background: `var(--grade-${token}-bg)` }}
              >
                {label}
              </button>
            ))}
          </div>
        )
      ) : phase === 'answering' || phase === 'grading' ? (
        <button
          onClick={handleSubmit}
          disabled={phase === 'grading'}
          className="w-full rounded-full py-4 text-sm font-bold text-[oklch(0.99_0.005_90)] disabled:opacity-50"
          style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
        >
          {phase === 'grading' ? 'Grading…' : 'Submit Answer'}
        </button>
      ) : (
        <button
          onClick={advance}
          className="w-full rounded-full py-4 text-sm font-bold text-[oklch(0.99_0.005_90)]"
          style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
        >
          Next →
        </button>
      )}
    </div>
  )
}

function EndPanel({
  icon,
  title,
  subtitle,
  onExit,
}: {
  icon: string
  title: string
  subtitle: string
  onExit: () => void
}) {
  return (
    <div className="rounded-[20px] bg-[var(--bg-card)] py-16 text-center" style={{ boxShadow: 'var(--shadow-md)' }}>
      <div className="mb-4 text-5xl">{icon}</div>
      <div className="mb-1.5 text-xl font-extrabold">{title}</div>
      <p className="mb-7 text-sm text-[var(--text-secondary)]">{subtitle}</p>
      <button
        onClick={onExit}
        className="rounded-full px-6 py-3 text-sm font-bold text-[oklch(0.99_0.005_90)]"
        style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
      >
        ← My Decks
      </button>
    </div>
  )
}

function GradeBadge({ grade }: { grade: number }) {
  const map: Record<number, { label: string; color: string; bg: string }> = {
    1: { label: 'Forgot', color: 'var(--grade-forgot)', bg: 'var(--grade-forgot-bg)' },
    2: { label: 'Hard', color: 'var(--grade-hard)', bg: 'var(--grade-hard-bg)' },
    3: { label: 'Good', color: 'var(--grade-good)', bg: 'var(--grade-good-bg)' },
    4: { label: 'Easy', color: 'var(--accent)', bg: 'color-mix(in oklab, var(--accent) 16%, var(--bg-card))' },
  }
  const { label, color, bg } = map[grade] ?? map[1]
  return (
    <span className="inline-block self-start rounded-full px-4 py-1.5 text-xs font-extrabold" style={{ background: bg, color }}>
      {label}
    </span>
  )
}
