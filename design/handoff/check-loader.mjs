// The loading mark (NodeLoader) at every wait it covers, each held open by delaying its response.
//
//   - A load quicker than 300ms shows nothing: no mark that lived less than that was ever visible.
//   - App start, Home and the screens that load a list show the mark, named, after 300ms. Home
//     keeps the countdown's height while it waits.
//   - The tutor's reply and a grade show it at once, in a box one line tall; the dots and the
//     caret are gone.
//   - Generating cards and reading notes show it over the inputs with the stage written under it,
//     and the button doesn't move.
//   - The nodes float through each other in three dimensions: a nearer node is drawn larger,
//     brighter and over the others, nodes cross, and every link stays on its two nodes. Reduced
//     motion holds them still.
//   - It is the student's accent, like every drawing of the logo in the app.
//
// Fixture setup as in check-fixes.mjs. Screenshots go to design/handoff/out/loader/, phone and
// desktop, dark and light.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const APP = 'http://127.0.0.1:5199/'
const API = 'http://127.0.0.1:8011'
const OUT = `${repo}/design/handoff/out/loader`
mkdirSync(OUT, { recursive: true })

const FIXTURE = { ...process.env, DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture' }
const reseed = () =>
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], { env: FIXTURE, stdio: 'ignore' })

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  (${detail})`}`)
}
const call = (path, init) => fetch(`${API}${path}`, init).catch(() => fetch(`${API}${path}`, init))
const get = async (path) => (await call(path)).json()
const send = (path, method, body) =>
  call(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
const browser = await chromium.launch()
/** The float's own numbers (lib/loader), from the module as the fixture's dev server serves it:
 * where each node rests and its radius there, its radius at rest depth, the bright node, and the
 * pairs a link can join, in the order the mark draws them. */
const FLOAT = await (async () => {
  const page = await browser.newPage()
  await page.goto(APP, { waitUntil: 'commit' })
  const float = await page.evaluate(async () => {
    const m = await import('/src/lib/loader.ts')
    return {
      rest: m.LOADER_REST.map((n) => [n.x, n.y]),
      restR: m.LOADER_REST.map((n) => n.r),
      baseR: m.LOADER_NODES.map((n) => n.r),
      bright: m.BRIGHT,
      pairs: m.PAIRS,
    }
  })
  await page.close()
  return float
})()
const { rest: REST, restR: REST_R, baseR: BASE_R, bright: BRIGHT, pairs: PAIRS } = FLOAT
const NODES = BASE_R.map((_, i) => i)
const errs = []
/** Runs in every page: each mark, from the frame it mounts, with how it looked each frame of its
 * first two seconds and the most opaque it ever got. Asking Playwright after the fact can't say
 * what a mark looked like at 100ms: its polling backs off, and can notice a new element late. */
function recordMarks() {
  const born = new WeakMap()
  window.__marks = []
  const tick = (now) => {
    for (const el of document.querySelectorAll('.node-loader')) {
      if (!born.has(el)) {
        const entry = { label: el.textContent, born: now, last: now, peak: 0, frames: [] }
        born.set(el, entry)
        window.__marks.push(entry)
      }
      const entry = born.get(el)
      const s = getComputedStyle(el)
      const opacity = s.visibility === 'visible' ? Number(s.opacity) : 0
      entry.last = now
      entry.peak = Math.max(entry.peak, opacity)
      if (now - entry.born < 2000) entry.frames.push([now - entry.born, opacity])
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
const fresh = async ({ viewport = PHONE, reducedMotion = 'no-preference' } = {}) => {
  const page = await browser.newPage({ viewport, timezoneId: 'UTC', reducedMotion, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errs.push(e.message))
  // Fonts come from Google, which a sandboxed browser may not reach; fail them fast.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  await page.addInitScript(recordMarks)
  return page
}
/** Whether the mark labelled `label` stayed unseen for its first 250ms and was fully shown by 550. */
const appearedLate = async (page, label) => {
  const m = (await page.evaluate(() => window.__marks)).find((x) => x.label === label)
  if (!m) return { ok: false, detail: 'never mounted' }
  const early = m.frames.filter(([age]) => age < 250)
  const late = m.frames.filter(([age]) => age > 550)
  const ok = early.length > 0 && early.every(([, o]) => o === 0) && late.some(([, o]) => o >= 0.95)
  return { ok, detail: JSON.stringify(m.frames.filter((_, i) => i % 6 === 0).map(([a, o]) => [Math.round(a), o])) }
}
/** Holds matching requests for `ms` before letting them through, so the wait stays open. */
const hold = (page, pattern, ms, method = 'GET') =>
  page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.fallback()
    await sleep(ms)
    await route.continue().catch(() => {})
  })
/** The mark whose label reads `label`. Named by its content, since a status takes no name from it. */
const mark = (page, label) => page.locator('.node-loader', { hasText: label })
const look = (loc) =>
  loc.first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { visibility: s.visibility, opacity: Number(s.opacity) }
  })
const seen = async (loc) => {
  const s = await look(loc).catch(() => null)
  return !!s && s.visibility === 'visible' && s.opacity > 0.95
}
/** The mark as drawn right now, in viewBox units: each node's centre, radius and opacity by its
 * own index, the order the nodes are painted in (the loop moves the nearest to the end), and the
 * edges' ends. */
const geometry = (loc) =>
  loc.first().evaluate((el) => {
    const painted = [...el.querySelectorAll('circle')]
    const byNode = [...painted].sort((a, b) => Number(a.dataset.node) - Number(b.dataset.node))
    return {
      nodes: byNode.map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]),
      radii: byNode.map((c) => Number(c.getAttribute('r'))),
      opacity: byNode.map((c) => Number(c.getAttribute('fill-opacity') ?? 1)),
      painted: painted.map((c) => Number(c.dataset.node)),
      links: [...el.querySelectorAll('line')].map((l) => ({
        a: Number(l.dataset.a),
        b: Number(l.dataset.b),
        ends: ['x1', 'y1', 'x2', 'y2'].map((a) => Number(l.getAttribute(a))),
        opacity: Number(l.getAttribute('stroke-opacity')),
      })),
    }
  })
/** One line per pair, in the float's order, each ending on its two nodes' centres. */
const attached = (g) =>
  g.links.length === PAIRS.length &&
  g.links.every(({ a, b, ends }, i) => a === PAIRS[i][0] && b === PAIRS[i][1] && near(ends.slice(0, 2), g.nodes[a]) && near(ends.slice(2), g.nodes[b]))
/** Where an element sits on the page, not the viewport: a click scrolls what it clicks into view. */
const pageBox = (loc) =>
  loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { y: r.top + window.scrollY, height: r.height }
  })
/** On a phone with a library, the ways to add cards wait behind "Add cards"; on a desktop they're out. */
const openGenerate = async (page) => {
  const add = page.getByRole('button', { name: 'Add cards', exact: true })
  if (await add.isVisible()) await add.click()
  await page.getByRole('button', { name: /Generate with AI/ }).click()
}
const near = (a, b, tolerance = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` })

reseed()
const decks = await get('/api/decks')
const organic = decks.find((d) => d.name === 'Organic Chemistry II')

async function pass(theme) {
  const dark = theme === 'dark'
  await send('/api/settings', 'PATCH', { theme })

  // --- App start ------------------------------------------------------------------------------------
  if (dark) {
    const page = await fresh()
    await hold(page, '**/api/auth/me', 1500)
    await page.goto(APP, { waitUntil: 'commit' })
    const boot = mark(page, 'Loading Rekall')
    await boot.waitFor({ state: 'attached', timeout: 10000 })
    await sleep(700)
    const box = await boot.locator('svg').boundingBox()
    const late = await appearedLate(page, 'Loading Rekall')
    check('app start: nothing for the first 300ms, then the mark', late.ok, late.detail)
    check(
      'centred on the page',
      (await seen(boot)) && Math.abs(box.x + box.width / 2 - PHONE.width / 2) < 2 && Math.abs(box.y + box.height / 2 - PHONE.height / 2) < 2,
      JSON.stringify(box),
    )
    await shot(page, 'phone-dark-boot')
    const gone = await boot.waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false)
    check('and gone once signed in', gone)
    await page.close()
  }

  // --- Home ------------------------------------------------------------------------------------------
  for (const [viewport, height, tag] of [
    [PHONE, 268, 'phone'],
    [DESKTOP, 400, 'desktop'],
  ]) {
    const page = await fresh({ viewport })
    await hold(page, '**/api/dashboard', 1500)
    await page.goto(APP, { waitUntil: 'commit' })
    const loader = mark(page, 'Loading your cards')
    await loader.waitFor({ state: 'attached', timeout: 10000 })
    const block = page.locator('[aria-busy="true"]').first()
    const before = (await block.boundingBox())?.height
    await sleep(700)
    const after = (await block.boundingBox())?.height
    if (dark) {
      const late = await appearedLate(page, 'Loading your cards')
      check(`home (${tag}): the countdown's height is kept, the mark in it after 300ms`, before === height && after === height && late.ok, `${before} / ${after} ${late.detail}`)
    }
    await shot(page, `${tag}-${theme}-home`)
    await page.close()
  }

  // --- The tutor thinking ------------------------------------------------------------------------------
  for (const [viewport, tag] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ]) {
    const page = await fresh({ viewport })
    await page.goto(APP + 'tutor', { waitUntil: 'networkidle' })
    await hold(page, '**/text-turn', 2000, 'POST')
    await page.getByPlaceholder(/Message/).first().fill('What does a beta blocker block?')
    await page.keyboard.press('Enter')
    const thinking = mark(page, 'Thinking')
    await thinking.waitFor({ state: 'attached', timeout: 5000 })
    await sleep(350)
    const row = await thinking.evaluate((el) => el.parentElement.getBoundingClientRect().height)
    if (dark && tag === 'phone') {
      check('tutor: the mark while it thinks, at once, in a row one line tall', (await seen(thinking)) && Math.abs(row - 24.375) < 0.6, `${row}`)
      check('and the dots are gone', (await page.getByText('•••').count()) === 0)
      // Floating from the start: every node moves, and the links stay on them.
      const a = await geometry(thinking)
      await sleep(600)
      const b = await geometry(thinking)
      const moved = NODES.every((i) => !near(a.nodes[i], b.nodes[i], 0.2))
      const linked = b.links.filter((l) => l.opacity > 0.1).length
      check('the nodes float, a few of them linked, the links staying on them', moved && linked >= 3 && attached(a) && attached(b), JSON.stringify(b.nodes))
    }
    await shot(page, `${tag}-${theme}-tutor`)
    const gone = await thinking.waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false)
    if (dark && tag === 'phone') check('and gone when the first words land', gone)
    await page.close()
  }

  // --- Grading an answer --------------------------------------------------------------------------------
  for (const [viewport, tag] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ]) {
    const page = await fresh({ viewport })
    await page.goto(`${APP}study/${organic.id}`, { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Type your answer').fill('The carbocation forms first, then the nucleophile attacks.')
    await hold(page, '**/api/cards/*/review', 2000, 'POST')
    await page.getByRole('button', { name: 'Check my answer' }).click()
    const checking = mark(page, 'Checking your answer')
    await checking.waitFor({ state: 'attached', timeout: 5000 })
    await sleep(350)
    const caret = await page.locator('span.w-\\[2px\\]').count()
    if (dark && tag === 'phone') check('grading: the mark until the explanation starts, and no caret yet', (await seen(checking)) && caret === 0, `caret ${caret}`)
    await shot(page, `${tag}-${theme}-grading`)
    const gone = await checking.waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false)
    if (dark && tag === 'phone') check('and gone when it does', gone)
    await page.close()
  }

  // --- Generating cards ---------------------------------------------------------------------------------
  for (const [viewport, tag] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ]) {
    const page = await fresh({ viewport })
    const result = {
      deck_id: organic.id,
      deck_name: organic.name,
      cards_added: [{ id: 'c1', subtopic: null, question: 'What forms first in SN1?', answer: 'The carbocation.', is_math: false }],
      cards_dropped: [],
    }
    await page.route('**/api/notes/generate-from-topic', async (route) => {
      await sleep(2000)
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify(result)}\n\n` }).catch(() => {})
    })
    await page.goto(APP + 'cards', { waitUntil: 'networkidle' })
    await openGenerate(page)
    await page.getByRole('button', { name: 'From a topic' }).click()
    await page.getByLabel('Subject').fill('Chemistry')
    await page.getByLabel('Topic').fill('Nucleophilic substitution')
    const button = page.getByRole('button', { name: 'Generate flashcards' })
    const before = await pageBox(button)
    await button.click()
    const making = mark(page, 'Starting…')
    await making.waitFor({ state: 'attached', timeout: 5000 })
    await sleep(350)
    const busyButton = page.getByRole('button', { name: 'Generating' })
    const after = await pageBox(busyButton).catch(() => null)
    const hidden = await page.getByLabel('Subject').evaluate((el) => getComputedStyle(el).visibility).catch(() => 'missing')
    if (dark && tag === 'phone') {
      check('generating: the mark over the inputs, with the stage under it', (await seen(making)) && (await making.textContent()).includes('Starting…'))
      check('the inputs keep their space, hidden', hidden === 'hidden', hidden)
      check('and the button, now "Generating", has not moved', !!after && Math.abs(after.y - before.y) < 0.5 && Math.abs(after.height - before.height) < 0.5, `${before?.y} → ${after?.y}`)
    }
    await shot(page, `${tag}-${theme}-generate`)
    const done = await page.getByText('What forms first in SN1?').waitFor({ timeout: 10000 }).then(() => true, () => false)
    if (dark && tag === 'phone') check('and the result replaces it', done)
    await page.close()
  }

  if (!dark) return

  // --- Reading notes ------------------------------------------------------------------------------------
  {
    const page = await fresh()
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await sleep(2000)
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {})
    })
    await page.goto(APP + 'notes', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Add notes' }).click()
    // A 1×1 PNG, as if chosen from the photo library.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type=file][accept="image/*"]:not([capture])').setInputFiles({ name: 'page-1.png', mimeType: 'image/png', buffer: png })
    const button = page.getByRole('button', { name: 'Add 1 note' })
    const before = await pageBox(button)
    await button.click()
    const reading = mark(page, 'Reading your notes…')
    await reading.waitFor({ state: 'attached', timeout: 5000 })
    await sleep(350)
    const after = await pageBox(page.getByRole('button', { name: 'Adding 1 note' })).catch(() => null)
    check('reading notes: the mark with its caption, over the ways to add', await seen(reading))
    check('and the button, now "Adding 1 note", has not moved', !!after && Math.abs(after.y - before.y) < 0.5, `${before?.y} → ${after?.y}`)
    await shot(page, 'phone-dark-add-notes')
    await page.close()
  }

  // --- Screens that load a list -------------------------------------------------------------------------
  const screens = [
    { url: 'cards', pattern: '**/api/decks', label: 'Loading your decks' },
    { url: 'notes', pattern: '**/api/notes', label: 'Loading your notes' },
    { url: 'settings', pattern: '**/api/settings', label: 'Loading settings' },
    { url: 'admin', pattern: '**/api/admin/stats*', label: 'Loading stats' },
    { url: `study/${organic.id}`, pattern: '**/study-queue*', label: 'Loading this deck' },
  ]
  for (const { url, pattern, label } of screens) {
    const page = await fresh()
    await hold(page, pattern, 1500)
    await page.goto(APP + url, { waitUntil: 'commit' })
    await mark(page, label).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
    await sleep(700)
    const late = await appearedLate(page, label)
    check(`/${url.split('/')[0]}: "${label}", after 300ms and not before`, late.ok, late.detail)
    await page.close()
  }
  {
    // Generate's saved-notes picker, and the tutor's voice chip.
    const page = await fresh()
    await page.goto(APP + 'cards', { waitUntil: 'networkidle' })
    await openGenerate(page)
    await hold(page, '**/api/notes', 1500)
    await page.getByRole('button', { name: /Use saved notes/ }).click()
    const loader = mark(page, 'Loading your notes')
    await loader.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    await sleep(700)
    check('the saved-notes picker: "Loading your notes"', await seen(loader))
    await page.close()
  }
  {
    const page = await fresh()
    await hold(page, '**/api/tutor/voices', 2500)
    await page.goto(APP + 'tutor', { waitUntil: 'commit' })
    await page.getByRole('button', { name: /^Voice/ }).click({ timeout: 10000 })
    const loader = mark(page, 'Loading voices')
    await loader.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    await sleep(700)
    check('the voice chip: a small "Loading voices"', await seen(loader))
    await shot(page, 'phone-dark-voices')
    await page.close()
  }

  // --- Quick loads show nothing ---------------------------------------------------------------------------
  {
    const page = await fresh()
    await page.goto(APP, { waitUntil: 'networkidle' })
    for (const tab of ['Cards', 'Notes', 'Tutor', 'Settings']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click()
      await page.waitForLoadState('networkidle')
      await sleep(400)
    }
    const marks = await page.evaluate(() => window.__marks)
    const quick = marks.filter((m) => m.last - m.born < 280)
    check(
      'no mark that lived under 300ms was ever visible',
      quick.length > 0 && quick.every((m) => m.peak === 0),
      JSON.stringify(marks.map((m) => [m.label, Math.round(m.last - m.born), m.peak])),
    )
    await page.close()
  }

  // --- Depth ------------------------------------------------------------------------------------------------
  {
    const page = await fresh()
    await hold(page, '**/api/decks', 7000)
    await page.goto(APP + 'cards', { waitUntil: 'commit' })
    const loader = mark(page, 'Loading your decks')
    await loader.waitFor({ state: 'attached', timeout: 10000 })
    await sleep(800)
    const frames = []
    for (let k = 0; k < 30; k++) {
      frames.push(await geometry(loader))
      await sleep(150)
    }
    const scales = (g) => g.radii.map((r, i) => r / BASE_R[i])
    // Painted far to near: each circle drawn at least as large, for its size, as the one before it,
    // and the dim ones brighter as they come closer.
    const ordered = frames.every((g) => {
      const s = scales(g)
      const inOrder = g.painted.every((n, k) => k === 0 || s[n] >= s[g.painted[k - 1]] - 1e-3)
      const dim = NODES.filter((n) => n !== BRIGHT).sort((a, b) => s[a] - s[b])
      return inOrder && dim.every((n, k) => k === 0 || g.opacity[n] >= g.opacity[dim[k - 1]] - 1e-3)
    })
    const deep = frames.some((g) => Math.max(...scales(g)) - Math.min(...scales(g)) > 0.05)
    check('a nearer node is drawn larger, brighter and over the others', ordered && deep, JSON.stringify(frames.map((g) => [g.painted, scales(g).map((v) => +v.toFixed(3))])))
    // Two nodes drawn over each other, the nearer one on top: passing through, not around.
    const crossings = frames.flatMap((g) =>
      PAIRS.filter(([a, b]) => Math.hypot(g.nodes[a][0] - g.nodes[b][0], g.nodes[a][1] - g.nodes[b][1]) < g.radii[a] + g.radii[b]).map(([a, b]) => {
        const [front, back] = scales(g)[a] >= scales(g)[b] ? [a, b] : [b, a]
        return g.painted.indexOf(front) > g.painted.indexOf(back)
      }),
    )
    check('nodes pass through each other, the nearer drawn on top', crossings.length > 0 && crossings.every(Boolean), `${crossings.length} overlaps`)
    check('and every link stays on its two nodes as they float', frames.every(attached))
    await shot(page, 'phone-dark-float')
    await page.close()
  }

  // --- Reduced motion, and colour ------------------------------------------------------------------------
  {
    const page = await fresh({ reducedMotion: 'reduce' })
    await hold(page, '**/api/decks', 4000)
    await page.goto(APP + 'cards', { waitUntil: 'commit' })
    const loader = mark(page, 'Loading your decks')
    await loader.waitFor({ state: 'attached', timeout: 10000 })
    await sleep(800)
    const a = await geometry(loader)
    await sleep(1200)
    const b = await geometry(loader)
    const still = [a, b].every((g) => g.nodes.every((p, i) => near(p, REST[i])) && g.radii.every((r, i) => Math.abs(r - REST_R[i]) < 0.01))
    const breathing = await loader.locator('.node-loader-bright').evaluate((el) => getComputedStyle(el).animationName)
    check('reduced motion: the mark holds still', still, JSON.stringify(b.nodes))
    check('and only the bright node fades, slowly', breathing === 'node-loader-breathe', breathing)
    await page.close()
  }
  {
    const page = await fresh()
    await hold(page, '**/api/decks', 4000)
    await page.goto(APP + 'cards', { waitUntil: 'commit' })
    const loader = mark(page, 'Loading your decks')
    await loader.waitFor({ state: 'attached', timeout: 10000 })
    await sleep(1200)
    const moving = await geometry(loader)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await sleep(100)
    const settled = await geometry(loader)
    check(
      'switching reduced motion on mid-wait puts the nodes back at rest',
      !moving.nodes.every((p, i) => near(p, REST[i])) && settled.nodes.every((p, i) => near(p, REST[i])),
    )
    const colours = await page.evaluate(() => {
      const probe = document.createElement('span')
      document.body.append(probe)
      probe.style.color = 'var(--accent)'
      const accent = getComputedStyle(probe).color
      probe.remove()
      const svg = document.querySelector('.node-loader svg')
      return {
        accent,
        mark: getComputedStyle(svg).color,
        bright: getComputedStyle(svg.querySelector('.node-loader-bright')).fill,
        // The sidebar's, in the page even where a phone hides it.
        logos: [...document.querySelectorAll('svg[aria-label="Rekall"]')].map((l) => getComputedStyle(l).color),
      }
    })
    check(
      'the mark is the accent, and so is every logo on the page',
      colours.mark === colours.accent && colours.bright === colours.accent && colours.logos.length > 0 && colours.logos.every((c) => c === colours.accent),
      JSON.stringify(colours),
    )
    await page.close()
  }
}

await pass('dark')
await pass('light')
reseed()

check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURE${failures === 1 ? '' : 'S'}` : '\nALL PASS')
process.exit(failures ? 1 : 0)
