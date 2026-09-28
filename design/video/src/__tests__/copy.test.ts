import { describe, expect, it } from 'vitest'
import { CAPTIONS, END_CARD } from '../data/copy'

const lines = [...Object.values(CAPTIONS), END_CARD.tagline]

describe('the copy the video adds', () => {
  it.each(lines)('"%s" is one sentence case sentence', (line) => {
    expect(line).toMatch(/^[A-Z]/)
    expect(line).toMatch(/\.$/)
    // Sentence case: nothing capitalised after the first word except the product's own names.
    const rest = line.split(' ').slice(1).filter((w) => !['Rekall', 'SN1', 'SN2'].includes(w))
    for (const w of rest) expect(w, `"${w}" in "${line}"`).toMatch(/^[^A-Z]/)
  })

  it.each(lines)('"%s" keeps to the design system', (line) => {
    expect(line).not.toMatch(/·|→|←|↑|↓|->/) // no separators, no arrows
    expect(line).not.toMatch(/\b[A-Z]{3,}\b/) // no all-caps
    expect(line).not.toMatch(/[$€£]|\bfree\b|\bprice\b/i) // no prices
  })

  it.each(lines)('"%s" says only what the app does', (line) => {
    // Answers are typed; only the tutor listens (50c7052).
    expect(line).not.toMatch(/\b(say|speak|spoken|voice)\b.*\banswer/i)
    // Exams pace new cards; they don't promise coverage.
    expect(line).not.toMatch(/guarantee|every card before|never forget/i)
  })

  it('ends on the address the app is at', () => {
    expect(END_CARD.url).toBe('rekall.study')
  })
})
