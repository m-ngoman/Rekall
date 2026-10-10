import { describe, expect, it } from 'vitest'
import { END_CARD } from '../data/copy'
import { AVATAR, BANNERS, type BannerSpec } from '../tools/bannerSpecs'

describe('the profile images', () => {
  const banners = Object.entries(BANNERS) as [string, BannerSpec][]
  it.each(banners)('%s keeps its content inside its safe box, inside the image', (_, b) => {
    expect(b.safe.x).toBeGreaterThanOrEqual(0)
    expect(b.safe.y).toBeGreaterThanOrEqual(0)
    expect(b.safe.x + b.safe.width).toBeLessThanOrEqual(b.width)
    expect(b.safe.y + b.safe.height).toBeLessThanOrEqual(b.height)
  })
  it.each(banners)('%s has a lockup that fits its safe box', (_, b) => {
    // Mark row, then the tagline in at most two lines at its width, then the address.
    const height = b.mark + b.mark * 0.32 + 2 * b.tagline * 1.3 + b.mark * 0.2 + b.url * 1.4
    expect(height).toBeLessThanOrEqual(b.safe.height)
  })
  it('match the platforms’ sizes', () => {
    expect([BANNERS.x.width, BANNERS.x.height]).toEqual([1500, 500])
    expect([BANNERS.linkedin.width, BANNERS.linkedin.height]).toEqual([1584, 396])
    expect([BANNERS.youtube.width, BANNERS.youtube.height]).toEqual([2560, 1440])
    expect(BANNERS.youtube.safe).toEqual({ x: 507, y: 508, width: 1546, height: 423 })
    expect(AVATAR.size).toBe(1024)
  })
  it('say what the end card says, and no handle that could go stale', () => {
    expect(END_CARD.tagline).toBe('Flashcards that read what you actually wrote, and tell you what you missed.')
    expect(END_CARD.url).toBe('rekall.study')
  })
})
