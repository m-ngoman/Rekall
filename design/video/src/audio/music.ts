// A lo-fi study bed, written out as notes and synthesized: warm electric-piano chords, a round bass,
// a soft swung kit that comes in after two bars (so the answer's keys are heard on their own first),
// and a little vinyl — at 80 BPM, low-passed so it sits under a voice. It is the video's own, so
// there is nothing to license or credit, and it is deterministic for its seed like everything else.
import { SR, Stereo, buffer, envelope, filter, noise, rng } from './dsp'

const BPM = 80
export const BEAT = 60 / BPM
const BAR = 4 * BEAT
/** Offbeat eighths land late: the lazy feel. */
const SWING = 0.1 * BEAT
const TAU = Math.PI * 2

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

/** IV–iii–ii–I in C, with sevenths and ninths: Fmaj9, Em7, Dm9, Cmaj9. */
const PROGRESSION = [
  { bass: 41, chord: [53, 57, 60, 64, 67] },
  { bass: 40, chord: [52, 55, 59, 62] },
  { bass: 38, chord: [50, 53, 57, 60, 64] },
  { bass: 36, chord: [48, 52, 55, 59, 62] },
]

/** Adds a decaying sine partial into `x` by phasor rotation (fast, and exact enough for audio). */
function partial(x: Float32Array, freq: number, amp: number, attack: number, decay: number, release: { at: number; time: number } | null): void {
  const w = (TAU * freq) / SR
  const [cw, sw] = [Math.cos(w), Math.sin(w)]
  let s = 0
  let c = 1
  const decayStep = Math.exp(-1 / (decay * SR))
  let env = 1
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    let a = amp * env * (attack > 0 ? Math.min(1, t / attack) : 1)
    if (release && t > release.at) a *= Math.exp(-(t - release.at) / release.time)
    x[i] += a * s
    const ns = s * cw + c * sw
    c = c * cw - s * sw
    s = ns
    env *= decayStep
  }
}

/** An electric piano note: a few harmonics that die away at different rates, and the short bright
 * "tine" at the front. */
function epiano(freq: number, vel: number, hold: number, r: () => number): Float32Array {
  const x = buffer(hold + 0.7)
  const detune = 1 + (r() * 2 - 1) * 0.0012
  const partials: [number, number, number][] = [
    [1, 1, 2.0],
    [2, 0.36, 1.1],
    [3, 0.1, 0.6],
    [4, 0.05, 0.35],
  ]
  for (const [ratio, amp, decay] of partials) partial(x, freq * ratio * detune, amp * vel, 0.004, decay, { at: hold, time: 0.14 })
  if (freq * 7.1 < 8000) partial(x, freq * 7.1, 0.09 * vel, 0.001, 0.018, null)
  return x
}

function bassNote(freq: number, vel: number, hold: number): Float32Array {
  const x = buffer(hold + 0.3)
  partial(x, freq, vel, 0.008, 1.3, { at: hold, time: 0.07 })
  partial(x, freq * 2, 0.28 * vel, 0.008, 0.6, { at: hold, time: 0.07 })
  return filter(x, 'lowpass', 380, 0.7)
}

function kick(r: () => number): Float32Array {
  const x = buffer(0.45)
  let phase = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    phase += (TAU * (48 + 64 * Math.exp(-t / 0.03))) / SR
    x[i] = Math.sin(phase) * Math.exp(-t / 0.15)
  }
  const thump = envelope(filter(noise(x.length, r), 'lowpass', 2400), 0.0005, 0.0015)
  for (let i = 0; i < x.length; i++) x[i] += thump[i] * 0.15
  return x
}

function snare(r: () => number): Float32Array {
  const x = envelope(filter(noise(Math.round(0.35 * SR), r), 'bandpass', 1900, 0.7), 0.001, 0.085)
  for (let i = 0; i < x.length; i++) x[i] = x[i] * 1.6 + 0.45 * Math.sin((TAU * 185 * i) / SR) * Math.exp(-i / SR / 0.045)
  return filter(x, 'lowpass', 7000)
}

function hat(r: () => number): Float32Array {
  return envelope(filter(noise(Math.round(0.08 * SR), r), 'highpass', 7500, 0.7), 0.0005, 0.02)
}

/** `seconds` of the bed, stereo, peaking below full scale — its level is set where it is used. */
export function lofiBed(seconds: number, seed = 'bed'): Stereo {
  const r = rng(seed)
  const out = new Stereo(seconds)
  const keys = new Stereo(seconds)
  const jitter = () => (r() * 2 - 1) * 0.006
  const bars = Math.ceil(seconds / BAR)

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * BAR
    const { bass, chord } = PROGRESSION[bar % PROGRESSION.length]
    const groove = bar >= 2

    // Keys: the chord on the one, and a lighter stab of its top notes on the swung "and" of three.
    chord.forEach((note, i) => {
      const pan = -0.3 + (0.6 * i) / (chord.length - 1)
      keys.place(epiano(hz(note), 0.62 + (r() * 2 - 1) * 0.06, 2.4 * BEAT, r), t0 + i * 0.012 + jitter(), -6, pan)
    })
    chord.slice(-3).forEach((note, i) => {
      keys.place(epiano(hz(note), 0.34 + (r() * 2 - 1) * 0.05, 1.1 * BEAT, r), t0 + 2.5 * BEAT + SWING + i * 0.01 + jitter(), -6, -0.2 + 0.2 * i)
    })

    if (groove) {
      out.place(bassNote(hz(bass), 0.8, 1.5 * BEAT), t0 + jitter(), -5)
      out.place(bassNote(hz(bass + 7), 0.6, 0.9 * BEAT), t0 + 2.5 * BEAT + SWING + jitter(), -6)
      out.place(kick(r), t0 + jitter(), -4)
      out.place(kick(r), t0 + 1.5 * BEAT + SWING + jitter(), -7)
      out.place(snare(r), t0 + BEAT + jitter(), -13, -0.08)
      out.place(snare(r), t0 + 3 * BEAT + jitter(), -13, -0.08)
      for (let e = 0; e < 8; e++) {
        if (r() < 0.12) continue
        const off = e % 2 === 1
        out.place(hat(r), t0 + (e / 2) * BEAT + (off ? SWING : 0) + jitter(), (off ? -27 : -23) + (r() * 2 - 1) * 1.5, 0.25)
      }
    }
  }

  // The keys breathe: a slow tremolo, a quarter-turn apart left and right.
  for (let i = 0; i < keys.left.length; i++) {
    const t = i / SR
    keys.left[i] *= 1 + 0.1 * Math.sin(TAU * 4.2 * t)
    keys.right[i] *= 1 + 0.1 * Math.sin(TAU * 4.2 * t + Math.PI / 2)
    out.left[i] += keys.left[i]
    out.right[i] += keys.right[i]
  }

  // Vinyl: sparse crackle and a little hiss.
  const n = out.left.length
  for (let k = 0; k < seconds * 7; k++) {
    const at = r() * seconds
    const pop = envelope(filter(noise(Math.round(0.004 * SR), r), 'highpass', 2000), 0.0001, 0.0004)
    out.place(pop, at, -30 - 18 * r(), r() * 2 - 1)
  }
  for (const ch of [out.left, out.right]) {
    const hiss = filter(filter(noise(n, r), 'lowpass', 6000), 'highpass', 400)
    for (let i = 0; i < n; i++) ch[i] += hiss[i] * 0.002
    // Lo-fi: the top rolled off.
    filter(ch, 'lowpass', 7200, 0.6)
  }
  // And a soft saturation to glue it, driven from a set level so it only rounds the peaks off.
  const drive = 0.8 / out.peak()
  for (const ch of [out.left, out.right]) for (let i = 0; i < n; i++) ch[i] = Math.tanh(1.2 * drive * ch[i]) / Math.tanh(1.2)
  return out
}
