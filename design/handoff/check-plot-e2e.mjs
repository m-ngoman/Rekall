// The whole path, once: marker -> SSE -> React -> SVG. The gallery in render-plots.mjs feeds the
// component props directly, so it proves the renderer and nothing about the wire; this drives the
// real tutor screen against the stub provider and asserts on what actually lands in the DOM.
//
//   cd backend && DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture \
//     GRADER=stub TUTOR_PROVIDER=stub GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= OWNER_EMAIL=dev@rekall.study \
//     .venv/bin/uvicorn app.main:app --port 8011
//   cd frontend && npm run dev:fixture
//   node design/handoff/check-plot-e2e.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(new URL('.', import.meta.url).pathname, 'out/plots')
mkdirSync(out, { recursive: true })

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  (${detail})`}`)
}

const browser = await chromium.launch()
for (const [theme, viewport] of [
  ['dark', { width: 1280, height: 900 }],
  ['light', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://127.0.0.1:5199/tutor', { waitUntil: 'networkidle' })

  // A fresh context starts at onboarding — theme, daily target, starter deck — and the tutor is
  // behind it. Click forward until the composer exists rather than naming each step, so a change
  // to the flow costs nothing here.
  for (let i = 0; i < 8 && !(await page.getByPlaceholder(/message the tutor/i).count()); i += 1) {
    await page.waitForTimeout(700)
    const next = page
      .locator('button:visible')
      .filter({ hasText: /^(get started|continue|skip for now|tutor)$/i })
      .first()
    if (await next.count()) await next.click()
  }

  const box = page.getByPlaceholder(/message the tutor/i).first()
  await box.fill('Draw me a velocity-time graph.')
  await box.press('Enter')

  // Onboarding picks a theme of its own, so this is set after it rather than before.
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)

  const svg = page.locator('svg[aria-label^="Graph of"]')
  await svg.waitFor({ timeout: 20000 })
  // The typewriter is still revealing text when the plot lands; wait for it to settle.
  await page.waitForTimeout(2500)

  console.log(`\n--- ${theme}, ${viewport.width}x${viewport.height} ---`)
  const bubble = await page.locator('main').innerText()
  check('no marker text leaked', !bubble.includes('<<') && !bubble.includes('fn='), bubble.slice(0, 120))

  const alt = await svg.getAttribute('aria-label')
  check('alt text names the axes with units', /velocity \(m\/s\) against time \(s\)/.test(alt), alt)
  check('alt text names the shaded region', /area beneath it shaded from 0 to 4/.test(alt), alt)

  // min() parsed: a kink, not a dropped plot. One unbroken curve path plus one shading path.
  const curves = await svg.locator('path[stroke="var(--text)"]').count()
  check('the piecewise curve drew as one unbroken path', curves === 1, `${curves} paths`)
  const shades = await svg.locator('path[fill="var(--accent)"]').count()
  check('the area under the curve is shaded', shades === 1, `${shades} washes`)
  const opacity = await svg.locator('path[fill="var(--accent)"]').getAttribute('fill-opacity')
  check('the wash is a tenth, not a block', opacity === '0.1', String(opacity))

  // textContent, not innerText: innerText is an HTML property and comes back empty on an SVG
  // <text> node, which reads as "the titles are missing" when they are right there on screen.
  const titles = await svg.locator('text').allTextContents()
  check('both axis titles rendered', titles.includes('time (s)') && titles.includes('velocity (m/s)'))

  // The accent belongs to the point being discussed, never to the curve itself.
  const marks = await svg.locator('circle[fill="var(--accent)"]').count()
  check('one accent mark, at the kink', marks === 1, `${marks} marks`)

  const size = await svg.boundingBox()
  check('the plot fits its column', size.width <= viewport.width - 24, `${Math.round(size.width)}px`)
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '))

  await page.locator('svg[aria-label^="Graph of"]').screenshot({ path: `${out}/e2e-${theme}.png` })
  await page.close()
}
await browser.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
