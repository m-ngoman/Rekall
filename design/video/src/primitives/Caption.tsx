import { useCurrentFrame } from 'remotion'
import { APP_EASE, clamp, progress } from '../lib/ease'
import type { Layout } from '../timeline'

/** Where captions sit: in the band above the app's window (primitives/AppCanvas), never over the
 * interface. Landscape: left-aligned with the window, bottom-anchored 36 px above it. Portrait:
 * lined up with the app's own content edge, 32 px above the phone, and clear of every platform's
 * top bar (nothing above y 250). */
export const CAPTION_PLACES = {
  landscape: { left: 224, bottom: 1080 - 180, width: 1472, size: 60 },
  portrait: { left: 155, bottom: 1920 - 408, width: 770, size: 64 },
} as const

export type CaptionPlace = keyof typeof CAPTION_PLACES

/** A caption: the video's own words, set like the app sets a title — Nunito bold in --text, tight
 * tracking, never the accent. It rises into place with the app's curve and fades out. */
export function Caption({ text, from, to, place }: { text: string; from: number; to: number; place: CaptionPlace }) {
  const frame = useCurrentFrame()
  if (frame < from || frame >= to) return null
  // A caption on the first frame is simply there: that frame is often the thumbnail.
  const enter = from === 0 ? 1 : progress(frame, from, 8, APP_EASE)
  const exit = clamp((to - frame) / 6)
  const p = CAPTION_PLACES[place]
  return (
    <div
      style={{
        position: 'absolute',
        left: p.left,
        width: p.width,
        bottom: p.bottom,
        fontSize: p.size,
        lineHeight: 1.15,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: 'var(--text)',
        textWrap: 'balance',
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 14}px)`,
      }}
    >
      {text}
    </div>
  )
}

export const captionPlace = (layout: Layout): CaptionPlace => layout
