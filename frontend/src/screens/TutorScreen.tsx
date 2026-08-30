import { type ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createMemoryNote,
  createTutorSession,
  deleteMemoryNote,
  listBugs,
  listMemoryNotes,
  listTutorVoices,
  reportBug,
  resolveBug,
  sendTextTurn,
  sendVoiceTurnText,
  updateTutorSession,
} from '../api'
import type { BugReport } from '../api'
import MemoryPicker from '../components/MemoryPicker'
import PersonalityPicker, { PERSONALITY_PRESETS } from '../components/PersonalityPicker'
import VoiceOrb, { type OrbState } from '../components/VoiceOrb'
import VoicePicker from '../components/VoicePicker'
import { createExam } from '../api'
import { formatDayLong } from '../lib/dates'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useMicRecorder } from '../hooks/useMicRecorder'
import { useScrambleText } from '../hooks/useScrambleText'
import type {
  MemoryCategory,
  MemoryNote,
  Settings,
  TutorPersonality,
  TutorSession,
  TutorVoice,
  WordTiming,
} from '../types'

interface Message {
  /** 'system' is local-only — the app talking, not the tutor. Used by the owner-only /bug
   * commands, which never reach the model. */
  role: 'user' | 'assistant' | 'system'
  text: string
  imageUrl?: string
}

const STATUS_LABEL: Record<OrbState, string> = {
  idle: '',
  waiting: 'Waiting for you…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

/** Tap-to-fill starters for the empty tutor screen. Deliberately phrased around what this tutor
 * can actually do given its grounding (it reads your weak cards — see tutor_prompt.py) rather
 * than generic "ask me anything" filler. */
const STARTER_PROMPTS = ['Quiz me on my weak cards', 'Explain a concept I keep missing', 'Help me study for an exam']

/** Derived from the picker's own presets rather than restated here — two hand-written copies of
 * the same five labels is exactly the kind of pair that quietly disagrees after a rename. */
const PERSONALITY_LABELS = Object.fromEntries(
  PERSONALITY_PRESETS.map((p) => [p.id, p.label]),
) as Record<TutorPersonality, string>

const MEMORY_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3.5h11a1 1 0 0 1 1 1V21l-6.5-3L4.5 21V4.5a1 1 0 0 1 1-1z" />
    <path d="M8.5 8h6" />
  </svg>
)

const PERSONALITY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 16.6l-1.9-4.9L5.2 9.8l4.9-1.9L12 3z" />
    <path d="M19 15l.8 2.1L22 18l-2.2.9L19 21l-.8-2.1L16 18l2.2-.9L19 15z" />
  </svg>
)

const VOICE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4V5z" />
    <path d="M16 8a5 5 0 0 1 0 8" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
)

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5" />
    <path d="M6 11l6-6 6 6" />
  </svg>
)

const PHOTO_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="15" rx="2.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="8" cy="9.5" r="1.5" />
  </svg>
)

const CAMERA_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
)

const LIBRARY_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="15" rx="2.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="8" cy="9.5" r="1.5" />
  </svg>
)

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

const MIC_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
)

/** Bare words for the focus view's status line — the ellipsis variants above suit a composer
 * strip, but uppercase-tracked status text reads cleaner without punctuation. */
const FOCUS_STATUS: Record<OrbState, string> = {
  idle: '',
  waiting: 'Waiting for you',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

/** A spoken "yes" to the tutor's offer to add an exam. Anchored to the whole utterance on
 * purpose: answering a study question with "yes, the mitochondria" must never book something.
 * Only consulted on the turn immediately following an offer. */
const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|add it|sounds good)([ ,.!]*(please|thanks|thank you|do it|add it))*[ .!]*$/i

/** How far ahead of the voice a word lights up. Strictly on-time reads as lagging. */
const WORD_LEAD_S = 0.08

const FLIP_DURATION_MS = 160
/** How long the focus overlay takes to fade. Also the unmount delay on exit — the orb's FLIP
 * back onto the mic button (160ms) finishes first, then the backdrop melts away around it. */
const OVERLAY_FADE_MS = 300

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
  /** The tab-transition animation, applied to this screen's own elements rather than to a
   * wrapper around them. A transform on an ancestor would re-anchor the fixed composer to that
   * ancestor instead of the viewport; a transform on an element doesn't affect its own fixed
   * positioning, so log and composer each animate themselves. */
  enterClass?: string
  /** Adam's account only. Enables the /bug commands in the composer — see handleCommand. */
  isOwner?: boolean
}

export default function TutorScreen({ settings, enterClass, isOwner }: Props) {
  const [session, setSession] = useState<TutorSession | null>(null)
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [voiceModeActive, setVoiceModeActive] = useState(false)
  const [orbMounted, setOrbMounted] = useState(false) // in the DOM at all
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Neutral status message. Separate from `error` because falling back to text is expected
   * behaviour, and styling it red would tell the user something broke when nothing did. */
  const [notice, setNotice] = useState<string | null>(null)
  const [openPopover, setOpenPopover] = useState<'personality' | 'voice' | 'memory' | 'photo' | null>(null)
  const [voices, setVoices] = useState<TutorVoice[] | null>(null)
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[] | null>(null)
  /** A calendar entry the tutor has offered to add. Held until the student taps Add — the tutor
   * proposes, the student writes. `added` keeps the card in place afterwards so the confirmation
   * is visible rather than the row just vanishing. */
  const [examOffer, setExamOffer] = useState<{ name: string; date: string; added: boolean } | null>(null)
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
  const scrambledTranscript = useScrambleText(liveTranscript)

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
  /** Cancels the free local amplitude watch that holds voice mode open between turns. */
  const cancelWaitRef = useRef<(() => void) | null>(null)
  const voiceTurnAbortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
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
    createTutorSession()
      .then(setSession)
      .catch(() => setError('Could not start a tutor session.'))
    listTutorVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
    listMemoryNotes()
      .then(setMemoryNotes)
      .catch(() => setMemoryNotes([]))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // useLayoutEffect, not useEffect: this measures the textarea and then writes a pixel height
  // onto it. In a passive effect that write lands *after* the browser has painted, so opening the
  // tutor tab showed the composer at its natural height and then resized it a frame later —
  // visible as a delayed jump, and worse while the tab-enter animation was still running.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  // The height above is measured in whatever font is rendering at the time. On a cold load that's
  // the fallback, and Nunito swapping in afterwards changes the line box — leaving the composer
  // sized for a font it is no longer using.
  useEffect(() => {
    document.fonts?.ready
      .then(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`
      })
      .catch(() => {})
  }, [])

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
      bottomRef.current?.scrollIntoView({ block: 'end' })
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

  /** When the voice reaches each word of the sentence being spoken, in seconds into that
   * sentence's own audio.
   *
   * Cartesia reports real per-word timings alongside the audio, so there is normally nothing to
   * estimate. Two fallbacks keep this honest rather than brittle:
   *  - counts disagree (the synthesizer normalized something — "$5" spoken as two words), so
   *    written words are mapped proportionally onto the real timings. Still anchored to the
   *    actual audio, just coarser.
   *  - no timings at all (Chatterbox), so the old letter-weighted estimate stands in. It ran up
   *    to ~0.35s ahead of the voice when measured, which is why it's the last resort.
   */
  // Keyed on the sentence's *text*, not the sentences array: a later sentence arriving mid-speech
  // must not give this a new identity, or the sweep effect below would restart and re-flash every
  // word already lit.
  const speakingSentence = speakingIdx >= 0 ? voiceSentences[speakingIdx] ?? '' : ''
  const currentWords = useMemo(() => {
    if (speakingIdx < 0 || !speakingSentence) return null
    const words = speakingSentence.split(/\s+/).filter(Boolean)
    const timings = sentenceWordsRef.current[speakingIdx] ?? []

    if (timings.length === words.length) {
      return words.map((word, i) => ({ word, start: timings[i].s }))
    }
    if (timings.length > 0) {
      return words.map((word, i) => ({
        word,
        start: timings[Math.min(timings.length - 1, Math.floor((i * timings.length) / words.length))].s,
      }))
    }

    const duration = sentenceDurationsRef.current[speakingIdx] ?? words.length * 0.36
    const weights = words.map((w) => w.length + 2)
    const total = weights.reduce((a, b) => a + b, 0)
    let acc = 0
    return words.map((word, i) => {
      const start = (duration * acc) / total
      acc += weights[i]
      return { word, start }
    })
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

  /** Reveals an assistant message's text a few characters at a time instead of popping in
   * whatever chunk just arrived over the wire — used by both the typed and voice reply paths so
   * there's one typewriter, not two. Chunk size varies a lot between the two (typed replies
   * stream near-per-token; voice replies arrive a whole synthesized sentence at a time), so the
   * per-tick step is adaptive: small step when text is trickling in (smooth per-character feel),
   * bigger step when a large chunk just landed (catches up in ~15 ticks instead of visibly
   * lagging behind the real content for a second-plus).
   */
  const typewriterRef = useRef<{ target: string; timer: number | null }>({ target: '', timer: null })

  const typeInto = (fullText: string) => {
    const state = typewriterRef.current
    state.target = fullText
    if (state.timer) return
    state.timer = window.setInterval(() => {
      setMessages((prev) => {
        // Always types into the trailing assistant message rather than a captured index. The old
        // index was captured inside a setMessages updater, which React runs later — so on a
        // reply's FIRST chunk it was still -1 and the reveal wrote into array[-1], i.e. nowhere.
        // Multi-chunk replies self-healed on chunk two; a single-sentence voice reply never got
        // one, stayed empty forever, and vanished when the karaoke cleared. While a reply is
        // being revealed it is by construction the last message, so "the last message, if it's
        // the assistant's" is both simpler and correct.
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant' || last.text.length >= state.target.length) {
          if (state.timer) {
            clearInterval(state.timer)
            state.timer = null
          }
          return prev
        }
        const behind = state.target.length - last.text.length
        const step = Math.max(1, Math.ceil(behind / 15))
        const next = [...prev]
        next[next.length - 1] = { ...last, text: state.target.slice(0, last.text.length + step) }
        return next
      })
    }, 20)
  }

  /** Freezes the typewriter mid-reveal — for a pause/barge-in interrupt, where the point is that
   * the tutor stops talking right now, not that the remaining text pops in immediately.
   */
  const stopTypewriter = () => {
    const state = typewriterRef.current
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
  }

  useEffect(() => stopTypewriter, [])

  // --- Owner-only bug inbox -------------------------------------------------------------------
  // Somewhere to drop "fix this later" without leaving whatever I was doing. Handled entirely on
  // the client: the text never reaches the tutor, so it costs nothing, arrives verbatim, and no
  // model tries to be helpful about a bug it can't fix. Everyone else's /bug is just a message.
  const bugListRef = useRef<BugReport[]>([])

  const renderBugs = (bugs: BugReport[]): string => {
    if (!bugs.length) return 'No open bugs.'
    const lines = bugs.map((b, i) => {
      const days = Math.floor((Date.now() - new Date(b.created_at).getTime()) / 86400000)
      const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
      return `${i + 1}. ${b.text}  (${when})`
    })
    return `${bugs.length} open:\n${lines.join('\n')}\n\n/bugs done <number> to clear one.`
  }

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
      const key = doneMatch[1]
      const list = bugListRef.current
      // A list position is far easier to type on a phone than a UUID, so a plain number means
      // "the nth of the listing you just showed me"; anything else is matched as an id prefix.
      const byIndex = /^\d+$/.test(key) ? list[Number(key) - 1] : undefined
      const target = byIndex ?? list.find((b) => b.id.startsWith(key.toLowerCase()))
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

  const handleSendText = async () => {
    const text = draft.trim()
    const image = pendingImage
    // Before the session guard: a command is answered locally, so it should still work on the
    // one occasion I most want to file a bug — when the tutor itself didn't come up.
    if (text.startsWith('/') && (await handleCommand(text))) return
    if ((!text && !image) || !session || orbState !== 'idle') return
    setDraft('')
    setPendingImage(null)
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', text, imageUrl: image ? URL.createObjectURL(image) : undefined }])
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }])
    let fullText = ''
    try {
      await sendTextTurn(
        session.id,
        text,
        (chunk) => {
          fullText += chunk
          typeInto(fullText)
        },
        image ?? undefined,
        offerExam,
      )
    } catch {
      setError('Something went wrong reaching the tutor.')
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
    } catch {
      replyInFlightRef.current = false
      if (controller.signal.aborted) return // interrupted on purpose — the interrupter already handles state
      setError('Something went wrong reaching the tutor.')
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
      setLiveTranscript('')
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
      if (orbStateRef.current === 'waiting') {
        // The watcher owns an open mic with no transcription attached — cancelling it is what
        // actually releases the microphone (and clears the browser's recording indicator).
        cancelWaitRef.current?.()
        cancelWaitRef.current = null
      } else if (orbStateRef.current === 'listening') {
        cancelListenRef.current?.()
        cancelListenRef.current = null
      } else {
        // Mid-thinking/speaking — stop the tutor talking right now rather than letting the turn
        // finish naturally, which is what it used to do.
        interruptSpeaking()
      }
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
      <div className={`flex flex-col gap-5 pb-64 ${enterClass ?? ''}`}>
        {messages.length === 0 ? (
          /* Was a single centered line of grey text on an otherwise blank screen. The starter
             prompts do real work beyond filling space: a blank tutor box gives no clue what it's
             actually good at, so these double as capability hints. */
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background: 'color-mix(in oklab, var(--accent) 15%, var(--bg-card))',
                color: 'var(--accent)',
                boxShadow: 'var(--highlight-shadow)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 16.6l-1.9-4.9L5.2 9.8l4.9-1.9L12 3z" />
                <path d="M19 15l.8 2.1L22 18l-2.2.9L19 21l-.8-2.1L16 18l2.2-.9L19 15z" />
              </svg>
            </div>
            <div>
              <div className="mb-1.5 text-lg font-extrabold">What are we working on?</div>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
                Type a message, attach a photo of your notes, or tap the mic to talk — it keeps listening until you
                tap it again.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setDraft(prompt)}
                  className="rounded-full border border-[var(--ring-track)] px-3.5 py-2 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Not bubble-on-bubble chat styling: the tutor's words sit directly on the page like
             prose, and only the user's turns get a (quiet, tinted) pill to mark whose line is
             whose. One bubble per exchange is enough attribution — two was wallpaper. */
          messages.map((m, i) =>
            m.role === 'system' ? (
              // The app talking, not the tutor: monospaced, dimmed and centred so a /bug listing
              // never reads as something the model said.
              <div
                key={i}
                className="max-w-[94%] self-center whitespace-pre-line rounded-2xl px-4 py-2.5 text-center font-mono text-xs leading-relaxed"
                style={{ background: 'var(--bg)', color: 'var(--text-secondary)' }}
              >
                {m.text}
              </div>
            ) : m.role === 'user' ? (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed"
                style={{
                  background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-card))',
                  color: 'var(--text)',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                {m.imageUrl && (
                  <img src={m.imageUrl} alt="Attached photo" className="mb-2 max-h-48 w-full rounded-xl object-cover" />
                )}
                {m.text}
              </div>
            ) : (
              <div key={i} className="max-w-[94%] self-start px-1 text-[0.9375rem] leading-relaxed text-[var(--text)]">
                {m.imageUrl && (
                  <img src={m.imageUrl} alt="Attached photo" className="mb-2 max-h-48 w-full rounded-xl object-cover" />
                )}
                {m.text}
              </div>
            ),
          )
        )}
        {examOffer && (
          <div
            className="flex max-w-[94%] items-center gap-3 self-start rounded-[16px] border border-[var(--ring-track)] px-4 py-3"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{examOffer.name}</div>
              <div className="text-xs text-[var(--text-secondary)]">{formatDayLong(examOffer.date)}</div>
            </div>
            {examOffer.added ? (
              <span className="flex-shrink-0 text-xs font-bold" style={{ color: 'var(--grade-good)' }}>
                Added ✓
              </span>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  onClick={() => setExamOffer(null)}
                  className="rounded-xl px-3 py-2 text-xs font-bold text-[var(--text-secondary)]"
                >
                  No thanks
                </button>
                <button
                  onClick={() => commitExam({ name: examOffer.name, date: examOffer.date })}
                  className="rounded-xl px-3.5 py-2 text-xs font-bold text-[oklch(0.99_0.005_90)]"
                  style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow)' }}
                >
                  Add to calendar
                </button>
              </div>
            )}
          </div>
        )}
        {notice && (
          <div
            className="self-center rounded-2xl px-4 py-2.5 text-center text-sm font-semibold"
            style={{ background: 'var(--bg)', color: 'var(--text-secondary)' }}
          >
            {notice}
          </div>
        )}
        {error && (
          <div
            className="self-center rounded-2xl px-4 py-2.5 text-center text-sm font-semibold"
            style={{ background: 'var(--grade-forgot-bg)', color: 'var(--grade-forgot)' }}
          >
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* `fixed`, not `sticky` — pinned to the viewport regardless of chat scroll. Offset by the
          sidebar's width on desktop (lg:left-60) so it centers within the content area, not the
          full window; bottom-24 on mobile clears the floating tab bar underneath it. */}
      <div className={`fixed inset-x-0 bottom-24 z-20 flex justify-center px-5 lg:bottom-6 lg:left-60 lg:px-10 ${enterClass ?? ''}`}>
        <div className="flex w-full max-w-xl flex-col gap-1.5 rounded-[16px] bg-[var(--bg-card)] p-2 lg:max-w-2xl" style={{ boxShadow: 'var(--shadow-md)' }}>
          {pendingImage && !voiceModeActive && (
            <div className="flex items-center gap-2 px-2 pt-1">
              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg">
                <img src={pendingImageUrl ?? undefined} alt="Selected photo" className="h-full w-full object-cover" />
                <button
                  onClick={() => setPendingImage(null)}
                  aria-label="Remove photo"
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  {CLOSE_ICON}
                </button>
              </div>
              <span className="truncate text-xs text-[var(--text-secondary)]">{pendingImage.name}</span>
            </div>
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
              placeholder="Message the tutor…"
              className="min-w-0 resize-none bg-transparent px-3 py-2 text-sm leading-snug outline-none"
            />
          ) : (
            <div className="flex items-center justify-center py-2.5">
              <span className="text-xs font-bold text-[var(--text-secondary)]">{STATUS_LABEL[orbState]}</span>
            </div>
          )}

          {/* Wraps on purpose. Five controls need roughly 380px of label and padding, and a
              390pt phone only offers ~330px inside the composer — so on a narrow screen the
              photo/mic pair drops to a second line instead of the chips being squeezed until
              their labels break apart. `ml-auto` on the photo group does what the old spacer div
              did (push the pair right) but survives wrapping, which a `flex-1` spacer does not. */}
          {/* One shared click-away layer, rendered before the controls and below them (z-10 vs
              z-20). Each popover used to carry its own `fixed inset-0` backdrop, which painted
              over the neighbouring buttons — so switching from one picker to another took two
              taps: one absorbed by the backdrop, one on the button. Now the buttons sit above
              it, and a tap on another chip opens that chip directly. */}
          {openPopover && <div className="fixed inset-0 z-10" onClick={() => setOpenPopover(null)} />}

          <div className="relative z-20 flex flex-wrap items-end gap-1.5">
            <div className="relative">
              <button
                onClick={() => setOpenPopover((p) => (p === 'personality' ? null : 'personality'))}
                aria-label={`Tutor style${session ? ': ' + PERSONALITY_LABELS[session.personality] : ''}`}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-secondary)]"
                style={{
                  background: openPopover === 'personality' ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-card))' : undefined,
                  boxShadow: openPopover === 'personality' ? 'var(--highlight-shadow)' : 'var(--shadow-xs)',
                }}
              >
                {PERSONALITY_ICON}
                {/* The selected value is hidden on phones — three of these labels plus the photo
                    and send controls need more width than a 390pt screen has, and the send button
                    was dropping to a second line. The icon plus its accessible name still say what
                    the control is; the value itself is one tap away in the picker. */}
                {/* Falls back to the saved default while the session request is in flight. A
                    new session is created *from* that default, so this is the same word it will
                    show a moment later — without it the chip grows when the response lands and
                    shoves the composer's controls around. */}
                {(session?.personality ?? settings?.tutor_personality) && (
                  <span className="hidden sm:inline">
                    {PERSONALITY_LABELS[(session?.personality ?? settings?.tutor_personality)!]}
                  </span>
                )}
              </button>
              {openPopover === 'personality' && session && (
                <>
                  <div className="absolute bottom-12 left-0 z-20">
                    <PersonalityPicker
                      personality={session.personality}
                      customPrompt={session.custom_prompt ?? ''}
                      onChange={handlePersonalityChange}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setOpenPopover((p) => (p === 'voice' ? null : 'voice'))}
                aria-label={`Voice${voiceName ? ': ' + voiceName : ''}`}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-secondary)]"
                style={{
                  background: openPopover === 'voice' ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-card))' : undefined,
                  boxShadow: openPopover === 'voice' ? 'var(--highlight-shadow)' : 'var(--shadow-xs)',
                }}
              >
                {VOICE_ICON}
                {voiceName ? <span className="hidden sm:inline">{voiceName}</span> : null}
              </button>
              {openPopover === 'voice' && session && (
                <>
                  <div className="absolute bottom-12 left-0 z-20">
                    <VoicePicker voiceId={session.voice_id} voices={voices} onChange={handleVoiceChange} />
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setOpenPopover((p) => (p === 'memory' ? null : 'memory'))}
                aria-label={`Notes the tutor remembers: ${memoryNotes?.length ?? 0}`}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-secondary)]"
                style={{
                  background: openPopover === 'memory' ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-card))' : undefined,
                  boxShadow: openPopover === 'memory' ? 'var(--highlight-shadow)' : 'var(--shadow-xs)',
                }}
              >
                {MEMORY_ICON}
                {memoryNotes && memoryNotes.length > 0 && (
                  <span className="hidden sm:inline">
                    {memoryNotes.length} {memoryNotes.length === 1 ? 'note' : 'notes'}
                  </span>
                )}
              </button>
              {openPopover === 'memory' && (
                <>
                  <div className="absolute bottom-12 left-0 z-20">
                    <MemoryPicker notes={memoryNotes} onAdd={handleAddMemory} onDelete={handleDeleteMemory} />
                  </div>
                </>
              )}
            </div>

            {!voiceModeActive && (
              <div className="relative ml-auto">
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleSelectImage}
                  className="hidden"
                />
                <input ref={libraryInputRef} type="file" accept="image/*" onChange={handleSelectImage} className="hidden" />
                <button
                  onClick={() => setOpenPopover((p) => (p === 'photo' ? null : 'photo'))}
                  aria-label={pendingImage ? 'Photo attached' : 'Attach a photo'}
                  className="flex h-8 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-secondary)]"
                  style={{
                    background: pendingImage || openPopover === 'photo' ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-card))' : undefined,
                    boxShadow: pendingImage || openPopover === 'photo' ? 'var(--highlight-shadow)' : 'var(--shadow-xs)',
                  }}
                >
                  {PHOTO_ICON}
                  {pendingImage && <span className="hidden sm:inline">1 photo</span>}
                </button>
                {openPopover === 'photo' && (
                  <>
                      <div className="absolute bottom-12 right-0 z-20 flex w-44 flex-col gap-1 rounded-[14px] bg-[var(--bg-card)] p-1.5" style={{ boxShadow: 'var(--shadow-lg)' }}>
                      <button
                        onClick={() => {
                          cameraInputRef.current?.click()
                          setOpenPopover(null)
                        }}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[var(--text)]"
                      >
                        {CAMERA_ICON}
                        Take Photo
                      </button>
                      <button
                        onClick={() => {
                          libraryInputRef.current?.click()
                          setOpenPopover(null)
                        }}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[var(--text)]"
                      >
                        {LIBRARY_ICON}
                        Choose from Library
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {!voiceModeActive && draft.trim() ? (
              <button
                onClick={handleSendText}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-[oklch(0.99_0.005_90)]"
                style={{ background: 'var(--accent)', boxShadow: 'var(--accent-shadow-soft)' }}
              >
                {SEND_ICON}
              </button>
            ) : (
              // Stays in the DOM while active (as the FLIP animation's target position) but hidden
              // and non-interactive — the floating orb is the actual stop control once it's up.
              <button
                ref={micButtonRef}
                onClick={handleToggleVoiceMode}
                title="Start voice mode"
                disabled={voiceModeActive}
                // Takes over the photo group's `ml-auto` in voice mode, when that group isn't
                // rendered. It's invisible by then, but it's still the FLIP animation's target
                // position — letting it slide left here would land the orb in the wrong place.
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-[oklch(0.99_0.005_90)] transition-opacity duration-150 ${
                  voiceModeActive ? 'ml-auto' : ''
                }`}
                style={{
                  background: 'var(--accent)',
                  boxShadow: 'var(--accent-shadow-soft)',
                  opacity: voiceModeActive ? 0 : 1,
                  pointerEvents: voiceModeActive ? 'none' : 'auto',
                }}
              >
                {MIC_ICON}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* FOCUS MODE — a full-screen takeover, not a chat with an orb floating over it. The text
          being spoken is the star: large type on a bare dark stage, the sentence currently being
          read lit up and the rest dimmed, with the orb reduced to a control at the bottom. The
          stage is deliberately literal-black in both themes — same "own immersive treatment"
          decision as the orb itself. Mounted/unmounted around the orb's FLIP flight so the grow-
          out-of-the-button motion still lands. */}
      {orbMounted && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Voice session"
          className="fixed inset-0 z-30 flex touch-none flex-col transition-opacity"
          style={{
            transitionDuration: `${OVERLAY_FADE_MS}ms`,
            opacity: voiceModeActive && overlayIn ? 1 : 0,
            background:
              'radial-gradient(ellipse 95% 60% at 50% 104%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 68%), rgb(13 10 8 / 0.96)',
          }}
        >
          <div className="flex min-h-0 flex-1 items-end justify-center px-7 pt-[calc(3.5rem+env(safe-area-inset-top))]">
            <div
              ref={focusTextRef}
              className="max-h-[55vh] w-full max-w-xl touch-auto overflow-y-auto overscroll-contain transition-transform duration-500 lg:max-h-[60vh]"
              style={{
                transform: overlayIn ? 'translateY(0)' : 'translateY(12px)',
                // Text dissolves at the container's edges instead of clipping against an
                // invisible line — the scroll boundary shouldn't read as a box edge when the
                // whole design is about not having boxes.
                WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
                maskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
              }}
            >
              {/* The running conversation, not a one-utterance-at-a-time card: entering voice
                  mode mid-chat picks up right where the typed exchange left off, and everything
                  said by voice stays on stage above the live line. One type size throughout —
                  brightness carries time (past turns recede, the live moment is lit) and
                  alignment carries speaker, so nothing needs a bubble. */}
              <div className="flex flex-col gap-9 px-1 py-6 text-[1.35rem] font-semibold leading-[1.5] lg:text-[1.6rem]">
                {/* System messages (the /bug commands) are dropped here: they're the app talking
                    to itself, and on the voice stage they'd read as something that was said. */}
                {(orbState === 'speaking' && voiceSentences.length > 0 ? messages.slice(0, -1) : messages)
                  .filter((m) => m.role !== 'system')
                  .map(
                  (m, i) =>
                    m.text ? (
                      <p
                        key={i}
                        className={`focus-line ${m.role === 'user' ? 'self-end text-right' : 'self-start text-left'}`}
                        style={{
                          maxWidth: '88%',
                          color:
                            m.role === 'user'
                              ? 'color-mix(in oklab, var(--accent) 55%, rgb(255 255 255 / 0.45))'
                              : 'rgb(255 255 255 / 0.42)',
                        }}
                      >
                        {m.text}
                      </p>
                    ) : null,
                )}

                {orbState === 'listening' && liveTranscript && (
                  <p className="max-w-[88%] self-end text-right text-white">{scrambledTranscript}</p>
                )}

                {orbState === 'thinking' && (
                  <p aria-label="Thinking" className="animate-pulse self-start tracking-[0.35em] text-white/40">
                    •••
                  </p>
                )}

                {orbState === 'speaking' && voiceSentences.length > 0 && (
                  /* Karaoke, at sentence granularity — that's the honest unit: audio arrives one
                     sentence per blob, so playback genuinely knows sentence boundaries and
                     nothing finer. The sentence being read is lit, spoken ones stay readable,
                     arrived-but-unspoken ones are barely there. */
                  <p className="max-w-[88%] self-start text-left">
                    {voiceSentences.map((sentence, i) =>
                      i === speakingIdx && currentWords ? (
                        <span key={i} data-sentence={i} className="focus-line-inline">
                          {currentWords.map(({ word }, wi) => (
                            <span key={wi} className={wi < litCount ? 'focus-word' : 'focus-word-idle'}>
                              {word + ' '}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span
                          key={i}
                          data-sentence={i}
                          className="focus-line-inline"
                          style={{
                            color: i < speakingIdx ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.16)',
                            transition: 'color 350ms ease',
                          }}
                        >
                          {sentence}{' '}
                        </span>
                      ),
                    )}
                  </p>
                )}
                <div ref={focusBottomRef} />
              </div>
            </div>
          </div>

          {/* The offer has to be reachable from in here: the overlay covers the chat, so the card
              in the log behind it is invisible until you leave voice mode. Tapping is the primary
              path — a spoken "yes" also works (see runVoiceTurn), but speech gets misheard and
              this one writes to their calendar. */}
          {examOffer && (
            <div className="mx-auto mb-4 flex w-[min(26rem,88%)] items-center gap-3 rounded-[16px] px-4 py-3"
              style={{ background: 'rgb(255 255 255 / 0.08)', border: '1px solid rgb(255 255 255 / 0.14)' }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white/90">{examOffer.name}</div>
                <div className="text-xs text-white/50">{formatDayLong(examOffer.date)}</div>
              </div>
              {examOffer.added ? (
                <span className="flex-shrink-0 text-xs font-bold" style={{ color: 'var(--grade-good)' }}>
                  Added ✓
                </span>
              ) : (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => setExamOffer(null)} className="rounded-xl px-2.5 py-2 text-xs font-bold text-white/45">
                    No
                  </button>
                  <button
                    onClick={() => commitExam({ name: examOffer.name, date: examOffer.date })}
                    className="rounded-xl px-3.5 py-2 text-xs font-bold text-[oklch(0.99_0.005_90)]"
                    style={{ background: 'var(--accent)' }}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col items-center gap-1 pb-10 lg:pb-8">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">
              {FOCUS_STATUS[orbState]}
            </span>
            {/* The grow-out-of-the-button motion is done on orbCircleRef via direct transform
                manipulation (see the FLIP effects above) — imperative on purpose. */}
            <button
              ref={orbCircleRef}
              onClick={handleToggleVoiceMode}
              title="End voice mode"
              className="relative flex origin-center cursor-pointer items-center justify-center rounded-full p-2"
            >
              <VoiceOrb state={orbState} getAnalyser={getAnalyser} size={230} />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="oklch(0.99 0.005 90)">
                  <rect x="5" y="5" width="14" height="14" rx="4" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
