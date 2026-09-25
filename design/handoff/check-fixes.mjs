// Behaviour the screenshots can't show, one check per fix that needed a browser to prove.
//
//   - A card reported during study leaves the session, including the second showing it was
//     queued for when it was missed first time.
//   - A card flagged is_math shows its maths set, not its LaTeX source, in the card writer's list
//     and in a generation run's results.
//   - Moving between tabs adds one history entry per move, so Back goes back one.
//   - Escape in the exam sheet's delete confirmation cancels the confirmation and nothing else.
//   - A slow answer to a search that has since changed doesn't replace the list.
//   - A failed import says what the server said, not "400 Bad Request: {...}".
//   - The manifest's colours are the dark theme's background, as the pre-paint script's are.
//
// Fixture setup as in check-notes-editor.mjs: the backend on :8011 with GRADER=stub against the
// rekall_fixture database, `npm run dev:fixture` on :5199. It reseeds the fixture first.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const repo = resolve(new URL('.', import.meta.url).pathname, '../..')
const APP = 'http://127.0.0.1:5199/'
const API = 'http://127.0.0.1:8011'

execFileSync(`${repo}/backend/.venv/bin/python`, [`${repo}/design/handoff/seed_fixture.py`], {
  env: { ...process.env, DATABASE_URL: 'postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture' },
  stdio: 'ignore',
})

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  (${detail})`}`)
}
const get = async (path) => (await fetch(`${API}${path}`)).json()
/** Cards -> one of its ways in, which on a phone with a library wait behind "Add cards". */
const wayIn = async (page, label) => {
  await page.getByRole('button', { name: 'Cards', exact: true }).first().click()
  const add = page.getByRole('button', { name: 'Add cards', exact: true })
  if (await add.isVisible()) await add.click()
  await page.getByRole('button', { name: label }).first().click()
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

// --- A reported card leaves the session ---------------------------------------------------------
{
  const decks = await get('/api/decks')
  const deck = decks.find((d) => d.due + d.new_today >= 3)
  const { cards } = await get(`/api/decks/${deck.id}/study-queue`)
  const reported = cards[0].question
  const onScreen = () => page.getByText(reported, { exact: true }).isVisible()

  await page.goto(`${APP}study/${deck.id}`, { waitUntil: 'networkidle' })
  const box = page.getByPlaceholder('Type your answer')
  const answerWrong = async () => {
    await box.fill('zzzz')
    await page.getByRole('button', { name: 'Check my answer' }).click()
    await page.getByRole('button', { name: /^(Next card|Finish)/ }).waitFor()
  }

  await box.waitFor()
  check('the first card is the one to report', await onScreen())
  await answerWrong()
  // Missed first time, so it is queued for a second showing: every card is still to come.
  const before = await page.getByRole('button', { name: /^Next card/ }).innerText()
  check('a missed card is queued again', before === `Next card, ${cards.length} left`, before)
  await page.getByRole('button', { name: 'Report and remove this card' }).click()
  await page.getByText('Removed from your reviews.').waitFor()
  const after = await page.getByRole('button', { name: /^(Next card|Finish)/ }).innerText()
  check('reporting takes its second showing out of the queue', after === `Next card, ${cards.length - 1} left`, after)

  // Walk the rest of the session, missing every card, and watch for the reported one.
  let seen = false
  for (let step = 0; step < cards.length * 2 + 2; step += 1) {
    const next = page.getByRole('button', { name: /^(Next card|Finish)/ })
    const finishing = (await next.innerText()) === 'Finish'
    await next.click()
    if (finishing) break
    await box.waitFor()
    if (await onScreen()) seen = true
    await answerWrong()
  }
  check('the reported card never came back', !seen)
  await page.getByText('Done for today').waitFor()
  const suspended = (await get(`/api/decks/${deck.id}/study-queue`)).cards.every((c) => c.question !== reported)
  check('and the server left it out of the next session', suspended)
}

// --- Maths is set in card lists and generation results -------------------------------------------
{
  // KaTeX renders into .katex elements; the source it came from starts with "$\frac".
  const setAsMaths = async (scope) => (await scope.locator('.katex').count()) > 0
  const rawLatex = async (scope) => (await scope.innerText()).includes('\\frac')

  const pharmacology = (await get('/api/decks')).find((d) => d.name === 'Pharmacology')
  await page.goto(APP, { waitUntil: 'networkidle' })
  await wayIn(page, /Write your own/)
  // Under StrictMode the deck list is fetched twice in development, and each answer pre-selects
  // the newest deck, so a choice made before the second one lands is overwritten. Choose until
  // the choice holds.
  const list = page.locator('main')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.locator('select').first().selectOption(pharmacology.id)
    const held = await list.getByText(`${pharmacology.total} cards`).waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (held) break
  }
  await list.getByText('By the product rule', { exact: false }).first().waitFor()
  await list.locator('.katex').first().waitFor({ timeout: 10000 }).catch(() => {})
  check('the card writer sets a maths card as maths', (await setAsMaths(list)) && !(await rawLatex(list)))

  // A generation run's results, from a topic, with the model's answer stood in for.
  const result = {
    deck_id: pharmacology.id,
    deck_name: 'Pharmacology',
    cards_added: [
      { id: 'c1', subtopic: null, question: 'What is $\\frac{d}{dx} e^{2x}$?', answer: '$2e^{2x}$', is_math: true },
      { id: 'c2', subtopic: null, question: 'What does a beta blocker block?', answer: 'Beta-adrenergic receptors.', is_math: false },
    ],
    cards_dropped: [],
  }
  await page.route('**/api/notes/generate-from-topic', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify(result)}\n\n` }),
  )
  await page.goto(APP, { waitUntil: 'networkidle' })
  await wayIn(page, /Generate with AI/)
  await page.getByRole('button', { name: 'From a topic' }).click()
  await page.getByLabel('Subject').fill('Calculus')
  await page.getByLabel('Topic', { exact: true }).fill('Derivatives')
  await page.getByRole('button', { name: 'Generate flashcards' }).click()
  await page.getByText('Added to Pharmacology').waitFor()
  await list.locator('.katex').first().waitFor({ timeout: 10000 }).catch(() => {})
  check('generation results set a maths card as maths', (await setAsMaths(list)) && !(await rawLatex(list)))
  check('and leave an ordinary card as it was written', await list.getByText('Beta-adrenergic receptors.', { exact: true }).isVisible())
}

// --- One history entry per navigation -------------------------------------------------------------
{
  await page.goto(APP, { waitUntil: 'networkidle' })
  const before = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Cards', exact: true }).first().click()
  await page.waitForURL('**/cards')
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
  await page.waitForURL('**/notes')
  const added = (await page.evaluate(() => history.length)) - before
  check('two tab changes add two history entries', added === 2, `${added} added`)
  await page.goBack()
  await page.waitForTimeout(300)
  check('and Back returns to the tab before', new URL(page.url()).pathname === '/cards', new URL(page.url()).pathname)
}

// --- Escape in a confirmation over the exam sheet -------------------------------------------------
{
  const today = new Date().toISOString().slice(0, 10)
  const next = (await get('/api/exams')).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
  await page.goto(`${APP}calendar`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: new RegExp(next.name) }).first().click()
  await page.getByRole('button', { name: 'Delete exam' }).click()
  const question = page.getByText(`Delete ${next.name}?`)
  await question.waitFor()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Escape cancels the delete confirmation', !(await question.isVisible()))
  check('and leaves the exam sheet open', await page.getByRole('button', { name: 'Delete exam' }).isVisible())
}

// --- A stale search answer ------------------------------------------------------------------------
{
  const all = (await get('/api/notes')).length
  await page.goto(`${APP}notes`, { waitUntil: 'networkidle' })
  // The search for "zzq" is answered slowly, and by then the box has been cleared again.
  await page.route('**/api/notes?q=zzq*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  const box = page.getByPlaceholder('Search your notes')
  await box.fill('zzq')
  await page.waitForTimeout(500)
  await box.fill('')
  await page.waitForTimeout(2500)
  const tiles = await page.getByLabel('Move to category').count()
  check("a slow answer to an old search doesn't replace the list", tiles === all, `${tiles} of ${all} notes shown`)
}

// --- What a failed import says --------------------------------------------------------------------
{
  await page.goto(APP, { waitUntil: 'networkidle' })
  await wayIn(page, /Import CSV/)
  await page.getByPlaceholder('Paste CSV here').fill('just one line, no header')
  await page.getByRole('button', { name: 'Import these cards' }).click()
  const said = page.getByText('Could not parse CSV. Expected header: DeckName,Subtopic,Front,Back', { exact: true })
  const ok = await said.waitFor({ timeout: 5000 }).then(() => true, () => false)
  check("a failed import shows the server's sentence", ok)
  check('and no status line or JSON', !(await page.locator('main').innerText()).includes('Bad Request'))
}

// --- The manifest's colours -----------------------------------------------------------------------
{
  const html = await (await fetch(APP)).text()
  const dark = /theme === 'dark' \? '(#[0-9a-f]{6})'/.exec(html)?.[1]
  const manifest = await (await fetch(`${APP}manifest.webmanifest`)).json()
  check('the manifest uses the dark background the pre-paint script does', !!dark && manifest.theme_color === dark && manifest.background_color === dark, `${manifest.theme_color} / ${manifest.background_color} vs ${dark}`)
}

check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURE${failures === 1 ? '' : 'S'}` : '\nALL PASS')
process.exit(failures ? 1 : 0)
