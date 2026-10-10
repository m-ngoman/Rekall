// The backend's Inworld call (backend/app/services/tts.py), ported so the video's voice line is
// made exactly the way the app makes a spoken reply: same endpoint, same body, same WAV shape,
// same folding of Inworld's tokens into written words.

export const INWORLD_URL = 'https://api.inworld.ai/tts/v1/voice'
export const SAMPLE_RATE = 44100

/** `_inworld_body`. */
export function inworldBody(text, voiceId = 'Ashley', modelId = 'inworld-tts-2-flash') {
  return {
    text,
    voiceId,
    modelId,
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
    timestampType: 'WORD',
  }
}

/** `_inworld_headers`: the portal issues base64("<key>:") already, so it is sent verbatim. */
export function inworldHeaders(key) {
  return { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' }
}

const isAlnum = (c) => /[\p{L}\p{N}]/u.test(c)

/** `_inworld_words`: drop the whitespace tokens, fold punctuation-only tokens into the end of the
 * word before them. 21 tokens in, 10 words out for the video's line — one timing per written word,
 * which is what lets the karaoke light the exact word rather than a proportional guess. */
export function foldWords(timestampInfo) {
  const alignment = (timestampInfo ?? {}).wordAlignment ?? {}
  const tokens = alignment.words ?? []
  const starts = alignment.wordStartTimeSeconds ?? []
  const ends = alignment.wordEndTimeSeconds ?? []
  const words = []
  for (let i = 0; i < Math.min(tokens.length, starts.length, ends.length); i++) {
    const token = tokens[i]
    if (!token.trim()) continue
    if (words.length && ![...token].some(isAlnum)) {
      words[words.length - 1].e = ends[i]
      continue
    }
    words.push({ w: token.trim(), s: starts[i], e: ends[i] })
  }
  return words
}

/** The PCM frames of a WAV, found by walking its chunks rather than assuming a 44-byte header —
 * `_inworld_pcm` goes through Python's wave module for the same reason: an extra LIST chunk would
 * otherwise be read as audio. */
export function wavPcm(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file')
  let fmt = null
  let data = null
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString('ascii', o, o + 4)
    const size = buf.readUInt32LE(o + 4)
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(o + 8),
        channels: buf.readUInt16LE(o + 10),
        sampleRate: buf.readUInt32LE(o + 12),
        bits: buf.readUInt16LE(o + 22),
      }
    } else if (id === 'data') {
      data = buf.subarray(o + 8, Math.min(buf.length, o + 8 + size))
    }
    o += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk')
  return { fmt, pcm: data }
}

/** `_wav_header`: the 44-byte header for 16-bit mono PCM at 44.1 kHz. */
export function wavHeader(pcmBytes, sampleRate = SAMPLE_RATE, channels = 1, bits = 16) {
  const h = Buffer.alloc(44)
  const byteRate = (sampleRate * channels * bits) / 8
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + pcmBytes, 4)
  h.write('WAVEfmt ', 8, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(byteRate, 28)
  h.writeUInt16LE((channels * bits) / 8, 32)
  h.writeUInt16LE(bits, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(pcmBytes, 40)
  return h
}

/** The alignment backend/tests/test_tts_inworld.py pins as REAL — "exactly what the API returned"
 * for the video's line. Read from the test itself, so the two can't drift. */
export function readPinnedAlignment(testSource) {
  const start = testSource.indexOf('REAL = {')
  if (start < 0) throw new Error('REAL not found in test_tts_inworld.py')
  let depth = 0
  let end = -1
  for (let i = start + 'REAL = '.length; i < testSource.length; i++) {
    if (testSource[i] === '{') depth++
    else if (testSource[i] === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  const literal = testSource
    .slice(start + 'REAL = '.length, end)
    .replace(/,(\s*[\]}])/g, '$1') // Python allows trailing commas; JSON doesn't
  return JSON.parse(literal)
}
