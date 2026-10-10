import { useEffect, useState } from 'react'
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion'
import { fontsLoaded } from '../fonts'

/** The tokens, resolved. scripts/check-smoke.mjs samples the middle of each swatch and compares it
 * with the OKLCH values in frontend/src/index.css, converted independently — so a CSS pipeline
 * that rewrote or dropped the app's colours fails here, before any scene is built on it. */
export const SWATCHES = ['--bg', '--surface', '--rule', '--text', '--text-muted', '--accent', '--grade-hard'] as const

export const Smoke: React.FC = () => {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsLoaded
      .then(() => {
        for (const face of ['500 16px Nunito', '600 16px Nunito', '700 16px Nunito', '600 16px "Barlow Condensed"']) {
          if (!document.fonts.check(face)) throw new Error(`Font not loaded: ${face}`)
        }
        continueRender(handle)
      })
      .catch((err) => cancelRender(err))
  }, [handle])

  return (
    <AbsoluteFill style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="flex">
        {SWATCHES.map((token) => (
          <div key={token} data-token={token} style={{ width: 160, height: 200, background: `var(${token})` }} />
        ))}
      </div>
      <div className="flex items-baseline gap-6 px-6 pt-6">
        <span className="numeral text-[6rem] text-[var(--accent)]">34</span>
        <span className="text-[1.5rem] font-medium">Nunito 500</span>
        <span className="text-[1.5rem] font-semibold">Nunito 600</span>
        <span className="text-[1.5rem] font-bold">Nunito 700</span>
        <span className="on-accent rounded-[var(--r-full)] px-6 py-3 text-[1.1875rem] font-bold">Check my answer</span>
      </div>
    </AbsoluteFill>
  )
}
