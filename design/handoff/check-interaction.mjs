// What happens after a tap, for the places where the interface used to promise one thing and do
// another. One block per promise; each says what it pins.
//
//   - Home tells "daily goal complete, cards left" from "caught up", and offers the cards.
//   - Caught up is status text naming when cards come back, not a button-shaped pill.
//   - A deck with nothing due offers to review ahead, and that starts a session.
//   - "Report and remove this card" can be undone, into the session and the schedule.
//   - A graded answer on a phone can show the model answer.
//   - A missed card can be saved for the tutor, in words that say so.
//   - Tapping a calendar day shows that day, and adding an exam is second to it.
//   - The deck editor opens on its cards; the form and deleting the deck wait behind a tap.
//   - The Cards tab leads with the library once there is one.
//   - Generation's two modes keep their own inputs across a switch.
//   - A failed load keeps what was on screen, or says it couldn't load; never "nothing yet".
//   - First run opens on a sample question.
//   - The tutor's memory chip says "Memory", whatever it holds.
//
// Fixture setup as in check-fixes.mjs: the backend on :8011 with GRADER=stub against the
// rekall_fixture database, `npm run dev:fixture` on :5199. Each block reseeds the fixture.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const APP = 'http://127.0.0.1:5199/'
const API = 'http://127.0.0.1:8011'

const reseed = () =>
  execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
    env: { ...process.env, DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture' },
    stdio: 'ignore',
  })

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  (${detail})`}`)
}
// Once more on a dropped socket: a reseed can outlast uvicorn's keep-alive, and fetch won't retry
// anything but a GET on the connection the server has since closed.
const call = (path, init) => fetch(`${API}${path}`, init).catch(() => fetch(`${API}${path}`, init))
const get = async (path) => (await call(path)).json()
const send = (path, method, body) =>
  call(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
/** A self-assessed review, which is what the fixture's stub-free path can do without a grader. */
const review = async (cardId) =>
  (await send(`/api/cards/${cardId}/review`, 'POST', { answer_input: '', input_mode: 'self_assessed', grade: 3 })).text()
const deckNamed = async (name) => (await get('/api/decks')).find((d) => d.name === name)

const browser = await chromium.launch()
const errs = []
const fresh = async (viewport = { width: 390, height: 844 }) => {
  const page = await browser.newPage({ viewport, timezoneId: 'UTC' })
  page.on('pageerror', (e) => errs.push(e.message))
  return page
}
const cardsTab = async (page) => {
  await page.getByRole('button', { name: 'Cards', exact: true }).first().click()
  await page.waitForTimeout(500)
}

// --- Home: goal met, cards left -------------------------------------------------------------------
{
  reseed()
  await send('/api/settings', 'PATCH', { daily_goal: 1 })
  const deck = (await get('/api/decks')).find((d) => d.due > 0)
  await review((await get(`/api/decks/${deck.id}/study-queue`)).cards[0].id)
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByText('Daily goal complete.').waitFor({ timeout: 5000 }).catch(() => {})
  check('a met goal says so', await page.getByText('Daily goal complete.').isVisible())
  check('and not that nothing is due', !(await page.getByText(/Nothing due|Come back tomorrow/).count()))
  const more = page.getByRole('button', { name: /^Keep studying / })
  check('and offers the cards still waiting', await more.isVisible())
  await more.click()
  await page.waitForURL('**/study/*')
  const opened = await page.getByPlaceholder('Type your answer').waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('which opens a session', opened)
  await page.close()
}

// --- Home: caught up ------------------------------------------------------------------------------
{
  reseed()
  for (const deck of (await get('/api/decks')).filter((d) => !d.exam_paused && d.due + d.new > 0)) {
    for (const card of (await get(`/api/decks/${deck.id}/study-queue`)).cards) await review(card.id)
  }
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  const caughtUp = page.getByText("You're caught up.")
  await caughtUp.waitFor({ timeout: 5000 }).catch(() => {})
  check('an empty plate reads "caught up"', await caughtUp.isVisible())
  await page.getByText(/cards? comes? back/).waitFor({ timeout: 5000 }).catch(() => {})
  check('and says when cards come back', await page.getByText(/cards? comes? back (later today|tomorrow|in \d+ days|on )/).isVisible())
  check('with no button pretending to be one', !(await page.getByRole('button', { name: /Start |Keep studying|Come back/ }).count()))
  await page.close()
}

// --- A deck with nothing due, reviewed ahead ------------------------------------------------------
{
  reseed()
  const stats = await deckNamed('Statistics')
  const page = await fresh()
  await page.goto(`${APP}study/${stats.id}`, { waitUntil: 'networkidle' })
  await page.getByText('Nothing due in this deck').waitFor()
  const ahead = page.getByRole('button', { name: 'Review ahead' })
  check('nothing due offers to review ahead', await ahead.isVisible())
  await ahead.click()
  const box = page.getByPlaceholder('Type your answer')
  const started = await box.waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('and reviewing ahead starts a session', started)
  const { cards } = await get(`/api/decks/${stats.id}/study-queue?ahead=true`)
  check('on the card due soonest', started && (await page.getByText(cards[0].question, { exact: true }).filter({ visible: true }).count()) === 1)
  await page.close()
}

// --- Report, undo, and the model answer on a phone ------------------------------------------------
{
  reseed()
  const deck = (await get('/api/decks')).find((d) => d.due >= 3)
  const first = (await get(`/api/decks/${deck.id}/study-queue`)).cards[0]
  const page = await fresh()
  await page.goto(`${APP}study/${deck.id}`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Type your answer').fill('zzzz')
  await page.getByRole('button', { name: 'Check my answer' }).click()
  const next = page.getByRole('button', { name: /^(Next card|Finish)/ })
  await next.waitFor()
  const before = await next.innerText()

  // The desktop rail carries the same text, hidden at this width, so only visible copies count.
  const reference = (await get(`/api/cards/${first.id}/answer`)).answer
  const shown = () => page.getByText(reference, { exact: true }).filter({ visible: true }).count()
  const show = page.getByRole('button', { name: 'Show model answer' })
  await show.waitFor({ timeout: 5000 }).catch(() => {})
  check('a graded phone offers the model answer', await show.isVisible())
  check('folded until asked for', (await shown()) === 0)
  await show.click()
  check('and shows it when asked', (await shown()) === 1)

  const save = page.getByRole('button', { name: 'Save for tutor' })
  check('a missed card can be saved for the tutor', await save.isVisible())
  await save.click()
  const saved = await page.getByText('Saved. The tutor will start here next time.').waitFor({ timeout: 5000 }).then(() => true, () => false)
  check('in words that say what happened', saved)

  await page.getByRole('button', { name: 'Report and remove this card' }).click()
  await page.getByText('Removed from your reviews.').waitFor()
  const removed = await next.innerText()
  check('reporting says the card is gone', removed !== before, `${before} -> ${removed}`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Report and remove this card' }).waitFor()
  check('undo puts it back in the session', (await next.innerText()) === before, `${before} -> ${await next.innerText()}`)
  // Missed, so it is relearning and due again in minutes: not in today's queue yet, but among
  // the cards scheduled later, which a suspended card never is.
  const scheduled = (await get(`/api/decks/${deck.id}/study-queue?ahead=true`)).cards.some((c) => c.id === first.id)
  check('and back in the schedule', scheduled)
  await page.close()
}

// --- A calendar day -------------------------------------------------------------------------------
{
  reseed()
  const page = await fresh()
  await page.goto(`${APP}calendar`, { waitUntil: 'networkidle' })
  const tomorrow = new Date(Date.now() + 86_400_000)
  const iso = tomorrow.toISOString().slice(0, 10)
  const spoken = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(tomorrow)
  await page.getByRole('button', { name: new RegExp(`^${spoken}`) }).first().click()
  const heading = page.getByRole('region', { name: new RegExp(spoken.split(',')[0]) })
  await heading.waitFor({ timeout: 5000 }).catch(() => {})
  check('tapping a day opens that day', await heading.isVisible())
  check('not the add-exam sheet', !(await page.getByRole('dialog').count()))
  const rows = await get(`/api/dashboard/day?date=${iso}`)
  const bar = (await get(`/api/dashboard/load?start=${iso}&end=${iso}`))[iso] ?? 0
  check("its decks add up to the day's bar", rows.reduce((n, r) => n + r.cards, 0) === bar)
  if (rows[0]) check('and are listed by name', await heading.getByText(rows[0].name, { exact: true }).isVisible())
  await heading.getByRole('button', { name: 'Add exam' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add exam' })
  check('adding an exam from it keeps the day', await sheet.getByText(tomorrow.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })).isVisible())
  await page.close()
}

// --- The deck editor, and the Cards tab ------------------------------------------------------------
{
  reseed()
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  await cardsTab(page)
  check('the library leads on a phone', await page.getByRole('button', { name: /^Edit Pharmacology/ }).isVisible())
  check('with the ways in folded away', !(await page.getByRole('button', { name: /Write your own/ }).count()))
  await page.getByRole('button', { name: 'Add cards', exact: true }).click()
  check('until "Add cards" opens them', await page.getByRole('button', { name: /Write your own/ }).isVisible())

  await page.getByRole('button', { name: /^Edit Pharmacology/ }).click()
  const listed = await page.getByRole('button', { name: 'Edit card' }).first().waitFor({ timeout: 5000 }).then(() => true, () => false)
  check('the deck editor opens on its cards', listed)
  check('with no blank form in the way', !(await page.getByLabel('Question').count()))
  check('or a delete button', !(await page.getByRole('button', { name: /Delete (this )?deck/ }).count()))
  await page.getByRole('button', { name: 'Add card', exact: true }).click()
  check('"Add card" opens the form', await page.getByLabel('Question').isVisible())
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: /^Rename or delete/ }).click()
  check('deleting the deck sits behind its name', await page.getByRole('button', { name: 'Delete deck' }).isVisible())
  await page.getByRole('button', { name: 'Delete deck' }).click()
  check('and still asks first', await page.getByText('Delete Pharmacology?').isVisible())
  await page.close()
}

// --- Generation's two modes -------------------------------------------------------------------------
{
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  await cardsTab(page)
  await page.getByRole('button', { name: 'Add cards', exact: true }).click()
  await page.getByRole('button', { name: /Generate with AI/ }).click()
  // The photo-library input: images, no camera capture.
  await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
    name: 'lecture-notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  })
  await page.getByText('lecture-notes.png').waitFor()
  await page.getByRole('button', { name: 'From a topic' }).click()
  check('the topic form labels its fields', await page.getByLabel('Subject').isVisible())
  await page.getByLabel('Subject').fill('Chemistry')
  await page.getByRole('button', { name: 'From my material' }).click()
  check('switching modes keeps the material picked', await page.getByText('lecture-notes.png').isVisible())
  await page.getByRole('button', { name: 'From a topic' }).click()
  check('and the topic typed', (await page.getByLabel('Subject').inputValue()) === 'Chemistry')
  await page.close()
}

// --- A failed load ------------------------------------------------------------------------------------
{
  reseed()
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByText('Organic Chemistry II').first().waitFor()
  // From here every deck list fails. Leaving Home and coming back refetches it.
  await page.route('**/api/decks', (route) => route.fulfill({ status: 503, body: 'down' }))
  await cardsTab(page)
  await page.getByRole('button', { name: 'Home', exact: true }).first().click()
  await page.getByText("Couldn't refresh just now.").first().waitFor({ timeout: 5000 }).catch(() => {})
  check('a failed refresh says so', await page.getByText("Couldn't refresh just now.").first().isVisible())
  check('and keeps the decks it had', await page.getByText('Organic Chemistry II').first().isVisible())
  check('rather than saying there are none', !(await page.getByText('Nothing to remember yet.').count()))
  await page.close()

  const cold = await fresh()
  await cold.route('**/api/decks', (route) => route.fulfill({ status: 503, body: 'down' }))
  await cold.goto(APP, { waitUntil: 'networkidle' })
  await cold.getByText("Couldn't load your cards.").waitFor({ timeout: 5000 }).catch(() => {})
  check('a failed first load says it couldn\'t load', await cold.getByText("Couldn't load your cards.").isVisible())
  check('not that there is nothing', !(await cold.getByText('Nothing to remember yet.').count()))
  await cold.unroute('**/api/decks')
  await cold.getByRole('button', { name: 'Retry' }).click()
  const back = await cold.getByText('Organic Chemistry II').first().waitFor({ timeout: 5000 }).then(() => true, () => false)
  check('and Retry brings it back', back)
  await cold.close()
}

// --- First run, and the tutor's memory chip ----------------------------------------------------------
{
  reseed()
  await send('/api/settings', 'PATCH', { onboarded: false })
  const page = await fresh()
  await page.goto(APP, { waitUntil: 'networkidle' })
  const tryIt = page.getByRole('button', { name: 'Try a sample question' })
  check('first run opens on a sample question', await tryIt.isVisible())
  await tryIt.click()
  await page.waitForURL('**/study/*', { timeout: 10000 }).catch(() => {})
  const session = await page.getByPlaceholder('Type your answer').waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('which is a session, one tap in', session)
  await page.getByRole('button', { name: /^Sample deck/ }).first().click()
  await page.waitForTimeout(500)
  check('and leaving it lands on Home', new URL(page.url()).pathname === '/', new URL(page.url()).pathname)

  await page.getByRole('button', { name: 'Tutor', exact: true }).first().click()
  const chip = page.getByRole('button', { name: /^Tutor memory/ })
  await chip.waitFor({ timeout: 5000 }).catch(() => {})
  check('the memory chip reads "Memory"', (await chip.innerText()).startsWith('Memory'), await chip.innerText().catch(() => ''))
  await page.close()
}

check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURE${failures === 1 ? '' : 'S'}` : '\nALL PASS')
process.exit(failures ? 1 : 0)
