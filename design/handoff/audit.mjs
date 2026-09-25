// Full-coverage sweep: every reachable screen at both viewports and both themes, checked for
// horizontal overflow, elements escaping the viewport, and JS errors — then screenshotted and
// tiled into contact sheets so a human can scan the lot.
//
// This exists because the mock comparison only covers the eight screens the design bundle drew.
// The type-scale and line-height changes are global, so the screens the bundle never mentioned
// (Write cards, Import, Generate, Onboarding, Admin, the exam sheet, the note editor) are exactly
// where a regression would go unnoticed. It is also the before/after check for a refactor: run it
// on two builds with fonts blocked and compare the screenshots pixel for pixel.
//
//   cd backend && DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture \
//     GRADER=stub TUTOR_PROVIDER=stub GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= OWNER_EMAIL=dev@rekall.study \
//     .venv/bin/uvicorn app.main:app --port 8011
//   cd frontend && npm run dev:fixture
//   node design/handoff/audit.mjs
//
// Options, all environment variables:
//   AUDIT_OUT=dir          where screenshots and audit.json go (default design/handoff/out/audit)
//   AUDIT_ONLY=a,b*,c      only these states; a trailing * matches a prefix ("tutor*")
//   AUDIT_BLOCK_FONTS=1    abort Google Fonts requests, so text renders in the fallback face and
//                          two runs are comparable pixel for pixel whatever the network does
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const out = resolve(process.env.AUDIT_OUT || resolve(new URL('.', import.meta.url).pathname, 'out/audit'))
mkdirSync(out, { recursive: true })

const APP = 'http://127.0.0.1:5199/'
const API = 'http://127.0.0.1:8011'
const ONLY = (process.env.AUDIT_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)
const BLOCK_FONTS = Boolean(process.env.AUDIT_BLOCK_FONTS)

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
/** Cards -> one of the three ways in. On a phone with a library they wait behind "Add cards". */
const fromCards = (label) => async (p) => {
  await tab('Cards')(p)
  const add = p.getByRole('button', { name: 'Add cards', exact: true })
  if (await add.isVisible()) await add.click()
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

/** Sends a typed tutor turn. With `stream` set, the reply is a canned SSE body instead of the
 * stub provider's, so states the stub never produces (an exam offer, a paywall) can be drawn. */
const tutorTurn = (text, stream) => async (p) => {
  if (stream) await p.route('**/api/tutor/sessions/*/text-turn', (route) => route.fulfill(stream))
  await tab('Tutor')(p)
  const box = p.getByPlaceholder(/message the tutor/i).first()
  await box.fill(text)
  await box.press('Enter')
}
const sse = (events) => ({
  status: 200,
  contentType: 'text/event-stream',
  body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
})

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
  // A day tapped on the calendar: its cards by deck, its exams, and adding one.
  'calendar-day': async (p) => {
    await tab('Calendar')(p)
    const tomorrow = new Date(Date.now() + 86_400_000)
    const spoken = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(tomorrow)
    await p.getByRole('button', { name: new RegExp(`^${spoken}`) }).first().click()
    await p.waitForTimeout(900)
  },
  'cards-add': async (p) => {
    await tab('Cards')(p)
    const add = p.getByRole('button', { name: 'Add cards', exact: true })
    if (await add.isVisible()) await add.click()
    await p.waitForTimeout(400)
  },
  'deck-editor': async (p) => {
    await tab('Cards')(p)
    await p.getByRole('button', { name: /^Edit Pharmacology/ }).click()
    await p.waitForTimeout(900)
  },
  'deck-editor-rename': async (p) => {
    await tab('Cards')(p)
    await p.getByRole('button', { name: /^Edit Pharmacology/ }).click()
    await p.getByRole('button', { name: /^Rename or delete/ }).click()
    await p.waitForTimeout(400)
  },
  'deck-editor-add': async (p) => {
    await tab('Cards')(p)
    await p.getByRole('button', { name: /^Edit Pharmacology/ }).click()
    await p.getByRole('button', { name: 'Add card', exact: true }).click()
    await p.waitForTimeout(400)
  },
  'generate-topic': async (p) => {
    await fromCards('Generate with AI')(p)
    await p.getByRole('button', { name: 'From a topic' }).click()
    await p.waitForTimeout(400)
  },
  // Statistics has nothing due in the fixture, so it opens on the offer to review ahead.
  'study-empty': async (p) => {
    await p.getByRole('button', { name: /Statistics/ }).last().click()
    await p.waitForTimeout(1200)
  },
  'study-ahead': async (p) => {
    await p.getByRole('button', { name: /Statistics/ }).last().click()
    await p.getByRole('button', { name: 'Review ahead' }).click()
    await p.waitForSelector('textarea', { timeout: 15000 })
    await p.waitForTimeout(600)
  },
  // A daily goal of one, met: Home says so and offers more rather than "come back tomorrow".
  'home-goal-met': async (p) => {
    await p.evaluate(async () => {
      const json = { 'content-type': 'application/json' }
      await fetch('/api/settings', { method: 'PATCH', headers: json, body: JSON.stringify({ daily_goal: 1 }) })
      const decks = await (await fetch('/api/decks')).json()
      const deck = decks.find((d) => d.due > 0)
      const { cards } = await (await fetch(`/api/decks/${deck.id}/study-queue`)).json()
      const res = await fetch(`/api/cards/${cards[0].id}/review`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ answer_input: '', input_mode: 'self_assessed', grade: 3 }),
      })
      await res.text()
    })
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(900)
  },
  'note-editor': async (p) => {
    await tab('Notes')(p)
    await p.getByRole('button', { name: /Add notes/ }).first().click()
    await p.waitForTimeout(1200)
  },
  'note-open': async (p) => {
    await tab('Notes')(p)
    await p.getByText('SN1 vs SN2 mechanisms').first().click()
    await p.waitForSelector('text=/Saved|SN1/', { timeout: 15000 })
    await p.waitForTimeout(1500)
  },
  'notes-search': async (p) => {
    await tab('Notes')(p)
    await p.getByPlaceholder(/search your notes/i).fill('carbocation')
    await p.waitForTimeout(1200)
  },
  // The stub tutor's reply ends in a plot, so this is the full log: prose, maths, the graph.
  'tutor-reply': async (p) => {
    await tutorTurn('Explain a velocity-time graph')(p)
    await p.waitForSelector('svg[aria-label^="Graph of"]', { timeout: 20000 })
    await p.waitForTimeout(3500)
  },
  'tutor-offer': async (p) => {
    await tutorTurn(
      'I have a biology test on Friday',
      sse([
        ['token', { text: 'Good luck with it. Want me to put it on your calendar?' }],
        ['suggest_exam', { name: 'Biology test', date: '2031-01-10' }],
        ['done', { transcript: 'I have a biology test on Friday', reply: 'Good luck with it. Want me to put it on your calendar?' }],
      ]),
    )(p)
    await p.waitForSelector('text=Add to calendar', { timeout: 15000 })
    await p.waitForTimeout(1500)
  },
  'tutor-paywall': async (p) => {
    await tutorTurn('Hello', {
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ detail: "Rekall AI isn't active on this account." }),
    })(p)
    await p.waitForSelector('text=See plans', { timeout: 15000 })
    await p.waitForTimeout(500)
  },
  plans: async (p) => {
    await p.goto(`${APP}plans`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
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

const wanted = (name) =>
  !ONLY.length || ONLY.some((pat) => (pat.endsWith('*') ? name.startsWith(pat.slice(0, -1)) : name === pat))

const VIEWPORTS = [
  ['mobile', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
]

const results = []
const browser = await chromium.launch()

for (const [tag, viewport] of VIEWPORTS) {
  for (const theme of ['dark', 'light']) {
    for (const [name, drive] of Object.entries(SCREENS)) {
      if (!wanted(name)) continue
      reseed()
      // Once more on a dropped socket: the reseed can outlast uvicorn's five-second keep-alive,
      // and fetch won't retry a PATCH on the connection the server has since closed.
      const setTheme = () =>
        fetch(`${API}/api/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ theme }),
        })
      await setTheme().catch(setTheme)
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, timezoneId: 'UTC' })
      if (BLOCK_FONTS) await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
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
          // inset-positioned and reports oddly — and so is anything inside a horizontal scroller
          // (the editor's toolbar), which is meant to run past the edge and is clipped where it
          // does. The scroller itself is still checked.
          const inScroller = (el) => {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (getComputedStyle(a).overflowX !== 'visible') return true
            }
            return false
          }
          const escapees = []
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el)
            if (cs.position === 'fixed' || cs.position === 'sticky') continue
            if (cs.visibility === 'hidden' || cs.display === 'none') continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            if ((r.right > vw + 4 || r.left < -4) && !inScroller(el)) {
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

        // Animations off and the caret hidden, so two runs of the same build are identical.
        await page.screenshot({ path: `${out}/${id}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
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
