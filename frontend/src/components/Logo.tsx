import { HELD, LOGO_EDGES, LOGO_NODES } from '../lib/logo'

/** The Rekall mark, in the student's accent: the same mark in the same colour as the browser tab's
 * icon (`applyFavicon` in useSettings), so the app and its tab read as one thing whichever accent
 * was picked. That's a fifth job for the accent, beside the countdown, the load scale, the primary
 * button and the active nav. The dim nodes and edges are the accent at reduced opacity rather than
 * a second token — opacity blends toward whatever is behind, so the same markup reads correctly on
 * the dark theme and the light one, where `--accent` is already the darker, readable version.
 *
 * The bright node is held by TWO edges on purpose. A single edge ending in a round terminus reads
 * as something else entirely once you can only see the silhouette — don't reduce it to one. The
 * geometry lives in lib/logo. The loading mark (NodeLoader) only suggests it, by its own numbers.
 */
export default function Logo({ size = 28, color = 'var(--accent)' }: { size?: number; color?: string }) {
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
