// Replica of frontend/src/screens/GenerateScreen.tsx inside the Cards tab: the form with a saved
// note picked, the run (the mark taking the inputs' place, the backend's stage label under it), and
// the result. The deck <select> is drawn as Chrome draws a closed one; nothing else departs from
// the app's markup.
import ActionCard from '@app/components/ActionCard'
import BackButton from '@app/components/BackButton'
import { CameraIcon, PdfIcon, PhotoIcon } from '@app/components/icons'
import { deckById, demo } from '../data/demo'
import { NodeLoaderFrame } from '../primitives/NodeLoaderFrame'
import type { Press } from './StudyScreen'

const NOTES_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

export interface GenerateView {
  phase: 'form' | 'busy' | 'result'
  stage?: string
  loaderMs?: number
  generate?: Press
  touch?: boolean
}

export function GenerateScreen({ phase, stage, loaderMs = 0, generate, touch }: GenerateView) {
  const deck = deckById(demo.generate.deckId)
  const busy = phase === 'busy'
  if (phase === 'result') {
    const added = demo.generate.added.length
    const dropped = demo.generate.dropped.length
    return (
      <div>
        <div className="mb-1 text-[1.25rem] font-bold">Added to {deck.name}</div>
        <p className="mb-5 text-[0.9375rem] text-[var(--text-muted)]">
          {added} card{added === 1 ? '' : 's'} added
          {dropped > 0 && `, ${dropped} dropped because ${dropped === 1 ? 'it' : 'they'} didn't hold up against your notes`}.
        </p>
        <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
          {demo.generate.added.map((c) => (
            <div key={c.id} className="border-b border-[var(--rule)] py-3.5">
              {c.subtopic && <div className="mb-0.5 text-[0.8125rem] font-semibold text-[var(--text-muted)]">{c.subtopic}</div>}
              <div className="text-[0.9375rem] font-bold">{c.question}</div>
              <div className="mt-0.5 text-sm text-[var(--text-muted)]">{c.answer}</div>
            </div>
          ))}
        </div>
        {dropped > 0 && (
          <div className="mb-5">
            <div className="mb-2 text-[0.9375rem] font-bold">Dropped during verification</div>
            <div className="flex flex-col border-t border-[var(--rule)]">
              {demo.generate.dropped.map((d, i) => (
                <div key={i} className="border-b border-[var(--rule)] py-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text)]">{d.question}</span> {d.reason}
                </div>
              ))}
            </div>
          </div>
        )}
        <button className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold">Done</button>
      </div>
    )
  }

  const filter = generate?.down ? `brightness(${touch ? 0.9 : 0.92})` : generate?.hover && !touch ? 'brightness(1.06)' : undefined
  return (
    <div>
      <BackButton onClick={() => {}} className="mb-3">
        Back
      </BackButton>
      <div className="mb-4">
        {/* Segmented, with its pill resting under the first option. */}
        <div className="relative flex gap-0.5 rounded-[var(--r-sm)] p-0.5" style={{ background: 'var(--bg)' }}>
          <span aria-hidden className="pointer-events-none rounded-[4px]" style={{ position: 'absolute', left: 2, top: 2, bottom: 2, width: 'calc(50% - 3px)', background: 'var(--surface)' }} />
          {[
            { label: 'From my material', active: true },
            { label: 'From a topic', active: false },
          ].map((o) => (
            <button
              key={o.label}
              aria-pressed={o.active}
              className="relative z-10 h-8 flex-1 whitespace-nowrap rounded-[4px] px-2.5 text-[0.8125rem]"
              style={{ color: o.active ? 'var(--text)' : 'var(--text-muted)', fontWeight: o.active ? 700 : 600 }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
        Upload photos of your notes or a PDF, or pull from notes you&apos;ve already saved. The AI drafts flashcards, then checks each one against your notes before adding it.
      </p>

      <div className="mb-5">
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Add to</div>
        <Select value={deck.name} />
      </div>

      <div className="relative" aria-busy={busy || undefined}>
        <div className={busy ? 'invisible' : undefined}>
          <div className="mb-3 rounded-[var(--r-md)] bg-[var(--surface)] [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
            <ActionCard onClick={() => {}} disabled={busy} title="Take a photo" description="Point the camera at a page of notes" icon={<CameraIcon />} />
            <ActionCard onClick={() => {}} disabled={busy} title="Choose photos" description="From your photo library" icon={<PhotoIcon />} />
            <ActionCard onClick={() => {}} disabled={busy} title="Choose a PDF" description="Lecture slides, a handout, a chapter" icon={<PdfIcon />} />
            <ActionCard onClick={() => {}} disabled={busy} title="Use saved notes" description="1 note chosen. Tap to change." icon={NOTES_ICON} />
          </div>
        </div>
        {busy && (
          <NodeLoaderFrame ms={loaderMs} size={80} delay={0} label={stage || 'Generating'} showLabel className="absolute inset-0 flex flex-col items-center justify-center gap-3" />
        )}
      </div>

      <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-2.5">
          <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{demo.generate.note.title}</span>
          <button disabled={busy} className="-mr-2 flex-shrink-0 rounded-[var(--r-sm)] px-2 py-2 text-[0.8125rem] font-bold text-[var(--text-muted)]">
            Remove
          </button>
        </div>
      </div>

      <button disabled={busy} className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold disabled:opacity-50" style={{ filter: busy ? undefined : filter }}>
        {busy ? 'Generating' : 'Generate flashcards'}
      </button>
    </div>
  )
}

/** A closed <select>, as Chrome draws the app's: its classes, the value, and the native arrow. */
function Select({ value }: { value: string }) {
  return (
    <div className="relative flex h-11 w-full items-center rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]">
      <span className="min-w-0 flex-1 truncate" style={{ paddingLeft: 3 }}>{value}</span>
      <svg aria-hidden width="10" height="6" viewBox="0 0 10 6" style={{ position: 'absolute', right: 7, top: 19 }}>
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
