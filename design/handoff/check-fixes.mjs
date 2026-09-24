// Behaviour the screenshots can't show, one check per fix that needed a browser to prove.
//
//   - A card reported during study leaves the session, including the second showing it was
//     queued for when it was missed first time.
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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

// --- A reported card leaves the session ---------------------------------------------------------
{
  const decks = await get('/api/decks')
  const deck = decks.find((d) => d.due + d.new >= 3)
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
  await page.getByRole('button', { name: "This card doesn't look right" }).click()
  await page.getByText("Reported. You won't see it again.").waitFor()
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

check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(failures ? `\n${failures} FAILURE${failures === 1 ? '' : 'S'}` : '\nALL PASS')
process.exit(failures ? 1 : 0)
