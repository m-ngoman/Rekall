// Remotion's own ffmpeg and ffprobe (npx remotion ffmpeg), which every render already depends on,
// so the pipeline needs nothing installed on the machine. Its build leaves out most filters; what
// this uses — loudnorm, silencedetect, aresample — is in it. (There is no ebur128: loudnorm's
// first pass reports the same BS.1770 measurements.)
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

export const root = path.resolve(import.meta.dirname, '../..')
const remotionBin = path.join(root, 'node_modules/.bin/remotion')

export function remotion(args, { quiet = false, env = {} } = {}) {
  execFileSync(remotionBin, args, { cwd: root, stdio: quiet ? 'pipe' : 'inherit', env: { ...process.env, ...env } })
}

/** ffmpeg's stderr — where it writes its reports. Throws if it fails. */
export function ffmpeg(args) {
  const r = spawnSync(remotionBin, ['ffmpeg', '-hide_banner', '-nostats', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${r.stderr.slice(-2000)}`)
  return r.stderr
}

export function ffprobe(file) {
  const r = spawnSync(remotionBin, ['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffprobe ${file} failed:\n${r.stderr}`)
  return JSON.parse(r.stdout)
}

export const LOUDNESS = { I: -14, TP: -1.5, LRA: 11 }
/** Where the mix sits when there is no voice to set it by. */
export const MIX_WITHOUT_VOICE = -18

/** loudnorm's measurement pass: integrated loudness, true peak, range, threshold, offset. */
export function measureLoudness(file) {
  // -vn: given a video, measure only its sound. This ffmpeg has no encoder to feed a picture to null.
  const err = ffmpeg(['-i', file, '-vn', '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`, '-f', 'null', '-'])
  const json = err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1)
  return JSON.parse(json)
}

/** One linear gain, to a 48 kHz 16-bit WAV — nothing dynamic, so the mix keeps its balance. */
export function applyGain(input, output, gainDb) {
  ffmpeg(['-y', '-i', input, '-af', `volume=${gainDb.toFixed(2)}dB`, '-ar', '48000', '-c:a', 'pcm_s16le', output])
}

/** Where sound starts, from silencedetect: the end of the first silence. */
export function firstSound(file, noise = '-45dB', minSilence = 0.15) {
  const err = ffmpeg(['-i', file, '-vn', '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-'])
  const m = err.match(/silence_end: ([\d.]+)/)
  return m ? Number(m[1]) : 0
}
