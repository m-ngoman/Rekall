// The design has one hard rule about the accent: text sitting on an accent fill uses `.on-accent`
// (near-black, tinted toward the accent's hue) and is *never* white. This walks every screen in
// both themes and reports any accent-filled element whose text colour isn't that.
//
//   node design/handoff/check-on-accent.mjs
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
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
  await p.waitForTimeout(600)
}
const fromCards = (label) => async (p) => {
  await tab('Cards')(p)
  await p.getByRole('button', { name: new RegExp(label) }).first().click()
  await p.waitForTimeout(800)
}

const SCREENS = {
  home: async () => {},
  cards: tab('Cards'),
  calendar: tab('Calendar'),
  notes: tab('Notes'),
  tutor: tab('Tutor'),
  settings: async (p) => {
    await p.getByRole('button', { name: /^Settings$/ }).first().click()
    await p.waitForTimeout(600)
  },
  'write-cards': fromCards('Write your own'),
  import: fromCards('Import CSV'),
  generate: fromCards('Generate with AI'),
  'note-editor': async (p) => {
    await tab('Notes')(p)
    await p.getByRole('button', { name: /Add notes/ }).first().click()
    await p.waitForTimeout(900)
  },
  'exam-sheet': async (p) => {
    await tab('Calendar')(p)
    await p.getByRole('button', { name: /Add exam/ }).first().click()
    await p.waitForTimeout(700)
  },
  onboarding: async (p) => {
    await p.evaluate(async () => {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ onboarded: false }),
      })
    })
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
  },
}

const browser = await chromium.launch()
const findings = []

for (const theme of ['dark', 'light']) {
  for (const [name, drive] of Object.entries(SCREENS)) {
    reseed()
    await fetch(`${API}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme }),
    })
    const p = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' })
    try {
      await p.goto(APP, { waitUntil: 'networkidle' })
      await p.waitForTimeout(700)
      await drive(p)
      await p.waitForTimeout(300)
      const hits = await p.evaluate(() => {
        // getComputedStyle hands back `oklch(...)` verbatim for these, so any numeric comparison
        // on the raw string compares lightness against hue and matches nearly anything. Paint each
        // colour onto a 1x1 canvas instead and read the actual sRGB the user sees.
        const cv = document.createElement('canvas')
        cv.width = cv.height = 1
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        const toRGB = (css) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = '#010203'
          ctx.fillStyle = css
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          // fillStyle silently keeps its old value on an unparseable colour; that sentinel means
          // the browser could not resolve it and the result must not be trusted.
          if (d[0] === 1 && d[1] === 2 && d[2] === 3) return null
          return [d[0], d[1], d[2], d[3]]
        }

        const probe = document.createElement('div')
        document.body.appendChild(probe)
        probe.style.color = 'var(--accent)'
        const accent = toRGB(getComputedStyle(probe).color)
        probe.style.color = 'oklch(from var(--accent) 0.17 0.02 h)'
        const onAccent = toRGB(getComputedStyle(probe).color)
        probe.remove()
        if (!accent || !onAccent) return [{ text: 'COLOUR RESOLUTION FAILED', color: '', expected: '', cls: '' }]

        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

        const out = []
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el)
          const bg = toRGB(cs.backgroundColor)
          if (!bg || bg[3] < 200) continue
          if (dist(bg, accent) > 24) continue
          if (!el.textContent?.trim()) continue
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
          const fg = toRGB(cs.color)
          if (!fg) continue
          if (dist(fg, onAccent) > 40) {
            out.push({
              text: el.textContent.trim().slice(0, 34),
              color: `${cs.color} -> rgb(${fg.slice(0, 3).join(',')})`,
              expected: `rgb(${onAccent.slice(0, 3).join(',')})`,
              tooLight: lum(fg) > lum(onAccent) + 60,
              cls: String(el.className).slice(0, 70),
            })
          }
        }
        return out
      })
      for (const h of hits) findings.push({ theme, screen: name, ...h })
    } catch (e) {
      console.log(`  (skipped ${theme}/${name}: ${e.message.split('\n')[0]})`)
    }
    await p.close()
  }
}
await browser.close()

if (!findings.length) {
  console.log('\nNo accent-filled element has non-on-accent text. Rule holds everywhere checked.')
} else {
  console.log(`\n${findings.length} accent fills with the wrong text colour:\n`)
  for (const f of findings) {
    console.log(`  ${f.theme}/${f.screen}: "${f.text}"`)
    console.log(`      colour ${f.color}  expected ~${f.expected}${f.tooLight ? '   << far too light' : ''}`)
    console.log(`      ${f.cls}`)
  }
}
