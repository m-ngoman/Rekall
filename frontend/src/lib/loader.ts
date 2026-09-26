/** How the loading mark's nodes float: eight of them, each on its own path through the others in
 * three dimensions, linked while they are near each other.
 *
 * It suggests the Rekall mark rather than drawing it: nodes, links, one of them bright. The logo's
 * own geometry is in lib/logo.
 *
 * Pure, with no DOM, so the motion can be tested: that it stays inside its box, never jumps, passes
 * every node through every other, and never draws too few links or too many.
 */

/** One axis of a node's path: [amplitude in viewBox units, period in ms, phase]. */
type Wave = readonly [number, number, number]

interface LoaderNode {
  /** Where its path is centred, from the middle of the box, and its radius at rest depth. */
  x: number
  y: number
  r: number
  /** Across, down and in depth. */
  path: readonly [Wave, Wave, Wave]
}

/** The middle of the 120 × 120 viewBox. */
export const CENTRE = 60

/** Every path passes through the middle, so every node crosses every other now and then. No two
 * periods are shared, so the whole never visibly repeats. The phases set where each node is when the
 * mark appears: spread out, none overlapping, a few linked. */
export const LOADER_NODES: readonly LoaderNode[] = [
  { x: 0, y: 0, r: 8.5, path: [[20, 9100, 2.54], [18, 7300, 3.06], [20, 8300, 0.19]] },
  { x: -5, y: 3, r: 5.5, path: [[31, 6700, 4.72], [28, 8900, 3.12], [26, 7700, 3.9]] },
  { x: 5, y: -4, r: 5, path: [[29, 8500, 1.35], [32, 6100, 2.65], [24, 9700, 1.74]] },
  { x: -6, y: -5, r: 6, path: [[28, 7100, 0.72], [30, 9900, 4.94], [28, 6300, 1.95]] },
  { x: 4, y: 6, r: 5, path: [[32, 9500, 3.76], [27, 7500, 6.06], [25, 8700, 4.71]] },
  { x: -2, y: -6, r: 4.5, path: [[29, 5900, 2.02], [31, 8100, 1.86], [30, 10300, 5.09]] },
  { x: 6, y: 2, r: 5.5, path: [[31, 10900, 3.36], [29, 6500, 5.5], [27, 7900, 2.76]] },
  { x: -6, y: 5, r: 5, path: [[30, 6900, 4.69], [31, 9300, 1.41], [24, 11300, 4.62]] },
]

/** The bright node, as the logo has one. It keeps nearer the middle, so the others weave through it. */
export const BRIGHT = 0

/** The perspective: how far the eye is from the middle of the box, in viewBox units. Nearer would
 * exaggerate the depth; further would flatten it. */
export const FOCAL = 150

/** The furthest any node goes toward or away from the eye: the largest depth amplitude. */
export const DEPTH = 30

/** Links: the shortest `LINK_CAP` at most, those within `LINK_REACH` of each other in space, and
 * never fewer than the shortest `LINK_FLOOR`. Each fades over `LINK_FADE` either side of the length
 * where it is half drawn, so none ever pops on or off. */
export const LINK_CAP = 7
export const LINK_FLOOR = 3
export const LINK_REACH = 33
export const LINK_FADE = 10

/** One node of the loading mark, as drawn this frame. */
export interface FloatingNode {
  /** Where it's drawn, in perspective, in the viewBox. */
  x: number
  y: number
  r: number
  /** How much larger perspective draws it than at rest depth: above 1 nearer the eye, below 1 further. */
  scale: number
  /** 0 at the furthest a node goes, 1 at the nearest. */
  near: number
  /** Where it is in space, from the middle of the box, before perspective: what links are measured by. */
  space: readonly [number, number, number]
}

const wave = ([amplitude, period, phase]: Wave, t: number) => amplitude * Math.sin((2 * Math.PI * t) / period + phase)

/** Where the nodes are `t` ms after the mark appears, seen in perspective. A node coming toward the
 * eye grows and moves out from the middle; one going away shrinks and moves in. */
export function floatAt(t: number): FloatingNode[] {
  return LOADER_NODES.map(({ x: cx, y: cy, r, path: [px, py, pz] }) => {
    const x = cx + wave(px, t)
    const y = cy + wave(py, t)
    const z = wave(pz, t)
    const scale = FOCAL / (FOCAL - z)
    return { x: CENTRE + x * scale, y: CENTRE + y * scale, r: r * scale, scale, near: (z + DEPTH) / (2 * DEPTH), space: [x, y, z] }
  })
}

/** The mark before it moves, and all it shows under reduced motion. */
export const LOADER_REST: readonly FloatingNode[] = floatAt(0)

/** Every pair of nodes, each once: what a link can join. */
export const PAIRS: readonly (readonly [number, number])[] = LOADER_NODES.flatMap((_, a) =>
  LOADER_NODES.slice(a + 1).map((_, k) => [a, a + 1 + k] as const),
)

const smoothstep = (from: number, to: number, x: number) => {
  const u = Math.min(Math.max((x - from) / (to - from), 0), 1)
  return u * u * (3 - 2 * u)
}

/** How strongly each pair in PAIRS is linked this frame: 1 fully drawn, 0 not at all. The length at
 * which a link is half drawn follows the nodes: LINK_REACH, shortened so no more than the shortest
 * LINK_CAP pass it, lengthened to a unit past the shortest LINK_FLOOR so they are always more than
 * half drawn. Both limits move as smoothly as the nodes do, so no link ever pops. */
export function linksAt(nodes: readonly FloatingNode[]): number[] {
  const lengths = PAIRS.map(([a, b]) => {
    const [ax, ay, az] = nodes[a].space
    const [bx, by, bz] = nodes[b].space
    return Math.hypot(ax - bx, ay - by, az - bz)
  })
  const sorted = [...lengths].sort((p, q) => p - q)
  const half = Math.max(Math.min(LINK_REACH, sorted[LINK_CAP - 1]), sorted[LINK_FLOOR - 1] + 1)
  return lengths.map((length) => smoothstep(half + LINK_FADE, half - LINK_FADE, length))
}

/** How much larger a mark `size` px across draws its nodes and links: 1 from 48px up, and up to √2 at
 * 24px, where they would otherwise be specks. */
export function sizeBoost(size: number): number {
  return Math.min(1.5, Math.max(1, Math.sqrt(48 / size)))
}

/** How opaque something `base`-opaque is drawn at nearness `near`: dimmer further away and brighter
 * closer, never below `floor` or above 1. */
export function depthOpacity(base: number, near: number, floor = 0): number {
  return Math.min(1, Math.max(floor, base * (1 + 0.6 * (near - 0.5))))
}
