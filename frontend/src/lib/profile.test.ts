import { describe, expect, it } from 'vitest'
import { lineEvidence, profileLineCount, rebaseEdit } from './profile'
import type { ProfileLine, StudentProfile } from '../types'

const tutor = (sessions: number, stale = false): ProfileLine => ({
  text: 'When a problem has more than one step, reaches for a formula first.',
  yours: false,
  sessions,
  latest: '2026-07-14',
  stale,
})
const mine: ProfileLine = { text: 'Ask me before telling me.', yours: true, sessions: null, latest: null, stale: false }

describe('profileLineCount', () => {
  it("counts yours and the tutor's together, across sections", () => {
    const profile: StudentProfile = {
      sections: [
        { name: 'How they work', lines: [tutor(3), mine] },
        { name: 'What helps', lines: [] },
        { name: 'Course and level', lines: [tutor(2)] },
      ],
      text: '',
      chars: 0,
      max_chars: 1500,
      rev: 1,
    }
    expect(profileLineCount(profile)).toBe(3)
    expect(profileLineCount(null)).toBe(0)
  })
})

describe('lineEvidence', () => {
  it("says how often the tutor saw it, in the singular when once", () => {
    expect(lineEvidence(tutor(3))).toBe('3 sessions')
    expect(lineEvidence(tutor(1))).toBe('1 session')
  })

  it('says when a line has gone quiet, and that the tutor is leaving it out', () => {
    expect(lineEvidence(tutor(2, true))).toMatch(/^2 sessions · hasn't come up since \w+.*, so it's left out for now$/)
  })

  it('has nothing to say about your own lines', () => {
    expect(lineEvidence(mine)).toBeNull()
  })
})

describe('rebaseEdit', () => {
  const SECTIONS = ['How they work', 'What helps', 'Course and level']
  const base = [
    '## How they work',
    '- Reaches for a formula first.',
    '- Answers fast and checks nothing.',
    '',
    '## What helps',
    '',
    '## Course and level',
    '- Second-year biology.',
  ].join('\n')

  it("keeps what the tutor wrote meanwhile, and adds what you added under its heading", () => {
    const draft = base.replace('## What helps', '## What helps\n- Short sessions.')
    const latest = base.replace('## What helps', '## What helps\n- Follows a worked example.')
    expect(rebaseEdit(base, draft, latest, SECTIONS)).toBe(
      base.replace('## What helps', '## What helps\n- Follows a worked example.\n- Short sessions.'),
    )
  })

  it("takes out what you took out, and doesn't bring back what the tutor did", () => {
    const draft = base.replace('- Answers fast and checks nothing.\n', '')
    const latest = base.replace('- Second-year biology.', '- Third-year biology.')
    const out = rebaseEdit(base, draft, latest, SECTIONS)
    expect(out).not.toContain('Answers fast')
    expect(out).toContain('- Third-year biology.')
    expect(out).not.toContain('Second-year')
  })

  it('keeps a rewording and a move', () => {
    const draft = base
      .replace('- Reaches for a formula first.\n', '')
      .replace('## What helps', '## What helps\n- Reaches for a formula before reading the question.')
    const latest = base + '\n- Resitting in spring.'
    const out = rebaseEdit(base, draft, latest, SECTIONS)
    expect(out).toBe(
      [
        '## How they work',
        '- Answers fast and checks nothing.',
        '',
        '## What helps',
        '- Reaches for a formula before reading the question.',
        '',
        '## Course and level',
        '- Second-year biology.',
        '- Resitting in spring.',
      ].join('\n'),
    )
  })

  it('with nothing changed, is the latest version', () => {
    const latest = base.replace('## What helps', '## What helps\n- Diagrams.')
    expect(rebaseEdit(base, base, latest, SECTIONS)).toBe(latest)
  })
})
