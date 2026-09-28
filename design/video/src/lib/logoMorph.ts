import { BRIGHT, LOADER_NODES, floatAt, linksAt, PAIRS, type FloatingNode } from '@app/lib/loader'
import { HELD, LOGO_EDGES, LOGO_NODES } from '@app/lib/logo'
import { APP_EASE, clamp, lerp, progress } from './ease'
import { DIM, linkOpacity, linkWidth, nodeOpacity } from './loaderFrame'

/** Which floating node becomes which logo node. The bright node is always the held one, D: the mark
 * has one bright node and so does the logo. Of the seven dim nodes, the three nearest A, B and C at
 * the moment the morph starts take those places — every assignment is tried (7 × 6 × 5 = 210), so
 * the least total travel wins and nothing crosses the mark on its way. The other four fade out. */
export function assignNodes(start: readonly FloatingNode[]): { toLogo: Map<number, number>; leaving: number[] } {
  const dim = LOADER_NODES.map((_, i) => i).filter((i) => i !== BRIGHT)
  const targets = [0, 1, 2].map((k) => LOGO_NODES[k])
  let best = { cost: Infinity, pick: [0, 0, 0] }
  for (const a of dim)
    for (const b of dim)
      for (const c of dim) {
        if (a === b || b === c || a === c) continue
        const pick = [a, b, c]
        const cost = pick.reduce((sum, n, k) => sum + Math.hypot(start[n].x - targets[k].x, start[n].y - targets[k].y), 0)
        if (cost < best.cost) best = { cost, pick }
      }
  const toLogo = new Map<number, number>([[BRIGHT, HELD]])
  best.pick.forEach((n, k) => toLogo.set(n, k))
  return { toLogo, leaving: dim.filter((i) => !best.pick.includes(i)) }
}

export interface MorphFrame {
  nodes: { i: number; x: number; y: number; r: number; opacity: number }[]
  /** The loader's own links, fading out. */
  links: { x1: number; y1: number; x2: number; y2: number; width: number; opacity: number }[]
  /** The logo's five edges drawing on between the moving nodes: `draw` is how much of each. */
  edges: { x1: number; y1: number; x2: number; y2: number; width: number; opacity: number; draw: number }[]
}

/** The loading mark becoming the logo. `floatMs` is the float's own clock, which keeps running
 * under the morph so nothing stops dead; `p` is the morph's progress, 0 to 1. At 1 the nodes sit
 * exactly on the logo's geometry and the caller swaps in the real <Logo>. */
export function logoMorph(floatMs: number, startMs: number, p: number): MorphFrame {
  const { toLogo } = assignNodes(floatAt(startMs))
  const now = floatAt(floatMs)
  const strengths = linksAt(now)
  const e = APP_EASE(clamp(p))

  const nodes = now.map((n, i) => {
    const target = toLogo.get(i)
    if (target === undefined) {
      // Leaving: shrink toward 60% and fade by p = 0.6, drifting a little toward the mark's middle.
      const q = progress(p, 0, 0.6)
      return { i, x: lerp(n.x, 60, q * 0.25), y: lerp(n.y, 64, q * 0.25), r: n.r * lerp(1, 0.6, q), opacity: nodeOpacity(n, i) * (1 - q), near: n.near }
    }
    const goal = LOGO_NODES[target]
    return {
      i,
      x: lerp(n.x, goal.x, e),
      y: lerp(n.y, goal.y, e),
      r: lerp(n.r, goal.r, e),
      opacity: lerp(nodeOpacity(n, i), target === HELD ? 1 : DIM, e),
      near: lerp(n.near, target === HELD ? 1 : 0.5, e),
    }
  })

  const linkFade = 1 - progress(p, 0, 0.5)
  const at = (logoIndex: number) => {
    const i = [...toLogo.entries()].find(([, t]) => t === logoIndex)![0]
    return nodes[i]
  }
  return {
    nodes: [...nodes].sort((a, b) => a.near - b.near).map(({ i, x, y, r, opacity }) => ({ i, x, y, r, opacity })),
    links: PAIRS.map(([from, to], k) => {
      const [a, b] = [now[from], now[to]]
      const [na, nb] = [nodes[from], nodes[to]]
      return { x1: na.x, y1: na.y, x2: nb.x, y2: nb.y, width: linkWidth(a, b), opacity: linkOpacity(strengths[k], a, b) * linkFade }
    }),
    edges: LOGO_EDGES.map(([from, to, width], k) => {
      const [a, b] = [at(from), at(to)]
      // Staggered a touch, the triangle first and the two that hold D last.
      const draw = progress(p, 0.35 + k * 0.06, 0.4)
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, width, opacity: 0.42, draw }
    }),
  }
}
