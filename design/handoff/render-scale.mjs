// Renders the app at the two root font-sizes the type-scale decision chose between, so it can be
// made, or revisited, by eye: 106%, what was live when it was made, and 100%, which lands every rem
// on the doc's px values and is what index.css uses now. No source change: each pass injects its
// size as a stylesheet override, so the comparison still works whichever one is live.
//
//   node design/handoff/render-scale.mjs     (fixture servers running; see seed_fixture.py)
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const out = resolve(new URL('.', import.meta.url).pathname, 'out/scale')
mkdirSync(out, { recursive: true })

function reseed() {
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
    env: { ...process.env, DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture' },
    stdio: 'ignore',
  })
}

const browser = await chromium.launch()
for (const screen of ['home', 'calendar']) {
  for (const [tag, pct] of [['106', '106%'], ['100', '100%']]) {
    reseed()
    await fetch('http://127.0.0.1:8011/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'UTC' })
    await page.addInitScript(() => localStorage.setItem('pipcards:accent', 'oklch(0.7 0.145 40)'))
    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: `html { font-size: calc(${pct} * var(--text-scale, 1)) !important }` })
    await page.waitForTimeout(900)
    if (screen === 'calendar') {
      await page.getByRole('button', { name: 'Calendar', exact: true }).first().click()
      await page.waitForTimeout(800)
    }
    await page.evaluate(() => document.fonts.ready)
    const path = `${out}/${screen}-${tag}.png`
    await page.screenshot({ path })
    console.log(path, await page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    await page.close()
  }
}
await browser.close()
