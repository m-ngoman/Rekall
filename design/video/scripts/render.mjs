// Renders the videos, the posters and the review sheets.
//
//   npm run render                       all four videos
//   node scripts/render.mjs Launch30-Portrait [--silent]
//   npm run posters                      cover, graded, voice and end frames of each
//   npm run contact                      one-frame-a-second review sheets
//
// A video is rendered in three steps, because Remotion's bundled ffmpeg can measure and normalise
// loudness but a render can't do both at once: the cut's audio once (it's the same in both
// shapes), normalised to -14 LUFS / -1 dBTP; each shape's picture, muted; then the two muxed with
// the moov atom up front, so the file starts playing before it has finished downloading. With no
// voice take and no music there's no audio track at all — the video is complete without one.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { COMPOSITIONS, CUTS } from './cuts.mjs'
import { ffmpeg, measureLoudness, normalise, remotion, root } from './lib/ffmpeg.mjs'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { all: { type: 'boolean', default: false }, posters: { type: 'boolean', default: false }, sheets: { type: 'boolean', default: false }, silent: { type: 'boolean', default: false } },
})
const out = path.join(root, 'out')
const tmp = path.join(out, 'tmp')
fs.mkdirSync(tmp, { recursive: true })

const hasVoice = fs.existsSync(path.join(root, 'public/audio/tutor-sn1-sn2.wav'))
const hasMusic = ['public/audio/music.mp3', 'public/audio/music.wav', 'public/audio/music.m4a', 'public/audio/local/music.mp3', 'public/audio/local/music.wav', 'public/audio/local/music.m4a'].some((f) =>
  fs.existsSync(path.join(root, f)),
)
const withAudio = !opts.silent && (hasVoice || hasMusic)
const props = JSON.stringify({ silent: opts.silent })

const audioFor = new Map()
/** The cut's audio, rendered once and normalised; null when there is none to render. */
function cutAudio(cut) {
  if (!withAudio) return null
  if (audioFor.has(cut)) return audioFor.get(cut)
  const raw = path.join(tmp, `${cut}.wav`)
  const norm = path.join(tmp, `${cut}.norm.wav`)
  console.log(`\n${cut}: audio`)
  remotion(['render', `${cut}-Landscape`, raw, '--codec=wav', `--props=${props}`, '--log=error'])
  const m = measureLoudness(raw)
  console.log(`  measured ${m.input_i} LUFS, ${m.input_tp} dBTP, LRA ${m.input_lra}`)
  if (!(Number(m.input_i) > -60)) {
    console.log('  silent — leaving the audio track out')
    audioFor.set(cut, null)
    return null
  }
  const mode = normalise(raw, norm, m)
  console.log(`  normalised to ${-14} LUFS (${mode})`)
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

if (opts.posters) renderPosters()
else if (opts.sheets) renderSheets()
else {
  const ids = opts.all ? Object.keys(COMPOSITIONS) : positionals
  if (ids.length === 0) throw new Error('Name a composition, or pass --all')
  if (!withAudio) console.log(hasVoice || hasMusic ? 'Rendering silent (--silent).' : 'No voice take or music in public/audio: rendering silent.')
  for (const id of ids) renderVideo(id)
}
