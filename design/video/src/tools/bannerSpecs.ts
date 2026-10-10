// The profile images, as data: what each platform asks for and where its own interface covers the
// image. `safe` is the box the content has to stay inside, in the image's pixels.
export interface BannerSpec {
  file: string
  width: number
  height: number
  /** Where the platform's own interface leaves the image visible. */
  safe: { x: number; y: number; width: number; height: number }
  /** The lockup's sizes: mark and wordmark, the tagline, the address. */
  mark: number
  tagline: number
  url: number
  align: 'center' | 'start'
}

export const BANNERS = {
  x: {
    file: 'x-header',
    width: 1500,
    height: 500,
    // The profile photo sits over the lower left; on a phone the sides are cropped a little.
    safe: { x: 380, y: 60, width: 1020, height: 380 },
    mark: 104,
    tagline: 34,
    url: 30,
    align: 'center',
  },
  linkedin: {
    file: 'linkedin-banner',
    width: 1584,
    height: 396,
    // The profile photo covers the lower left, and the top strip is cropped on a phone.
    safe: { x: 420, y: 56, width: 1080, height: 284 },
    mark: 84,
    tagline: 28,
    url: 26,
    align: 'center',
  },
  youtube: {
    file: 'youtube-banner',
    width: 2560,
    height: 1440,
    // The one area every device shows: 1546 × 423, centred.
    safe: { x: 507, y: 508, width: 1546, height: 423 },
    mark: 132,
    tagline: 46,
    url: 38,
    align: 'center',
  },
} as const satisfies Record<string, BannerSpec>

/** The avatar: square, drawn for the circle most platforms cut it to. The mark's box is this share
 * of the width; its drawing fills about 70% of that box, and its corners stay well inside the circle. */
export const AVATAR = { file: 'avatar', size: 1024, markShare: 0.82 } as const

export type BannerName = keyof typeof BANNERS
