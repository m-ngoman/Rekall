// The video's sound effects, each made from noise and sine partials. Every one is mono, peaks at
// 1, and varies slightly by seed, so a run of key presses doesn't sound like one sample repeated.
import { SR, buffer, envelope, filter, noise, normalise, rng } from './dsp'

const TAU = Math.PI * 2
const vary = (r: () => number, amount: number) => 1 + (r() * 2 - 1) * amount

/** A sine partial with an exponential decay, added into `x`. */
function partial(x: Float32Array, freq: number, amp: number, decay: number, attack = 0.002, delay = 0): void {
  for (let i = 0; i < x.length; i++) {
    const t = i / SR - delay
    if (t < 0) continue
    const a = attack > 0 ? Math.min(1, t / attack) : 1
    x[i] += amp * a * Math.exp(-t / decay) * Math.sin(TAU * freq * t)
  }
}

/** Filtered noise with its own envelope, added into `x`. */
function burst(x: Float32Array, r: () => number, type: 'lowpass' | 'highpass' | 'bandpass', f0: number, q: number, amp: number, decay: number, delay = 0): void {
  const n = noise(x.length, r)
  filter(n, type, f0, q)
  envelope(n, 0.0003, decay, delay)
  for (let i = 0; i < x.length; i++) x[i] += n[i] * amp
}

/** A laptop key: the keycap's click, the switch's short body, and the quieter click of it coming
 * back up. The space bar is lower and longer. */
export function keystroke(seed: string, space = false): Float32Array {
  const r = rng(`key-${seed}`)
  const x = buffer(space ? 0.2 : 0.14)
  const up = (space ? 0.085 : 0.065) * vary(r, 0.2)
  burst(x, r, 'bandpass', 3600 * vary(r, 0.15), 1.1, 1, 0.0008)
  burst(x, r, 'bandpass', (space ? 420 : 820) * vary(r, 0.15), 2.5, space ? 0.9 : 0.6, space ? 0.018 : 0.009)
  burst(x, r, 'bandpass', 1500 * vary(r, 0.2), 4, 0.25, 0.006)
  if (space) partial(x, 150 * vary(r, 0.05), 0.35, 0.03, 0.001)
  burst(x, r, 'bandpass', 4200 * vary(r, 0.15), 1.3, 0.35, 0.0006, up)
  burst(x, r, 'bandpass', 900 * vary(r, 0.15), 3, 0.2, 0.006, up)
  return normalise(x)
}

/** A very small, bright tick: the grader's explanation typing itself out. */
export function tick(seed: string): Float32Array {
  const r = rng(`tick-${seed}`)
  const x = buffer(0.04)
  burst(x, r, 'bandpass', 5200 * vary(r, 0.12), 1.4, 1, 0.0005)
  burst(x, r, 'bandpass', 2300 * vary(r, 0.12), 5, 0.3, 0.003)
  return normalise(x)
}

/** A click or a tap on a control: down, and a lighter release. */
export function click(seed: string): Float32Array {
  const r = rng(`click-${seed}`)
  const x = buffer(0.14)
  burst(x, r, 'bandpass', 2900 * vary(r, 0.1), 1.3, 1, 0.0009)
  partial(x, 1750 * vary(r, 0.08), 0.35, 0.004, 0.0005)
  burst(x, r, 'bandpass', 3500 * vary(r, 0.1), 1.3, 0.45, 0.0007, 0.055 * vary(r, 0.15))
  return normalise(x)
}

/** A soft, round confirmation: a short sine dropping in pitch. */
export function pop(seed: string): Float32Array {
  const r = rng(`pop-${seed}`)
  const x = buffer(0.22)
  const f0 = 560 * vary(r, 0.05)
  let phase = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    phase += (TAU * (f0 + 420 * Math.exp(-t / 0.018))) / SR
    x[i] = Math.sin(phase) * Math.min(1, t / 0.002) * Math.exp(-t / 0.05)
  }
  burst(x, r, 'bandpass', 2400, 1.2, 0.15, 0.001)
  return normalise(x)
}

/** A mallet on wood — a marimba bar: the fundamental, its strong fourth-and-a-bit overtone, and
 * the thump of the mallet. */
export function mallet(seed: string, freq: number, length = 1.1): Float32Array {
  const r = rng(`mallet-${seed}`)
  const x = buffer(length)
  partial(x, freq, 1, 0.34, 0.0015)
  partial(x, freq * 3.93, 0.28, 0.05, 0.001)
  partial(x, freq * 9.2, 0.06, 0.012, 0.0005)
  burst(x, r, 'lowpass', 1400, 0.7, 0.18, 0.004)
  return normalise(x)
}

/** A small bell: inharmonic partials, the upper ones dying first. */
export function chime(seed: string, freq: number): Float32Array {
  const r = rng(`chime-${seed}`)
  const x = buffer(2.8)
  const partials: [number, number, number][] = [
    [1, 1, 1.5],
    [2.0, 0.28, 0.9],
    [2.76, 0.4, 0.7],
    [5.4, 0.16, 0.35],
    [8.93, 0.06, 0.18],
  ]
  for (const [ratio, amp, decay] of partials) partial(x, freq * ratio * vary(r, 0.002), amp, decay, 0.003)
  return normalise(x)
}

/** Air moving past: noise through a band that sweeps up (opening) or down (closing), swelling and
 * fading. Processed in short blocks so the band can move. */
export function whoosh(seed: string, seconds: number, rising: boolean): Float32Array {
  const r = rng(`whoosh-${seed}`)
  const x = noise(Math.round(seconds * SR), r)
  const block = 256
  const out = new Float32Array(x.length)
  // One filter state carried across blocks: a state-variable bandpass whose centre can change.
  let low = 0
  let band = 0
  for (let i = 0; i < x.length; i += block) {
    const p = i / x.length
    const sweep = rising ? p : 1 - p
    const fc = 300 * Math.pow(4200 / 300, sweep)
    const f = 2 * Math.sin((Math.PI * fc) / SR)
    const q = 1.6
    for (let j = i; j < Math.min(x.length, i + block); j++) {
      const high = x[j] - low - q * band
      band += f * high
      low += f * band
      out[j] = band
    }
  }
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length
    const swell = rising ? Math.sin(Math.PI * Math.pow(p, 0.7)) : Math.sin(Math.PI * Math.pow(p, 1.4))
    out[i] *= swell * swell
  }
  return normalise(out)
}
