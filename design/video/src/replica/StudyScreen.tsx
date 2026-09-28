// Replica of frontend/src/screens/StudyScreen.tsx on its AI-graded path — answering, grading,
// graded — inside the study branch of App.tsx (no sidebar: "the session is the whole screen").
// Class strings are the app's. What differs is only what the app does on its own clock: the
// textarea is a div with a drawn caret, the loading mark is NodeLoaderFrame, and the graded layout
// arrives over 16 frames (lib/grade) instead of in one render, ending on exactly the app's markup.
import BackButton from '@app/components/BackButton'
import type { ReactNode } from 'react'
import { lerp } from '../lib/ease'
import type { gradeLanding } from '../lib/grade'
import { NodeLoaderFrame } from '../primitives/NodeLoaderFrame'

type Landing = ReturnType<typeof gradeLanding>

export interface Press {
  hover?: boolean
  down?: boolean
}

export interface StudyView {
  desktop: boolean
  phase: 'answering' | 'grading' | 'graded'
  deckName: string
  /** Cards still ahead, counting the one on screen: the header's count. */
  left: number
  /** The session's size and how much of it is done — the progress bar. */
  total: number
  done: number
  examDays: number
  subtopic: string
  question: string
  typed: string
  caret: boolean
  focused: boolean
  streamed: string
  /** Time since the grading mark mounted, while it's up. */
  loaderMs: number | null
  score: number
  gradeLabel: string
  gradeColor: string
  due: string
  modelAnswer: string
  /** "Next card, N left". */
  queueAfter: number
  /** The graded layout arriving; absent once it has. */
  landing?: Landing
  check?: Press
  save?: Press & { saved?: boolean }
  /** Press feedback as a finger gives it (index.css `hover: none`) rather than a mouse. */
  touch?: boolean
}

const pressFilter = (p: Press | undefined, touch: boolean | undefined) =>
  p?.down ? `brightness(${touch ? 0.9 : 0.92})` : p?.hover && !touch ? 'brightness(1.06)' : undefined

export function StudyScreen(v: StudyView) {
  const graded = v.phase === 'graded'
  const L = v.landing
  const open = graded ? (L ? L.open : 1) : 0

  const header = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <BackButton onClick={() => {}}>
          <span className="truncate">{v.deckName}</span>
        </BackButton>
        <div className="flex flex-shrink-0 items-baseline gap-1.5 lg:hidden">
          <span className="numeral text-[1.75rem]">{v.left}</span>
          <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">left</span>
        </div>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-[var(--rule)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${(v.done / v.total) * 100}%` }} />
      </div>
    </div>
  )

  const scoreBlock = (
    <>
      <div className="flex items-end gap-4" style={{ color: v.gradeColor }}>
        <div className="flex items-baseline gap-1">
          <span className="numeral text-[4.5rem]" style={L ? { opacity: L.numeral, transform: `translateY(${(1 - L.numeral) * 0.12}em)` } : undefined}>
            {v.score}
          </span>
          <span className="numeral text-[1.75rem] opacity-70" style={L ? { opacity: 0.7 * L.outOf } : undefined}>
            /5
          </span>
        </div>
        <div className="pb-1" style={L ? { opacity: L.label } : undefined}>
          <div className="text-[1.0625rem] font-bold">{v.gradeLabel}</div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{v.due}</div>
        </div>
      </div>
      <div aria-hidden className="mt-4 flex gap-[3px]">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= v.score ? (L ? L.segment(n) : 1) : 0
          return (
            <span
              key={n}
              className="h-[3px] flex-1 rounded-[2px]"
              style={{ background: on >= 1 ? v.gradeColor : on <= 0 ? 'var(--rule)' : `color-mix(in oklab, ${v.gradeColor} ${on * 100}%, var(--rule))` }}
            />
          )
        })}
      </div>
    </>
  )

  const explanation = (withMargin: boolean) => (
    <p className={`text-[0.9375rem] leading-relaxed [text-wrap:pretty] ${withMargin ? 'mt-4' : ''}`}>
      {v.streamed}
      {v.phase === 'grading' &&
        (v.streamed ? (
          <span className="ml-0.5 inline-block h-[18px] w-[2px] align-text-bottom bg-[var(--accent)]" />
        ) : (
          <NodeLoaderFrame ms={v.loaderMs ?? 0} size={24} delay={0} label="Checking your answer" className="flex h-[1.625em] items-center" />
        ))}
    </p>
  )

  // While the block opens, it sits in a one-row grid whose track is `open` of its content's
  // height — the whole of it at 1, with no measuring. At rest it's the app's markup exactly.
  const graded_ = graded && (
    L && L.open < 1 ? (
      <>
        <div style={{ display: 'grid', gridTemplateRows: `${L.open}fr` }}>
          <div style={{ minHeight: 0, overflow: 'hidden' }}>
            {scoreBlock}
            <div style={{ height: 16 }} />
          </div>
        </div>
        {explanation(false)}
      </>
    ) : (
      <>
        {scoreBlock}
        {explanation(true)}
      </>
    )
  )

  const fadeIn = (node: ReactNode, key: string) => (L && L.swap < 1 ? <div key={key} style={{ opacity: L.swap }}>{node}</div> : node)

  const rail = (
    <aside className="hidden lg:flex lg:flex-col lg:gap-6">
      <div className="flex items-baseline gap-2">
        <span className="numeral text-[6rem]">{v.left}</span>
        <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">left</span>
      </div>
      {graded ? (
        fadeIn(
          <div className="flex flex-col gap-5">
            <div className="border-t border-[var(--rule)] pt-3">
              <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{v.typed}</p>
            </div>
            <div className="border-t border-[var(--rule)] pt-3">
              <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">Model answer</div>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{v.modelAnswer}</p>
            </div>
          </div>,
          'rail',
        )
      ) : (
        <div className="border-t border-[var(--rule)]">
          {[
            { label: 'Done', value: '0' },
            { label: 'Right first time', value: '0 of 0' },
            { label: 'Exam', value: `${v.examDays} days` },
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

  const questionSize = graded && L && L.open < 1 ? { fontSize: lerp(v.desktop ? 32 : 24, 18, L.open) } : undefined

  const actions =
    v.phase === 'answering' || v.phase === 'grading' ? (
      <div className="lg:flex lg:items-center lg:gap-4">
        <button
          disabled={v.phase === 'grading'}
          className="on-accent w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] disabled:opacity-50 lg:w-auto lg:px-8 lg:py-[0.6875rem]"
          style={{ filter: v.phase === 'answering' ? pressFilter(v.check, v.touch) : undefined }}
        >
          {v.phase === 'grading' ? 'Checking' : 'Check my answer'}
        </button>
        <div className="mt-3 hidden text-[0.8125rem] text-[var(--text-muted)] lg:mt-0 lg:block">⌘ Enter also checks</div>
      </div>
    ) : (
      fadeIn(
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <button className="on-accent w-full rounded-[var(--r-full)] px-4 py-[0.9375rem] text-[1.1875rem] font-bold leading-[1.2] lg:w-auto lg:self-start lg:px-8 lg:py-[0.6875rem]">
            {`Next card, ${v.queueAfter} left`}
          </button>
          {v.save?.saved ? (
            <span className="self-start text-[0.8125rem] text-[var(--text-muted)] lg:self-auto">Saved. The tutor will start here next time.</span>
          ) : (
            <button
              className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto"
              style={{ filter: pressFilter(v.save, v.touch) }}
            >
              Save for tutor
            </button>
          )}
          <button className="self-start text-[0.8125rem] font-semibold text-[var(--text-muted)] underline decoration-[var(--rule)] underline-offset-4 lg:self-auto">
            Report and remove this card
          </button>
        </div>,
        'actions',
      )
    )

  return (
    <div className="h-full text-[var(--text)]">
      <main className="mx-auto max-w-xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] lg:max-w-7xl lg:px-10">
        <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-[4.5rem] lg:gap-y-10">
          <div className="lg:col-span-2">{header}</div>
          <div className="contents lg:flex lg:flex-col lg:gap-10">
            <div>
              <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{v.subtopic}</div>
              <div className={`mt-2 font-bold leading-snug [text-wrap:pretty] ${graded && open >= 1 ? 'text-[1.125rem]' : graded ? '' : 'text-[1.5rem] lg:text-[2rem]'}`} style={questionSize}>
                {v.question}
              </div>
            </div>

            {v.phase === 'answering' ? (
              <div>
                {/* The textarea, as a box that wraps text the way a textarea does (pre-wrap,
                    break-word) and sits on its line the way a textarea does: inline-block with its
                    overflow clipped, so its baseline is its bottom edge and the line under it keeps
                    the same few pixels of descent the app's page has. */}
                <div
                  className="min-h-[132px] w-full resize-none rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3.5 text-[0.9375rem] leading-relaxed outline-none"
                  style={{
                    display: 'inline-block',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                    boxShadow: v.focused ? '0 0 0 2px var(--rule)' : undefined,
                  }}
                >
                  {v.typed ? (
                    <>
                      {v.typed}
                      <Caret on={v.caret} />
                    </>
                  ) : (
                    <>
                      <Caret on={v.caret} />
                      <span className="text-[var(--text-muted)]">Type your answer</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {graded_ || explanation(false)}
                <div className="mt-5 border-t border-[var(--rule)] pt-3 lg:hidden">
                  <div className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">You wrote</div>
                  <p className="mt-1.5 line-clamp-3 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">{v.typed}</p>
                </div>
                {graded &&
                  fadeIn(
                    <div className="mt-3 border-t border-[var(--rule)] lg:hidden">
                      <button className="flex w-full items-center justify-between py-3 text-[0.8125rem] font-semibold text-[var(--text-muted)]">
                        Show model answer
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </button>
                    </div>,
                    'compare',
                  )}
              </div>
            )}

            {actions}
          </div>
          {rail}
        </div>
      </main>
    </div>
  )
}

/** The text caret: 1 px of --text, a line tall. The textarea's own caret is the browser's; this
 * is drawn where it would be, and blinks on the frame clock (lib/typing caretVisible). */
function Caret({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-block', width: 1, height: '1.2em', marginRight: -1, verticalAlign: '-0.22em', background: on ? 'var(--text)' : 'transparent' }}
    />
  )
}
