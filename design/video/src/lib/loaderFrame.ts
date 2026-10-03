import { BRIGHT, LOADER_REST, PAIRS, depthOpacity, floatAt, linksAt, sizeBoost, type FloatingNode } from '@app/lib/loader'
import { EASE_OUT } from './ease'

/** NodeLoader.tsx's drawing constants. The motion itself is the app's (lib/loader, imported); these
 * are the few numbers NodeLoader keeps to itself, held in step by src/__tests__/drift.test.ts. */
export const DIM = 0.58
export const LINK = 0.42
export const LINK_WIDTH = 4
/** `.node-loader`: node-loader-in 200ms ease-out, after the element's own delay. */
export const FADE_IN_MS = 200

export interface DrawnNode {
  /** Index into LOADER_NODES — the bright one is BRIGHT. */
  i: number
  x: number
  y: number
  r: number
  opacity: number
}
export interface DrawnLink {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  opacity: number
}
export interface LoaderFrame {
  /** The mark's own fade-in. */
  opacity: number
  /** Furthest first: the order to paint them in. */
  nodes: DrawnNode[]
  links: DrawnLink[]
}

export const nodeOpacity = (node: FloatingNode, i: number) =>
  i === BRIGHT ? depthOpacity(1, node.near, 0.85) : depthOpacity(DIM, node.near)
export const linkWidth = (a: FloatingNode, b: FloatingNode) => LINK_WIDTH * ((a.scale + b.scale) / 2)
export const linkOpacity = (strength: number, a: FloatingNode, b: FloatingNode) =>
  strength * depthOpacity(LINK, (a.near + b.near) / 2)

/** The loading mark `ms` after it mounted, as NodeLoader draws it: hidden for `delay`, then fading
 * in over 200 ms while the nodes start to float — its clock counts from the moment it appears. */
export function loaderFrame(ms: number, size: number, delay: number): LoaderFrame {
  const boost = sizeBoost(size)
  const clock = ms - delay
  const nodes = clock > 0 ? floatAt(clock) : LOADER_REST
  const strengths = linksAt(nodes)
  const opacity = clock < 0 ? 0 : EASE_OUT(Math.min(1, clock / FADE_IN_MS))
  return {
    opacity,
    nodes: nodes
      .map((n, i) => ({ i, x: n.x, y: n.y, r: n.r * boost, opacity: nodeOpacity(n, i), near: n.near }))
      .sort((a, b) => a.near - b.near)
      .map(({ i, x, y, r, opacity: o }) => ({ i, x, y, r, opacity: o })),
    links: PAIRS.map(([from, to], k) => {
      const [a, b] = [nodes[from], nodes[to]]
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: linkWidth(a, b) * boost, opacity: linkOpacity(strengths[k], a, b) }
    }),
  }
}
