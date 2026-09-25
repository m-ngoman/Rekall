import { describe, expect, it } from 'vitest'
import { lineEvidence, profileLineCount } from './profile'
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

  it('says when a line has gone quiet', () => {
    expect(lineEvidence(tutor(2, true))).toMatch(/^2 sessions · hasn't come up since \w+/)
  })

  it('has nothing to say about your own lines', () => {
    expect(lineEvidence(mine)).toBeNull()
  })
})
