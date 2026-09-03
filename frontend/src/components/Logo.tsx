/** The Rekall mark, drawn inline so it takes its colour from the text around it.
 *
 * Muted by default: the accent has four jobs (countdown, load scale, primary button, active nav)
 * and the logo is not one of them. The dim nodes and edges are that colour at reduced opacity
 * rather than a second token — opacity blends toward whatever is behind, so the same markup reads
 * correctly on the dark theme and the light one.
 *
 * The bright node is held by TWO edges on purpose. A single edge ending in a round terminus reads
 * as something else entirely once you can only see the silhouette — don't reduce it to one.
 */
export default function Logo({ size = 28, color = 'var(--text-muted)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" role="img" aria-label="Rekall" style={{ color }}>
      <g stroke="currentColor" strokeOpacity={0.42} strokeLinecap="round">
        <line x1="26" y1="84" x2="56" y2="92" strokeWidth="6" />
        <line x1="56" y1="92" x2="38" y2="58" strokeWidth="6" />
        <line x1="38" y1="58" x2="26" y2="84" strokeWidth="6" />
        <line x1="38" y1="58" x2="88" y2="40" strokeWidth="5.5" />
        <line x1="56" y1="92" x2="88" y2="40" strokeWidth="5.5" />
      </g>
      <g fill="currentColor">
        <circle cx="26" cy="84" r="8.5" fillOpacity={0.58} />
        <circle cx="56" cy="92" r="8.5" fillOpacity={0.58} />
        <circle cx="38" cy="58" r="8.5" fillOpacity={0.58} />
        <circle cx="88" cy="40" r="13.5" />
      </g>
    </svg>
  )
}
