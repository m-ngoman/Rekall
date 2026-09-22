import { describe, expect, it } from 'vitest'
import { hydrate } from './hydrate'

const at = '2026-09-24T10:00:00Z'

describe('hydrate', () => {
  it('shows a stored photo placeholder as a dropped photo, not as text', () => {
    expect(hydrate([{ role: 'user', content: '[Sent a photo]', created_at: at }])).toEqual([
      { role: 'user', text: '', photoDropped: true },
    ])
  })

  it('lifts trailing graph traces into captions', () => {
    const [m] = hydrate([
      { role: 'assistant', content: 'It is a U shape.\n\n[Graph shown: y = x^2 from -3 to 3]', created_at: at },
    ])
    expect(m).toEqual({ role: 'assistant', text: 'It is a U shape.', captions: ['Graph shown: y = x^2 from -3 to 3'] })
  })

  it('leaves a bracketed sentence the tutor wrote itself where it is', () => {
    const [m] = hydrate([{ role: 'assistant', content: 'Try this.\n[Hint: factor first]', created_at: at }])
    expect(m).toEqual({ role: 'assistant', text: 'Try this.\n[Hint: factor first]' })
  })
})
