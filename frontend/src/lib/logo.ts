/** The Rekall mark's geometry, and how its nodes drift in the loading mark.
 *
 * One set of coordinates for every drawing of the mark in the app: `Logo` draws them still and
 * `NodeLoader` draws them drifting. `public/logo.svg` and the favicon `useSettings` builds are
 * static copies of the same numbers, so a change here is a change there too.
 *
 * Pure, with no DOM, so the drift can be tested for the one thing it must never do: close the
 * bright node's two edges up into one. A single edge ending in a round terminus reads as something
 * else entirely (see `Logo`).
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

/** Each node's own slow path around where it rests: a sine on each axis, amplitudes in viewBox
 * units, periods in ms. The periods don't line up, so the motion never visibly repeats.
 *
 * Each node moves most along its edges rather than across them, so the triangle breathes more than
 * it swings: C mostly sideways (its edge to D is nearly flat), B mostly up and down (its edge to D
 * is steep). D, the held node, moves least and slowest. A, attached to neither of D's edges, is
 * the freest — though not far vertically, since A and C are the closest pair. */
const PATHS = [
  { ax: 4, ay: 2.5, px: 4700, py: 3900, fx: 0, fy: 1.9 },
  { ax: 1.5, ay: 4.5, px: 5300, py: 4300, fx: 2.3, fy: 0.7 },
  { ax: 4.5, ay: 1.5, px: 4100, py: 5900, fx: 4.1, fy: 3.0 },
  { ax: 2.5, ay: 2, px: 6700, py: 5100, fx: 1.2, fy: 5.2 },
] as const

/** How long the drift takes to reach its full size. It starts from the still mark, so the first
 * thing seen is the logo itself. */
export const DRIFT_EASE_MS = 400

/** A small mark drifts a little more, or its motion is lost at a few pixels. Capped here: at twice
 * the drift, D's two edges touch where they leave it. */
export const MAX_DRIFT_GAIN = 1.5

/** The drift's scale for a mark `sizePx` wide: 1 at 40px and up, rising to the cap for small ones. */
export function driftGain(sizePx: number): number {
  return Math.min(MAX_DRIFT_GAIN, Math.max(1, 40 / sizePx))
}

/** Where the nodes are `t` ms into the drift. At `t` ≤ 0, exactly where the logo has them. */
export function driftAt(t: number, gain = 1): Point[] {
  const e = Math.min(Math.max(t / DRIFT_EASE_MS, 0), 1)
  const scale = gain * e * e * (3 - 2 * e)
  return LOGO_NODES.map((node, i) => {
    const path = PATHS[i]
    return {
      x: node.x + scale * path.ax * Math.sin((2 * Math.PI * t) / path.px + path.fx),
      y: node.y + scale * path.ay * Math.sin((2 * Math.PI * t) / path.py + path.fy),
    }
  })
}

/** The angle at the held node between its two edges, in degrees. */
export function heldAngle(points: readonly Point[]): number {
  const [a, b] = LOGO_EDGES.filter(([from, to]) => from === HELD || to === HELD).map(([from, to]) => (from === HELD ? to : from))
  const d = points[HELD]
  const u = { x: points[a].x - d.x, y: points[a].y - d.y }
  const v = { x: points[b].x - d.x, y: points[b].y - d.y }
  const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}
