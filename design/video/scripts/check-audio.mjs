// Checks the voice take against its timings file before anything is rendered with it: 16-bit mono
// PCM, as long as its last word, one timing per written word. No take is not an error — the video
// renders silent — but it is said.
import fs from 'node:fs'
import path from 'node:path'
import { wavPcm } from './lib/inworld.mjs'

const root = path.resolve(import.meta.dirname, '..')
const words = JSON.parse(fs.readFileSync(path.join(root, 'src/audio/tutor-sn1-sn2.words.json'), 'utf8'))
const wav = path.join(root, 'public/audio/tutor-sn1-sn2.wav')

const written = words.text.split(/\s+/).filter(Boolean)
if (words.words.length !== written.length) {
  console.error(`FAIL ${words.words.length} timings for ${written.length} words`)
  process.exit(1)
}
if (!fs.existsSync(wav)) {
  console.log(`No voice take (${path.relative(root, wav)}): the videos render silent, the karaoke on the committed timings.`)
  console.log('Make one with INWORLD_API_KEY set: npm run tts')
  process.exit(0)
}
const { fmt, pcm } = wavPcm(fs.readFileSync(wav))
const duration = pcm.length / (fmt.sampleRate * fmt.channels * (fmt.bits / 8))
const problems = []
if (fmt.format !== 1 || fmt.bits !== 16) problems.push(`expected 16-bit PCM, got format ${fmt.format} at ${fmt.bits} bits`)
if (fmt.channels !== 1) problems.push(`expected mono, got ${fmt.channels} channels`)
const last = words.words[words.words.length - 1].e
if (Math.abs(duration - last) > 0.05 && Math.abs(duration - words.duration) > 0.05) problems.push(`${duration.toFixed(3)} s of audio, but the last word ends at ${last} s`)
if (words.sha256) {
  const { createHash } = await import('node:crypto')
  if (createHash('sha256').update(fs.readFileSync(wav)).digest('hex') !== words.sha256) problems.push('the take is not the one its timings were made from (sha256 differs); run npm run tts again')
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`)
  process.exit(1)
}
console.log(`ok  voice take: ${duration.toFixed(2)} s, ${fmt.sampleRate} Hz, ${words.words.length} words timed`)
