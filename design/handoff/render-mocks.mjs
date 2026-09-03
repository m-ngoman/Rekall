// Renders every `[data-screen-label]` artboard in the handoff mocks to PNG, dark and light.
// Usage: NODE_PATH=~/.local/lib/node_modules node design/handoff/render-mocks.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(new URL('.', import.meta.url).pathname)
const mocks = resolve(here, 'design_handoff_rekall_countdown/mocks')
const out = resolve(here, 'out/mock')
mkdirSync(out, { recursive: true })

const files = [
  ['mobile', 'Rekall.dc.html', { width: 1400, height: 1000 }],
  ['desktop', 'Rekall Desktop.dc.html', { width: 1500, height: 1000 }],
]

const browser = await chromium.launch()
for (const [tag, file, viewport] of files) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.error(`[${tag}] pageerror`, e.message))
  await page.goto(`file://${mocks}/${file}`)
  await page.waitForFunction(() => document.querySelectorAll('[data-screen-label]').length > 0, null, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => window.__dcSetProps(window.__dcRootName(), { theme: t }), theme)
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme)
    await page.waitForTimeout(300)
    const screens = await page.$$('[data-screen-label]')
    for (const el of screens) {
      const label = (await el.getAttribute('data-screen-label')).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const path = `${out}/${tag}-${theme}-${label}.png`
      await el.scrollIntoViewIfNeeded()
      await el.screenshot({ path })
      console.log(path)
    }
  }
  await page.close()
}
await browser.close()
