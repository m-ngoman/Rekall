/** Accent constants only. The stateful hook that used to live here is gone: the accent is now one
 * of the user's server-stored settings, applied by useSettings alongside the theme, and its
 * localStorage mirror is written there and read by the pre-paint script in index.html.
 */
export const DEFAULT_ACCENT = 'oklch(0.7 0.145 40)'

/** Same lightness and the same chroma for every preset — only the hue changes.
 *
 * They used to drift: coral sat at L 0.70 / C 0.16 while sage and dusty blue were L 0.62 / C 0.10,
 * so the greens and blues read as washed out next to the others on the dark background. In oklch
 * both numbers are perceptual, so holding them fixed is what makes four hues feel like one family
 * rather than four unrelated colours.
 *
 * C is 0.145 rather than higher because that's what dusty blue can reach — blue has the narrowest
 * sRGB gamut of the four at this lightness (0.145 is 89% of its maximum). Pushing the others
 * further would restore exactly the imbalance this fixes, just with different winners.
 */
export const ACCENT_PRESETS = [
  { name: 'Coral', value: DEFAULT_ACCENT },
  { name: 'Sage', value: 'oklch(0.7 0.145 145)' },
  { name: 'Dusty Blue', value: 'oklch(0.7 0.145 250)' },
  { name: 'Berry', value: 'oklch(0.7 0.145 340)' },
]

/** The last colour picked from the colour wheel, remembered so it keeps a swatch in the row
 * beside the presets. Without it a custom accent is invisible the moment you choose it: nothing
 * in the row is highlighted, and going back to it means finding the exact shade again.
 *
 * Local to the device rather than server-stored: it's a convenience for re-picking, not part of
 * the account. The accent actually in force is a real setting and syncs as it always did.
 */
const CUSTOM_ACCENT_KEY = 'pipcards:customAccent'

export function readCustomAccent(): string | null {
  try {
    return localStorage.getItem(CUSTOM_ACCENT_KEY)
  } catch {
    return null
  }
}

export function writeCustomAccent(value: string): void {
  try {
    localStorage.setItem(CUSTOM_ACCENT_KEY, value)
  } catch {
    // Private browsing. The colour still applies for this session; it just won't be remembered.
  }
}
