// The design has one hard rule about the accent: text sitting on an accent fill uses `.on-accent`
// (near-black, tinted toward the accent's hue) and is *never* white. This walks every screen in
// both themes and reports any accent-filled element whose text colour isn't that — and, since
// the light theme's fills were lightened so that rule could pass AA at any size, any whose text
// measures under WCAG AA against its fill: 4.5:1, or 3:1 for large text (24px, or 18.66px bold)
// and for an icon with no text. A control that is disabled until something is typed ("Add card",
// "Generate flashcards") is measured as it will be once enabled: opacity is the only thing that
// changes, and the colours read here don't include it. VERBOSE=1 lists every control measured.
//
//   node design/handoff/check-on-accent.mjs     (fixture servers running; see seed_fixture.py)
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
// On a phone with a library the ways in wait behind "Add cards".
const fromCards = (label) => async (p) => {
  await tab('Cards')(p)
  const add = p.getByRole('button', { name: 'Add cards', exact: true })
  if (await add.isVisible()) await add.click()
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
  // The compact fills: the memory panel's 12px "Save", behind its Edit, and the plans screen's
  // 14px buttons.
  'tutor-memory': async (p) => {
    await tab('Tutor')(p)
    await p.getByRole('button', { name: /^Tutor memory/ }).click()
    await p.waitForTimeout(500)
    await p.getByRole('button', { name: /^(Edit|Write something)$/ }).click()
    await p.waitForTimeout(300)
  },
  plans: async (p) => {
    await p.getByRole('button', { name: /^Settings$/ }).first().click()
    await p.waitForTimeout(600)
    await p.getByRole('button', { name: 'Plans' }).click()
    await p.waitForTimeout(900)
  },
  // A deck with nothing due, where "Review ahead" is the button.
  'study-empty': async (p) => {
    await p.getByRole('button', { name: /Statistics/ }).last().click()
    await p.waitForTimeout(1200)
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
const measured = []

for (const theme of ['dark', 'light']) {
  for (const [name, drive] of Object.entries(SCREENS)) {
    reseed()
    // Once more on a dropped socket: the reseed can outlast uvicorn's five-second keep-alive, and
    // fetch won't retry a PATCH on the connection the server has since closed.
    const setTheme = () =>
      fetch(`${API}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
    await setTheme().catch(setTheme)
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
        probe.style.color = ''
        // The action treatment's own fill and text, as a real .on-accent element resolves them.
        probe.className = 'on-accent'
        const fill = toRGB(getComputedStyle(probe).backgroundColor)
        const onAccent = toRGB(getComputedStyle(probe).color)
        probe.remove()
        if (!accent || !fill || !onAccent) return [{ text: 'COLOUR RESOLUTION FAILED', color: '', expected: '', cls: '' }]

        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        // WCAG relative luminance and contrast, from 8-bit sRGB.
        const rel = (c) => {
          const [r, g, b] = c.slice(0, 3).map((v) => {
            const s = v / 255
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const contrast = (a, b) => {
          const [hi, lo] = [rel(a), rel(b)].sort((x, y) => y - x)
          return (hi + 0.05) / (lo + 0.05)
        }

        const out = []
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el)
          const bg = toRGB(cs.backgroundColor)
          if (!bg || bg[3] < 200) continue
          if (dist(bg, accent) > 24 && dist(bg, fill) > 24 && !el.classList.contains('on-accent')) continue
          if (cs.visibility === 'hidden' || el.getClientRects().length === 0) continue
          const fg = toRGB(cs.color)
          if (!fg) continue
          const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          const hasIcon = !!el.querySelector('svg')
          if (!hasText && !hasIcon) continue
          const size = parseFloat(cs.fontSize)
          const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
          const needed = hasText && !large ? 4.5 : 3
          const ratio = contrast(fg, bg)
          const label = (el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || 'icon').slice(0, 34)
          if (hasText && dist(fg, onAccent) > 40) {
            out.push({
              text: label,
              color: `${cs.color} -> rgb(${fg.slice(0, 3).join(',')})`,
              expected: `rgb(${onAccent.slice(0, 3).join(',')})`,
              tooLight: lum(fg) > lum(onAccent) + 60,
              cls: String(el.className).slice(0, 70),
            })
          }
          out.push({ measured: true, text: label, ratio, needed, size, pass: ratio >= needed })
        }
        return out
      })
      for (const h of hits) {
        if (!h.measured) findings.push({ theme, screen: name, ...h })
        else measured.push({ theme, screen: name, ...h })
      }
    } catch (e) {
      console.log(`  (skipped ${theme}/${name}: ${e.message.split('\n')[0]})`)
    }
    await p.close()
  }
}
await browser.close()

const failing = measured.filter((m) => !m.pass)
for (const theme of ['dark', 'light']) {
  const ms = measured.filter((m) => m.theme === theme)
  if (!ms.length) continue
  const worst = ms.reduce((a, b) => (a.ratio <= b.ratio ? a : b))
  console.log(`${theme}: ${ms.length} accent-filled controls measured, lowest ${worst.ratio.toFixed(2)}:1 ("${worst.text}", ${worst.screen})`)
}
if (process.env.VERBOSE) {
  for (const m of measured) console.log(`  ${m.theme}/${m.screen}: "${m.text}" ${m.ratio.toFixed(2)}:1 at ${m.size}px (needs ${m.needed})`)
}
if (failing.length) {
  console.log(`\n${failing.length} accent-filled controls under AA:\n`)
  for (const f of failing) console.log(`  ${f.theme}/${f.screen}: "${f.text}" ${f.ratio.toFixed(2)}:1 at ${f.size}px, needs ${f.needed}:1`)
}

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
process.exit(findings.length || failing.length ? 1 : 0)
