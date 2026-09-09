// The README's study-loop shot. Unlike render-app.mjs (which compares against the handoff
// mocks) this one exists to show what the product actually does: a *partial* answer, graded,
// with the model explaining what was missed. A verbatim answer scoring 5/5 demonstrates
// nothing a string comparison couldn't do.
//
//   node design/handoff/render-readme-shot.mjs
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const out = resolve(repo, 'docs/readme')
mkdirSync(out, { recursive: true })

const FIXTURE_DB = 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture'
const reseed = () =>
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
    env: { ...process.env, DATABASE_URL: FIXTURE_DB },
    stdio: 'ignore',
  })

// A real but incomplete attempt: it names the carbocation and stops there, missing why that
// leads to a racemic mixture. Grades 3/5 on the default "balanced" strictness, which is the
// frame worth showing — a 5/5 proves nothing a string comparison couldn't do, and a 1/5 shows
// the model correcting rather than the student recalling.
const PARTIAL = 'You get a carbocation in the middle of the reaction.'

const browser = await chromium.launch()

for (const theme of ['dark', 'light']) {
  reseed()
  await fetch('http://127.0.0.1:8011/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme }),
  })

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    timezoneId: 'UTC',
  })
  await page.addInitScript((t) => {
    localStorage.setItem('pipcards:theme', t)
    localStorage.setItem('pipcards:accent', 'oklch(0.7 0.145 40)')
  }, theme)

  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: /Organic Chemistry II/ }).last().click()
  await page.waitForSelector('textarea', { timeout: 15000 })
  await page.waitForTimeout(400)

  console.log(`[${theme}] card:`, (await page.locator('h1, h2').allInnerTexts()).join(' | ').slice(0, 120))

  await page.locator('textarea').fill(PARTIAL)
  await page.getByRole('button', { name: /Check my answer/ }).click()
  await page.waitForSelector('text=/Back in|Good|Hard|Forgot|Easy/', { timeout: 60000 })
  // The explanation streams token by token; let it settle before the shutter.
  await page.waitForTimeout(3000)
  await page.evaluate(() => document.fonts.ready)

  // Crop to the content rather than shipping 40% empty page. Measured from the live DOM so a
  // layout change can't silently leave a band of background in the committed image.
  // Leaf nodes only: a full-height layout wrapper's bottom is the viewport, which would defeat
  // the crop entirely. What we want is the lowest element that actually draws something.
  const box = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('body *')].filter(
      (e) => e.children.length === 0 && e.textContent.trim() !== ''
    )
    const bottom = Math.max(
      ...leaves.map((e) => e.getBoundingClientRect().bottom).filter((b) => b <= window.innerHeight)
    )
    return { bottom: Math.min(Math.ceil(bottom) + 40, window.innerHeight) }
  })

  const path = `${out}/study-loop-${theme}.png`
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: box.bottom } })
  console.log(`  -> ${path}  (${box.bottom}px tall)`)
  await page.close()
}

await browser.close()
