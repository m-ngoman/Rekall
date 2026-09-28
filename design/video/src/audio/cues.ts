// Every sound effect in a cut, placed from the same beats and schedules the scenes animate with —
// the answer's keys on the frames its characters appear, a click on each press, the explanation's
// ticks as it types itself out — so the sound can't drift from the picture. `sfxStem` mixes them
// into one stereo track the length of the cut, which the Soundtrack plays from its first frame.
import { demo } from '../data/demo'
import { monthCells } from '../lib/calendar'
import { typedChars } from '../lib/stream'
import { typingSchedule } from '../lib/typing'
import { FPS, type Cut, type Scene } from '../timeline'
import { Stereo, rng } from './dsp'
import { chime, click, keystroke, mallet, pop, tick, whoosh } from './sounds'

export type Sound =
  | { kind: 'key'; space: boolean }
  | { kind: 'tick' }
  | { kind: 'click' }
  | { kind: 'pop' }
  | { kind: 'mallet'; freq: number; length?: number }
  | { kind: 'chime'; freq: number }
  | { kind: 'whoosh'; seconds: number; rising: boolean }

export interface Cue {
  /** Seconds into the cut. */
  at: number
  sound: Sound
  /** Peak level, dB below full scale (each sound peaks at 0 dB before this). */
  gain: number
  /** -1 left … 1 right. */
  pan: number
  seed: string
}

/** Pentatonic, G4 up two octaves: the calendar's bars filling in, left to right, low to high. */
const SCALE = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98]

function sceneCues(scene: Scene, lead: number, cutId: string): Cue[] {
  const cues: Cue[] = []
  const at = (frame: number) => (scene.start + frame) / FPS
  const tag = `${cutId}-${scene.kind}`
  const add = (frame: number, sound: Sound, gain: number, pan = 0, seed = `${tag}-${frame}`) => cues.push({ at: at(frame), sound, gain, pan, seed })

  switch (scene.kind) {
    case 'study': {
      const b = scene.beats
      const r = rng(`${tag}-typing`)
      // The answer, key by key, as StudyScene types it (the same schedule, the same seed).
      typingSchedule(demo.study.typed, b.typeStart, b.typeEnd, 'answer').forEach((frame, i) => {
        const space = demo.study.typed[i] === ' '
        add(frame, { kind: 'key', space }, -11 + (r() * 2 - 1) * 1.5, (r() * 2 - 1) * 0.12, `${tag}-key-${i}`)
      })
      add(b.press, { kind: 'click' }, -10)
      // The explanation typing itself out: a small tick on the frame every third character lands.
      const text = demo.study.result.explanation
      let last = 0
      for (let f = b.streamStart; f <= b.streamEnd; f++) {
        const n = typedChars(f, text, b.streamStart, b.streamEnd)
        for (let k = Math.floor(last / 3) + 1; k <= Math.floor(n / 3); k++) add(f, { kind: 'tick' }, -16 + (r() * 2 - 1) * 2, (r() * 2 - 1) * 0.2, `${tag}-tick-${k}`)
        last = n
      }
      // The score landing: a mallet, and a quieter fifth above it.
      add(b.land, { kind: 'mallet', freq: 392 }, -11)
      add(b.land + 2, { kind: 'mallet', freq: 587.33 }, -18, 0.15)
      if (b.save) {
        add(b.save.press, { kind: 'click' }, -10)
        add(b.save.press + 2, { kind: 'pop' }, -14)
      }
      break
    }
    case 'voice': {
      const b = scene.beats
      add(b.micPress, { kind: 'click' }, -10)
      add(b.micPress + 1, { kind: 'whoosh', seconds: 0.5, rising: true }, -22)
      if (b.exit !== undefined) {
        add(b.exit, { kind: 'click' }, -10)
        add(b.exit + 1, { kind: 'whoosh', seconds: 0.45, rising: false }, -23)
      }
      break
    }
    case 'generate': {
      const b = scene.beats
      add(b.press, { kind: 'click' }, -10)
      add(b.result, { kind: 'pop' }, -14)
      add(b.result + 3, { kind: 'mallet', freq: 523.25, length: 0.8 }, -20, 0.1)
      add(b.homePress, { kind: 'click' }, -10)
      break
    }
    case 'home':
      add(scene.beats.press, { kind: 'click' }, -10)
      break
    case 'calendar': {
      const b = scene.beats
      const [y, m] = demo.today.split('-').map(Number)
      const glissando = (month: number, from: number, seedTag: string) => {
        const future = monthCells(y, month, demo.today, demo.load).cells.filter((c) => c.iso >= demo.today).length
        const plucks = Math.ceil(future / 2)
        for (let i = 0; i < plucks; i++) {
          const p = plucks > 1 ? i / (plucks - 1) : 0
          add(from + i * 2, { kind: 'mallet', freq: SCALE[Math.min(SCALE.length - 1, Math.floor(p * SCALE.length))], length: 0.6 }, -23 - 3 * p, -0.45 + 0.9 * p, `${tag}-${seedTag}-${i}`)
        }
      }
      // CalendarScene grows the bars from frame 4, one a frame, in date order from today.
      glissando(m - 1, 4, 'oct')
      if (b.nextMonth) {
        add(b.nextMonth.press, { kind: 'click' }, -10)
        add(b.nextMonth.press + 1, { kind: 'whoosh', seconds: 0.32, rising: true }, -25, 0.3)
        glissando(m, b.nextMonth.press + 4, 'nov')
      }
      break
    }
    case 'end':
      // The loading mark resolving into the logo (EndCard: the morph runs from frame 10 for 28),
      // and a bell as it settles and the name comes up.
      add(8, { kind: 'whoosh', seconds: 1.0, rising: true }, -23)
      add(36, { kind: 'chime', freq: 1046.5 }, -15, -0.1)
      add(40, { kind: 'chime', freq: 1567.98 }, -20, 0.12)
      break
  }
  // A crossfade is the video's, not the app's: a breath of air under it.
  if (lead > 0 && scene.kind !== 'end') add(-lead, { kind: 'whoosh', seconds: 0.4, rising: false }, -26)
  return cues
}

export function cuesFor(cut: Cut): Cue[] {
  const cues = cut.scenes.flatMap((scene, i) => sceneCues(scene, i > 0 ? cut.transitions[i - 1].frames : 0, cut.id))
  return cues.filter((c) => c.at >= 0 && c.at < cut.durationInFrames / FPS).sort((a, b) => a.at - b.at || a.seed.localeCompare(b.seed))
}

export function soundFor(cue: Cue): Float32Array {
  const s = cue.sound
  switch (s.kind) {
    case 'key':
      return keystroke(cue.seed, s.space)
    case 'tick':
      return tick(cue.seed)
    case 'click':
      return click(cue.seed)
    case 'pop':
      return pop(cue.seed)
    case 'mallet':
      return mallet(cue.seed, s.freq, s.length)
    case 'chime':
      return chime(cue.seed, s.freq)
    case 'whoosh':
      return whoosh(cue.seed, s.seconds, s.rising)
  }
}

/** The cut's sound effects, mixed: one stereo track exactly as long as the cut. */
export function sfxStem(cut: Cut): Stereo {
  const out = new Stereo(cut.durationInFrames / FPS)
  for (const cue of cuesFor(cut)) out.place(soundFor(cue), cue.at, cue.gain, cue.pan)
  return out
}
