/** What the video's own source may not do. Every frame has to be a pure function of its number, and
 * the video's own graphics keep to the design system; the replicas may do whatever the app does. */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = path.resolve(__dirname, '..')
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? (e.name === '__tests__' ? [] : files(p)) : /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
const sources = files(src).map((p) => ({ name: path.relative(src, p), text: fs.readFileSync(p, 'utf8') }))
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('every frame is a function of its number', () => {
  it.each(sources)('$name reads no clock and no randomness', ({ text }) => {
    const c = code(text)
    expect(c).not.toMatch(/Math\.random\(/)
    expect(c).not.toMatch(/Date\.now\(/)
    expect(c).not.toMatch(/new Date\(\)/)
    expect(c).not.toMatch(/performance\.now\(|requestAnimationFrame\(|setTimeout\(|setInterval\(/)
  })
  it.each(sources)('$name runs no CSS animation or transition', ({ text }) => {
    const c = code(text)
    // A `transition` class token, or a `transition:` style property.
    expect(c).not.toMatch(/['"`\s]transition(-[a-z]+)?['"`\s]/)
    expect(c).not.toMatch(/\btransition(Duration|Property|TimingFunction)?\s*:/)
    expect(c).not.toMatch(/\banimate-[a-z]/)
    // The app's own animated classes, which would run on the clock.
    expect(c).not.toMatch(/['"`\s](focus-word|focus-line|focus-line-inline|node-loader|sliding-pill|pill-option|load-bar|latest-pill)['"`\s]/)
  })
  it.each(sources)('$name sizes nothing by the video frame', ({ text }) => {
    const c = code(text)
    expect(c).not.toMatch(/\b(min-h|h|max-h)-screen\b/)
    expect(c).not.toMatch(/\d(\.\d+)?vh\b/)
  })
})

describe("the video's own graphics keep to the design system", () => {
  // The replicas draw the app, glow and all; the orb and the loader are the app's own drawings.
  const own = sources.filter(({ name }) => !name.startsWith('replica/') && !['lib/orb.ts', 'primitives/VoiceOrbFrame.tsx'].includes(name))
  it.each(own)('$name: no gradients, glows or shadows', ({ text }) => {
    const c = code(text)
    expect(c).not.toMatch(/gradient\(/i)
    expect(c).not.toMatch(/box-?shadow|drop-shadow|text-?shadow/i)
  })
  it.each(own.filter(({ name }) => !/^(primitives\/(NodeLoaderFrame|LogoMorph|AppCanvas)|tools\/Smoke|theme)\./.test(name)))(
    '$name: no accent — the accent belongs to the app',
    ({ text }) => {
      expect(code(text)).not.toMatch(/--accent/)
    },
  )
})
