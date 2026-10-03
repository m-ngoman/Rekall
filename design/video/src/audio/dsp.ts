// The small amount of signal processing the soundtrack's own sounds are made with: a seeded noise
// source, the RBJ-cookbook biquads, envelopes, and mixing into a stereo buffer. Everything here is
// deterministic — the same seed makes the same samples — so the sound effects and the music bed
// are part of the source like everything else, re-made on every render rather than committed.
import { random } from 'remotion/no-react'

export const SR = 48000

/** A fast seeded generator (mulberry32), seeded from Remotion's `random` so seeds read as names. */
export function rng(seed: string): () => number {
  let a = Math.floor(random(seed) * 2 ** 32) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const db = (x: number) => Math.pow(10, x / 20)
export const buffer = (seconds: number) => new Float32Array(Math.max(1, Math.round(seconds * SR)))

/** White noise in [-1, 1). */
export function noise(n: number, r: () => number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1
  return out
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass'

/** An RBJ biquad, applied in place. `bandpass` has a 0 dB peak. */
export function filter(x: Float32Array, type: FilterType, f0: number, q = Math.SQRT1_2): Float32Array {
  const w0 = (2 * Math.PI * Math.min(f0, SR * 0.45)) / SR
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0: number, b1: number, b2: number
  if (type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
  else if (type === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
  else [b0, b1, b2] = [alpha, 0, -alpha]
  const a0 = 1 + alpha
  const [a1, a2] = [(-2 * cos) / a0, (1 - alpha) / a0]
  ;[b0, b1, b2] = [b0 / a0, b1 / a0, b2 / a0]
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

/** Multiplies in place by an attack-then-exponential-decay envelope (times in seconds). */
export function envelope(x: Float32Array, attack: number, decay: number, delay = 0): Float32Array {
  for (let i = 0; i < x.length; i++) {
    const t = i / SR - delay
    if (t < 0) {
      x[i] = 0
      continue
    }
    const a = attack > 0 ? Math.min(1, t / attack) : 1
    x[i] *= a * Math.exp(-Math.max(0, t - attack) / decay)
  }
  return x
}

/** Adds `src` into `dst` from sample `at`, scaled. */
export function addInto(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  const start = Math.round(at)
  for (let i = 0; i < src.length; i++) {
    const j = start + i
    if (j < 0) continue
    if (j >= dst.length) break
    dst[j] += src[i] * gain
  }
}

export function peak(x: Float32Array): number {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** Scales in place so the loudest sample is at `to` (linear). */
export function normalise(x: Float32Array, to = 1): Float32Array {
  const p = peak(x)
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= to / p
  return x
}

/** A stereo buffer, and mono sounds placed into it with a gain and an equal-power pan (-1…1). */
export class Stereo {
  readonly left: Float32Array
  readonly right: Float32Array
  constructor(seconds: number) {
    this.left = buffer(seconds)
    this.right = buffer(seconds)
  }
  place(sound: Float32Array, seconds: number, gainDb: number, pan = 0): void {
    const g = db(gainDb)
    const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
    addInto(this.left, sound, seconds * SR, g * Math.cos(angle))
    addInto(this.right, sound, seconds * SR, g * Math.sin(angle))
  }
  peak(): number {
    return Math.max(peak(this.left), peak(this.right))
  }
}

/** 16-bit PCM WAV bytes, interleaved stereo. */
export function wavBytes(left: Float32Array, right: Float32Array): Uint8Array {
  const n = Math.min(left.length, right.length)
  const out = new Uint8Array(44 + n * 4)
  const v = new DataView(out.buffer)
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + n * 4, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, SR, true)
  v.setUint32(28, SR * 4, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, n * 4, true)
  const s16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)))
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, s16(left[i]), true)
    v.setInt16(46 + i * 4, s16(right[i]), true)
  }
  return out
}

/** Integrated loudness in LUFS, as ITU-R BS.1770-4 measures it at 48 kHz: K-weighting (its
 * published shelf and high-pass coefficients), 400 ms blocks every 100 ms, the -70 LUFS absolute
 * gate and the -10 LU relative one — the same number ffmpeg's loudnorm reports. */
export function lufs(left: Float32Array, right: Float32Array): number {
  const kWeight = (x: Float32Array) => {
    const stages: [number[], number[]][] = [
      [[1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]],
      [[1.0, -2.0, 1.0], [-1.99004745483398, 0.99007225036621]],
    ]
    let y = Float64Array.from(x)
    for (const [[b0, b1, b2], [a1, a2]] of stages) {
      const out = new Float64Array(y.length)
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let i = 0; i < y.length; i++) {
        const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = y[i]
        y2 = y1
        y1 = v
        out[i] = v
      }
      y = out
    }
    return y
  }
  const [l, r] = [kWeight(left), kWeight(right)]
  const size = Math.round(0.4 * SR)
  const step = Math.round(0.1 * SR)
  const blocks: number[] = []
  for (let s = 0; s + size <= l.length; s += step) {
    let sum = 0
    for (let i = s; i < s + size; i++) sum += l[i] * l[i] + r[i] * r[i]
    blocks.push(sum / size)
  }
  const loud = (z: number) => -0.691 + 10 * Math.log10(z)
  const mean = (zs: number[]) => zs.reduce((a, b) => a + b, 0) / Math.max(1, zs.length)
  const absolute = blocks.filter((z) => z > 0 && loud(z) > -70)
  if (absolute.length === 0) return -Infinity
  const relative = loud(mean(absolute)) - 10
  return loud(mean(absolute.filter((z) => loud(z) > relative)))
}
