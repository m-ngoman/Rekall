// Screenshots the real app (fixture backend on 8011, vite on 5199) at the same screens and
// themes as the handoff mocks, so the two can be compared side by side.
//
//   node design/handoff/render-app.mjs [screen ...]
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')

/** The study screens submit a real answer, which reschedules a card and drops the due count
 *  every later screen reports. Re-seeding per pass keeps every screenshot on the same data. */
function reseed() {
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture',
    },
    stdio: 'ignore',
  })
}

const out = resolve(new URL('.', import.meta.url).pathname, 'out/app')
mkdirSync(out, { recursive: true })

const APP = 'http://127.0.0.1:5199/'
// The mock artboards are 390x844 (iPhone) and 1280x800 (desktop).
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

const tab = (name) => async (page) => {
  await page.getByRole('button', { name, exact: true }).first().click()
  await page.waitForTimeout(700)
}

/** Drives the study flow from Home's start button. `stop` decides how far it goes. */
const study = (stop) => async (page) => {
  // The deck tile, not the Start button: Start opens the deck cramming for the nearest exam
  // (Pharmacology here), while the mock's Study screens are Organic Chemistry II.
  await page.getByRole('button', { name: /Organic Chemistry II/ }).last().click()
  await page.waitForSelector('textarea', { timeout: 15000 })
  await page.waitForTimeout(400)
  if (stop === 'answering') {
    await page.locator('textarea').fill(
      'The leaving group goes first, so you get a planar carbocation. The nucleophile can attack from either face equally, so'
    )
    await page.waitForTimeout(200)
    return
  }
  // Graded: an answer close enough to the reference that the stub grader returns 3/"Good", 4/5.
  await page.locator('textarea').fill(
    'The leaving group departs first, giving a planar carbocation intermediate. The nucleophile attacks either face with equal probability, so stereochemistry is lost.'
  )
  await page.getByRole('button', { name: /Check my answer/ }).click()
  await page.waitForSelector('text=/Back in|Good|Hard|Forgot/', { timeout: 30000 })
  await page.waitForTimeout(1200)
}

const SCREENS = {
  home: async () => {},
  cards: tab('Cards'),
  calendar: tab('Calendar'),
  notes: tab('Notes'),
  tutor: tab('Tutor'),
  settings: async (page, { desktop }) => {
    if (desktop) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    else await page.getByRole('button', { name: /^Settings$/ }).first().click()
    await page.waitForTimeout(700)
  },
  study: study('answering'),
  'study-graded': study('graded'),
}

const only = process.argv.slice(2)
const wanted = only.length ? only : Object.keys(SCREENS)

const browser = await chromium.launch()
for (const [tag, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]]) {
  for (const theme of ['dark', 'light']) {
    for (const name of wanted) {
      reseed()
      // Theme lives server-side: useSettings applies the stored value over whatever the boot
      // script read from localStorage, so seeding the row is the only way to get a light render.
      await fetch('http://127.0.0.1:8011/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      // Pinned to UTC so the browser's local day matches the backend's `today_utc()`. Without
      // it, running in MDT after 18:00 puts the app's "today" edge on one day and the load the
      // API reports for "today" on the next — a real defect (reported separately), but not one
      // these comparison shots should be showing.
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, timezoneId: 'UTC' })
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message))
      try {
        await page.addInitScript((t) => {
          localStorage.setItem('pipcards:theme', t)
          localStorage.setItem('pipcards:accent', 'oklch(0.7 0.145 40)')
        }, theme)
        await page.goto(APP, { waitUntil: 'networkidle' })
        await page.waitForTimeout(900)
        await SCREENS[name](page, { desktop: tag === 'desktop' })
        await page.evaluate(() => document.fonts.ready)
        const path = `${out}/${tag}-${theme}-${name}.png`
        await page.screenshot({ path })
        console.log(path, errs.length ? `  PAGEERROR: ${errs[0]}` : '')
      } catch (e) {
        console.error(`FAILED ${tag}-${theme}-${name}: ${e.message.split('\n')[0]}`)
      }
      await page.close()
    }
  }
}
await browser.close()
