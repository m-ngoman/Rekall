// The tutor log's scroll behaviour, which is a timing bug and so cannot be checked by reading.
// Before the fix this script's assertions failed like this, measured on a 390x520 viewport:
// scrolling down 400px mid-reply was dragged back up 319px inside 200ms, and 173px of the newest
// reply sat behind the composer.
//
//   cd backend && DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture \
//     GRADER=stub TUTOR_PROVIDER=stub GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= OWNER_EMAIL=dev@rekall.study \
//     .venv/bin/uvicorn app.main:app --port 8011
//   cd frontend && npm run dev:fixture
//   node design/handoff/check-tutor-scroll.mjs
//
// The stub provider streams its reply over about two seconds (154 chunks, 12ms apart), which is
// long enough to scroll into but short enough to wait out; the numbers below are sized for that,
// not for a real model's several seconds. Run it against the real provider too when changing the
// follow itself.
import { chromium } from 'playwright'

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  (${detail})`}`)
}

const y = (page) => page.evaluate(() => Math.round(window.scrollY))

/** Clicks through onboarding until the composer exists. */
async function reachTutor(page) {
  await page.goto('http://127.0.0.1:5199/tutor', { waitUntil: 'networkidle' })
  for (let i = 0; i < 8 && !(await page.getByPlaceholder(/message the tutor/i).count()); i += 1) {
    await page.waitForTimeout(700)
    const next = page
      .locator('button:visible')
      .filter({ hasText: /^(get started|continue|skip for now|tutor)$/i })
      .first()
    if (await next.count()) await next.click()
  }
  return page.getByPlaceholder(/message the tutor/i).first()
}

const browser = await chromium.launch()

for (const [name, viewport] of [
  ['phone', { width: 390, height: 520 }],
  ['desktop', { width: 1280, height: 720 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  const box = await reachTutor(page)
  console.log(`\n--- ${name}, ${viewport.width}x${viewport.height} ---`)

  // Enough turns that the log is comfortably taller than the viewport.
  for (let t = 0; t < 3; t += 1) {
    await box.fill(`Turn ${t}: draw me a velocity-time graph.`)
    await box.press('Enter')
    await page.waitForTimeout(4000)
  }

  // 1. Left alone, the log ends up resting on its newest line.
  const rest = await page.evaluate(() => {
    const anchor = document.querySelector('main div[class*="pb-64"] > div:last-child')
    const composer = document.querySelector('div[class*="fixed"][class*="z-20"]')
    return {
      anchorBottom: Math.round(anchor.getBoundingClientRect().bottom),
      composerTop: Math.round(composer.getBoundingClientRect().top),
    }
  })
  check('the log follows to its newest line', rest.anchorBottom <= rest.composerTop, `anchor ${rest.anchorBottom} vs composer ${rest.composerTop}`)

  // 2. The defect that made the reader scroll down in the first place.
  const overlap = await page.evaluate(() => {
    const plots = document.querySelectorAll('svg[aria-label^="Graph of"]')
    const last = plots[plots.length - 1]
    const composer = document.querySelector('div[class*="fixed"][class*="z-20"]')
    return last ? Math.round(last.getBoundingClientRect().bottom - composer.getBoundingClientRect().top) : -1
  })
  check('the newest reply is not behind the composer', overlap <= 0, `${overlap}px of overlap`)

  // 3 and 4. A scroll mid-reply survives the next twenty-five typewriter ticks.
  for (const [label, delta] of [['down', 300], ['up', -300]]) {
    await box.fill('Draw it once more')
    await box.press('Enter')
    await page.waitForTimeout(250) // mid-reveal
    await page.evaluate((d) => window.scrollBy(0, d), delta)
    const moved = await y(page)
    await page.waitForTimeout(500)
    const settled = await y(page)
    // Scrolling down may still be followed further down as the reply grows; what must never
    // happen is being dragged back up.
    const ok = label === 'down' ? settled >= moved - 2 : Math.abs(settled - moved) <= 2
    check(`scrolling ${label} mid-reply is not undone`, ok, `${moved} -> ${settled}`)
    await page.waitForTimeout(3000) // let the reply finish before the next one
    if (label === 'up') {
      // 5. Coming back to the bottom re-engages the follow.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await box.fill('And again')
      await box.press('Enter')
      const start = await y(page)
      await page.waitForTimeout(1200)
      check('returning to the bottom re-engages the follow', (await y(page)) > start, `${start} -> ${await y(page)}`)
    }
  }

  // 6. The pill: present only while scrolled away during a live reply, and it takes you back.
  // A class locator, not a role: the pill carries aria-hidden while it is parked behind the
  // composer, which is the point of it, and that takes it out of the accessibility tree.
  const pill = page.locator('.latest-pill')
  const pillY = async () => (await pill.boundingBox()).y
  await page.waitForTimeout(3000)
  const parked = await pillY()
  await box.fill('One more time')
  await box.press('Enter')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.scrollBy(0, -400))
  await page.waitForTimeout(400)
  const shown = await pillY()
  check('the pill rises out of the composer when you scroll away', shown < parked - 20, `${Math.round(parked)} -> ${Math.round(shown)}`)
  await pill.click()
  await page.waitForTimeout(600)
  check('tapping the pill returns to the newest line', (await pillY()) > shown + 20, `${Math.round(shown)} -> ${Math.round(await pillY())}`)

  await page.waitForTimeout(2000)
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

// 7. Reduced motion takes the slide off, per the block in index.css.
const reduced = await browser.newPage({ viewport: { width: 390, height: 520 }, reducedMotion: 'reduce' })
await reachTutor(reduced)
const transition = await reduced.evaluate(
  () => getComputedStyle(document.querySelector('.latest-pill')).transitionDuration,
)
check('reduced motion removes the slide', transition === '0s', transition)
await reduced.close()

await browser.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
