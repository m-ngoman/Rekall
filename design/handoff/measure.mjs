// Measures the same design facts in the mock and in the real app, so fidelity gaps show up as
// numbers instead of impressions. Prints a table of every property that differs.
//
//   node design/handoff/measure.mjs
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const mocks = resolve(new URL('.', import.meta.url).pathname, 'design_handoff_rekall_countdown/mocks')
const APP = 'http://127.0.0.1:5199/'

/** Everything we read off one element. */
const PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color',
  'backgroundColor', 'borderRadius', 'borderTopWidth', 'borderTopColor',
  'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'gap',
]

const read = (el) => {
  if (!el) return null
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const out = { _w: Math.round(r.width), _h: Math.round(r.height) }
  for (const p of [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color',
    'backgroundColor', 'borderRadius', 'borderTopWidth', 'borderTopColor',
    'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'gap',
  ]) out[p] = cs[p]
  return out
}

/** Per-screen probes: a label -> a function returning the element, run in page context. */
const PROBES = {
  home: {
    'exam name': `[...document.querySelectorAll('*')].find(e => /^(Organic Chemistry II|Pharmacology)$/.test(e.textContent.trim()) && e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) >= 18)`,
    'countdown numeral': `[...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^\\d+$/.test(e.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) > 100)`,
    'days label': `[...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'days')`,
    'due numeral': `[...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^\\d+$/.test(e.textContent.trim()) && Math.abs(parseFloat(getComputedStyle(e).fontSize) - 32) < 3)`,
    'due label': `[...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'cards due today')`,
    'primary button': `[...document.querySelectorAll('button')].find(e => /^Start today's/.test(e.textContent.trim()))`,
    'exam row': `[...document.querySelectorAll('button')].find(e => /in \\d+ days$/.test(e.textContent.trim()))`,
    'decks heading': `[...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Decks')`,
    'deck tile': `[...document.querySelectorAll('*')].find(e => /cards$/.test(e.textContent.trim()) && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(getComputedStyle(e).borderRadius) > 8)`,
    'nav': `document.querySelector('nav')`,
  },
}

const browser = await chromium.launch()

async function measureMock(screen) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await page.goto(`file://${mocks}/Rekall.dc.html`)
  await page.waitForFunction(() => document.querySelectorAll('[data-screen-label]').length > 0, null, { timeout: 30000 })
  await page.evaluate(() => window.__dcSetProps(window.__dcRootName(), { theme: 'dark' }))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const out = {}
  for (const [label, expr] of Object.entries(PROBES[screen])) {
    out[label] = await page.evaluate(
      ([e, rd]) => {
        // Scope to the named artboard so probes don't match another screen's markup.
        const board = [...document.querySelectorAll('[data-screen-label]')].find(
          (b) => b.getAttribute('data-screen-label').toLowerCase() === 'home'
        )
        const orig = document.querySelectorAll.bind(document)
        document.querySelectorAll = (s) => board.querySelectorAll(s)
        let el = null
        try { el = eval(e) } catch {}
        document.querySelectorAll = orig
        return eval(`(${rd})`)(el)
      },
      [expr, read.toString()]
    )
  }
  await page.close()
  return out
}

async function measureApp(screen) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'UTC' })
  await page.addInitScript(() => {
    localStorage.setItem('pipcards:theme', 'dark')
    localStorage.setItem('pipcards:accent', 'oklch(0.7 0.145 40)')
  })
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => document.fonts.ready)
  const out = {}
  for (const [label, expr] of Object.entries(PROBES[screen])) {
    out[label] = await page.evaluate(
      ([e, rd]) => {
        let el = null
        try { el = eval(e) } catch {}
        return eval(`(${rd})`)(el)
      },
      [expr, read.toString()]
    )
  }
  await page.close()
  return out
}

const screen = 'home'
const [m, a] = [await measureMock(screen), await measureApp(screen)]
await browser.close()

for (const label of Object.keys(PROBES[screen])) {
  const mm = m[label]
  const aa = a[label]
  if (!mm || !aa) {
    console.log(`\n### ${label}: ${!mm ? 'NOT FOUND IN MOCK' : ''} ${!aa ? 'NOT FOUND IN APP' : ''}`)
    continue
  }
  const diffs = Object.keys(mm).filter((k) => String(mm[k]) !== String(aa[k]))
  if (!diffs.length) { console.log(`\n### ${label}: identical`); continue }
  console.log(`\n### ${label}`)
  for (const k of diffs) console.log(`  ${k.padEnd(18)} mock=${String(mm[k]).padEnd(28)} app=${aa[k]}`)
}
