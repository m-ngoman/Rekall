// Makes the soundtrack's generated files into public/audio/generated/ (gitignored — they are
// re-made from source, identically, before every render):
//   sfx-<cut>.wav   every sound effect in the cut, mixed, as long as the cut (src/audio/cues.ts)
//   music.wav       the lo-fi bed (src/audio/music.ts), long enough for the longest cut
//
//   npm run audio
import fs from 'node:fs'
import path from 'node:path'
import { cuesFor, sfxStem } from '../src/audio/cues'
import { db, lufs, wavBytes } from '../src/audio/dsp'
import { lofiBed } from '../src/audio/music'
import { CUTS, FPS } from '../src/timeline'

/** The bed's own level. The Soundtrack plays it 16 dB down (28 under the voice), which puts it about
 * 10 LU under the tutor's line, and far under it while the tutor speaks. */
const MUSIC_LUFS = -13

const dir = path.join(process.cwd(), 'public/audio/generated')
fs.mkdirSync(dir, { recursive: true })
const dBFS = (x: number) => (20 * Math.log10(x)).toFixed(1)

for (const cut of CUTS) {
  const stem = sfxStem(cut)
  fs.writeFileSync(path.join(dir, `sfx-${cut.id}.wav`), wavBytes(stem.left, stem.right))
  console.log(`  sfx-${cut.id}.wav: ${cuesFor(cut).length} cues, peak ${dBFS(stem.peak())} dBFS, ${lufs(stem.left, stem.right).toFixed(1)} LUFS`)
}

const seconds = Math.max(...CUTS.map((c) => c.durationInFrames / FPS)) + 1
const bed = lofiBed(seconds)
let gain = db(MUSIC_LUFS - lufs(bed.left, bed.right))
// Never clip: if the level would, the bed lands a little under it instead.
if (bed.peak() * gain > 0.95) gain = 0.95 / bed.peak()
for (const ch of [bed.left, bed.right]) for (let i = 0; i < ch.length; i++) ch[i] *= gain
fs.writeFileSync(path.join(dir, 'music.wav'), wavBytes(bed.left, bed.right))
console.log(`  music.wav: ${seconds} s, ${lufs(bed.left, bed.right).toFixed(1)} LUFS, peak ${dBFS(bed.peak())} dBFS`)
