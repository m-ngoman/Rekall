/** The storyboard, as code. Every beat of both cuts is a frame number here and nowhere else:
 * scenes read their beats from the cut they are placed in, captions are windows in the cut's own
 * frames, and the tests hold the whole thing to its totals (900 and 1770 frames) and to its rules
 * (the voice line ends inside its scene, no two captions overlap).
 *
 * 30 fps: every platform the video goes to takes it, the motion is eased UI and type where 60 adds
 * nothing visible, and it halves render time and file size. A frame is 33 ms against the 80 ms the
 * karaoke leads the voice by and the 460 ms word pop, so nothing the app times is lost. */
import type { CaptionId } from './data/copy'

export const FPS = 30

export type Layout = 'landscape' | 'portrait'
export const SIZES: Record<Layout, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
}

/** A camera move's key: at frame `f` (scene-local), frame the replica around `(x, y)` in its own
 * CSS pixels at zoom `z` (1 = the whole replica viewport). Moves between keys ease with the app's
 * curve; zoom interpolates in log space so a push reads as even. */
export interface CameraKey {
  f: number
  x: number
  y: number
  z: number
}
export type Cameras = Record<Layout, CameraKey[]>

export interface StudyBeats {
  typeStart: number
  typeEnd: number
  /** The pointer sets off for "Check my answer" here, hovers, and presses. */
  pointerStart: number
  hover: number
  press: number
  /** First words of the explanation, and the last. The loading mark holds the line until then. */
  streamStart: number
  streamEnd: number
  /** The score lands: the question shrinks, the numeral rises, the bar fills. */
  land: number
  /** 60 s only: "Save for tutor". */
  save?: { pointerStart: number; hover: number; press: number }
  camera: Cameras
}

export interface VoiceBeats {
  /** The mic button in the composer. The orb flies out of it and the stage fades in. */
  micPress: number
  /** Listening; the student's question reveals at the app's 28 ms a character. */
  transcriptStart: number
  /** Sent: the question becomes a past turn and the tutor thinks. */
  thinkStart: number
  /** The voice starts. The karaoke and the orb both run off the audio from here. */
  speakStart: number
  /** Listening again once the line is done. */
  listenAfter: number
  /** 60 s only: leave voice mode, and the typed log is what's left on screen. */
  exit?: number
  camera: Cameras
}

export interface HomeBeats {
  /** Pointer or tap on the exam's name, which opens the calendar. */
  pointerStart: number
  press: number
  camera: Cameras
}

export interface CalendarBeats {
  /** 60 s only: the next-month chevron. */
  nextMonth?: { pointerStart: number; press: number }
  camera: Cameras
}

export interface GenerateBeats {
  pointerStart: number
  press: number
  /** When each stage label replaces the last (the backend's own stage events). */
  stages: number[]
  result: number
  /** The Home tab, to move on. */
  homePointerStart: number
  homePress: number
  camera: Cameras
}

export type Scene =
  | { kind: 'study'; start: number; duration: number; beats: StudyBeats }
  | { kind: 'voice'; start: number; duration: number; beats: VoiceBeats }
  | { kind: 'generate'; start: number; duration: number; beats: GenerateBeats }
  | { kind: 'home'; start: number; duration: number; beats: HomeBeats }
  | { kind: 'calendar'; start: number; duration: number; beats: CalendarBeats }
  | { kind: 'end'; start: number; duration: number }

/** How a scene arrives. A cut is the app's own navigation, which is instant; a crossfade is the
 * video's, used only where the app has no transition of its own to show. */
export interface Transition {
  kind: 'cut' | 'crossfade'
  frames: number
}

export interface Cut {
  id: 'Launch30' | 'Launch60'
  durationInFrames: number
  scenes: Scene[]
  /** Into scene i, for i ≥ 1. */
  transitions: Transition[]
  captions: { id: CaptionId; from: number; to: number }[]
  posters: { name: string; frame: number }[]
}

const cut: Transition = { kind: 'cut', frames: 0 }
const crossfade = (frames: number): Transition => ({ kind: 'crossfade', frames })

/** The whole app, as the window shows it at rest. On a phone the camera never moves: zooming a
 * 390 px screen crops its text columns, and a phone recording doesn't zoom either. */
const WHOLE = { landscape: { x: 640, y: 360, z: 1 }, portrait: { x: 195, y: 321.5, z: 1 } }
const still = (): Cameras => ({ landscape: [{ f: 0, ...WHOLE.landscape }], portrait: [{ f: 0, ...WHOLE.portrait }] })

/** Voice mode on the desktop: once the stage is open, in on its column — the lines and the orb —
 * so the words being spoken are as large as the screen will have them; out again as it closes. */
const voiceCamera = (micPress: number, exit?: number): Cameras => ({
  landscape: [
    { f: 0, ...WHOLE.landscape },
    { f: micPress + 8, ...WHOLE.landscape },
    { f: micPress + 40, x: 640, y: 453, z: 1.35 },
    ...(exit === undefined ? [] : [{ f: exit - 4, x: 640, y: 453, z: 1.35 }, { f: exit + 20, ...WHOLE.landscape }]),
  ],
  portrait: [{ f: 0, ...WHOLE.portrait }],
})

/** The study screen on the desktop: in close on the card while the answer is typed — the card's
 * column and nothing of the rail beside it — closer once the score lands, as close as keeps the
 * explanation's whole line in view, then back out to the whole page, where the rail shows what you
 * wrote beside the model answer. Positions are replica pixels; src/data/anchors.json has what is
 * where. */
const studyCamera = (land: number, extra: CameraKey[] = []): Cameras => ({
  landscape: [
    { f: 0, x: 435, y: 275, z: 1.47 },
    { f: land - 2, x: 435, y: 275, z: 1.47 },
    { f: land + 14, x: 424, y: 262, z: 1.6 },
    { f: land + 94, x: 424, y: 262, z: 1.6 },
    { f: land + 118, ...WHOLE.landscape },
    ...extra,
  ],
  portrait: [{ f: 0, ...WHOLE.portrait }],
})

export const LAUNCH30: Cut = {
  id: 'Launch30',
  durationInFrames: 900,
  scenes: [
    {
      kind: 'study',
      start: 0,
      duration: 320,
      beats: {
        typeStart: 12,
        typeEnd: 86,
        pointerStart: 84,
        hover: 98,
        press: 102,
        streamStart: 122,
        streamEnd: 180,
        land: 186,
        camera: studyCamera(186),
      },
    },
    {
      kind: 'voice',
      start: 320,
      duration: 280,
      beats: { micPress: 24, transcriptStart: 34, thinkStart: 76, speakStart: 100, listenAfter: 268, camera: voiceCamera(24) },
    },
    { kind: 'home', start: 600, duration: 90, beats: { pointerStart: 62, press: 84, camera: still() } },
    { kind: 'calendar', start: 690, duration: 110, beats: { camera: still() } },
    { kind: 'end', start: 800, duration: 100 },
  ],
  transitions: [cut, crossfade(9), cut, crossfade(9)],
  captions: [
    { id: 'check', from: 0, to: 84 },
    { id: 'reads', from: 104, to: 180 },
    { id: 'missed', from: 204, to: 312 },
    { id: 'talk', from: 324, to: 402 },
    { id: 'countdown', from: 606, to: 684 },
    { id: 'paced', from: 702, to: 790 },
  ],
  posters: [
    { name: 'cover', frame: 0 },
    { name: 'graded', frame: 250 },
    { name: 'voice', frame: 560 },
    { name: 'end', frame: 899 },
  ],
}

export const LAUNCH60: Cut = {
  id: 'Launch60',
  durationInFrames: 1770,
  scenes: [
    {
      kind: 'study',
      start: 0,
      duration: 480,
      beats: {
        typeStart: 12,
        typeEnd: 116,
        pointerStart: 114,
        hover: 128,
        press: 132,
        streamStart: 158,
        streamEnd: 232,
        land: 238,
        save: { pointerStart: 366, hover: 386, press: 392 },
        camera: studyCamera(238, [
          { f: 392, ...WHOLE.landscape },
          { f: 414, x: 424, y: 290, z: 1.6 },
        ]),
      },
    },
    {
      kind: 'voice',
      start: 480,
      duration: 360,
      beats: { micPress: 54, transcriptStart: 68, thinkStart: 112, speakStart: 142, listenAfter: 310, exit: 328, camera: voiceCamera(54, 328) },
    },
    {
      kind: 'generate',
      start: 840,
      duration: 360,
      beats: {
        pointerStart: 26,
        press: 46,
        stages: [46, 52, 128],
        result: 196,
        homePointerStart: 322,
        homePress: 346,
        // The result fits a desktop window, so there's nothing to scroll to: the camera leans in on
        // the list — the cards added, what was dropped and why (anchors: generate-result dropped),
        // and Done — with the column centred and nothing cut at the sides, and is back out before
        // the pointer heads for the sidebar.
        camera: {
          landscape: [
            { f: 0, ...WHOLE.landscape },
            { f: 236, ...WHOLE.landscape },
            { f: 266, x: 760, y: 420, z: 1.3 },
            { f: 300, x: 760, y: 420, z: 1.3 },
            { f: 322, ...WHOLE.landscape },
          ],
          portrait: [{ f: 0, ...WHOLE.portrait }],
        },
      },
    },
    { kind: 'home', start: 1200, duration: 120, beats: { pointerStart: 90, press: 112, camera: still() } },
    {
      kind: 'calendar',
      start: 1320,
      duration: 270,
      beats: {
        nextMonth: { pointerStart: 100, press: 120 },
        // Into November's grid, around the exam's day (anchors: calendar-next grid, examDay): the
        // grid alone, neither the sidebar nor the column beside it. Its rows are 78 px apart with a
        // 2 px gap, so no framing shows whole rows only; this one's top edge is in the gap above
        // the week of the 2nd, and the week of the 30th is cut below its "3 cards" — no line of
        // text is sliced.
        camera: {
          landscape: [
            { f: 0, ...WHOLE.landscape },
            { f: 130, ...WHOLE.landscape },
            { f: 176, x: 572, y: 449, z: 2 },
          ],
          portrait: [{ f: 0, ...WHOLE.portrait }],
        },
      },
    },
    { kind: 'end', start: 1590, duration: 180 },
  ],
  transitions: [cut, crossfade(9), cut, cut, crossfade(9)],
  captions: [
    { id: 'check', from: 0, to: 84 },
    { id: 'reads', from: 136, to: 216 },
    { id: 'missed', from: 256, to: 366 },
    { id: 'save', from: 392, to: 474 },
    { id: 'talk', from: 486, to: 570 },
    { id: 'memory', from: 780, to: 836 },
    { id: 'notes', from: 846, to: 940 },
    { id: 'checked', from: 970, to: 1140 },
    { id: 'countdown', from: 1206, to: 1300 },
    { id: 'perDay', from: 1328, to: 1430 },
    { id: 'paced', from: 1450, to: 1578 },
  ],
  posters: [
    { name: 'cover', frame: 0 },
    { name: 'graded', frame: 300 },
    { name: 'voice', frame: 765 },
    { name: 'end', frame: 1769 },
  ],
}

export const CUTS = [LAUNCH30, LAUNCH60] as const

/** The frame, in the whole cut, at which a scene's voice line starts. */
export function voiceStartFrame(c: Cut): number {
  const v = c.scenes.find((s) => s.kind === 'voice')
  if (!v || v.kind !== 'voice') throw new Error(`${c.id} has no voice scene`)
  return v.start + v.beats.speakStart
}
