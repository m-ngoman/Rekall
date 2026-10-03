// Renders the videos, the posters and the review sheets.
//
//   npm run render                       all four videos
//   node scripts/render.mjs Launch30-Portrait [--silent] [--no-music] [--no-sfx]
//   npm run posters                      cover, graded, voice and end frames of each
//   npm run contact                      one-frame-a-second review sheets
//   npm run banners                      the X, LinkedIn and YouTube banners, and the avatar
//
// A video is rendered in three steps, because Remotion's bundled ffmpeg can measure and set
// loudness but a render can't do both at once: the cut's audio once (it's the same in both
// shapes), set to its level; each shape's picture, muted; then the two muxed with the moov atom up
// front, so the file starts playing before it has finished downloading. The level is the voice's:
// the tutor's line at -14 LUFS, and the effects and the bed in proportion, by one linear gain kept
// under -1.5 dBTP. (Normalising the whole mix to -14 instead would have to squash the voice to fit
// its peaks.) The sound effects and the bed are made from source first (scripts/make-audio.ts).
// With --silent, or nothing to play, there's no audio track at all — the video is complete without.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { COMPOSITIONS, CUTS, PROFILES } from './cuts.mjs'
import { LOUDNESS, MIX_WITHOUT_VOICE, applyGain, ffmpeg, firstSound, measureLoudness, remotion, root } from './lib/ffmpeg.mjs'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean', default: false },
    posters: { type: 'boolean', default: false },
    sheets: { type: 'boolean', default: false },
    banners: { type: 'boolean', default: false },
    silent: { type: 'boolean', default: false },
    'no-music': { type: 'boolean', default: false },
    'no-sfx': { type: 'boolean', default: false },
  },
})
const out = path.join(root, 'out')
const tmp = path.join(out, 'tmp')
fs.mkdirSync(tmp, { recursive: true })

const rendering = !opts.posters && !opts.sheets && !opts.banners
if (rendering && !opts.silent) {
  console.log('Making the sound effects and the music bed:')
  execFileSync(path.join(root, 'node_modules/.bin/vite-node'), ['scripts/make-audio.ts'], { cwd: root, stdio: 'inherit' })
}
const has = (f) => fs.existsSync(path.join(root, 'public', f))
const hasVoice = has('audio/tutor-sn1-sn2.wav')
const MUSIC = ['audio/music.mp3', 'audio/music.wav', 'audio/music.m4a', 'audio/local/music.mp3', 'audio/local/music.wav', 'audio/local/music.m4a', 'audio/generated/music.wav']
const music = !opts['no-music'] && MUSIC.some(has)
const sfx = !opts['no-sfx'] && Object.keys(CUTS).some((c) => has(`audio/generated/sfx-${c}.wav`))
const withAudio = !opts.silent && (hasVoice || music || sfx)
const flags = { silent: opts.silent, music: !opts['no-music'], sfx: !opts['no-sfx'] }
const props = JSON.stringify(flags)

/** A cut's sound alone, as a WAV. remotion.config.ts leaves out the videos' encoding settings for
 * this pass, which a WAV can't take. */
function audioPass(cut, file, p) {
  remotion(['render', `${cut}-Landscape`, file, '--codec=wav', '--audio-codec=pcm-16', `--props=${JSON.stringify(p)}`, '--log=error'], { env: { REKALL_RENDER_PASS: 'audio' } })
}

const audioFor = new Map()
/** The cut's audio, rendered once and set to its level; null when there is none to render. */
function cutAudio(cut) {
  if (!withAudio) return null
  if (audioFor.has(cut)) return audioFor.get(cut)
  const raw = path.join(tmp, `${cut}.wav`)
  const norm = path.join(tmp, `${cut}.norm.wav`)
  console.log(`\n${cut}: audio`)
  audioPass(cut, raw, flags)
  const mix = measureLoudness(raw)
  console.log(`  mix ${mix.input_i} LUFS, ${mix.input_tp} dBTP`)
  if (!(Number(mix.input_i) > -60)) {
    console.log('  silent — leaving the audio track out')
    audioFor.set(cut, null)
    return null
  }
  const report = { cut }
  let gain = MIX_WITHOUT_VOICE - Number(mix.input_i)
  if (hasVoice) {
    // The voice alone, from the same composition: its level sets the gain, and where it starts is
    // checked here, where nothing else is playing over it.
    const stem = path.join(tmp, `${cut}.voice.wav`)
    audioPass(cut, stem, { silent: false, music: false, sfx: false })
    const voice = measureLoudness(stem)
    const onset = firstSound(stem)
    const expected = CUTS[cut].voiceStart / 30
    console.log(`  voice ${voice.input_i} LUFS, starting at ${onset.toFixed(3)} s (${expected.toFixed(3)} expected)`)
    if (Math.abs(onset - expected) > 1 / 30 + 0.02) throw new Error(`${cut}: the voice starts at ${onset} s, not ${expected} s`)
    gain = LOUDNESS.I - Number(voice.input_i)
    Object.assign(report, { voiceLufs: Number(voice.input_i) + gain, voiceOnset: onset, voiceExpected: expected })
  }
  // One gain for everything, lowered if the loudest true peak would pass the limit.
  const over = Math.max(0, Number(mix.input_tp) + gain - LOUDNESS.TP)
  gain -= over
  if (report.voiceLufs !== undefined) report.voiceLufs -= over
  applyGain(raw, norm, gain)
  const after = measureLoudness(norm)
  Object.assign(report, { gain, mixLufs: Number(after.input_i), truePeak: Number(after.input_tp) })
  console.log(`  ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB: voice ${report.voiceLufs?.toFixed(2) ?? '-'} LUFS, mix ${after.input_i} LUFS, ${after.input_tp} dBTP`)
  fs.mkdirSync(path.join(out, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(out, 'reports', `audio-${cut}.json`), JSON.stringify(report, null, 2) + '\n')
  audioFor.set(cut, norm)
  return norm
}

function renderVideo(id) {
  const spec = COMPOSITIONS[id]
  if (!spec) throw new Error(`No composition ${id}; one of ${Object.keys(COMPOSITIONS).join(', ')}`)
  const audio = cutAudio(spec.cut)
  const video = path.join(tmp, `${spec.out}.video.mp4`)
  const final = path.join(out, `${spec.out}.mp4`)
  console.log(`\n${id}: picture`)
  remotion(['render', id, video, '--muted', `--props=${props}`, '--log=error'])
  const mux = audio
    ? ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', final]
    : ['-y', '-i', video, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', final]
  ffmpeg(mux)
  console.log(`  -> ${path.relative(root, final)} (${(fs.statSync(final).size / 1e6).toFixed(1)} MB${audio ? '' : ', no audio'})`)
}

function renderPosters() {
  const dir = path.join(out, 'posters')
  fs.mkdirSync(dir, { recursive: true })
  for (const [id, spec] of Object.entries(COMPOSITIONS)) {
    for (const [name, frame] of Object.entries(CUTS[spec.cut].posters)) {
      const base = path.join(dir, `${spec.out}-${name}`)
      remotion(['still', id, `${base}.png`, `--frame=${frame}`, `--props=${props}`, '--log=error'], { quiet: true })
      // Portrait covers are what TikTok, Reels and Shorts ask for as a cover image.
      if (name === 'cover' && spec.height > spec.width) {
        remotion(['still', id, `${base}.jpg`, `--frame=${frame}`, '--image-format=jpeg', '--jpeg-quality=90', `--props=${props}`, '--log=error'], { quiet: true })
      }
      console.log(`  ${path.relative(root, base)}.png`)
    }
  }
}

function renderSheets() {
  const dir = path.join(out, 'contact')
  fs.mkdirSync(dir, { recursive: true })
  for (const id of Object.keys(COMPOSITIONS)) {
    const file = path.join(dir, `${COMPOSITIONS[id].out}.png`)
    remotion(['still', `Sheet-${id}`, file, '--frame=0', '--log=error'], { quiet: true })
    console.log(`  ${path.relative(root, file)}`)
  }
}

/** The profile images: a banner each for X, LinkedIn and YouTube, and the avatar. */
function renderBanners() {
  const dir = path.join(out, 'banners')
  fs.mkdirSync(dir, { recursive: true })
  for (const [id, file] of Object.entries(PROFILES)) {
    const target = path.join(dir, `${file}.png`)
    remotion(['still', id, target, '--log=error'], { quiet: true })
    console.log(`  ${path.relative(root, target)}`)
  }
}

if (opts.banners) renderBanners()
else if (opts.posters) renderPosters()
else if (opts.sheets) renderSheets()
else {
  const ids = opts.all ? Object.keys(COMPOSITIONS) : positionals
  if (ids.length === 0) throw new Error('Name a composition, or pass --all')
  if (!withAudio) console.log(hasVoice || hasMusic ? 'Rendering silent (--silent).' : 'No voice take or music in public/audio: rendering silent.')
  for (const id of ids) renderVideo(id)
}
