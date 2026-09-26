import { useEffect, useRef } from 'react'
import { BRIGHT, LOADER_REST, PAIRS, depthOpacity, floatAt, linksAt, sizeBoost, type FloatingNode } from '../lib/loader'

interface Props {
  /** Pixels, square. */
  size?: number
  /** What is being waited for. Read out by screen readers; also shown under the mark with `showLabel`. */
  label?: string
  showLabel?: boolean
  /** Milliseconds before it appears. A screen that loads in less shows nothing at all, rather than a
   * mark that flashes; a wait the student just started (a reply, a grade, a deck) passes 0. */
  delay?: number
  /** Layout: the mark sets none of its own, since it sits inline in a reply as readily as centred
   * in an empty screen. */
  className?: string
}

/** A dim node's opacity and a full link's, half way back, as the logo draws its nodes and edges. */
const DIM = 0.58
const LINK = 0.42
/** A link's stroke width at rest depth, in viewBox units: finer than the logo's edges, since there
 * are more of them. */
const LINK_WIDTH = 4

const REST_LINKS = linksAt(LOADER_REST)
/** Furthest first, so the nearest is painted over the rest. */
const byDepth = (nodes: readonly FloatingNode[]) => nodes.map((_, i) => i).sort((a, b) => nodes[a].near - nodes[b].near)
const nodeOpacity = (node: FloatingNode, i: number) =>
  // The bright node stays the brightest thing in the mark, however far back it goes.
  i === BRIGHT ? depthOpacity(1, node.near, 0.85) : depthOpacity(DIM, node.near)
const linkWidth = (a: FloatingNode, b: FloatingNode) => LINK_WIDTH * ((a.scale + b.scale) / 2)
const linkOpacity = (strength: number, a: FloatingNode, b: FloatingNode) => strength * depthOpacity(LINK, (a.near + b.near) / 2)

/**
 * The loading mark: a handful of nodes floating through each other in three dimensions, linked
 * while they are near.
 *
 * In the student's accent, like every drawing of the logo (see Logo), and in its language, dim nodes
 * around one bright one, without its shape. Each node follows its own slow path through the middle
 * (lib/loader), so they pass in front of, behind and through each other and the whole never repeats.
 * Seen in perspective, a node coming nearer grows, brightens and is drawn over the others; one going
 * away shrinks and dims. Two nodes that come near each other are linked, the link fading in as they
 * close and out as they part. A small mark draws its nodes and links larger (sizeBoost), so the
 * 24px one inline in a reply still reads as nodes rather than specks.
 *
 * Drawn by writing the SVG's attributes from an animation frame loop, as VoiceOrb draws its canvas:
 * no React render per frame, and browsers pause the loop in a hidden tab. React never touches those
 * attributes again, since the props it rendered them from never change, and never reorders the
 * circles either, so the loop can move the nearest to the end to paint it last. Under reduced
 * motion there is no loop; the mark holds still and only the bright node's opacity changes, slowly
 * (index.css).
 *
 * The delay is CSS (`.node-loader`): hidden until then, and not read out, but taking its space from
 * the start, so appearing moves nothing.
 */
export default function NodeLoader({ size = 48, label = 'Loading', showLabel = false, delay = 300, className = '' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const boost = sizeBoost(size)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const lines = svg.querySelectorAll('line')
    // By their own index, not their place: the loop reorders them, and this effect can run again.
    const circles = LOADER_REST.map((_, i) => svg.querySelector<SVGCircleElement>(`circle[data-node="${i}"]`)!)
    const layer = circles[0].parentNode!
    let order = [...layer.children].map((c) => Number(c.getAttribute('data-node')))

    const draw = (nodes: readonly FloatingNode[]) => {
      const links = linksAt(nodes)
      PAIRS.forEach(([from, to], i) => {
        const [a, b] = [nodes[from], nodes[to]]
        lines[i].setAttribute('x1', a.x.toFixed(2))
        lines[i].setAttribute('y1', a.y.toFixed(2))
        lines[i].setAttribute('x2', b.x.toFixed(2))
        lines[i].setAttribute('y2', b.y.toFixed(2))
        lines[i].setAttribute('stroke-width', (linkWidth(a, b) * boost).toFixed(2))
        lines[i].setAttribute('stroke-opacity', linkOpacity(links[i], a, b).toFixed(3))
      })
      nodes.forEach((node, i) => {
        circles[i].setAttribute('cx', node.x.toFixed(2))
        circles[i].setAttribute('cy', node.y.toFixed(2))
        circles[i].setAttribute('r', (node.r * boost).toFixed(2))
        circles[i].setAttribute('fill-opacity', nodeOpacity(node, i).toFixed(3))
      })
      const next = byDepth(nodes)
      if (next.some((n, k) => n !== order[k])) {
        for (const n of next) layer.appendChild(circles[n])
        order = next
      }
    }

    let frame = 0
    let last: number | null = null
    // Counts from the moment the mark appears, so the float begins as it fades in.
    let clock = -delay
    const tick = (now: number) => {
      // A hidden tab stops the loop; on the way back, carry on rather than leap ahead.
      if (last !== null) clock += Math.min(now - last, 64)
      last = now
      if (clock > 0) draw(floatAt(clock))
      frame = requestAnimationFrame(tick)
    }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const start = () => {
      cancelAnimationFrame(frame)
      last = null
      if (reduce?.matches) {
        draw(LOADER_REST)
        return
      }
      // Turned back on mid-wait, it carries on from the still frame it was holding.
      clock = Math.min(clock, 0)
      frame = requestAnimationFrame(tick)
    }
    start()
    reduce?.addEventListener?.('change', start)
    return () => {
      cancelAnimationFrame(frame)
      reduce?.removeEventListener?.('change', start)
    }
  }, [delay, boost])

  return (
    <span role="status" className={`node-loader ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        aria-hidden="true"
        className="block flex-shrink-0"
        style={{ color: 'var(--accent)' }}
      >
        <g stroke="currentColor" strokeLinecap="round">
          {PAIRS.map(([from, to], i) => {
            const [a, b] = [LOADER_REST[from], LOADER_REST[to]]
            return (
              <line
                key={i}
                data-a={from}
                data-b={to}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={linkWidth(a, b) * boost}
                strokeOpacity={linkOpacity(REST_LINKS[i], a, b)}
              />
            )
          })}
        </g>
        <g fill="currentColor">
          {byDepth(LOADER_REST).map((i) => (
            <circle
              key={i}
              data-node={i}
              cx={LOADER_REST[i].x}
              cy={LOADER_REST[i].y}
              r={LOADER_REST[i].r * boost}
              fillOpacity={nodeOpacity(LOADER_REST[i], i)}
              className={i === BRIGHT ? 'node-loader-bright' : undefined}
            />
          ))}
        </g>
      </svg>
      <span
        className={
          showLabel
            ? 'max-w-[18rem] text-center text-[0.9375rem] font-semibold text-[var(--text-muted)] [text-wrap:balance]'
            : 'sr-only'
        }
      >
        {label}
      </span>
    </span>
  )
}
