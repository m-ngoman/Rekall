import { describe, expect, it } from 'vitest'
import { HELD, LOGO_EDGES } from './logo'

describe('the mark', () => {
  it('holds its bright node by two edges', () => {
    expect(LOGO_EDGES.filter(([from, to]) => from === HELD || to === HELD)).toHaveLength(2)
  })
})
