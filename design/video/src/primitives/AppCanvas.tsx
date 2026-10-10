import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import type { Layout } from '../timeline'
import { cameraTransform } from '../lib/camera'

/** The replica's own viewport, in CSS pixels, and the window it is shown in.
 *
 * Both formats keep a band at the top of the frame for the captions and show the whole app in a
 * window below it, so a caption never lies over the interface and nothing of the app's viewport is
 * cropped. Landscape: the desktop app at 1280 × 720, 1.15× — a 1472 × 828 window. Portrait: the
 * phone app at 390 × 643, 2.2× — 858 × 1415. The window is the page's own colour with a hairline
 * --rule edge, the app's own way of drawing a boundary; the camera zooms inside it. */
export const CANVAS = {
  landscape: { width: 1280, height: 720, base: 1.15, view: { x: 224, y: 216, width: 1472, height: 828 }, radius: 16 },
  portrait: { width: 390, height: 643, base: 2.2, view: { x: 111, y: 440, width: 858, height: 1415 }, radius: 44 },
} as const

/** Places a replica in the frame and points the camera at it.
 *
 * The transform is on the replica's own root, which does two useful things at once: the camera
 * moves everything inside together (a pointer zooms with the button under it), and the app's
 * `fixed` elements — the tab bar, the composer, the voice stage — position against the replica's
 * viewport exactly as they do against the browser's, because a transformed element is the
 * containing block for its fixed descendants. Their class strings can be copied as they are. */
export function AppCanvas({
  layout,
  camera,
  children,
  bare = false,
  transparent = false,
}: {
  layout: Layout
  camera: { x: number; y: number; z: number }
  children: ReactNode
  /** The replica alone, filling the composition at its base scale — drawn exactly as the video
   * draws it — for the fidelity stills compared with screenshots of the real app. */
  bare?: boolean
  /** No background of its own: a layer drawn over another canvas at the same camera. */
  transparent?: boolean
}) {
  const c0 = CANVAS[layout]
  const c = bare ? { ...c0, view: { x: 0, y: 0, width: Math.round(c0.width * c0.base), height: Math.round(c0.height * c0.base) } } : c0
  const { scale, tx, ty } = cameraTransform(camera, c, c.view, c.base)
  const edge = !bare && !transparent
  return (
    <AbsoluteFill style={{ background: transparent ? undefined : 'var(--bg)' }}>
      <div
        style={{
          position: 'absolute',
          left: c.view.x,
          top: c.view.y,
          width: c.view.width,
          height: c.view.height,
          overflow: 'hidden',
          borderRadius: bare ? undefined : c.radius,
        }}
      >
        <div
          className={layout === 'landscape' ? 'rk-desktop' : 'rk-phone'}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: c.width,
            height: c.height,
            transformOrigin: '0 0',
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            background: transparent ? undefined : 'var(--bg)',
            color: 'var(--text)',
            overflow: 'hidden',
            // What the app's `vh` would be inside this viewport, for the few layouts sized by it.
            ['--vh' as string]: `${c.height / 100}px`,
          }}
        >
          {children}
        </div>
      </div>
      {edge && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: c.view.x,
            top: c.view.y,
            width: c.view.width,
            height: c.view.height,
            borderRadius: c.radius,
            border: '1px solid var(--rule)',
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  )
}
