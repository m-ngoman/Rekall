import Logo from '@app/components/Logo'
import { logoMorph } from '../lib/logoMorph'

/** The loading mark becoming the Rekall mark. Until `p` reaches 1 it is drawn from the morph's
 * geometry; from 1 it is the app's own <Logo>, so the resting frames are the logo exactly. */
export function LogoMorph({ size, floatMs, startMs, p }: { size: number; floatMs: number; startMs: number; p: number }) {
  if (p >= 1) return <Logo size={size} />
  const f = logoMorph(floatMs, startMs, p)
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" role="img" aria-label="Rekall" style={{ color: 'var(--accent)' }}>
      <g stroke="currentColor" strokeLinecap="round">
        {f.links.map((l, i) => (
          <line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.width} strokeOpacity={l.opacity} />
        ))}
        {f.edges.map((e, i) => (
          <line
            key={`e${i}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x1 + (e.x2 - e.x1) * e.draw}
            y2={e.y1 + (e.y2 - e.y1) * e.draw}
            strokeWidth={e.width}
            strokeOpacity={e.draw > 0 ? e.opacity : 0}
          />
        ))}
      </g>
      <g fill="currentColor">
        {f.nodes.map((n) => (
          <circle key={n.i} cx={n.x} cy={n.y} r={n.r} fillOpacity={n.opacity} />
        ))}
      </g>
    </svg>
  )
}
