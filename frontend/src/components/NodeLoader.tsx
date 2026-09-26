import { useEffect, useRef } from 'react'
import { HELD, LOADER_REST, LOADER_SCALE, LOGO_EDGES, depthOpacity, floatAt, type FloatingNode } from '../lib/logo'

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

/**
 * The loading mark: the Rekall logo's nodes, each floating on its own in three dimensions.
 *
 * In the student's accent, like every drawing of the logo (see Logo). It starts as the logo and
 * comes apart from there: each node follows its own slow path across and in depth (lib/logo), so
 * the shape keeps changing and only suggests the logo. Seen in perspective, a node coming nearer
 * grows, brightens and is drawn over the others; one going away shrinks and dims. The edges follow
 * their nodes, heavier and brighter where their ends are near.
 *
 * Drawn by writing the SVG's attributes from an animation frame loop, as VoiceOrb draws its canvas:
 * no React render per frame, and browsers pause the loop in a hidden tab. React never touches those
 * attributes again, since the props it rendered them from never change, and never reorders the
 * circles either, so the loop can move the nearest to the end to paint it last. Under reduced
 * motion there is no loop; the mark holds still and only the held node's opacity changes, slowly
 * (index.css).
 *
 * The delay is CSS (`.node-loader`): hidden until then, and not read out, but taking its space from
 * the start, so appearing moves nothing.
 */
export default function NodeLoader({ size = 48, label = 'Loading', showLabel = false, delay = 300, className = '' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const lines = svg.querySelectorAll('line')
    // By their own index, not their place: the loop reorders them, and this effect can run again.
    const circles = LOADER_REST.map((_, i) => svg.querySelector<SVGCircleElement>(`circle[data-node="${i}"]`)!)
    const layer = circles[0].parentNode!
    let order = [...layer.children].map((c) => Number(c.getAttribute('data-node')))

    const draw = (nodes: readonly FloatingNode[]) => {
      LOGO_EDGES.forEach(([from, to, width], i) => {
        const [a, b] = [nodes[from], nodes[to]]
        lines[i].setAttribute('x1', a.x.toFixed(2))
        lines[i].setAttribute('y1', a.y.toFixed(2))
        lines[i].setAttribute('x2', b.x.toFixed(2))
        lines[i].setAttribute('y2', b.y.toFixed(2))
        lines[i].setAttribute('stroke-width', (width * LOADER_SCALE * ((a.scale + b.scale) / 2)).toFixed(2))
        lines[i].setAttribute('stroke-opacity', depthOpacity(0.42, (a.near + b.near) / 2).toFixed(3))
      })
      nodes.forEach((node, i) => {
        circles[i].setAttribute('cx', node.x.toFixed(2))
        circles[i].setAttribute('cy', node.y.toFixed(2))
        circles[i].setAttribute('r', node.r.toFixed(2))
        // The held node stays the brightest thing in the mark, however far back it goes.
        circles[i].setAttribute('fill-opacity', (i === HELD ? depthOpacity(1, node.near, 0.85) : depthOpacity(0.58, node.near)).toFixed(3))
      })
      // Furthest first, so the nearest is painted over the rest.
      const byDepth = nodes.map((_, i) => i).sort((a, b) => nodes[a].near - nodes[b].near)
      if (byDepth.some((n, k) => n !== order[k])) {
        for (const n of byDepth) layer.appendChild(circles[n])
        order = byDepth
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
      // Turned back on mid-wait, it eases in again from the still mark.
      clock = Math.min(clock, 0)
      frame = requestAnimationFrame(tick)
    }
    start()
    reduce?.addEventListener?.('change', start)
    return () => {
      cancelAnimationFrame(frame)
      reduce?.removeEventListener?.('change', start)
    }
  }, [delay])

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
        <g stroke="currentColor" strokeOpacity={0.42} strokeLinecap="round">
          {LOGO_EDGES.map(([from, to, width], i) => (
            <line
              key={i}
              x1={LOADER_REST[from].x}
              y1={LOADER_REST[from].y}
              x2={LOADER_REST[to].x}
              y2={LOADER_REST[to].y}
              strokeWidth={width * LOADER_SCALE}
            />
          ))}
        </g>
        <g fill="currentColor">
          {LOADER_REST.map((node, i) => (
            <circle
              key={i}
              data-node={i}
              cx={node.x}
              cy={node.y}
              r={node.r}
              fillOpacity={i === HELD ? undefined : 0.58}
              className={i === HELD ? 'node-loader-held' : undefined}
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
