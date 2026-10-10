// Replica of frontend/src/components/tutor/FocusStage.tsx: voice mode's full-screen stage. The
// markup, colours and type are the app's; every animation the app runs on its own clock — the
// overlay's fade, the lines arriving, the words popping, the pulse, the orb's flight out of the
// mic — is a value handed in for this frame (lib/karaoke, lib/orb, lib/ease).
import type { OrbState } from '../lib/orb'
import { VoiceOrbFrame } from '../primitives/VoiceOrbFrame'

/** The stage's backdrop, as FocusStage draws it: a dark stage with the accent pooling below. */
export const STAGE_BACKGROUND =
  'radial-gradient(ellipse 95% 60% at 50% 104%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 68%), rgb(13 10 8 / 0.96)'

const USER_COLOUR = 'color-mix(in oklab, var(--accent) 55%, rgb(255 255 255 / 0.45))'
const PAST_COLOUR = 'rgb(255 255 255 / 0.42)'

export interface FocusView {
  /** The overlay's opacity (300 ms fade). */
  overlay: number
  /** The text column settling up 12 px as the stage opens (500 ms). */
  rise: number
  /** Past turns on the stage, each with its `.focus-line` entrance state. */
  lines: { role: 'user' | 'assistant'; text: string; opacity: number; y: number }[]
  /** The live transcript while listening. */
  live?: string
  /** The thinking dots' pulse opacity, when thinking. */
  thinking?: number
  /** The sentence being spoken: each word's white alpha and offset, and the line's own fade. */
  speaking?: { words: { word: string; alpha: number; y: number }[]; opacity: number }
  status: string
  orb: { bands: Float64Array; t: number; state: OrbState; resolution: number }
  /** The orb's FLIP: offset from its resting place, scale and opacity. */
  flip: { dx: number; dy: number; scale: number; opacity: number }
  /** Draw the backdrop here. Off in portrait, where it is drawn across the whole frame instead. */
  backdrop?: boolean
}

export function FocusStage(v: FocusView) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice session"
      className="fixed inset-0 z-30 flex touch-none flex-col"
      style={{ opacity: v.overlay, background: v.backdrop === false ? undefined : STAGE_BACKGROUND }}
    >
      <div className="flex min-h-0 flex-1 items-end justify-center px-7 pt-[calc(3.5rem+env(safe-area-inset-top))]">
        <div
          className="max-h-[calc(var(--vh)*55)] w-full max-w-xl touch-auto overflow-y-auto overscroll-contain lg:max-h-[calc(var(--vh)*60)]"
          style={{
            transform: `translateY(${(1 - v.rise) * 12}px)`,
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
            maskImage: 'linear-gradient(to bottom, transparent, black 14%, black 88%, transparent)',
          }}
        >
          <div className="flex flex-col gap-9 px-1 py-6 text-[1.35rem] font-semibold leading-[1.5] lg:text-[1.6rem]">
            {v.lines.map((m, i) => (
              <p
                key={i}
                className={m.role === 'user' ? 'self-end text-right' : 'self-start text-left'}
                style={{ maxWidth: '88%', color: m.role === 'user' ? USER_COLOUR : PAST_COLOUR, opacity: m.opacity, transform: `translateY(${m.y}em)` }}
              >
                {m.text}
              </p>
            ))}
            {v.live !== undefined && v.live !== '' && <p className="max-w-[88%] self-end text-right text-white">{v.live}</p>}
            {v.thinking !== undefined && (
              <p aria-label="Thinking" className="self-start tracking-[0.35em] text-white/40" style={{ opacity: v.thinking }}>
                •••
              </p>
            )}
            {v.speaking && (
              <p className="max-w-[88%] self-start text-left">
                <span data-sentence={0} style={{ opacity: v.speaking.opacity }}>
                  {v.speaking.words.map(({ word, alpha, y }, wi) => (
                    <span key={wi} style={{ display: 'inline-block', whiteSpace: 'pre', color: `rgb(255 255 255 / ${alpha})`, transform: `translateY(${y}em)` }}>
                      {word + ' '}
                    </span>
                  ))}
                </span>
              </p>
            )}
            <div />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pb-10 lg:pb-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">{v.status}</span>
        <button
          title="End voice mode"
          className="relative flex origin-center cursor-pointer items-center justify-center rounded-full p-2"
          style={{ transform: `translate(${v.flip.dx}px, ${v.flip.dy}px) scale(${v.flip.scale})`, opacity: v.flip.opacity }}
        >
          <VoiceOrbFrame bands={v.orb.bands} t={v.orb.t} state={v.orb.state} size={230} resolution={v.orb.resolution} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="oklch(0.99 0.005 90)">
              <rect x="5" y="5" width="14" height="14" rx="4" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}

/** Where the orb rests, in replica pixels: centred, above the stage's bottom padding (32 px on
 * desktop, 40 on a phone), the button being the 230 px orb plus 8 px all round. */
export const ORB_REST = { landscape: { x: 640, y: 720 - 32 - 123 }, portrait: { x: 195, y: 643 - 40 - 123 } } as const
