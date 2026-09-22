import { daysUntil } from '../../lib/dates'
import type { Exam } from '../../types'

/** Tap-to-fill starters for the empty tutor screen. Deliberately phrased around what this tutor
 * can actually do given its grounding (it reads your weak cards — see tutor_prompt.py) rather
 * than generic "ask me anything" filler. */
const STARTER_PROMPTS = ['Quiz me on my weak cards', 'Explain a concept I keep missing', 'Help me study for an exam']

/** The starters, with the third one naming the exam it would actually plan for. A starter that
 * says "Help me plan for Organic Chemistry II — 34 days" tells you the tutor knows your calendar;
 * the generic phrasing doesn't. Falls back to the generic wording when nothing is scheduled. */
function starterRows(next: Exam | null): { prompt: string; meta?: string }[] {
  const [weak, concept] = STARTER_PROMPTS
  return [
    { prompt: weak },
    { prompt: concept },
    next
      ? { prompt: `Help me plan for ${next.name}`, meta: `${daysUntil(next.date)} days` }
      : { prompt: STARTER_PROMPTS[2] },
  ]
}

/** The tutor before anything has been said: what it is for, and the starters, which fill the
 * composer when tapped. */
export default function EmptyState({ nextExam, onPick }: { nextExam: Exam | null; onPick: (prompt: string) => void }) {
  return (
    /* Was a single centered line of grey text on an otherwise blank screen. The starter
       prompts do real work beyond filling space: a blank tutor box gives no clue what it's
       actually good at, so these double as capability hints. */
    // Centred in the space it has, with the starters pinned to the bottom above the
    // composer. Stacked from the top, this screen was mostly an empty black field.
    <div className="flex min-h-[58vh] flex-col justify-end pt-4 lg:min-h-[62vh]">
      <div className="flex flex-1 flex-col justify-center">
      <div className="text-[1.5rem] font-bold leading-snug tracking-[-0.02em] lg:text-[1.75rem]">What are we working on?</div>
      <p className="mt-2 max-w-[320px] text-[0.9375rem] leading-[1.55] text-[var(--text-muted)] lg:max-w-[440px]">
        Type, attach or paste a photo of your notes, or tap the mic and talk. It keeps listening until you tap again.
      </p>
      </div>
      {/* Starters as rows, not chips: they are the three things this tutor is actually good at. */}
      <div className="mt-6 border-t border-[var(--rule)]">
        {starterRows(nextExam).map(({ prompt, meta }) => (
          <button
            key={prompt}
            onClick={() => onPick(prompt)}
            className="flex w-full items-baseline justify-between gap-4 border-b border-[var(--rule)] py-3.5 text-left text-[0.9375rem] font-semibold"
          >
            <span className="min-w-0 truncate">{prompt}</span>
            {meta && (
              <span className="flex flex-shrink-0 items-baseline gap-1">
                <span className="numeral text-[1.125rem] text-[var(--text)]">{meta.split(' ')[0]}</span>
                <span className="text-[0.8125rem] text-[var(--text-muted)]">{meta.split(' ').slice(1).join(' ')}</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
