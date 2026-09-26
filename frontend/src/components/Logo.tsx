import { HELD, LOGO_EDGES, LOGO_NODES } from '../lib/logo'

/** The Rekall mark, drawn inline so it takes its colour from the text around it.
 *
 * Muted by default: the accent has four jobs (countdown, load scale, primary button, active nav)
 * and the logo is not one of them. The dim nodes and edges are that colour at reduced opacity
 * rather than a second token — opacity blends toward whatever is behind, so the same markup reads
 * correctly on the dark theme and the light one.
 *
 * The bright node is held by TWO edges on purpose. A single edge ending in a round terminus reads
 * as something else entirely once you can only see the silhouette — don't reduce it to one. The
 * geometry lives in lib/logo, which the loading mark (NodeLoader) draws from too.
 */
export default function Logo({ size = 28, color = 'var(--text-muted)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" role="img" aria-label="Rekall" style={{ color }}>
      <g stroke="currentColor" strokeOpacity={0.42} strokeLinecap="round">
        {LOGO_EDGES.map(([from, to, width], i) => (
          <line key={i} x1={LOGO_NODES[from].x} y1={LOGO_NODES[from].y} x2={LOGO_NODES[to].x} y2={LOGO_NODES[to].y} strokeWidth={width} />
        ))}
      </g>
      <g fill="currentColor">
        {LOGO_NODES.map((node, i) => (
          <circle key={i} cx={node.x} cy={node.y} r={node.r} fillOpacity={i === HELD ? undefined : 0.58} />
        ))}
      </g>
    </svg>
  )
}
