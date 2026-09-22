import { type ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PaymentRequired, createMemoryNote, deleteMemoryNote, deleteProfileLine, getStudentProfile, listBugs, listMemoryNotes, listTutorVoices, reportBug, resolveBug, sendTextTurn, sendVoiceTurnText, startTutorSession, updateTutorSession } from '../api'
import type { PlotSpec } from '../lib/plot'
import Notice from '../components/Notice'
import type { OrbState } from '../components/VoiceOrb'
import ComposerChips from '../components/tutor/ComposerChips'
import EmptyState from '../components/tutor/EmptyState'
import { ExamOfferRow } from '../components/tutor/ExamOffer'
import FocusStage, { OVERLAY_FADE_MS } from '../components/tutor/FocusStage'
import LatestPill from '../components/tutor/LatestPill'
import PhotoAttach, { PendingPhoto } from '../components/tutor/PhotoAttach'
import TutorLog from '../components/tutor/TutorLog'
import { hydrate } from '../components/tutor/hydrate'
import type { ExamOffer, Message, Popover } from '../components/tutor/types'
import { createExam, listExams } from '../api'
import { formatDayLong, toISODate } from '../lib/dates'
import { upcomingExams } from '../lib/exams'
import { useCachedResource } from '../hooks/useCachedResource'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useAutosizeTextarea } from '../hooks/useAutosizeTextarea'
import { useFollowLatest } from '../hooks/useFollowLatest'
import { useMicRecorder } from '../hooks/useMicRecorder'
import { useRevealText } from '../hooks/useRevealText'
import { useTypewriter } from '../hooks/useTypewriter'
import { findListedBug, renderBugs } from '../lib/bugCommands'
import { wordStarts } from '../lib/wordTimings'
import type { BugReport, Exam, MemoryCategory, MemoryNote, Settings, StudentProfile, TutorPersonality, TutorSession, TutorVoice, WordTiming } from '../types'

const STATUS_LABEL: Record<OrbState, string> = {
  idle: '',
  waiting: 'Waiting for you…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5" />
    <path d="M6 11l6-6 6 6" />
  </svg>
)

const MIC_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
)

/** A spoken "yes" to the tutor's offer to add an exam. Anchored to the whole utterance on
 * purpose: answering a study question with "yes, the mitochondria" must never book something.
 * Only consulted on the turn immediately following an offer. */
const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|add it|sounds good)([ ,.!]*(please|thanks|thank you|do it|add it))*[ .!]*$/i

/** How far ahead of the voice a word lights up. Strictly on-time reads as lagging. */
const WORD_LEAD_S = 0.08

const FLIP_DURATION_MS = 160
/** FLIP delta: how far (and by what scale) `el` would need to move to sit exactly over `target`. */
function deltaToElement(el: HTMLElement, target: HTMLElement) {
  const elRect = el.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const dx = targetRect.left + targetRect.width / 2 - (elRect.left + elRect.width / 2)
  const dy = targetRect.top + targetRect.height / 2 - (elRect.top + elRect.height / 2)
  const scale = Math.max(targetRect.width, targetRect.height) / Math.max(elRect.width, elRect.height)
  return { dx, dy, scale }
}

interface Props {
  /** The user's saved voice settings. Null until they've loaded — the hooks fall back to their
   * own defaults in the meantime rather than blocking the screen on a request. */
  settings: Settings | null
  /** Adam's account only. Enables the /bug commands in the composer — see handleCommand. */
  isOwner?: boolean
  /** Where a 402 sends you. The tutor is a paid feature end to end, so this is reachable from
   * starting a session as well as from any turn. */
  onOpenPricing: () => void
}

/** Turn-by-turn detector readout, for diagnosing a turn that ends at the wrong moment on a
 * device with no usable console. Off unless ?mic=debug is on the URL. */
const MIC_DEBUG = new URLSearchParams(window.location.search).get('mic') === 'debug'

export default function TutorScreen({ settings, isOwner, onOpenPricing }: Props) {
  const [session, setSession] = useState<TutorSession | null>(null)
  // The last error was a 402, so the message carries a link to plans.
  const [paywall, setPaywall] = useState(false)
  // Only used by the empty state's starters, and it rides the same cache the Calendar tab fills,
  // so opening Tutor after Calendar costs no request.
  const [exams] = useCachedResource<Exam[]>('exams', listExams, () => [])
  const nextExam = useMemo(() => upcomingExams(exams)[0] ?? null, [exams])
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [voiceModeActive, setVoiceModeActive] = useState(false)
  const [orbMounted, setOrbMounted] = useState(false) // in the DOM at all
  const [messages, setMessages] = useState<Message[]>([])
  /** When the resumed conversation started, ISO. Null for one begun in this visit — the log only
   * dates itself when you're picking something up, and only then when it wasn't today. */
  const [resumedAt, setResumedAt] = useState<string | null>(null)
  /** Index of the first turn the tutor still holds verbatim; -1 when it holds all of them. */
  const [condensedBefore, setCondensedBefore] = useState(-1)
  /** "Tue, Sep 16" above a conversation carried over from another day, or null when it started
   * today. Without it a transcript from last night reads as though it just happened. */
  const resumedDay = useMemo(() => {
    if (!resumedAt) return null
    const day = toISODate(new Date(resumedAt))
    return day === toISODate(new Date()) ? null : formatDayLong(day)
  }, [resumedAt])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Neutral status message. Separate from `error` because falling back to text is expected
   * behaviour, and styling it red would tell the user something broke when nothing did. */
  const [notice, setNotice] = useState<string | null>(null)
  const [micDebug, setMicDebug] = useState<string | null>(null)
  /** A typed turn is waiting for its first token. Drives the thinking dots in the log: the
   * reply's placeholder is an empty line until then, and an empty line looks like a hang. */
  const [replyPending, setReplyPending] = useState(false)
  /** A typed reply is streaming. Typed turns never touch orbState, so without this a second send
   * could go out mid-reply and the typewriter — which always writes into the last assistant
   * message — would splice two replies into one. */
  const textTurnInFlightRef = useRef(false)
  const [openPopover, setOpenPopover] = useState<Popover | null>(null)
  const [voices, setVoices] = useState<TutorVoice[] | null>(null)
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[] | null>(null)
  /** The tutor's own reading of the student, kept apart from the notes they wrote. Loaded
   * once at mount: a pass only runs every few turns and writes on a background thread, so
   * polling it would spend requests to almost always see the same thing. */
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  /** A calendar entry the tutor has offered to add. Held until the student taps Add — the tutor
   * proposes, the student writes. `added` keeps the card in place afterwards so the confirmation
   * is visible rather than the row just vanishing. */
  const [examOffer, setExamOffer] = useState<ExamOffer | null>(null)
  /** Exams already written this session. The tutor sometimes repeats its offer on a later turn,
   * and without this the same test could be added to the calendar twice. */
  const addedExamsRef = useRef<Set<string>>(new Set())

  const offerExam = (exam: { name: string; date: string }) =>
    setExamOffer({ ...exam, added: addedExamsRef.current.has(`${exam.name}|${exam.date}`) })

  const commitExam = async (exam: { name: string; date: string }) => {
    try {
      await createExam(exam.name, exam.date, [])
      addedExamsRef.current.add(`${exam.name}|${exam.date}`)
      setExamOffer({ ...exam, added: true })
    } catch {
      setError("Couldn't add that to your calendar.")
    }
  }

  /** Derived once rather than inside the voice button, so the visible label and the aria-label
   * can't drift apart — which matters now that only one of the two is shown on a phone.
   * Falls back to the first voice because that's what the backend defaults an unset session to. */
  const voiceName = (voices?.find((v) => v.id === session?.voice_id) ?? voices?.[0])?.name
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [liveTranscript, setLiveTranscript] = useState('')
  const revealedTranscript = useRevealText(liveTranscript)

  /** The current reply, one entry per synthesized sentence, in arrival order. Drives the focus
   * view's karaoke text — the chat log behind it still gets the same reply via the typewriter,
   * so nothing about the conversation history changes shape. */
  const [voiceSentences, setVoiceSentences] = useState<string[]>([])
  /** Index into voiceSentences of the sentence the voice is saying right now; -1 = none. Set by
   * the audio player's onItemStart, because playback — not the SSE stream, which runs ahead — is
   * the only honest source for "where the voice actually is". */
  const [speakingIdx, setSpeakingIdx] = useState(-1)
  /** Fade-in switch for the focus overlay. Mounted at opacity 0, flipped a frame later — the
   * overlay div renders with voiceModeActive already true, so styling opacity off that alone
   * would pop it in fully opaque with no transition. */
  const [overlayIn, setOverlayIn] = useState(false)

  const sessionRef = useRef<TutorSession | null>(null)
  sessionRef.current = session
  const orbStateRef = useRef<OrbState>('idle')
  orbStateRef.current = orbState
  /** Seconds of audio per sentence, by sentence index. The player can't be asked (metadata loads
   * async, after playback may already need the number), but the format is our own backend
   * contract — tts.py requests WAV / pcm_s16le / 44.1kHz mono — so duration falls straight out
   * of the blob size: (bytes - 44-byte header) / 88200. If that contract ever changes the word
   * sweep drifts within sentences but never across them, since sentence starts stay ground truth. */
  const sentenceDurationsRef = useRef<number[]>([])
  /** Real per-word timings per sentence index, as reported by the synthesizer. */
  const sentenceWordsRef = useRef<WordTiming[][]>([])
  /** How many words of the current sentence the voice has reached. */
  const [litCount, setLitCount] = useState(0)
  const voiceModeRef = useRef(false)
  /** True while a reply's SSE stream is open. The player's queue can momentarily drain while the
   * backend is still synthesizing the next sentence — without this guard that gap fired
   * onQueueEmpty and dropped voice mode into listening in the middle of the tutor's reply. */
  const replyInFlightRef = useRef(false)
  const cancelListenRef = useRef<(() => void) | null>(null)
  /** True from the moment a listen cycle is entered until its capture resolves. Guards against
   * two watchers handing off the same utterance — see startListenCycle. */
  const listeningRef = useRef(false)
  /** Cancels the free local amplitude watch that holds voice mode open between turns. */
  const cancelWaitRef = useRef<(() => void) | null>(null)
  const voiceTurnAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const micButtonRef = useRef<HTMLButtonElement>(null)
  const orbCircleRef = useRef<HTMLButtonElement>(null)

  const mic = useMicRecorder({
    sensitivity: settings?.mic_sensitivity,
    silenceMs: settings?.mic_silence_ms,
    pushToTalk: settings?.push_to_talk,
  })
  // In continuous voice mode, once playback finishes, immediately start listening again — that's
  // what makes it "stay in voice mode" rather than dropping back to idle after every turn.
  const player = useAudioPlayer(
    () => {
      // Mid-reply drain: more sentences are coming, playback resumes on the next enqueue. Stay
      // in 'speaking' rather than treating a synthesis gap as the end of the turn.
      if (replyInFlightRef.current) return
      if (voiceModeRef.current) startListenCycle()
      else setOrbState('idle')
    },
    settings?.tts_speed_pct,
    (tag) => setSpeakingIdx(tag),
  )

  // Release everything on the way out. This matters more since voice mode can now hold the mic
  // open with nothing being transcribed: leaving the tab mid-wait would otherwise keep the
  // browser's recording indicator lit until the page was closed.
  useEffect(() => {
    return () => {
      voiceModeRef.current = false
      cancelWaitRef.current?.()
      cancelListenRef.current?.()
      voiceTurnAbortRef.current?.abort()
      mic.stop()
      player.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Still once per mount — it just no longer means "once per conversation". The server decides
    // whether this is the one you were last in or a new one, so a refresh or a trip to another
    // tab comes back to what you were saying instead of throwing it away.
    startTutorSession()
      .then((start) => {
        setSession(start.session)
        if (start.messages.length) {
          setMessages(hydrate(start.messages))
          setResumedAt(start.messages[0].created_at)
          // Index of the first turn the tutor still has word for word. Resolved here rather than
          // at render so the log doesn't re-compare timestamps on every keystroke.
          const cut = start.summarized_through
          setCondensedBefore(cut ? start.messages.findIndex((m) => m.created_at > cut) : -1)
        }
      })
      .catch((e) => {
        setPaywall(e instanceof PaymentRequired)
        setError(e instanceof PaymentRequired ? e.message : 'Could not start a tutor session.')
      })
    listTutorVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
    listMemoryNotes()
      .then(setMemoryNotes)
      .catch(() => setMemoryNotes([]))
    getStudentProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  const { away, pinToLatest, rejoin } = useFollowLatest(logRef, bottomRef, composerRef, messages)

  useAutosizeTextarea(textareaRef, draft, 120)

  // Mount on enter (the layout effect below does the actual FLIP-from-the-button animation once
  // it's in the DOM); on exit, animate straight from wherever it currently sits back onto the
  // button, then unmount once that transition finishes.
  useEffect(() => {
    if (voiceModeActive) {
      setOrbMounted(true)
      return
    }
    const orbEl = orbCircleRef.current
    const btnEl = micButtonRef.current
    if (orbEl && btnEl) {
      const { dx, dy, scale } = deltaToElement(orbEl, btnEl)
      orbEl.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${FLIP_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
      orbEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
      orbEl.style.opacity = '0'
    }
    const t = setTimeout(() => setOrbMounted(false), OVERLAY_FADE_MS)
    return () => clearTimeout(t)
  }, [voiceModeActive])

  // Fade-in switch: mounted at opacity 0, flipped one frame later so the transition actually
  // runs. Cleared immediately on exit so the fade-out starts in the same frame as the orb's
  // return flight.
  useEffect(() => {
    if (orbMounted && voiceModeActive) {
      const id = requestAnimationFrame(() => setOverlayIn(true))
      return () => cancelAnimationFrame(id)
    }
    setOverlayIn(false)
  }, [orbMounted, voiceModeActive])

  // Focus mode owns the whole screen, so the page behind it must not scroll out from under it —
  // a wheel or touch drag would silently reposition the chat mid-session. Restored on exit, then
  // the log is snapped back to its newest message, which grew while the overlay was up.
  useEffect(() => {
    if (!voiceModeActive) return
    // `overflow: hidden` on body doesn't hold the scroll position on iOS — the page drifts under
    // the overlay and lands somewhere else on release, which is what made leaving voice mode look
    // like the UI flashed back. Pinning the body at a negative offset holds it exactly, and the
    // offset is what we scroll back to.
    const scrollY = window.scrollY
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = prev.position
      document.body.style.top = prev.top
      document.body.style.width = prev.width
      // Synchronous, not in a rAF: this has to land before the browser paints the first frame of
      // the overlay's fade, so the jump to the newest message happens while it's still opaque.
      window.scrollTo(0, scrollY)
      // Through `pinToLatest`, so the newest line clears the composer here too, and so the log is
      // tracking again — whatever arrived while the overlay was up is what you want to be looking
      // at on the way out.
      pinToLatest()
    }
  }, [voiceModeActive])

  // Belt and braces: whatever path voice mode ended by — the mic button, Escape, an error, a
  // watcher that was mid-handoff — nothing should still be holding the microphone once it's off.
  // Each teardown path releases it itself; this is the guarantee that a missed one is visible as
  // nothing rather than as a recording indicator that never goes away.
  useEffect(() => {
    if (voiceModeActive) return
    mic.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceModeActive])

  // Escape ends the session on desktop — a takeover with no visible chrome needs a keyboard out.
  useEffect(() => {
    if (!voiceModeActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleToggleVoiceMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voiceModeActive])

  // Two scroll drivers, each owning its own phase. While the tutor speaks, the lit sentence
  // leads — sentences *arrive* faster than they're spoken, so bottom-pinning would let the live
  // line drift off the top under a pile of not-yet-spoken text. In every other phase the newest
  // turn leads, keeping the conversation pinned to its growing edge.
  const focusTextRef = useRef<HTMLDivElement>(null)
  const focusBottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (speakingIdx < 0) return
    focusTextRef.current
      ?.querySelector(`[data-sentence="${speakingIdx}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [speakingIdx])
  useEffect(() => {
    if (!voiceModeActive || orbState === 'speaking') return
    focusBottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [voiceModeActive, orbState, messages, liveTranscript])

  // Runs synchronously right after the orb enters the DOM: snap it to exactly overlap the mic
  // button (no transition), force that to commit, then release it toward its natural resting
  // position on the next frame — this is what makes it visually grow out of the button, not just
  // fade in near it.
  useLayoutEffect(() => {
    if (!orbMounted) return
    const orbEl = orbCircleRef.current
    const btnEl = micButtonRef.current
    if (!orbEl || !btnEl) return

    const { dx, dy, scale } = deltaToElement(orbEl, btnEl)
    orbEl.style.transition = 'none'
    orbEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
    orbEl.style.opacity = '0'
    orbEl.getBoundingClientRect() // force the snap to commit before animating away from it

    requestAnimationFrame(() => {
      const el = orbCircleRef.current
      if (!el) return
      el.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${FLIP_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
      el.style.transform = 'translate(0px, 0px) scale(1)'
      el.style.opacity = '1'
    })
  }, [orbMounted])

  /** When the voice reaches each word of the sentence being spoken — see wordStarts. */
  // Keyed on the sentence's *text*, not the sentences array: a later sentence arriving mid-speech
  // must not give this a new identity, or the sweep effect below would restart and re-flash every
  // word already lit.
  const speakingSentence = speakingIdx >= 0 ? voiceSentences[speakingIdx] ?? '' : ''
  const currentWords = useMemo(() => {
    if (speakingIdx < 0 || !speakingSentence) return null
    return wordStarts(speakingSentence, sentenceWordsRef.current[speakingIdx] ?? [], sentenceDurationsRef.current[speakingIdx])
  }, [speakingIdx, speakingSentence])

  /** Drives the sweep off the audio clock rather than firing all the animations at once with CSS
   * delays. Open-loop scheduling drifted whenever playback did — a stall, a speed change, a
   * sentence that started fractionally late — because nothing ever re-checked where the voice
   * actually was. This can't drift: every frame asks. */
  useEffect(() => {
    setLitCount(0)
    if (speakingIdx < 0 || !currentWords) return
    let frame = 0
    const tick = () => {
      // A small lead keeps the light-up feeling simultaneous with the voice; strictly on-time
      // reads as lagging.
      const now = player.currentTime() + WORD_LEAD_S
      let n = 0
      while (n < currentWords.length && currentWords[n].start <= now) n += 1
      // Monotonic: a word never goes dark again, so a hiccup in the clock can't flicker the line.
      setLitCount((prev) => (n > prev ? n : prev))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [speakingIdx, currentWords])

  const getAnalyser = () => {
    if (orbStateRef.current === 'listening' || orbStateRef.current === 'waiting') return mic.getAnalyser()
    if (orbStateRef.current === 'speaking') return player.getAnalyser()
    return null
  }

  const handlePersonalityChange = async (personality: TutorPersonality, customPrompt?: string) => {
    if (!session) return
    const updated = await updateTutorSession(session.id, { personality, custom_prompt: customPrompt })
    setSession(updated)
  }

  const handleVoiceChange = async (voiceId: string) => {
    if (!session) return
    const updated = await updateTutorSession(session.id, { voice_id: voiceId })
    setSession(updated)
    setOpenPopover(null)
  }

  const handleAddMemory = async (category: MemoryCategory, content: string) => {
    const note = await createMemoryNote(category, content)
    setMemoryNotes((prev) => [...(prev ?? []), note])
  }

  const handleDeleteMemory = async (id: string) => {
    await deleteMemoryNote(id)
    setMemoryNotes((prev) => prev?.filter((n) => n.id !== id) ?? null)
  }

  /** Removing one of the tutor's own observations. The server also records that it was rejected,
   * so the next pass can't re-derive it from the same conversations — without that, deleting is
   * theatre and the line comes straight back. */
  const handleDeleteProfileLine = async (text: string) => {
    await deleteProfileLine(text)
    setProfile((prev) => (prev ? { ...prev, lines: prev.lines.filter((l) => l.text !== text) } : prev))
  }

  const { typeInto, stopTypewriter } = useTypewriter(setMessages)

  // --- Owner-only bug inbox -------------------------------------------------------------------
  // Somewhere to drop "fix this later" without leaving whatever I was doing. Handled entirely on
  // the client: the text never reaches the tutor, so it costs nothing, arrives verbatim, and no
  // model tries to be helpful about a bug it can't fix. Everyone else's /bug is just a message.
  const bugListRef = useRef<BugReport[]>([])

  /** Handles a slash command typed into the composer. Returns true if it was one, in which case
   * nothing is sent to the tutor. */
  const handleCommand = async (text: string): Promise<boolean> => {
    if (!isOwner || !text.startsWith('/')) return false
    const [word, ...rest] = text.split(/\s+/)
    if (word !== '/bug' && word !== '/bugs') return false
    const args = rest.join(' ').trim()
    const say = (msg: string) => setMessages((prev) => [...prev, { role: 'system', text: msg }])

    setDraft('')
    setMessages((prev) => [...prev, { role: 'user', text }])

    if (word === '/bug') {
      if (!args) {
        say('Usage: /bug <what went wrong>. /bugs lists the open ones.')
        return true
      }
      try {
        // Whatever the app knows for free. A report typed one-handed mid-annoyance won't say
        // "on my phone, in portrait", and that's usually the half that matters.
        await reportBug(args, {
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          user_agent: navigator.userAgent,
        })
        say('Filed. 👍')
      } catch {
        say("Couldn't file that — it didn't reach the server.")
      }
      return true
    }

    // /bugs [done <n|id-prefix>]
    const doneMatch = /^done\s+(\S+)$/i.exec(args)
    if (doneMatch) {
      const target = findListedBug(bugListRef.current, doneMatch[1])
      if (!target) {
        say('No such bug in the last listing. Run /bugs first.')
        return true
      }
      try {
        await resolveBug(target.id)
        const remaining = await listBugs()
        bugListRef.current = remaining
        say(`Cleared: ${target.text}\n\n${renderBugs(remaining)}`)
      } catch {
        say("Couldn't clear that one.")
      }
      return true
    }

    if (args) {
      say('Usage: /bugs, or /bugs done <number>.')
      return true
    }
    try {
      const bugs = await listBugs()
      bugListRef.current = bugs
      say(renderBugs(bugs))
    } catch {
      say("Couldn't reach the bug list.")
    }
    return true
  }

  /** Hangs a graph on the reply currently streaming.
   *
   * A functional updater so it composes with the typewriter's own concurrent `setMessages`
   * rather than racing it. */
  const attachPlot = (plot: PlotSpec) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role !== 'assistant') return prev
      return [...prev.slice(0, -1), { ...last, plots: [...(last.plots ?? []), plot] }]
    })

  /** Deliberately start again, rather than carrying on what the idle window would have resumed.
   *
   * The old conversation is left in the database — this is "start a new one", not "delete that
   * one". It also ends the session for memory purposes, which is the other half of why it exists:
   * it is the only way to say "that was a separate thing" inside the idle window.
   *
   * Tears down everything the unmount cleanup does, because none of it is scoped to the
   * conversation: voice mode holding the mic open, a reply still streaming, a half-typed
   * typewriter, and the exam offer hanging off a turn that is about to disappear.
   */
  const handleNewConversation = async () => {
    voiceModeRef.current = false
    setVoiceModeActive(false)
    cancelWaitRef.current?.()
    cancelListenRef.current?.()
    voiceTurnAbortRef.current?.abort()
    voiceTurnAbortRef.current = null
    mic.stop()
    player.stop()
    stopTypewriter()

    setMessages([])
    setResumedAt(null)
    setCondensedBefore(-1)
    setDraft('')
    setPendingImage(null)
    setExamOffer(null)
    addedExamsRef.current.clear()
    setError(null)
    setOpenPopover(null)

    try {
      const start = await startTutorSession(undefined, true)
      setSession(start.session)
    } catch (e) {
      setPaywall(e instanceof PaymentRequired)
      setError(e instanceof PaymentRequired ? e.message : 'Could not start a new conversation.')
    }
  }

  const handleSendText = async () => {
    const text = draft.trim()
    const image = pendingImage
    // Before the session guard: a command is answered locally, so it should still work on the
    // one occasion I most want to file a bug — when the tutor itself didn't come up.
    if (text.startsWith('/') && (await handleCommand(text))) return
    if ((!text && !image) || !session || orbState !== 'idle' || textTurnInFlightRef.current) return
    textTurnInFlightRef.current = true
    // Sending takes you to the bottom even if you had scrolled up to re-read something: you just
    // added the newest line yourself.
    rejoin()
    setDraft('')
    setPendingImage(null)
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', text, imageUrl: image ? URL.createObjectURL(image) : undefined }])
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }])
    setReplyPending(true)
    let fullText = ''
    try {
      await sendTextTurn(
        session.id,
        text,
        (chunk) => {
          setReplyPending(false)
          fullText += chunk
          typeInto(fullText)
        },
        image ?? undefined,
        offerExam,
        attachPlot,
      )
    } catch (e) {
      // A placeholder that never got its reply. Left in, it sits under the error as an empty
      // line the tutor apparently said. Judged by what arrived, not by what the message shows:
      // the typewriter reveals on a 20ms tick, so a reply that failed just after its first token
      // can still be an empty message here, and that text is worth keeping.
      if (!fullText) {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          return last?.role === 'assistant' && !last.text ? prev.slice(0, -1) : prev
        })
      }
      setPaywall(e instanceof PaymentRequired)
      setError(e instanceof PaymentRequired ? e.message : 'Something went wrong reaching the tutor.')
    } finally {
      textTurnInFlightRef.current = false
      setReplyPending(false)
    }
  }

  const pendingImageUrl = useMemo(() => (pendingImage ? URL.createObjectURL(pendingImage) : null), [pendingImage])
  useEffect(() => {
    return () => {
      if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl)
    }
  }, [pendingImageUrl])

  const handleSelectImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setPendingImage(file)
  }

  /** Paste a screenshot straight into the composer.
   *
   * Bound to the window rather than to the textarea, because the reflex is to hit paste the moment
   * the screenshot is taken — which is usually before clicking into the box. Nothing else on this
   * screen wants an image paste, and text pastes are left alone: the handler only claims the event
   * once the clipboard actually carries an image.
   *
   * It does preventDefault in that case. A screenshot is image-only so there is nothing to
   * suppress, but an image copied from a web page arrives with HTML and text alongside it, and
   * without this the alt text or source URL lands in the draft next to the attachment.
   *
   * Replaces rather than queues, matching the file picker — `pendingImage` holds one photo, and
   * the backend's text-turn endpoint takes a single `image`.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Voice mode hides the composer, so an attachment would have nowhere to show and no send
      // button to leave by.
      if (voiceModeActive) return
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file) return
      e.preventDefault()
      setPendingImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [voiceModeActive])

  /** Kills the tutor's current turn immediately — a pause-button tap or a barge-in. Aborts the
   * in-flight reply request (so no further sentence audio gets enqueued after this point) and
   * stops whatever's already playing. Caller decides what happens next (idle vs. straight into
   * listening for a barge-in).
   */
  const interruptSpeaking = () => {
    voiceTurnAbortRef.current?.abort()
    voiceTurnAbortRef.current = null
    player.stop()
    stopTypewriter()
  }

  /** Submits an already-transcribed utterance (live Deepgram streaming, see useMicRecorder) and
   * streams the reply back — shared by every turn in voice mode.
   */
  const runVoiceTurn = async (text: string) => {
    const session = sessionRef.current
    if (!session) return

    // A spoken yes to a pending calendar offer. The app already holds the proposed exam, so this
    // commits it directly — no round trip, and the tutor can't get confused about whether it has
    // already been added. The turn still goes through so the conversation carries on naturally.
    if (examOffer && !examOffer.added && AFFIRMATIVE.test(text.trim())) {
      void commitExam({ name: examOffer.name, date: examOffer.date })
    }

    setMessages((prev) => [...prev, { role: 'user', text }])
    setVoiceSentences([])
    sentenceDurationsRef.current = []
    sentenceWordsRef.current = []
    setSpeakingIdx(-1)
    setOrbState('thinking')

    const controller = new AbortController()
    voiceTurnAbortRef.current = controller
    replyInFlightRef.current = true

    let sentenceCount = 0
    let fullText = ''
    let silentReply: string | null = null

    try {
      await sendVoiceTurnText(
        session.id,
        text,
        {
          onSuggestExam: offerExam,
          onSentence: (sentence, audioBlob, words) => {
            const idx = sentenceCount
            sentenceCount += 1
            fullText = idx === 0 ? sentence : `${fullText} ${sentence}`
            if (idx === 0) {
              setOrbState('speaking')
              setMessages((prev) => [...prev, { role: 'assistant', text: '' }])
            }
            setVoiceSentences((prev) => [...prev, sentence])
            sentenceDurationsRef.current[idx] = Math.max(0.3, (audioBlob.size - 44) / 88200)
            sentenceWordsRef.current[idx] = words
            typeInto(fullText)
            // The tag ties this audio back to its sentence: when the player reaches it,
            // onItemStart(idx) lights that sentence up in the focus view.
            player.enqueue(audioBlob, idx)
          },
          onDone: (result) => {
            if (sentenceCount === 0) silentReply = result.reply
          },
        },
        controller.signal,
      )
      voiceTurnAbortRef.current = null
      replyInFlightRef.current = false

      // The stream is closed; decide what happens next only if playback can't decide for us.
      // JS being single-threaded makes this airtight: between clearing the flag above and the
      // isPlaying() check below no audio event can interleave, so exactly one of this block or
      // the player's onQueueEmpty runs the loop-or-idle step — never both.
      if (sentenceCount === 0) {
        // Voiceless reply (nothing was heard, or TTS produced no audio) — surface the text.
        if (silentReply) setMessages((prev) => [...prev, { role: 'assistant', text: silentReply! }])
        if (voiceModeRef.current) startListenCycle()
        else setOrbState('idle')
      } else if (!player.isPlaying()) {
        // Playback drained before the stream finished, and its onQueueEmpty was suppressed by
        // the in-flight guard. The turn is genuinely over now.
        if (voiceModeRef.current) startListenCycle()
        else setOrbState('idle')
      }
    } catch (e) {
      replyInFlightRef.current = false
      if (controller.signal.aborted) return // interrupted on purpose — the interrupter already handles state
      setPaywall(e instanceof PaymentRequired)
      setError(e instanceof PaymentRequired ? e.message : 'Something went wrong reaching the tutor.')
      setOrbState('idle')
    }
  }

  /** Holds voice mode open between turns without paying for it: the mic stays open locally and
   * only amplitude is watched, so nothing leaves the device until someone speaks. The moment
   * speech is detected the real (metered) transcription cycle takes over the same live capture.
   */
  const startWaitingWatch = async () => {
    if (!voiceModeRef.current) return
    setLiveTranscript('')
    setOrbState('waiting')
    try {
      const watcher = await mic.watchForSpeech(() => {
        // Clear the handle before starting the listen cycle: the watcher has already stopped
        // watching but deliberately left the mic open for that cycle to adopt, so a later
        // cancel() here would tear the stream out from under it.
        cancelWaitRef.current = null
        if (!voiceModeRef.current) {
          // Voice mode was switched off between detection and here. Nothing is going to adopt
          // the capture the watcher left open, so release it.
          mic.stop()
          return
        }
        startListenCycle()
      })
      if (voiceModeRef.current) cancelWaitRef.current = watcher.cancel
      else watcher.cancel()
    } catch {
      setError('Could not access your microphone — check browser permissions.')
      voiceModeRef.current = false
      setVoiceModeActive(false)
      setOrbState('idle')
    }
  }

  /** One listen-until-silence cycle. Loops itself via the player's onQueueEmpty callback above as
   * long as voice mode stays on — this is what makes voice mode continuous instead of one-shot.
   */
  const startListenCycle = async () => {
    if (!voiceModeRef.current) return
    // Seven call sites reach this, and two of them can fire for the same utterance — the
    // between-turns watcher handing off, and the barge-in watcher on a reply that is still
    // finishing. Without this, both open their own capture, both resolve with the same words,
    // and the turn runs twice: the tutor is asked the same question twice and answers it twice.
    // Set synchronously, because cancelListenRef is only populated once listenUntilSilence has
    // awaited and a second caller gets through the gap.
    if (listeningRef.current) return
    listeningRef.current = true
    // A watcher still holding this handle means we arrived from somewhere other than its own
    // hand-off (which clears it first), so it's still watching — release it before this cycle
    // opens its own capture.
    cancelWaitRef.current?.()
    cancelWaitRef.current = null
    setError(null)
    setNotice(null)
    setLiveTranscript('')
    setVoiceSentences([])
    sentenceDurationsRef.current = []
    sentenceWordsRef.current = []
    setSpeakingIdx(-1)
    setOrbState('listening')
    try {
      const { promise, cancel } = await mic.listenUntilSilence(setLiveTranscript)
      cancelListenRef.current = cancel
      const text = await promise
      cancelListenRef.current = null
      // Capture is over; the turn below is free to run and the next cycle free to start.
      listeningRef.current = false
      setLiveTranscript('')
      // Why the turn ended, on screen, when ?mic=debug is on the URL — a phone has no console
      // worth reading and a turn that cuts off early is otherwise only guessable from outside.
      if (MIC_DEBUG) {
        const d = mic.debugRef.current
        // Into the voice stage, not setNotice: notices render in the chat log, which the voice
        // overlay sits on top of, so the readout would be drawn underneath the orb.
        if (d) {
          setMicDebug(
            `${d.reason} after ${(d.ms / 1000).toFixed(1)}s · audio ${d.chunks} chunks, ` +
              `last ${d.msSinceAudio}ms ago · peak ${d.peak} · mean ${d.mean} · floor ${d.floor} · ` +
              `bar ${d.startBar} · silence ${d.silenceMs}ms`,
          )
        }
      }
      if (!voiceModeRef.current) return // toggled off while we were listening
      if (!text.trim()) {
        // Nobody spoke. Restarting the transcription cycle here is what used to stream 30-second
        // windows of silence to a per-minute API on an unattended screen; dropping out of voice
        // mode fixed the cost but made a pause for thought end the conversation. Instead, hold
        // voice mode open on the free local watcher — the metered stream reopens by itself the
        // moment someone actually talks.
        startWaitingWatch()
        return
      }
      await runVoiceTurn(text)
    } catch {
      listeningRef.current = false
      setError('Could not access your microphone — check browser permissions.')
      voiceModeRef.current = false
      setVoiceModeActive(false)
      mic.stop()
      setOrbState('idle')
    }
  }

  const handleToggleVoiceMode = () => {
    setNotice(null)
    if (voiceModeActive) {
      voiceModeRef.current = false
      setVoiceModeActive(false)
      // Everything, in every state. This used to pick one teardown based on the orb, which left
      // two ways out wrong. Leaving while listening or waiting never called player.stop() or
      // aborted the turn, so a reply still streaming in carried on arriving and playing after
      // voice mode was off. And nothing here released the microphone in any state: a watcher's
      // cancel() only clears its polling interval — mic.stop() is what ends the capture and
      // clears the browser's recording indicator.
      //
      // Each of these is a no-op when it has nothing to do, so there is no state to match on.
      interruptSpeaking()
      cancelWaitRef.current?.()
      cancelWaitRef.current = null
      cancelListenRef.current?.()
      cancelListenRef.current = null
      listeningRef.current = false
      mic.stop()
      setOrbState('idle')
    } else {
      // Synchronously inside the tap, before anything awaits: iOS only lets audio start from a
      // real gesture, and the tutor's first sentence arrives from the network seconds later.
      void player.unlock()
      voiceModeRef.current = true
      setVoiceModeActive(true)
      startListenCycle()
    }
  }

  // Barge-in: while the tutor is speaking, keep a cheap amplitude-only mic watch running (see
  // useMicRecorder.watchForSpeech — no Deepgram connection, just "has the user started talking").
  // The moment it fires, kill the current turn and drop straight into a real listen cycle to
  // capture what they're actually saying.
  useEffect(() => {
    if (!voiceModeActive || orbState !== 'speaking') return
    let cancelled = false
    let watcherCancel: (() => void) | null = null

    mic.watchForSpeech(() => {
      if (cancelled || !voiceModeRef.current) return
      // This watcher already tore itself down before calling us. Null the cleanup's reference to
      // it now, before starting a fresh listening session on the same shared mic refs — otherwise
      // the cleanup fired by the orbState change below could race a *second* stop() against the
      // brand-new stream `startListenCycle` is about to open.
      watcherCancel = null
      interruptSpeaking()
      startListenCycle()
    }).then((w) => {
      if (cancelled) w.cancel()
      else watcherCancel = w.cancel
    })

    return () => {
      cancelled = true
      watcherCancel?.()
    }
  }, [orbState, voiceModeActive])

  return (
    <div className="flex flex-col">
      {/* 640px, the width the design draws the tutor column at, and the same width the composer
          below is capped to so the two share an edge. Without it the starter rows and the chat
          log stretch the full content area on a desktop and a row's meta ends up a thousand
          pixels from the text it belongs to. */}
      <div ref={logRef} className="mx-auto flex w-full max-w-[640px] flex-col gap-5 pb-64">
        {messages.length === 0 ? (
          <EmptyState nextExam={nextExam} onPick={setDraft} />
        ) : (
          <TutorLog messages={messages} replyPending={replyPending} resumedDay={resumedDay} condensedBefore={condensedBefore} />
        )}
        {examOffer && (
          <ExamOfferRow
            offer={examOffer}
            onDismiss={() => setExamOffer(null)}
            onAdd={() => commitExam({ name: examOffer.name, date: examOffer.date })}
          />
        )}
        {notice && <Notice tone="neutral">{notice}</Notice>}
        {error && (
          <Notice tone="error" action={paywall ? { label: 'See plans', onClick: onOpenPricing } : undefined}>
            {error}
          </Notice>
        )}
        <div ref={bottomRef} />
      </div>

      {/* `fixed`, not `sticky` — pinned to the viewport regardless of chat scroll. Offset by the
          sidebar's width on desktop (lg:left-60) so it centers within the content area, not the
          full window; bottom-24 on mobile clears the floating tab bar underneath it. */}
      <div ref={composerRef} className="fixed inset-x-0 bottom-24 z-20 flex justify-center px-5 lg:bottom-6 lg:left-60 lg:px-10">
        <LatestPill away={away} onClick={pinToLatest} />
        <div className="relative flex w-full max-w-xl flex-col gap-1.5 rounded-[var(--r-md)] bg-[var(--surface)] p-2 lg:max-w-[640px]">
          {pendingImage && !voiceModeActive && (
            <PendingPhoto file={pendingImage} url={pendingImageUrl} onRemove={() => setPendingImage(null)} />
          )}
          {/* One shared click-away layer, rendered before the controls and below them (z-10 vs
              z-20). Each popover used to carry its own `fixed inset-0` backdrop, which painted
              over the neighbouring buttons — so switching from one picker to another took two
              taps: one absorbed by the backdrop, one on the button. Now the buttons sit above
              it, and a tap on another chip opens that chip directly. */}
          {openPopover && <div className="fixed inset-0 z-10" onClick={() => setOpenPopover(null)} />}

          {/* The message row: photo, text, send. Its own row, apart from the chips below, so the
              send button is never the control that wraps. It used to close the chip row, and a
              390pt phone offers ~330px inside the composer against ~380px of chips and buttons —
              so Send dropped to a line of its own underneath, the one control that has to be
              where the thumb expects it. Now the chips wrap among themselves and this row is
              always [photo] [text] [send], whatever the width. */}
          <div className="relative z-20 flex items-end gap-1.5">
            {!voiceModeActive && (
              <PhotoAttach
                attached={pendingImage !== null}
                open={openPopover === 'photo'}
                onToggle={() => setOpenPopover((p) => (p === 'photo' ? null : 'photo'))}
                onClose={() => setOpenPopover(null)}
                onSelect={handleSelectImage}
              />
            )}

            {!voiceModeActive ? (
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendText()
                  }
                }}
                placeholder="Message the tutor"
                className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-[0.9375rem] leading-snug outline-none"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center py-2.5">
                <span className="text-xs font-bold text-[var(--text-muted)]">{STATUS_LABEL[orbState]}</span>
              </div>
            )}

            {!voiceModeActive && draft.trim() ? (
              <button
                onClick={handleSendText}
                className="on-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--r-full)]"
                style={{ background: 'var(--accent)' }}
              >
                {SEND_ICON}
              </button>
            ) : (
              // Stays in the DOM while active (as the FLIP animation's target position) but hidden
              // and non-interactive — the floating orb is the actual stop control once it's up.
              <button
                ref={micButtonRef}
                onClick={handleToggleVoiceMode}
                title={settings?.ai_voice === false ? 'Voice mode is turned off in Settings' : 'Start voice mode'}
                // Hidden rather than greyed, unlike the Tutor tab: the composer is a tight row of
                // controls, and a dead button wedged between Send and the photo picker reads as
                // broken. The tab is a place you might go; this is a thing you'd press by mistake.
                hidden={settings?.ai_voice === false}
                disabled={voiceModeActive}
                className="on-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--r-full)] transition-opacity duration-150"
                style={{
                  background: 'var(--accent)',
                  opacity: voiceModeActive ? 0 : 1,
                  pointerEvents: voiceModeActive ? 'none' : 'auto',
                }}
              >
                {MIC_ICON}
              </button>
            )}
          </div>

          <ComposerChips
            session={session}
            settings={settings}
            voices={voices}
            voiceName={voiceName}
            memoryNotes={memoryNotes}
            profile={profile}
            open={openPopover}
            onToggle={(which) => setOpenPopover((p) => (p === which ? null : which))}
            onPersonalityChange={handlePersonalityChange}
            onVoiceChange={handleVoiceChange}
            onAddMemory={handleAddMemory}
            onDeleteMemory={handleDeleteMemory}
            onDeleteProfileLine={handleDeleteProfileLine}
            onNewConversation={messages.length > 0 ? handleNewConversation : null}
          />
        </div>
      </div>

      {orbMounted && (
        <FocusStage
          voiceModeActive={voiceModeActive}
          overlayIn={overlayIn}
          focusTextRef={focusTextRef}
          focusBottomRef={focusBottomRef}
          messages={messages}
          orbState={orbState}
          voiceSentences={voiceSentences}
          speakingIdx={speakingIdx}
          currentWords={currentWords}
          litCount={litCount}
          liveTranscript={liveTranscript}
          revealedTranscript={revealedTranscript}
          micDebug={MIC_DEBUG ? micDebug : null}
          examOffer={examOffer}
          onDismissOffer={() => setExamOffer(null)}
          onAddOffer={() => examOffer && commitExam({ name: examOffer.name, date: examOffer.date })}
          orbCircleRef={orbCircleRef}
          getAnalyser={getAnalyser}
          onEnd={handleToggleVoiceMode}
        />
      )}
    </div>
  )
}
