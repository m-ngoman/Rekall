import { useEffect, useRef } from 'react'
import { HELD, LOGO_EDGES, LOGO_NODES, driftAt, driftGain, type Point } from '../lib/logo'

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
 * The loading mark: the Rekall logo, its nodes drifting slowly about where they rest.
 *
 * The logo's own colours, never the accent: muted, with the held node in the text colour. Each
 * node follows its own slow path (lib/logo), and the edges are redrawn from the nodes every frame,
 * so they stretch rather than detach. It starts as the still logo and eases into the drift.
 *
 * Drawn by writing the SVG's attributes from an animation frame loop, as VoiceOrb draws its canvas:
 * no React render per frame, and browsers pause the loop in a hidden tab. React never touches those
 * attributes again, since the props it rendered them from never change. Under reduced motion there
 * is no loop; the mark holds still and only the held node's opacity changes, slowly (index.css).
 *
 * The delay is CSS (`.node-loader`): hidden until then, and not read out, but taking its space from
 * the start, so appearing moves nothing.
 */
export default function NodeLoader({ size = 40, label = 'Loading', showLabel = false, delay = 300, className = '' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const lines = svg.querySelectorAll('line')
    const circles = svg.querySelectorAll('circle')
    const gain = driftGain(size)

    const draw = (points: readonly Point[]) => {
      LOGO_EDGES.forEach(([from, to], i) => {
        lines[i].setAttribute('x1', points[from].x.toFixed(2))
        lines[i].setAttribute('y1', points[from].y.toFixed(2))
        lines[i].setAttribute('x2', points[to].x.toFixed(2))
        lines[i].setAttribute('y2', points[to].y.toFixed(2))
      })
      points.forEach((point, i) => {
        circles[i].setAttribute('cx', point.x.toFixed(2))
        circles[i].setAttribute('cy', point.y.toFixed(2))
      })
    }

    let frame = 0
    let last: number | null = null
    // Counts from the moment the mark appears, so the drift begins as it fades in.
    let clock = -delay
    const tick = (now: number) => {
      // A hidden tab stops the loop; on the way back, carry on rather than leap ahead.
      if (last !== null) clock += Math.min(now - last, 64)
      last = now
      if (clock > 0) draw(driftAt(clock, gain))
      frame = requestAnimationFrame(tick)
    }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const start = () => {
      cancelAnimationFrame(frame)
      last = null
      if (reduce?.matches) {
        draw(LOGO_NODES)
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
  }, [size, delay])

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
        style={{ color: 'var(--text-muted)' }}
      >
        <g stroke="currentColor" strokeOpacity={0.42} strokeLinecap="round">
          {LOGO_EDGES.map(([from, to, width], i) => (
            <line key={i} x1={LOGO_NODES[from].x} y1={LOGO_NODES[from].y} x2={LOGO_NODES[to].x} y2={LOGO_NODES[to].y} strokeWidth={width} />
          ))}
        </g>
        <g fill="currentColor">
          {LOGO_NODES.map((node, i) =>
            i === HELD ? (
              // The one thing held, in the text colour, as the design handoff has the mark.
              <circle key={i} cx={node.x} cy={node.y} r={node.r} className="node-loader-held" style={{ fill: 'var(--text)' }} />
            ) : (
              <circle key={i} cx={node.x} cy={node.y} r={node.r} fillOpacity={0.58} />
            ),
          )}
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
