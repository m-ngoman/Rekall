import { useMemo } from 'react'
import { wordStarts } from '@app/lib/wordTimings'
import take from '../audio/tutor-sn1-sn2.words.json'
import { useVoiceSamples } from '../audio/assets'
import { demo } from '../data/demo'
import { cameraAt } from '../lib/camera'
import { pointerAt, pressed } from '../lib/cursor'
import { FLIP_EASE, PULSE_EASE, TW_EASE, lerp, msToFrames, progress } from '../lib/ease'
import { focusLine, focusLineInline, focusWord, litFrame } from '../lib/karaoke'
import { orbBandsAt, type OrbInput, type OrbState } from '../lib/orb'
import { REVEAL_TICK_MS, revealedAt } from '../lib/reveal'
import { AppCanvas, CANVAS } from '../primitives/AppCanvas'
import { Pointer } from '../primitives/Pointer'
import { FocusStage, ORB_REST } from '../replica/FocusStage'
import { Shell } from '../replica/Shell'
import { Composer, MIC_CENTRE, TutorPage } from '../replica/TutorScreen'
import { FPS, type Layout, type VoiceBeats } from '../timeline'
import { ms, useSceneFrame } from './common'

const STATUS_LABEL: Record<OrbState, string> = { idle: '', waiting: 'Waiting for you…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' }
const FOCUS_STATUS: Record<OrbState, string> = { idle: '', waiting: 'Waiting for you', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }
/** The orb button is the 230 px orb plus 8 px all round; the mic it grows out of is 40 px. */
const FLIP_SCALE = 40 / 246
const ORB_CLOCK = 20_000

/** Voice mode, from the Tutor tab: the mic, the orb growing out of it, the student asking, the
 * tutor answering out loud with each word lit as it's spoken. It always starts on the Tutor tab —
 * the tutor is the only thing in Rekall that listens, and a stage that faded in over a flashcard
 * would say otherwise. */
export function VoiceScene({ layout, beats, silent = false }: { layout: Layout; beats: VoiceBeats; silent?: boolean }) {
  const f = useSceneFrame()
  const b = beats
  const desktop = layout === 'landscape'
  const audio = useVoiceSamples(silent)
  const question = demo.tutor.question
  const exit = b.exit ?? Infinity

  const stateAt = (frame: number): OrbState =>
    frame < b.micPress ? 'idle' : frame < b.thinkStart ? 'listening' : frame < b.speakStart ? 'thinking' : frame < b.listenAfter ? 'speaking' : 'listening'
  const state = stateAt(f)

  // The voice's words, as the app times them (wordStarts over the take's own alignment).
  const words = useMemo(() => wordStarts(take.text, take.words, take.duration), [])
  const askFrames = msToFrames(question.length * REVEAL_TICK_MS)

  /** What moves the orb at a moment of the app's loop clock. */
  const inputAt = (t: number): OrbInput => {
    const frame = ((t - ORB_CLOCK) / 1000) * FPS
    const s = stateAt(frame)
    if (s === 'speaking') {
      const at = (frame - b.speakStart) / FPS
      const inWord = take.words.some((w) => at >= w.s && at <= w.e)
      return { state: s, audioTime: at, envelope: inWord ? 1 : 0.18 }
    }
    if (s === 'listening') {
      const asking = frame >= b.transcriptStart && frame < b.transcriptStart + askFrames
      return { state: s, envelope: asking ? 0.7 + 0.25 * Math.sin(frame * 0.9) : 0.14 }
    }
    return { state: s }
  }
  const orbT = ORB_CLOCK + ms(f)
  const bands = useMemo(() => orbBandsAt(orbT, inputAt, audio), [orbT, audio]) // eslint-disable-line react-hooks/exhaustive-deps

  const voiceOn = f >= b.micPress && f < exit + 10
  const overlay = f < exit ? progress(f, b.micPress, msToFrames(300), TW_EASE) : 1 - progress(f, exit, msToFrames(300), TW_EASE)
  const flipIn = progress(f, b.micPress, msToFrames(160), FLIP_EASE)
  const flip = f < exit ? flipIn : 1 - progress(f, exit, msToFrames(160), FLIP_EASE)
  const mic = MIC_CENTRE[layout]
  const rest = ORB_REST[layout]

  const pageMessages =
    f < b.thinkStart
      ? []
      : f < b.speakStart
        ? [{ role: 'user' as const, text: question }]
        : [
            { role: 'user' as const, text: question },
            { role: 'assistant' as const, text: demo.tutor.reply },
          ]

  const lines: { role: 'user' | 'assistant'; text: string; opacity: number; y: number }[] = []
  if (f >= b.thinkStart) lines.push({ role: 'user', text: question, ...focusLine(ms(f - b.thinkStart)) })
  if (f >= b.listenAfter) lines.push({ role: 'assistant', text: demo.tutor.reply, ...focusLine(ms(f - b.listenAfter)) })

  const pulse = (() => {
    const phase = (ms(f - b.thinkStart) % 2000) / 2000
    return phase < 0.5 ? lerp(1, 0.5, PULSE_EASE(phase / 0.5)) : lerp(0.5, 1, PULSE_EASE((phase - 0.5) / 0.5))
  })()

  // The pointer: to the mic, and in the 60 s cut to the orb, which ends voice mode.
  const pointerTo = f < exit - 20 ? { from: { x: mic.x - 260, y: mic.y - 170 }, to: mic, start: b.micPress - 14, press: b.micPress } : { from: { x: rest.x + 220, y: rest.y - 140 }, to: rest, start: exit - 16, press: exit }
  const pointer = desktop
    ? f >= pointerTo.start && f < pointerTo.press + 8
      ? { ...pointerAt(f, pointerTo.from, pointerTo.to, pointerTo.start, pointerTo.press - 3), visible: Math.min(1, (f - pointerTo.start) / 4, (pointerTo.press + 8 - f) / 5), hand: f >= pointerTo.press - 5 }
      : null
    : f >= pointerTo.press - 2 && f < pointerTo.press + 8
      ? { ...pointerTo.to, visible: f < pointerTo.press + 3 ? 1 : (pointerTo.press + 8 - f) / 5, hand: false }
      : null

  return (
    <AppCanvas layout={layout} camera={cameraAt(f, b.camera[layout])}>
      <Shell
        tab="tutor"
        overlay={
          <>
            <Composer
              voiceActive={f >= b.micPress && f < exit + 9}
              statusLabel={STATUS_LABEL[state]}
              micOpacity={f < exit ? 1 - progress(f, b.micPress, msToFrames(150), TW_EASE) : progress(f, exit + 9, msToFrames(150), TW_EASE)}
              mic={{ hover: desktop && f >= b.micPress - 5 && f < b.micPress, down: pressed(f, b.micPress) }}
              touch={!desktop}
            />
            {voiceOn && (
              <FocusStage
                overlay={overlay}
                rise={progress(f, b.micPress, msToFrames(500), TW_EASE)}
                lines={lines}
                live={state === 'listening' && f < b.thinkStart && f >= b.transcriptStart ? revealedAt(ms(f - b.transcriptStart), question) : undefined}
                thinking={state === 'thinking' ? pulse : undefined}
                speaking={
                  state === 'speaking'
                    ? {
                        opacity: focusLineInline(ms(f - b.speakStart)),
                        words: words.map(({ word, start }) => {
                          const lit = litFrame(start, b.speakStart, FPS)
                          return { word, ...focusWord(f >= lit ? ms(f - lit) : null) }
                        }),
                      }
                    : undefined
                }
                status={FOCUS_STATUS[state]}
                orb={{ bands, t: orbT, state, resolution: CANVAS[layout].base * 1.6 }}
                flip={{ dx: (mic.x - rest.x) * (1 - flip), dy: (mic.y - rest.y) * (1 - flip), scale: lerp(FLIP_SCALE, 1, flip), opacity: flip }}
              />
            )}
          </>
        }
      >
        <TutorPage messages={f < exit ? (voiceOn ? pageMessages : []) : pageMessages} />
      </Shell>
      {pointer && pointer.visible > 0 && (
        <Pointer kind={desktop ? 'mouse' : 'touch'} x={pointer.x} y={pointer.y} hand={pointer.hand} down={pressed(f, pointerTo.press)} opacity={pointer.visible} />
      )}
    </AppCanvas>
  )
}
