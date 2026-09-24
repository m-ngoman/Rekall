// The note editor's save pipeline, which runs on timers and on the way out of the screen and so
// cannot be checked by reading: a debounced autosave, a draft that only becomes a note once it has
// something in it, a typed note that is discarded when it is emptied, and a Back that flushes the
// edit the debounce had not sent yet. Each is asserted against what the API then holds, not only
// against what the screen shows.
//
//   cd backend && DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture \
//     GRADER=stub TUTOR_PROVIDER=stub GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= OWNER_EMAIL=dev@rekall.study \
//     .venv/bin/uvicorn app.main:app --port 8011
//   cd frontend && npm run dev:fixture
//   node design/handoff/check-notes-editor.mjs
//
// It reseeds the fixture first, so it starts from the seed's four notes whatever ran before it.
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

const notes = async () => (await fetch(`${API}/api/notes`)).json()
const noteText = async (id) => (await (await fetch(`${API}/api/notes/${id}`)).json()).ocr_text

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(APP, { waitUntil: 'networkidle' })

const toNotes = async () => {
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
  await page.getByPlaceholder('Search your notes').waitFor()
}
const writeANote = async () => {
  await page.getByRole('button', { name: 'Add notes' }).click()
  await page.getByRole('button', { name: 'Write a note' }).click()
  await page.getByLabel('Note title').waitFor()
  await page.locator('.ProseMirror').waitFor()
}
// The editor's Back is the first button on the screen and reads "Notes", like the tab.
const back = () => page.locator('main button', { hasText: /^Notes$/ }).first().click()
const tile = (title) => page.getByText(title, { exact: true })
// Every note tile carries its own "Move to category" picker, so these count tiles on screen
// whatever their titles say.
const tiles = () => page.getByLabel('Move to category').count()
const backToList = async () => {
  await back()
  await page.getByPlaceholder('Search your notes').waitFor()
  await page.waitForTimeout(1500)
}

await toNotes()
const before = await notes()

// 1. Typing saves by itself, shortly after you stop: the draft becomes a note, and says so.
await writeANote()
await page.getByLabel('Note title').fill('Krebs cycle')
await page.locator('.ProseMirror').click()
await page.keyboard.type('Citrate is made first.')
await page.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 })
const created = (await notes()).filter((n) => !before.some((b) => b.id === n.id))
check('an autosave turned the draft into one note', created.length === 1, `${created.length} new`)
const id = created[0]?.id
check('the note holds what was typed', id && (await noteText(id)).includes('Citrate is made first.'), id && (await noteText(id)))

// 2. The edit is still there after leaving and coming back.
await back()
await tile('Krebs cycle').waitFor({ timeout: 10000 })
await tile('Krebs cycle').click()
await page.getByLabel('Note title').waitFor()
check('the title survived a round trip', (await page.getByLabel('Note title').inputValue()) === 'Krebs cycle')
check('the text survived a round trip', (await page.locator('.ProseMirror').innerText()).includes('Citrate is made first.'))

// 3. Back sends the edit the debounce hasn't yet: typed and left at once, well inside its 900ms.
await page.locator('.ProseMirror').click()
await page.keyboard.press('End')
await page.keyboard.type(' Then isocitrate.')
await back()
await tile('Krebs cycle').waitFor({ timeout: 10000 })
check('Back flushed the pending save', (await noteText(id)).includes('Then isocitrate.'), await noteText(id))

// 4. A draft left without a word in it never becomes a note.
const listed = await notes()
const shown = await tiles()
await writeANote()
await backToList()
check('an untouched draft left no note', (await notes()).length === listed.length, `${(await notes()).length} notes`)
check('and no tile', (await tiles()) === shown, `${await tiles()} tiles`)

// 5. A typed note that is emptied and left is deleted, not kept as a blank. Judged by its id and
// by the count, because the failure this guards against is the note surviving with no title.
await writeANote()
await page.getByLabel('Note title').fill('Scratch')
await page.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 })
const scratch = (await notes()).find((n) => n.title === 'Scratch')
check('the scratch note was created', Boolean(scratch))
await page.getByLabel('Note title').fill('')
await backToList()
const after = await notes()
check('an emptied note is deleted', !after.some((n) => n.id === scratch?.id), `${after.length} notes`)
check('and its tile with it', (await tiles()) === shown, `${await tiles()} tiles`)

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
await browser.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
