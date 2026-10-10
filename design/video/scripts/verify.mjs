// Checks the rendered videos against what the platforms need and what the plan promised:
// size, 30 fps, frame count, H.264 High in yuv420p with BT.709 tags, the moov atom first; and
// where there is sound, AAC 48 kHz stereo under -1 dBTP, the voice at -14 LUFS (±1) and starting
// within a frame of where the karaoke expects it (both from the render's report, measured on the
// voice alone), and the whole mix in a sane range around it. Writes out/reports/verify.json.
import fs from 'node:fs'
import path from 'node:path'
import { COMPOSITIONS, CUTS } from './cuts.mjs'
import { LOUDNESS, firstSound, ffprobe, measureLoudness, root } from './lib/ffmpeg.mjs'

const report = []
let failed = false
const check = (entry, ok, what) => {
  entry.checks.push({ ok, what })
  if (!ok) failed = true
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/** Whether the moov atom comes before mdat: the file can start playing as it downloads. */
function faststart(file) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(64)
  let offset = 0
  const seen = []
  for (let i = 0; i < 16; i++) {
    if (fs.readSync(fd, buf, 0, 16, offset) < 8) break
    let size = buf.readUInt32BE(0)
    const type = buf.toString('ascii', 4, 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(8))
    seen.push(type)
    if (type === 'moov' || type === 'mdat') break
    offset += size
  }
  fs.closeSync(fd)
  return seen.indexOf('moov') !== -1 && (seen.indexOf('mdat') === -1 || seen.indexOf('moov') < seen.indexOf('mdat'))
}

for (const [id, spec] of Object.entries(COMPOSITIONS)) {
  const file = path.join(root, 'out', `${spec.out}.mp4`)
  console.log(`\n${path.relative(root, file)}`)
  const entry = { file: path.relative(root, file), checks: [] }
  report.push(entry)
  if (!fs.existsSync(file)) {
    check(entry, false, 'rendered')
    continue
  }
  const probe = ffprobe(file)
  const v = probe.streams.find((s) => s.codec_type === 'video')
  const a = probe.streams.find((s) => s.codec_type === 'audio')
  const cut = CUTS[spec.cut]
  const duration = Number(probe.format.duration)
  check(entry, v.width === spec.width && v.height === spec.height, `${v.width}×${v.height}`)
  check(entry, v.r_frame_rate === '30/1' && v.avg_frame_rate === '30/1', `30 fps constant (${v.avg_frame_rate})`)
  check(entry, Number(v.nb_frames) === cut.frames, `${v.nb_frames} frames (${cut.frames} expected)`)
  // Remotion's ffprobe build prints the profile's number rather than its name; 100 is High.
  const high = v.profile === 'High' || String(v.profile) === '100'
  check(entry, v.codec_name === 'h264' && high, `${v.codec_name} High (profile ${v.profile})`)
  check(entry, v.pix_fmt === 'yuv420p', v.pix_fmt)
  check(entry, v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_space === 'bt709', `BT.709 tagged (${v.color_primaries}/${v.color_transfer}/${v.color_space})`)
  check(entry, Math.abs(duration - cut.frames / 30) < 1 / 30 + 0.03, `${duration.toFixed(3)} s`)
  check(entry, faststart(file), 'moov before mdat (faststart)')
  const mb = fs.statSync(file).size / 1e6
  check(entry, mb < 50, `${mb.toFixed(1)} MB`)
  entry.sizeMB = Math.round(mb * 10) / 10
  if (a) {
    check(entry, a.codec_name === 'aac' && Number(a.sample_rate) === 48000 && a.channels === 2, `audio ${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`)
    const m = measureLoudness(file)
    entry.loudness = { integrated: Number(m.input_i), truePeak: Number(m.input_tp), range: Number(m.input_lra) }
    check(entry, Number(m.input_tp) <= -1, `${m.input_tp} dBTP true peak (≤ -1)`)
    // The level is set by the voice (scripts/render.mjs); the whole mix, bed and effects included,
    // just has to be in a sane range around it.
    check(entry, Number(m.input_i) >= -24 && Number(m.input_i) <= -13, `${m.input_i} LUFS integrated, the whole mix (-24…-13)`)
    const levels = path.join(root, 'out/reports', `audio-${spec.cut}.json`)
    const report = fs.existsSync(levels) ? JSON.parse(fs.readFileSync(levels, 'utf8')) : null
    const expected = cut.voiceStart / 30
    if (report?.voiceLufs !== undefined) {
      entry.voice = { lufs: report.voiceLufs, onset: report.voiceOnset }
      check(entry, Math.abs(report.voiceLufs - LOUDNESS.I) <= 1, `voice at ${report.voiceLufs.toFixed(2)} LUFS (${LOUDNESS.I} ±1)`)
      check(entry, Math.abs(report.voiceOnset - expected) <= 1 / 30 + 0.02, `voice starts at ${report.voiceOnset.toFixed(3)} s (${expected.toFixed(3)} expected, measured on the voice alone)`)
    } else {
      // No render report: only a voice-only file says where the voice begins by its first sound.
      const onset = firstSound(file)
      if (onset > 0.5) check(entry, Math.abs(onset - expected) <= 1 / 30 + 0.02, `voice starts at ${onset.toFixed(3)} s (${expected.toFixed(3)} expected)`)
    }
  } else {
    console.log('  (no audio track)')
  }
}

fs.mkdirSync(path.join(root, 'out/reports'), { recursive: true })
fs.writeFileSync(path.join(root, 'out/reports/verify.json'), JSON.stringify(report, null, 2) + '\n')
if (failed) process.exit(1)
