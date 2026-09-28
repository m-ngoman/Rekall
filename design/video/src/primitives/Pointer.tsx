/** The pointer, in the replica's own pixels so it moves and zooms with the page under it.
 *
 * Desktop: an arrow that becomes a hand over something clickable, as a browser's does, dipping a
 * little on a press. Phone: a touch — a soft disc where the finger lands, for the few frames the
 * press lasts. Neither is part of the app; both are drawn in the page's own text colour. */
export function Pointer({
  kind,
  x,
  y,
  hand = false,
  down = false,
  opacity = 1,
}: {
  kind: 'mouse' | 'touch'
  x: number
  y: number
  hand?: boolean
  down?: boolean
  opacity?: number
}) {
  if (kind === 'touch') {
    const d = 44
    return (
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: x - d / 2,
          top: y - d / 2,
          width: d,
          height: d,
          borderRadius: '50%',
          background: 'var(--text)',
          opacity: 0.18 * opacity,
          transform: `scale(${down ? 0.86 : 1})`,
          pointerEvents: 'none',
          zIndex: 60,
        }}
      />
    )
  }
  const s = down ? 0.9 : 1
  return (
    <svg
      aria-hidden
      width={22}
      height={24}
      viewBox="0 0 22 24"
      style={{ position: 'absolute', left: hand ? x - 7 : x - 2, top: hand ? y - 2 : y - 2, opacity, transform: `scale(${s})`, transformOrigin: '2px 2px', pointerEvents: 'none', zIndex: 60, overflow: 'visible' }}
    >
      {hand ? (
        <path
          d="M7.5 1.5c1 0 1.8.8 1.8 1.8v6.2h.6V8.3c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v1.4h.6v-.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v1.2h.4c1 0 1.8.8 1.8 1.8v4.6c0 3.6-2.9 6.5-6.5 6.5h-2c-2.2 0-3.9-1-5-2.8l-3.2-5.1c-.5-.9-.3-2 .6-2.5.8-.5 1.8-.3 2.3.4l.9 1.3V3.3c0-1 .8-1.8 1.8-1.8z"
          fill="var(--text)"
          stroke="var(--bg)"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ) : (
        <path d="M2 1.5v18.2l4.8-4.6 3 6.9 3.1-1.3-3-6.8h6.6z" fill="var(--text)" stroke="var(--bg)" strokeWidth={1.3} strokeLinejoin="round" />
      )}
    </svg>
  )
}
