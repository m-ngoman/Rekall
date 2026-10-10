// Screenshots of the real app in each state the video draws, for scripts/fidelity.mjs to compare
// the replicas against. The app is the real frontend (Vite, `npm run dev:fixture`, started here if
// it isn't already up); only its backend is replaced — every /api call is answered from
// src/data/demo.json by scripts/lib/mock-api.mjs — and the clock is fixed on the demo's today.
//
//   npm run reference [-- --only home,calendar]
//
// Needs the frontend's dependencies (cd frontend && npm ci). Chromium is Playwright's; on this
// machine it is pre-installed under PLAYWRIGHT_BROWSERS_PATH.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { VIEWPORTS } from './cuts.mjs'
import { demo, respond } from './lib/mock-api.mjs'

const root = path.resolve(import.meta.dirname, '..')
const frontend = path.resolve(root, '../../frontend')
const out = path.join(root, 'out/reference')
fs.mkdirSync(out, { recursive: true })
const APP = 'http://127.0.0.1:5199'
const { values: opts } = parseArgs({ options: { only: { type: 'string' }, anchors: { type: 'boolean', default: false } } })
const only = opts.only?.split(',')

// At the scale the video draws each replica, so a screenshot and a Fidelity still are the same size.
const LAYOUTS = Object.fromEntries(
  Object.entries(VIEWPORTS).map(([layout, v]) => [layout, { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale }]),
)

const up = async () => fetch(APP).then((r) => r.ok, () => false)
let server = null
if (!(await up())) {
  server = spawn('npm', ['run', 'dev:fixture'], { cwd: frontend, stdio: 'ignore', detached: true })
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500))
  if (!(await up())) throw new Error('The fixture dev server did not come up on :5199')
}

const isDesktop = (layout) => layout === 'landscape'

// The app asks Google for Nunito and Barlow Condensed. This machine's Chromium can't verify the
// network proxy's certificate for fonts.googleapis.com, and the reference must not fall back to
// system fonts — so the stylesheet is answered here, pointing at the same two files the video
// loads (src/fonts.ts), which is also what makes the comparison about layout and not font builds.
const fontFile = (pkg, file) => fs.readFileSync(path.join(root, 'node_modules', pkg, 'files', file))
const FONTS = {
  '/local/nunito.woff2': fontFile('@fontsource-variable/nunito', 'nunito-latin-wght-normal.woff2'),
  '/local/barlow-condensed-600.woff2': fontFile('@fontsource/barlow-condensed', 'barlow-condensed-latin-600-normal.woff2'),
}
const FONT_CSS = ['500', '600', '700']
  .map((w) => `@font-face{font-family:'Nunito';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/local/nunito.woff2) format('woff2')}`)
  .concat(`@font-face{font-family:'Barlow Condensed';font-style:normal;font-weight:600;font-display:swap;src:url(https://fonts.gstatic.com/local/barlow-condensed-600.woff2) format('woff2')}`)
  .join('\n')

async function mockNetwork(page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }))
  await page.route('https://fonts.gstatic.com/**', (route) => {
    const file = FONTS[new URL(route.request().url()).pathname]
    return file ? route.fulfill({ status: 200, contentType: 'font/woff2', body: file }) : route.abort()
  })
  // Only the backend's paths: Vite serves the app's own source under /src/api/, which must pass.
  await page.route(
    (url) => url.origin === APP && url.pathname.startsWith('/api/'),
    (route) => {
      const req = route.request()
      const r = respond(req.method(), req.url())
      return r ? route.fulfill(r) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"not in the demo"}' })
    },
  )
}

/** Each state: where to go, and what to do there. */
const STATES = {
  'study-answering': async (page) => {
    await page.goto(`${APP}/study/${demo.study.deckId}`)
    await page.locator('textarea').fill(demo.study.typed)
  },
  'study-graded': async (page) => {
    await page.goto(`${APP}/study/${demo.study.deckId}`)
    await page.locator('textarea').fill(demo.study.typed)
    await page.getByRole('button', { name: 'Check my answer' }).click()
    await page.getByText('Back in 7 days').waitFor()
    await page.getByText('Save for tutor').waitFor()
  },
  home: async (page) => {
    await page.goto(APP)
    await page.getByText('cards due today').waitFor()
  },
  calendar: async (page) => {
    await page.goto(`${APP}/calendar`)
    await page.getByText(/cards before it/).filter({ visible: true }).first().waitFor()
  },
  'calendar-next': async (page) => {
    await page.goto(`${APP}/calendar`)
    await page.getByText(/cards before it/).filter({ visible: true }).first().waitFor()
    await page.getByRole('button', { name: 'Next month' }).click()
    await page.getByText('November 2026').waitFor()
  },
  tutor: async (page) => {
    await page.goto(`${APP}/tutor`)
    await page.getByText('What are we working on?').waitFor()
    await page.getByText(demo.tutor.voice, { exact: true }).waitFor()
  },
  'tutor-log': async (page) => {
    await page.goto(`${APP}/tutor`)
    await page.getByText(demo.tutor.voice, { exact: true }).waitFor()
    await page.getByPlaceholder('Message the tutor').fill(demo.tutor.question)
    await page.getByPlaceholder('Message the tutor').press('Enter')
    await page.getByText(demo.tutor.reply).waitFor()
    await page.waitForTimeout(1200) // the log's own smooth scroll to the newest line
  },
  'generate-form': async (page, layout) => {
    await page.goto(`${APP}/cards`)
    if (!isDesktop(layout)) await page.getByRole('button', { name: 'Add cards' }).click()
    await page.getByRole('button', { name: /Generate with AI/ }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: /Use saved notes/ }).click()
    await page.getByRole('checkbox', { name: new RegExp(demo.generate.note.title) }).click()
    await page.getByRole('button', { name: 'Use 1 note' }).click()
    await page.locator('select').selectOption(demo.generate.deckId)
  },
  'generate-result': async (page, layout) => {
    await STATES['generate-form'](page, layout)
    await page.getByRole('button', { name: 'Generate flashcards' }).click()
    await page.getByText(/^Added to /).waitFor()
  },
}

// Greyscale text, as the replicas are drawn: Chrome turns subpixel (LCD) anti-aliasing off on the
// transformed layer a replica sits in, and a phone's screen never uses it either.
/** The controls and blocks the video's camera frames and its pointer presses, per state: their
 * boxes in the real app, in CSS pixels of the viewport, written to src/data/anchors.json with
 * --anchors. The scenes aim at these rather than at guessed coordinates. */
const ANCHORS = {
  'study-answering': (page) => ({
    check: page.getByRole('button', { name: 'Check my answer' }),
    field: page.locator('textarea'),
    question: page.getByText(demo.study.card.question),
  }),
  'study-graded': (page) => ({
    score: page.getByText('Back in 7 days').locator('xpath=../..'),
    explanation: page.getByText(demo.study.result.explanation),
    save: page.getByRole('button', { name: 'Save for tutor' }),
    next: page.getByRole('button', { name: /Next card/ }),
    question: page.getByText(demo.study.card.question),
  }),
  home: (page) => ({
    examName: page.getByRole('button', { name: demo.exams[0].name, exact: true }).first(),
    numeral: page.getByLabel(/days until/),
    start: page.getByRole('button', { name: /^Start / }),
  }),
  calendar: (page) => ({
    numeral: page.locator('.numeral').filter({ visible: true }).first(),
    nextMonth: page.getByRole('button', { name: 'Next month' }),
    grid: page.getByText('Cards per day,').locator('xpath=../..'),
  }),
  'calendar-next': (page) => ({
    grid: page.getByText('Cards per day,').locator('xpath=../..'),
    // The exam's day cell. Its accessible name is how the calendar reads it out: "Tuesday, November 10, …".
    examDay: page.getByRole('button', { name: /November 10/ }).first(),
  }),
  tutor: (page) => ({
    mic: page.getByTitle('Start voice mode'),
    starters: page.getByText('Quiz me on my weak cards'),
  }),
  'generate-form': (page) => ({
    generate: page.getByRole('button', { name: 'Generate flashcards' }),
    note: page.getByText(demo.generate.note.title, { exact: true }),
  }),
  'generate-result': (page) => ({
    dropped: page.getByText('Dropped during verification'),
    title: page.getByText(/^Added to /),
  }),
}
const anchors = {}

const browser = await chromium.launch({ args: ['--disable-lcd-text'] })
try {
  for (const [layout, device] of Object.entries(LAYOUTS)) {
    for (const [id, act] of Object.entries(STATES)) {
      if (only && !only.includes(id)) continue
      const context = await browser.newContext({ ...device, timezoneId: 'UTC', locale: 'en-US', reducedMotion: 'no-preference' })
      await context.addInitScript(() => {
        localStorage.setItem('pipcards:theme', 'dark')
        localStorage.setItem('pipcards:accent', 'oklch(0.7 0.145 40)')
      })
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date(`${demo.today}T12:00:00Z`))
      await mockNetwork(page)
      await act(page, layout)
      await page.mouse.move(0, 0) // no hover state left behind by the last click
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      const file = path.join(out, `${id}-${layout}.png`)
      await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' })
      const scrollY = await page.evaluate(() => window.scrollY)
      console.log(`  ${path.relative(root, file)}${scrollY ? `  (scrolled ${scrollY}px)` : ''}`)
      if (opts.anchors && ANCHORS[id]) {
        const boxes = {}
        for (const [name, locator] of Object.entries(ANCHORS[id](page))) {
          const b = await locator.boundingBox({ timeout: 3000 }).catch(() => null)
          if (!b) console.log(`    (no ${name} in ${id})`)
          if (b) boxes[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
        }
        ;(anchors[layout] ??= {})[id] = { scrollY, ...boxes }
      }
      await context.close()
    }
  }
  if (opts.anchors) {
    const file = path.join(root, 'src/data/anchors.json')
    fs.writeFileSync(file, JSON.stringify(anchors, null, 2) + '\n')
    console.log(`wrote ${path.relative(root, file)}`)
  }
} finally {
  await browser.close()
  if (server) process.kill(-server.pid)
}
