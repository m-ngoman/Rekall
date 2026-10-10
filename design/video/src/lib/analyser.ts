import { fft } from './fft'

/** Web Audio's AnalyserNode as the app sets it up (useAudioPlayer, useMicRecorder): fftSize 256,
 * everything else default — smoothingTimeConstant 0.8, minDecibels -100, maxDecibels -30. Follows
 * the spec's getByteFrequencyData step by step: Blackman window, FFT scaled by 1/N, smoothing over
 * time, decibels, then 0-255. So the orb can be driven by the real voice take and move as it does
 * in the app, rather than by a guess at what speech looks like. */
export const FFT_SIZE = 256
export const BIN_COUNT = FFT_SIZE / 2
export const SMOOTHING_TIME = 0.8
export const MIN_DB = -100
export const MAX_DB = -30

const WINDOW = (() => {
  const a = 0.16
  const [a0, a1, a2] = [(1 - a) / 2, 0.5, a / 2]
  return Float64Array.from({ length: FFT_SIZE }, (_, n) => a0 - a1 * Math.cos((2 * Math.PI * n) / FFT_SIZE) + a2 * Math.cos((4 * Math.PI * n) / FFT_SIZE))
})()

/** One analysis: the FFT_SIZE samples ending at `end` (exclusive), smoothed against `smoothed`
 * (updated in place — pass a zeroed array to start), as bytes. */
export function byteFrequencyData(samples: ArrayLike<number>, end: number, smoothed: Float64Array): Uint8Array {
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let n = 0; n < FFT_SIZE; n++) {
    const s = end - FFT_SIZE + n
    re[n] = (s >= 0 && s < samples.length ? samples[s] : 0) * WINDOW[n]
  }
  fft(re, im)
  const out = new Uint8Array(BIN_COUNT)
  for (let k = 0; k < BIN_COUNT; k++) {
    const mag = Math.hypot(re[k], im[k]) / FFT_SIZE
    smoothed[k] = SMOOTHING_TIME * smoothed[k] + (1 - SMOOTHING_TIME) * mag
    const db = 20 * Math.log10(smoothed[k])
    const byte = Math.floor((255 / (MAX_DB - MIN_DB)) * (db - MIN_DB))
    out[k] = Number.isFinite(byte) ? Math.min(255, Math.max(0, byte)) : 0
  }
  return out
}
