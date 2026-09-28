// Renders each replica at rest (the Fidelity-* stills) and compares it with the real app in the
// same state (out/reference, from scripts/reference.mjs), pixel for pixel. Writes
// out/fidelity/<state>-<layout>.png — reference | replica | differences — and a JSON report.
//
//   npm run fidelity [-- --only study-graded] [-- --no-render]
//
// The score counts pixels with no match nearby. The replica is drawn at 1× and scaled up, the
// reference at the device pixel ratio, so text lays out with fractionally different advances: a
// line can end a few device pixels apart with every glyph in its place. A pixel counts as matched
// if the other image has the same colour within ±8 px across and ±2 px down (both ways round), so
// that drift is forgiven while a missing element, wrong copy or a real shift is not. Unmatched:
// warns above 0.1%, fails above 0.5%, unless the state is listed in ALLOWED with the reason the
// replica deliberately differs. The review sheet shows reference | replica | unmatched pixels.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PNG } from 'pngjs'

const root = path.resolve(import.meta.dirname, '..')
const { values: opts } = parseArgs({ options: { only: { type: 'string' }, 'no-render': { type: 'boolean', default: false } } })
const only = opts.only?.split(',')
const refDir = path.join(root, 'out/reference')
const outDir = path.join(root, 'out/fidelity')
fs.mkdirSync(outDir, { recursive: true })

/** Differences the replica keeps on purpose, and why. */
const ALLOWED = {}

const WARN = 0.001
const FAIL = 0.005
const REACH = { x: 8, y: 2 }
/** Colour distance, summed over RGB, past which two (softened) pixels are different. */
const TOLERANCE = 60

/** A 3×3 box blur: glyph edges rasterise with different coverage natively at 2.3× than scaled up
 * from 1×, and softening both first takes that out while a shape in the wrong place stays wrong. */
function soften(png) {
  const { width, height } = png
  const out = new PNG({ width, height })
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let k = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
            sum += png.data[(yy * width + xx) * 4 + c]
            k++
          }
        out.data[(y * width + x) * 4 + c] = sum / k
      }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  return out
}

/** Pixels of `a` with nothing like them within REACH in `b`, marked in `mark`. */
function unmatched(a, b, mark) {
  let n = 0
  const { width, height } = a
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let found = false
      for (let dy = -REACH.y; dy <= REACH.y && !found; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -REACH.x; dx <= REACH.x; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = (yy * width + xx) * 4
          if (Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]) <= TOLERANCE) {
            found = true
            break
          }
        }
      }
      if (!found) {
        n++
        mark.data[i] = 255
        mark.data[i + 1] = 0
        mark.data[i + 2] = 60
        mark.data[i + 3] = 255
      }
    }
  return n
}

const pairs = fs
  .readdirSync(refDir)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((id) => !only || only.some((o) => id.startsWith(o)))

const report = []
let failed = false
for (const id of pairs) {
  const replicaPath = path.join(outDir, `${id}.replica.png`)
  if (!opts['no-render']) {
    try {
      execFileSync(path.join(root, 'node_modules/.bin/remotion'), ['still', `Fidelity-${id}`, replicaPath, '--log=error'], { cwd: root, stdio: 'pipe' })
    } catch (e) {
      console.log(`skip ${id}: no replica still (${String(e.stderr ?? e).split('\n').find((l) => l.trim()) ?? 'render failed'})`)
      continue
    }
  }
  const ref = PNG.sync.read(fs.readFileSync(path.join(refDir, `${id}.png`)))
  const rep = PNG.sync.read(fs.readFileSync(replicaPath))
  if (ref.width !== rep.width || ref.height !== rep.height) {
    console.log(`FAIL ${id}: sizes differ, reference ${ref.width}×${ref.height}, replica ${rep.width}×${rep.height}`)
    failed = true
    continue
  }
  const { width, height } = ref
  // The review image: the reference, faded, with every unmatched pixel in red.
  const diff = new PNG({ width, height })
  for (let i = 0; i < ref.data.length; i += 4) {
    const l = 0.3 * ref.data[i] + 0.59 * ref.data[i + 1] + 0.11 * ref.data[i + 2]
    diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = 200 + l * 0.2
    diff.data[i + 3] = 255
  }
  const [a, b] = [soften(ref), soften(rep)]
  const n = Math.max(unmatched(a, b, diff), unmatched(b, a, diff))
  const share = n / (width * height)

  const sheet = new PNG({ width: width * 3 + 40, height })
  sheet.data.fill(255)
  PNG.bitblt(ref, sheet, 0, 0, width, height, 0, 0)
  PNG.bitblt(rep, sheet, 0, 0, width, height, width + 20, 0)
  PNG.bitblt(diff, sheet, 0, 0, width, height, 2 * width + 40, 0)
  fs.writeFileSync(path.join(outDir, `${id}.png`), PNG.sync.write(sheet))

  const status = share > FAIL ? (ALLOWED[id] ? 'allowed' : 'FAIL') : share > WARN ? 'warn' : 'ok'
  if (status === 'FAIL') failed = true
  report.push({ id, differing: n, share: Math.round(share * 10000) / 100, status, ...(ALLOWED[id] ? { why: ALLOWED[id] } : {}) })
  console.log(`${status.padEnd(7)} ${id.padEnd(32)} ${(share * 100).toFixed(2)}% of pixels differ`)
}
fs.mkdirSync(path.join(root, 'out/reports'), { recursive: true })
fs.writeFileSync(path.join(root, 'out/reports/fidelity.json'), JSON.stringify(report, null, 2) + '\n')
if (failed) process.exit(1)
