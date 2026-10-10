// Makes the tutor's voice line the way the app makes a spoken reply, and writes the two files the
// voice scene reads:
//   public/audio/<id>.wav            16-bit mono 44.1 kHz, with the backend's 44-byte header
//   src/audio/<id>.words.json        one {w, s, e} per written word, folded like _inworld_words
//
//   INWORLD_API_KEY=… npm run tts                     the line, from Inworld (key as the portal issues it)
//   npm run tts -- --from-response saved.json         the same, from a response saved earlier
//   npm run tts -- --from-test                        timings only, from backend/tests/test_tts_inworld.py
//   npm run tts -- --dry-run                          print the request and stop
//   --id <name> --text <line> --voice <id> --model <id> for any other line
//
// Refuses to write anything unless there is exactly one timing per written word: with any other
// count the app's karaoke falls back to a proportional remap (see wordStarts), and so would ours.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { INWORLD_URL, foldWords, inworldBody, inworldHeaders, readPinnedAlignment, wavHeader, wavPcm } from './lib/inworld.mjs'

const root = path.resolve(import.meta.dirname, '..')
const { values: opts } = parseArgs({
  options: {
    id: { type: 'string', default: 'tutor-sn1-sn2' },
    text: { type: 'string', default: 'Tertiary substrates go SN1; primary ones almost always go SN2.' },
    voice: { type: 'string', default: 'Ashley' },
    model: { type: 'string', default: 'inworld-tts-2-flash' },
    'from-response': { type: 'string' },
    'from-test': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

const body = inworldBody(opts.text, opts.voice, opts.model)
const wordsPath = path.join(root, 'src/audio', `${opts.id}.words.json`)
const wavPath = path.join(root, 'public/audio', `${opts.id}.wav`)
const written = opts.text.split(/\s+/).filter(Boolean)

const checkCount = (words) => {
  if (words.length !== written.length) {
    throw new Error(`${words.length} timings for ${written.length} written words — refusing to write a take the karaoke can't follow`)
  }
  words.forEach((w, i) => {
    if (w.w.replace(/[^\p{L}\p{N}]/gu, '') !== written[i].replace(/[^\p{L}\p{N}]/gu, '')) {
      throw new Error(`timing ${i} is for "${w.w}" but word ${i} is "${written[i]}"`)
    }
  })
}

if (opts['dry-run']) {
  console.log(`POST ${INWORLD_URL}\n${JSON.stringify(body, null, 2)}`)
  process.exit(0)
}

if (opts['from-test']) {
  const test = fs.readFileSync(path.resolve(root, '../../backend/tests/test_tts_inworld.py'), 'utf8')
  const words = foldWords(readPinnedAlignment(test))
  checkCount(words)
  const out = {
    text: opts.text,
    voice: opts.voice,
    model: opts.model,
    source: 'Inworld alignment pinned in backend/tests/test_tts_inworld.py; no audio take yet',
    duration: words[words.length - 1].e,
    words,
  }
  fs.writeFileSync(wordsPath, JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${path.relative(root, wordsPath)} (${words.length} words, ${out.duration}s) from the backend test`)
  process.exit(0)
}

let payload
if (opts['from-response']) {
  payload = JSON.parse(fs.readFileSync(opts['from-response'], 'utf8'))
} else {
  const key = process.env.INWORLD_API_KEY
  if (!key) {
    console.error('INWORLD_API_KEY is not set. Add it to the environment (the same variable the backend reads), or pass --from-response.')
    process.exit(2)
  }
  const res = await fetch(INWORLD_URL, { method: 'POST', headers: inworldHeaders(key), body: JSON.stringify(body) })
  if (!res.ok) {
    console.error(`Inworld answered ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 400)}`)
    process.exit(1)
  }
  payload = await res.json()
}

const { fmt, pcm } = wavPcm(Buffer.from(payload.audioContent, 'base64'))
if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) {
  throw new Error(`Expected 16-bit mono PCM, got format ${fmt.format}, ${fmt.bits}-bit, ${fmt.channels} channel(s)`)
}
const words = foldWords(payload.timestampInfo)
checkCount(words)

const wav = Buffer.concat([wavHeader(pcm.length, fmt.sampleRate), pcm])
fs.writeFileSync(wavPath, wav)
const duration = pcm.length / (fmt.sampleRate * 2)
const out = {
  text: opts.text,
  voice: opts.voice,
  model: opts.model,
  source: `Inworld take, ${new Date().toISOString().slice(0, 10)}`,
  sha256: crypto.createHash('sha256').update(wav).digest('hex'),
  sampleRate: fmt.sampleRate,
  duration: Math.round(duration * 1000) / 1000,
  processedCharacters: payload.usage?.processedCharactersCount ?? null,
  words,
}
fs.writeFileSync(wordsPath, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${path.relative(root, wavPath)} (${out.duration}s) and ${path.relative(root, wordsPath)} (${words.length} words)`)
