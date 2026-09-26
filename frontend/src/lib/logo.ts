/** The Rekall mark's geometry.
 *
 * `Logo` draws it. `public/logo.svg` and the favicon `useSettings` builds are static copies of the
 * same numbers, so a change here is a change there too. The loading mark only suggests the logo,
 * and floats by its own numbers (lib/loader).
 */

export interface Point {
  x: number
  y: number
}

export interface LogoNode extends Point {
  r: number
}

/** A, B and C, the small triangle, then D, the bright node: the order `Logo` paints them. In the
 * 120 × 120 viewBox. */
export const LOGO_NODES: readonly LogoNode[] = [
  { x: 26, y: 84, r: 8.5 },
  { x: 56, y: 92, r: 8.5 },
  { x: 38, y: 58, r: 8.5 },
  { x: 88, y: 40, r: 13.5 },
]

/** D: the one thing held, by two edges. */
export const HELD = 3

/** [from, to, stroke width], in paint order. The triangle's edges are a touch heavier than D's. */
export const LOGO_EDGES: readonly (readonly [number, number, number])[] = [
  [0, 1, 6],
  [1, 2, 6],
  [2, 0, 6],
  [2, 3, 5.5],
  [1, 3, 5.5],
]
