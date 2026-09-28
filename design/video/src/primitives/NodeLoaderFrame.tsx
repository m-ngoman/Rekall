import { loaderFrame } from '../lib/loaderFrame'

/** NodeLoader, drawn for one frame: the same markup, the same geometry, and `ms` — time since it
 * mounted — in place of the animation-frame loop. The CSS fade-in (`.node-loader`) is applied as
 * an opacity here rather than by the class, which would run on the clock instead of the frame. */
export function NodeLoaderFrame({
  ms,
  size = 48,
  delay = 300,
  label = 'Loading',
  showLabel = false,
  className = '',
}: {
  ms: number
  size?: number
  delay?: number
  label?: string
  showLabel?: boolean
  className?: string
}) {
  const f = loaderFrame(ms, size, delay)
  return (
    <span role="status" className={className} style={{ opacity: f.opacity, visibility: f.opacity > 0 ? 'visible' : 'hidden' }}>
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true" className="block flex-shrink-0" style={{ color: 'var(--accent)' }}>
        <g stroke="currentColor" strokeLinecap="round">
          {f.links.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.width} strokeOpacity={l.opacity} />
          ))}
        </g>
        <g fill="currentColor">
          {f.nodes.map((n) => (
            <circle key={n.i} cx={n.x} cy={n.y} r={n.r} fillOpacity={n.opacity} />
          ))}
        </g>
      </svg>
      <span
        className={
          showLabel ? 'max-w-[18rem] text-center text-[0.9375rem] font-semibold text-[var(--text-muted)] [text-wrap:balance]' : 'sr-only'
        }
      >
        {label}
      </span>
    </span>
  )
}
