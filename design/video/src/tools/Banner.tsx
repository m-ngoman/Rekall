import { useEffect, useState } from 'react'
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion'
import Logo from '@app/components/Logo'
import { END_CARD } from '../data/copy'
import { fontsLoaded } from '../fonts'
import { AVATAR, BANNERS, type BannerName } from './bannerSpecs'

const useFonts = () => {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsLoaded.then(() => continueRender(handle)).catch((err) => cancelRender(err))
  }, [handle])
}

/** A profile banner: the end card's lockup (the mark, the wordmark, the line, the address), set the
 * way the app sets its own name, on the app's flat background, inside the platform's safe box. */
export const Banner: React.FC<{ name: BannerName }> = ({ name }) => {
  useFonts()
  const b = BANNERS[name]
  return (
    <AbsoluteFill style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div
        style={{
          position: 'absolute',
          left: b.safe.x,
          top: b.safe.y,
          width: b.safe.width,
          height: b.safe.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: b.mark * 0.3 }}>
          <Logo size={b.mark} />
          <div style={{ fontSize: b.mark, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1 }}>{END_CARD.wordmark}</div>
        </div>
        <p style={{ marginTop: b.mark * 0.32, fontSize: b.tagline, lineHeight: 1.3, fontWeight: 600, color: 'var(--text-muted)', textWrap: 'balance', maxWidth: b.safe.width * 0.88 }}>
          {END_CARD.tagline}
        </p>
        <p style={{ marginTop: b.mark * 0.2, fontSize: b.url, fontWeight: 700 }}>{END_CARD.url}</p>
      </div>
    </AbsoluteFill>
  )
}

/** The avatar: the mark alone, centred by its drawing's own bounds (the mark's nodes span x 17.5–101.5
 * and y 26.5–100.5 of its 120 box, so its middle isn't the box's), on the app's background. */
export const Avatar: React.FC = () => {
  useFonts()
  const mark = AVATAR.size * AVATAR.markShare
  const k = mark / 120
  return (
    <AbsoluteFill style={{ background: 'var(--bg)', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translate(${(60 - 59.5) * k}px, ${(60 - 63.5) * k}px)` }}>
        <Logo size={mark} />
      </div>
    </AbsoluteFill>
  )
}
