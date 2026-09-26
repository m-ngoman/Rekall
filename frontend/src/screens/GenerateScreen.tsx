import { useEffect, useRef, useState } from 'react'
import { PaymentRequired, generateDeck, generateDeckFromNotes, generateDeckFromTopic, listDecks } from '../api'
import ActionCard from '../components/ActionCard'
import BackButton from '../components/BackButton'
import MaybeMath from '../components/MaybeMath'
import NodeLoader from '../components/NodeLoader'
import Segmented from '../components/Segmented'
import { errorMessage } from '../lib/errors'
import { CameraIcon, PdfIcon, PhotoIcon } from '../components/icons'
import NotePicker from '../components/generate/NotePicker'
import type { Deck, GenerationResult, Note } from '../types'

interface Props {
  onDone: () => void
  onCancel: () => void
  /** Where a 402 sends you. Generation is a paid feature, and "this needs a plan" is only useful
   * if the plan is one tap away. */
  onOpenPricing: () => void
}

const NOTES_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

type Mode = 'material' | 'topic'

const MODES: { value: Mode; label: string }[] = [
  { value: 'material', label: 'From my material' },
  { value: 'topic', label: 'From a topic' },
]

const FIELD_CLASS = 'h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem] outline-none placeholder:text-[var(--text-muted)]'

/** Sentinel `<select>` value for "new deck, but I'll name it". Not a real deck id, and not the
 * empty string either — the empty string already means "new deck, let the AI name it", and the two
 * have to stay distinguishable. */
const NAME_IT = '__name_it__'

export default function GenerateScreen({ onDone, onCancel, onOpenPricing }: Props) {
  const [decks, setDecks] = useState<Deck[] | null>(null)
  const [targetDeckId, setTargetDeckId] = useState('')
  const [customDeckName, setCustomDeckName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  /** Full Note objects rather than ids, so the staged list can show what you picked without
   * another round-trip. Source is deliberately one-or-the-other: whichever you choose last is
   * what gets generated from, and the staged list below always shows exactly that. */
  const [pickedNotes, setPickedNotes] = useState<Note[]>([])
  const [picking, setPicking] = useState(false)
  // The topic form is a mode rather than a fifth staged source: a topic isn't material you add to
  // a pile of pages, it's an alternative to having any pages at all. It used to be drawn as a
  // fifth source row anyway, and tapping it greyed out the other four and threw away whatever had
  // been picked, a far bigger change than a row in a list suggests. Now the two are an explicit
  // switch, and each keeps its own inputs: switching and switching back loses nothing.
  const [mode, setMode] = useState<Mode>('material')
  const byTopic = mode === 'topic'
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [curriculum, setCurriculum] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  // True when the last error was a 402, so the message can carry a link to plans.
  const [paywall, setPaywall] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listDecks().then(setDecks).catch(() => setDecks([]))
  }, [])

  const addImages = (list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev.filter((f) => f.type !== 'application/pdf'), ...Array.from(list)])
    setPickedNotes([])
    setError(null)
  }

  const setPdf = (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    setFiles([file])
    setPickedNotes([])
    setError(null)
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (byTopic) {
      if (!subject.trim() || !topic.trim()) {
        setError('Name the subject and the topic.')
        return
      }
    } else if (files.length === 0 && pickedNotes.length === 0) {
      setError('Add a photo or PDF, or pick from notes you\'ve already saved.')
      return
    }
    const namingIt = targetDeckId === NAME_IT
    if (namingIt && !customDeckName.trim()) {
      setError('Give the new deck a name, or switch back to letting the AI name it.')
      return
    }
    // NAME_IT is a UI-only sentinel; the API only ever sees a real deck id or nothing.
    const deckId = namingIt ? null : targetDeckId || null
    const deckName = namingIt ? customDeckName : ''

    setBusy(true)
    setError(null)
    setStage('Starting…')
    try {
      const res = byTopic
        ? await generateDeckFromTopic({ subject, topic, gradeLevel, curriculum }, deckId, deckName, setStage)
        : pickedNotes.length
          ? await generateDeckFromNotes(pickedNotes.map((n) => n.id), deckId, deckName, setStage)
          : await generateDeck(files, deckId, deckName, setStage)
      if (res.cards_added.length === 0) {
        setError(
          byTopic
            ? "Nothing survived checking. Try naming the topic more specifically, or add a syllabus."
            : pickedNotes.length
              ? "Couldn't find any flashcard-worthy material in those notes."
              : "Couldn't find any flashcard-worthy material in that upload.",
        )
        return
      }
      setResult(res)
    } catch (e) {
      // Only a 402 gets the pricing link. A 429 or a 404 on a missing note file has a sentence
      // worth reading and nowhere useful to send anyone.
      setPaywall(e instanceof PaymentRequired)
      setError(errorMessage(e, 'Generation failed.'))
    } finally {
      setBusy(false)
    }
  }

  if (picking) {
    return (
      <NotePicker
        initial={pickedNotes}
        onCancel={() => setPicking(false)}
        onConfirm={(notes) => {
          setPickedNotes(notes)
          if (notes.length > 0) setFiles([])
          setPicking(false)
          setError(null)
        }}
      />
    )
  }

  if (result) {
    const added = result.cards_added.length
    const dropped = result.cards_dropped.length
    return (
      <div>
        <div className="mb-1 text-[1.25rem] font-bold">Added to {result.deck_name}</div>
        <p className="mb-5 text-[0.9375rem] text-[var(--text-muted)]">
          {added} card{added === 1 ? '' : 's'} added
          {dropped > 0 &&
            (byTopic
              ? `, ${dropped} dropped in checking`
              : `, ${dropped} dropped because ${dropped === 1 ? 'it' : 'they'} didn't hold up against your notes`)}.
        </p>

        <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
          {result.cards_added.map((c) => (
            <div key={c.id} className="border-b border-[var(--rule)] py-3.5">
              {c.subtopic && <div className="mb-0.5 text-[0.8125rem] font-semibold text-[var(--text-muted)]">{c.subtopic}</div>}
              <div className="text-[0.9375rem] font-bold"><MaybeMath text={c.question} math={c.is_math} /></div>
              <div className="mt-0.5 text-sm text-[var(--text-muted)]"><MaybeMath text={c.answer} math={c.is_math} /></div>
            </div>
          ))}
        </div>

        {dropped > 0 && (
          <div className="mb-5">
            <div className="mb-2 text-[0.9375rem] font-bold">Dropped during verification</div>
            <div className="flex flex-col border-t border-[var(--rule)]">
              {result.cards_dropped.map((d, i) => (
                <div key={i} className="border-b border-[var(--rule)] py-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text)]">{d.question}</span> {d.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onDone} className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold">
          Done
        </button>
      </div>
    )
  }

  const staged: { key: string; label: string; remove: () => void }[] = [
    ...pickedNotes.map((n) => ({
      key: `note-${n.id}`,
      label: n.title || n.preview || (n.file_type === 'text' ? 'Empty note' : `${n.file_type === 'pdf' ? 'PDF' : 'Photo'} with no readable text`),
      remove: () => setPickedNotes((prev) => prev.filter((p) => p.id !== n.id)),
    })),
    ...files.map((f, i) => ({ key: `file-${i}-${f.name}`, label: f.name, remove: () => removeFile(i) })),
  ]

  return (
    <div>
      <BackButton onClick={onCancel} className="mb-3">Back</BackButton>
      <div className="mb-4">
        <Segmented
          options={MODES}
          value={mode}
          onChange={(next) => {
            // A run in flight was started from one mode's inputs; its result is worded for them.
            if (busy) return
            setMode(next)
            setError(null)
          }}
        />
      </div>
      <p className="mb-5 text-[0.9375rem] leading-relaxed text-[var(--text-muted)]">
        {byTopic
          ? "Say what you're studying and the AI writes the cards, then checks each one is standard material for that level before adding it. Cards come from what the AI knows about the topic, so check them as you go — you can report and remove a bad one while reviewing."
          : 'Upload photos of your notes or a PDF, or pull from notes you\'ve already saved. The AI drafts flashcards, then checks each one against your notes before adding it.'}
      </p>

      <div className="mb-5">
        <div className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">Add to</div>
        <select
          value={targetDeckId}
          onChange={(e) => setTargetDeckId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
        >
          <option value="">New deck, the AI names it</option>
          <option value={NAME_IT}>New deck, I'll name it</option>
          {decks?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {targetDeckId === NAME_IT && (
          <input
            autoFocus
            value={customDeckName}
            onChange={(e) => setCustomDeckName(e.target.value)}
            disabled={busy}
            placeholder="Deck name"
            maxLength={80}
            className="mt-2 h-11 w-full rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 text-[0.9375rem]"
          />
        )}
      </div>

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
      <input ref={libraryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
      <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setPdf(e.target.files)} />

      {/* While the deck is made, the mark takes the inputs' place, with the stage it's at written
          under it. The inputs keep their space, hidden, so nothing below them moves, and they
          come back as they were if the run fails. */}
      <div className="relative" aria-busy={busy || undefined}>
        <div className={busy ? 'invisible' : undefined}>
          {byTopic ? (
            // Labels above the fields, not only in the placeholders: a placeholder is gone the moment
            // you type, and four unlabelled boxes of your own words don't say which was which.
            <div className="mb-5 flex flex-col gap-3">
              <Labeled label="Subject">
                <input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} maxLength={80}
                  placeholder="Chemistry, History…" className={FIELD_CLASS} />
              </Labeled>
              <Labeled label="Topic">
                <input value={topic} onChange={(e) => setTopic(e.target.value)} disabled={busy} maxLength={120}
                  placeholder="What you're studying right now" className={FIELD_CLASS} />
              </Labeled>
              <Labeled label="Level (optional)">
                <input value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} disabled={busy} maxLength={60}
                  placeholder="Grade 11, IB HL…" className={FIELD_CLASS} />
              </Labeled>
              {/* A textarea, because the useful thing to put here is a pasted unit list. A board's
                  name alone is the input most likely to be half-known and confabulated around. */}
              <Labeled label="Curriculum or syllabus (optional)">
                <textarea value={curriculum} onChange={(e) => setCurriculum(e.target.value)} disabled={busy} rows={3} maxLength={2000}
                  placeholder="Paste your unit list if you have one"
                  className="w-full resize-none rounded-[var(--r-sm)] bg-[var(--surface)] px-3.5 py-2.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-[var(--text-muted)]" />
              </Labeled>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                {targetDeckId && targetDeckId !== NAME_IT
                  ? 'Cards will follow the notes already in that deck where they cover this topic.'
                  : 'Pick an existing deck above and any notes in it will be used, so the cards match what you were taught.'}
              </p>
            </div>
          ) : (
            // The four sources are rows on one surface, same as the ways in on the Cards tab.
            <div className="mb-3 rounded-[var(--r-md)] bg-[var(--surface)] [&>*+*]:border-t [&>*+*]:border-[var(--rule)]">
              <ActionCard onClick={() => cameraInputRef.current?.click()} disabled={busy} title="Take a photo" description="Point the camera at a page of notes" icon={<CameraIcon />} />
              <ActionCard onClick={() => libraryInputRef.current?.click()} disabled={busy} title="Choose photos" description="From your photo library" icon={<PhotoIcon />} />
              <ActionCard onClick={() => pdfInputRef.current?.click()} disabled={busy} title="Choose a PDF" description="Lecture slides, a handout, a chapter" icon={<PdfIcon />} />
              <ActionCard
                onClick={() => setPicking(true)}
                disabled={busy}
                title="Use saved notes"
                description={
                  pickedNotes.length > 0
                    ? `${pickedNotes.length} note${pickedNotes.length === 1 ? '' : 's'} chosen. Tap to change.`
                    : 'Build cards from what is already in your library'
                }
                icon={NOTES_ICON}
              />
            </div>
          )}
        </div>
        {busy && (
          <NodeLoader
            size={64}
            delay={0}
            label={stage || 'Generating'}
            showLabel
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          />
        )}
      </div>

      {!byTopic && staged.length > 0 && (
        <div className="mb-5 flex flex-col border-t border-[var(--rule)]">
          {staged.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-2.5">
              <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{item.label}</span>
              <button
                onClick={item.remove}
                disabled={busy}
                className="-mr-2 flex-shrink-0 rounded-[var(--r-sm)] px-2 py-2 text-[0.8125rem] font-bold text-[var(--text-muted)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-[var(--r-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}>
          {error}
          {paywall && (
            <button onClick={onOpenPricing} className="ml-2 underline underline-offset-4">
              See plans
            </button>
          )}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={busy || (byTopic ? !subject.trim() || !topic.trim() : files.length === 0 && pickedNotes.length === 0)}
        className="on-accent w-full rounded-[var(--r-full)] py-4 text-[1.0625rem] font-bold disabled:opacity-50"
      >
        {busy ? 'Generating' : 'Generate flashcards'}
      </button>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  )
}
