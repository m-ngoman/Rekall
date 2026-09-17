// Screenshots FunctionPlot against the functions that actually break plotters, in both themes.
// The chart guidance is explicit that a validator checks colour and not layout, so these have to
// be looked at: label collisions, clipped ticks, and vertical lines drawn through asymptotes.
//
//   cd frontend && npx vite --config vite.fixture.config.ts   (or any dev server)
//   node design/handoff/render-plots.mjs
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(new URL('.', import.meta.url).pathname)
const out = resolve(here, 'out/plots')
mkdirSync(out, { recursive: true })

/** The cases worth looking at, not the ones that are easy. */
const SPECS = [
  { name: 'parabola', fn: 'x^2 - 4', domain: [-4, 4], label: 'y = x² − 4', marks: [[-2, 0], [2, 0]], note: 'roots' },
  { name: 'asymptote', fn: '1/x', domain: [-4, 4], label: 'y = 1/x' },
  { name: 'tangent', fn: 'tan(x)', domain: [-4.5, 4.5], label: 'y = tan x' },
  { name: 'domain-gap', fn: 'sqrt(x)', domain: [-3, 9], label: 'y = √x' },
  { name: 'sine', fn: 'sin(x)', domain: [-6.3, 6.3], label: 'y = sin x', marks: [[0, 0]], note: 'origin' },
  { name: 'decay', fn: 'exp(-x) * 5', domain: [0, 6], label: 'y = 5e⁻ˣ' },
  { name: 'cubic', fn: 'x^3 - 3x', domain: [-2.5, 2.5], label: 'y = x³ − 3x', marks: [[-1, 2], [1, -2]], note: 'turning points' },
  { name: 'log', fn: 'ln(x)', domain: [-1, 8], label: 'y = ln x' },
  { name: 'flat', fn: '3', domain: [-5, 5], label: 'y = 3' },
]

// A page that mounts the real component from source, so this screenshots what ships.
const harness = (theme) => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700&family=Barlow+Condensed:wght@600&display=swap" rel="stylesheet">
</head><body>
<div id="root"></div>
<script type="module">
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import '/src/index.css'
  import FunctionPlot from '/src/components/FunctionPlot.tsx'
  const specs = ${JSON.stringify(SPECS)}
  const App = () => React.createElement('div',
    { style: { display: 'grid', gridTemplateColumns: 'repeat(3, max-content)', gap: '28px', padding: '28px', background: 'var(--bg)' } },
    specs.map((s) => React.createElement('div', { key: s.name, 'data-plot': s.name,
      style: { background: 'var(--surface)', borderRadius: 'var(--r-md)', padding: '14px 16px' } },
      React.createElement(FunctionPlot, { spec: s }))))
  createRoot(document.getElementById('root')).render(React.createElement(App))
</script></body></html>`

// Written to the Vite root, not public/: files under public/ are served verbatim, so the bare
// `react` import would never resolve. Vite only builds index.html, so this is dev-only, and it
// is removed again at the end.
const harnessPath = resolve(here, '../../frontend/_plotcheck.html')

const browser = await chromium.launch()
for (const theme of ['dark', 'light']) {
  // The theme goes in the markup, not an init script: `addInitScript` runs before
  // document.documentElement exists, so it threw and both passes silently rendered light — two
  // byte-identical screenshots, one of them labelled "dark".
  writeFileSync(harnessPath, harness(theme))
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://127.0.0.1:5199/_plotcheck.html', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/all-${theme}.png`, fullPage: true })
  console.log(`${out}/all-${theme}.png`, errs.length ? `PAGEERRORS ${errs.slice(0, 2)}` : '')

  // Hover the parabola so the crosshair and readout are in a shot too.
  if (theme === 'dark') {
    const svg = page.locator('[data-plot="parabola"] svg')
    const box = await svg.boundingBox()
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5)
    await page.waitForTimeout(250)
    await page.locator('[data-plot="parabola"]').screenshot({ path: `${out}/hover.png` })
    console.log(`${out}/hover.png`)
  }
  await page.close()
}
await browser.close()
rmSync(harnessPath, { force: true })
