// Full-coverage sweep: every reachable screen at both viewports and both themes, checked for
// horizontal overflow, elements escaping the viewport, and JS errors — then screenshotted and
// tiled into contact sheets so a human can scan the lot.
//
// This exists because the mock comparison only covers the eight screens the design bundle drew.
// The type-scale and line-height changes are global, so the screens the bundle never mentioned
// (Write cards, Import, Generate, Onboarding, Admin, the exam sheet, the note editor) are exactly
// where a regression would go unnoticed.
//
//   node design/handoff/audit.mjs
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const out = resolve(new URL('.', import.meta.url).pathname, 'out/audit')
mkdirSync(out, { recursive: true })

const APP = 'http://127.0.0.1:5199/'
const API = 'http://127.0.0.1:8011'

function reseed() {
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
    env: { ...process.env, DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture' },
    stdio: 'ignore',
  })
}

const tab = (name) => async (p) => {
  await p.getByRole('button', { name, exact: true }).first().click()
  await p.waitForTimeout(700)
}
const settings = async (p) => {
  await p.getByRole('button', { name: /^Settings$/ }).first().click()
  await p.waitForTimeout(700)
}
/** Cards -> one of the three action rows. */
const fromCards = (label) => async (p) => {
  await tab('Cards')(p)
  await p.getByRole('button', { name: new RegExp(label) }).first().click()
  await p.waitForTimeout(900)
}
const study = (graded) => async (p) => {
  await p.getByRole('button', { name: /Organic Chemistry II/ }).last().click()
  await p.waitForSelector('textarea', { timeout: 15000 })
  await p.waitForTimeout(400)
  if (!graded) {
    await p.locator('textarea').fill('The leaving group goes first, so you get a planar carbocation.')
    return
  }
  await p.locator('textarea').fill(
    'The leaving group departs first, giving a planar carbocation intermediate. The nucleophile attacks either face with equal probability, so stereochemistry is lost.'
  )
  await p.getByRole('button', { name: /Check my answer/ }).click()
  await p.waitForSelector('text=/Back in/', { timeout: 30000 })
  await p.waitForTimeout(1200)
}

const SCREENS = {
  home: async () => {},
  cards: tab('Cards'),
  calendar: tab('Calendar'),
  notes: tab('Notes'),
  tutor: tab('Tutor'),
  settings,
  study: study(false),
  'study-graded': study(true),
  // Screens the design bundle never covered — the ones most at risk from a global CSS change.
  'write-cards': fromCards('Write your own'),
  import: fromCards('Import CSV'),
  generate: fromCards('Generate with AI'),
  'exam-sheet': async (p) => {
    await tab('Calendar')(p)
    await p.getByRole('button', { name: /Add exam/ }).first().click()
    await p.waitForTimeout(800)
  },
  'note-editor': async (p) => {
    await tab('Notes')(p)
    await p.getByRole('button', { name: /Add notes/ }).first().click()
    await p.waitForTimeout(1200)
  },
  admin: async (p) => {
    await settings(p)
    const btn = p.getByRole('button', { name: /Usage dashboard/ })
    if (await btn.count()) {
      await btn.first().click()
      await p.waitForTimeout(1200)
    } else {
      throw new Error('owner-only entry point not present (OWNER_EMAIL unset on the fixture backend)')
    }
  },
  onboarding: async (p) => {
    // Reached by clearing the flag and reloading, since it only shows on a first run.
    await p.evaluate(async () => {
      // Relative, through the dev server's /api proxy: an absolute call to the fixture backend
      // would be cross-origin from the page and get blocked.
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ onboarded: false }),
      })
    })
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1000)
  },
}

const VIEWPORTS = [
  ['mobile', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
]

const results = []
const browser = await chromium.launch()

for (const [tag, viewport] of VIEWPORTS) {
  for (const theme of ['dark', 'light']) {
    for (const [name, drive] of Object.entries(SCREENS)) {
      reseed()
      await fetch(`${API}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, timezoneId: 'UTC' })
      const errs = []
      page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
      page.on('response', (r) => {
        if (r.status() >= 500) errs.push(`${r.status()} ${r.url()}`)
      })
      const id = `${tag}-${theme}-${name}`
      try {
        await page.goto(APP, { waitUntil: 'networkidle' })
        await page.waitForTimeout(800)
        await drive(page)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)

        const probe = await page.evaluate(() => {
          const vw = window.innerWidth
          const de = document.documentElement
          // Elements poking meaningfully past the right edge. A few px is antialiasing; 4+ is a
          // layout that doesn't fit. Fixed/sticky chrome is excluded — the nav is intentionally
          // inset-positioned and reports oddly.
          const escapees = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            if (cs.position === 'fixed' || cs.position === 'sticky') continue
            if (cs.visibility === 'hidden' || cs.display === 'none') continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if (r.right > vw + 4 || r.left < -4) {
              escapees.push({
                tag: el.tagName.toLowerCase(),
                cls: String(el.className).slice(0, 60),
                left: Math.round(r.left),
                right: Math.round(r.right),
              })
            }
          }
          // Text clipped by a fixed-height ancestor.
          const clipped = []
          for (const el of document.querySelectorAll('body *')) {
            if (el.children.length) continue
            if (!el.textContent?.trim()) continue
            const cs2 = getComputedStyle(el)
            // Ellipsis truncation is intentional here (calendar exam labels, note titles), so
            // only count text that is being cut off with no visual indication that it was.
            if (cs2.textOverflow === 'ellipsis') continue
            if (el.scrollWidth > el.clientWidth + 2 && cs2.overflow !== 'visible') {
              clipped.push({ text: el.textContent.trim().slice(0, 40), by: el.scrollWidth - el.clientWidth })
            }
          }
          return {
            scrollWidth: de.scrollWidth,
            innerWidth: vw,
            hOverflow: de.scrollWidth > vw + 1,
            escapees: escapees.slice(0, 6),
            clipped: clipped.slice(0, 6),
            bodyText: (document.body.innerText || '').trim().length,
          }
        })

        await page.screenshot({ path: `${out}/${id}.png`, fullPage: true })
        results.push({ id, ok: true, errs, ...probe })
      } catch (e) {
        results.push({ id, ok: false, errs, error: e.message.split('\n')[0] })
      }
      await page.close()
    }
  }
}
await browser.close()

writeFileSync(`${out}/audit.json`, JSON.stringify(results, null, 2))

let bad = 0
for (const r of results) {
  const flags = []
  if (!r.ok) flags.push(`UNREACHABLE (${r.error})`)
  if (r.errs?.length) flags.push(`ERRORS: ${r.errs[0]}`)
  if (r.hOverflow) flags.push(`H-OVERFLOW ${r.scrollWidth}>${r.innerWidth}`)
  if (r.escapees?.length) flags.push(`ESCAPES: ${r.escapees.map((e) => `${e.tag}.${e.cls.split(' ')[0]}@${e.left}-${e.right}`).join(', ')}`)
  if (r.clipped?.length) flags.push(`CLIPPED: ${r.clipped.map((c) => `"${c.text}"+${c.by}px`).join(', ')}`)
  if (r.ok && r.bodyText === 0) flags.push('EMPTY PAGE')
  if (flags.length) {
    bad++
    console.log(`\n✗ ${r.id}`)
    for (const f of flags) console.log(`    ${f}`)
  }
}
console.log(`\n${results.length} states checked, ${bad} flagged, ${results.length - bad} clean`)
