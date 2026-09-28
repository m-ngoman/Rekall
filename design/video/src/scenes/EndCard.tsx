import { AbsoluteFill } from 'remotion'
import { END_CARD } from '../data/copy'
import { APP_EASE, progress } from '../lib/ease'
import { LogoMorph } from '../primitives/LogoMorph'
import type { Layout } from '../timeline'
import { ms, useSceneFrame } from './common'

/** The end card. The loading mark floats in — the same eight nodes that stood in for every wait in
 * the video — and settles into the Rekall mark; then the wordmark, the line, the address. Set like
 * the app sets its own name: the sidebar's lockup on a wide frame, the sign-in screen's stacked one
 * on a tall frame. Nothing here is accent but the mark itself. */
export function EndCard({ layout, appear = -9 }: { layout: Layout; appear?: number }) {
  const f = useSceneFrame()
  const wide = layout === 'landscape'
  // The float's clock starts well into its cycle, where the eight are spread out and linked.
  const floatMs = 2600 + ms(f - appear)
  const morphStart = 10
  const p = progress(f, morphStart, 28, (x) => x) // eased per node inside logoMorph
  const markIn = progress(f, appear, 9, APP_EASE)
  const word = progress(f, 30, 12, APP_EASE)
  const line = progress(f, 40, 14, APP_EASE)
  const url = progress(f, 50, 12, APP_EASE)
  const rise = (v: number) => ({ opacity: v, transform: `translateY(${(1 - v) * 16}px)` })
  const size = wide ? 168 : 260

  return (
    <AbsoluteFill style={{ background: 'var(--bg)', color: 'var(--text)', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: wide ? 1400 : 880 }}>
        <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 36 : 28 }}>
          <div style={{ opacity: markIn }}>
            <LogoMorph size={size} floatMs={floatMs} startMs={2600 + ms(morphStart - appear)} p={p} />
          </div>
          <div style={{ fontSize: wide ? 128 : 136, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1, ...rise(word) }}>{END_CARD.wordmark}</div>
        </div>
        <p style={{ marginTop: wide ? 48 : 64, fontSize: wide ? 44 : 54, lineHeight: 1.3, fontWeight: 600, color: 'var(--text-muted)', textWrap: 'balance', ...rise(line) }}>
          {END_CARD.tagline}
        </p>
        <p style={{ marginTop: wide ? 36 : 48, fontSize: wide ? 44 : 54, fontWeight: 700, ...rise(url) }}>{END_CARD.url}</p>
      </div>
    </AbsoluteFill>
  )
}
