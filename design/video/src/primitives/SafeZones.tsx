import { AbsoluteFill } from 'remotion'
import type { Layout } from '../timeline'

/** Review guides, drawn only when the `guides` prop is on: where the platforms put their own UI.
 * Landscape: title-safe (5% in). Portrait: the top bar, the caption and music strip along the bottom,
 * and the action rail on the right — TikTok's, which is the widest of the three. */
export function SafeZones({ layout }: { layout: Layout }) {
  const zone = (style: React.CSSProperties) => (
    <div style={{ position: 'absolute', background: 'rgb(255 0 80 / 0.22)', outline: '1px solid rgb(255 0 80 / 0.7)', ...style }} />
  )
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 100 }}>
      {layout === 'landscape' ? (
        <div style={{ position: 'absolute', left: 96, top: 54, right: 96, bottom: 54, outline: '2px dashed rgb(255 0 80 / 0.8)' }} />
      ) : (
        <>
          {zone({ left: 0, top: 0, right: 0, height: 250 })}
          {zone({ left: 0, bottom: 0, right: 0, height: 440 })}
          {zone({ right: 0, top: 700, width: 140, height: 900 })}
        </>
      )}
    </AbsoluteFill>
  )
}
