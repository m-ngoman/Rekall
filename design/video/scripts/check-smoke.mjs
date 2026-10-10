// Samples the Smoke still (see src/tools/Smoke.tsx) and checks each swatch against the dark theme's
// tokens in frontend/src/index.css, converted from OKLCH here rather than trusted from the render.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { hex, oklchToRgb } from './lib/oklch.mjs'

const root = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.resolve(root, '../../frontend/src/index.css'), 'utf8')
const dark = css.slice(css.indexOf(":root[data-theme='dark']"))
const token = (block, name) => {
  const m = block.match(new RegExp(`${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`))
  if (!m) throw new Error(`No OKLCH value for ${name}`)
  return m.slice(1).map(Number)
}
// Dark sets --accent to the raw pick, which :root declares.
const expected = {
  '--bg': token(dark, '--bg'),
  '--surface': token(dark, '--surface'),
  '--rule': token(dark, '--rule'),
  '--text': token(dark, '--text'),
  '--text-muted': token(dark, '--text-muted'),
  '--accent': token(css, '--accent-pick'),
  '--grade-hard': token(dark, '--grade-hard'),
}

const png = PNG.sync.read(fs.readFileSync(path.resolve(root, 'out/smoke.png')))
let failed = false
Object.entries(expected).forEach(([name, lch], i) => {
  const want = oklchToRgb(...lch)
  const x = i * 160 + 80
  const y = 100
  const o = (png.width * y + x) * 4
  const got = [png.data[o], png.data[o + 1], png.data[o + 2]]
  const ok = got.every((c, k) => Math.abs(c - want[k]) <= 2)
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(13)} want ${hex(want)} got ${hex(got)}`)
})
if (failed) process.exit(1)
