/** The Rekall mark's geometry, and how its nodes float in the loading mark.
 *
 * One set of coordinates for every drawing of the mark in the app: `Logo` draws them still and
 * `NodeLoader` sets them floating. `public/logo.svg` and the favicon `useSettings` builds are
 * static copies of the same numbers, so a change here is a change there too.
 *
 * Pure, with no DOM, so the motion can be tested: that it stays inside its box, never jumps, and
 * really does pass nodes in front of each other.
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

// --- The loading mark ------------------------------------------------------------------------------

/** The middle of the mark: its nodes span 17.5–101.5 across and 26.5–100.5 down. */
export const CENTRE: Point = { x: 59.5, y: 63.5 }

/** The loader rests as the logo drawn smaller about its middle, which leaves the nodes room to
 * float without leaving the box. */
export const LOADER_SCALE = 0.78

/** The perspective: how far the eye is from the plane the logo sits in, in viewBox units. Nearer
 * would exaggerate the depth; further would flatten it. */
export const FOCAL = 150

/** The furthest any node floats toward or away from the eye. */
export const DEPTH = 22

/** How long the float takes to reach its full size. It starts from the still mark, so the first
 * thing seen is the logo itself. */
export const FLOAT_EASE_MS = 2000

/** Each node's own slow path about where it rests, on each axis: [amplitude in viewBox units,
 * period in ms, phase]. No two periods are shared, so the shape keeps changing and never visibly
 * repeats, and every node passes in front of every other now and then. */
const PATHS: readonly (readonly [number, number, number])[][] = [
  [[10, 7300, 0], [8, 5900, 1.3], [22, 8300, 2.1]],
  [[9, 6100, 2.4], [10, 7700, 0.4], [20, 9700, 4.0]],
  [[11, 5300, 4.2], [9, 6700, 2.9], [22, 7100, 0.9]],
  [[8, 8900, 1.1], [8, 4700, 5.3], [21, 6100, 3.3]],
]

/** One node of the loading mark, as drawn this frame. */
export interface FloatingNode extends Point {
  r: number
  /** How much larger perspective draws it than at rest: above 1 nearer the eye, below 1 further. */
  scale: number
  /** 0 at the furthest a node goes, 1 at the nearest; 0.5 at rest. */
  near: number
}

/** Where the loader's nodes are `t` ms into the float, seen in perspective. At `t` ≤ 0 they rest in
 * the logo's layout. A node coming toward the eye grows and moves out from the middle; one going
 * away shrinks and moves in. */
export function floatAt(t: number): FloatingNode[] {
  const e = Math.min(Math.max(t / FLOAT_EASE_MS, 0), 1)
  const ease = e * e * (3 - 2 * e)
  const wave = ([amplitude, period, phase]: readonly [number, number, number]) =>
    ease * amplitude * Math.sin((2 * Math.PI * t) / period + phase)
  return LOGO_NODES.map((node, i) => {
    const [px, py, pz] = PATHS[i]
    const x = (node.x - CENTRE.x) * LOADER_SCALE + wave(px)
    const y = (node.y - CENTRE.y) * LOADER_SCALE + wave(py)
    const z = wave(pz)
    const scale = FOCAL / (FOCAL - z)
    return {
      x: CENTRE.x + x * scale,
      y: CENTRE.y + y * scale,
      r: node.r * LOADER_SCALE * scale,
      scale,
      near: (z + DEPTH) / (2 * DEPTH),
    }
  })
}

/** The loader at rest: the logo's layout at the loader's scale. */
export const LOADER_REST: readonly FloatingNode[] = floatAt(0)

/** How opaque something `base`-opaque is drawn at nearness `near`: as the logo has it at rest,
 * dimmer further away and brighter closer, never below `floor` or above 1. */
export function depthOpacity(base: number, near: number, floor = 0): number {
  return Math.min(1, Math.max(floor, base * (1 + 0.6 * (near - 0.5))))
}
