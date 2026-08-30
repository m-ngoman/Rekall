import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Kept in step with the `.sliding-pill` transition in index.css. The stretch relaxes well before
 * the pill lands, so the squash reads as momentum rather than as the pill simply being wider. */
const STRETCH_MS = 240

/** Peak stretch along the direction of travel. Past roughly 1.2 it stops looking elastic and
 * starts looking like a rendering bug. */
const STRETCH = 1.14

/** The bulge and its release are different gestures on different clocks. Growing is quick — it's
 * driven by the pill being flung. Relaxing is slow and finishes after the pill has landed, which
 * is the follow-through that makes it read as something soft settling into place. The relax curve
 * passes slightly beyond its target so it gives back ~2% before coming to rest. */
const GROW = { ms: '130ms', ease: 'cubic-bezier(0.3, 0.9, 0.4, 1)' }
const RELAX = { ms: '520ms', ease: 'cubic-bezier(0.22, 1.12, 0.36, 1)' }

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A selection indicator that travels between options instead of blinking on and off.
 *
 * Shared by the tab bar and the segmented controls in Settings. Both had the same requirement and
 * the logic is fiddly enough — measuring, re-measuring on resize and webfont load, suppressing the
 * transition on first paint — that a second copy would drift out of step with the first.
 *
 * The caller owns the pill's appearance; this owns where it is and how it moves.
 */
export function useSlidingPill<K extends string | number>(active: K) {
  const container = useRef<HTMLDivElement>(null)
  const items = useRef(new Map<K, HTMLElement>())
  const [box, setBox] = useState<Box | null>(null)
  /** Whether the active key is one of the registered options. The tab bar doesn't contain
   * Settings (it's the gear in the header), so selecting it leaves nothing for the pill to sit
   * on — it used to stay put around whichever icon it was last on, which then greyed out,
   * leaving a highlight around an inactive tab. */
  const [present, setPresent] = useState(true)
  const [stretching, setStretching] = useState(false)
  const [ready, setReady] = useState(false)
  const firstRun = useRef(true)

  /** The container is positioned, so these offsets are already relative to it — no
   * getBoundingClientRect arithmetic, and no dependence on scroll position. */
  const measure = useCallback(() => {
    const el = items.current.get(active)
    if (!el) {
      // The last box is deliberately kept: the pill fades out where it stood rather than
      // collapsing to the corner, and it's the right starting point for the slide back.
      setPresent(false)
      return
    }
    setPresent(true)
    setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
  }, [active])

  useLayoutEffect(measure, [measure])

  // Transitions stay off until the pill has been placed once, otherwise it slides in from the
  // container's left edge on first paint.
  useEffect(() => {
    if (!box || ready) return
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [box, ready])

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setStretching(true)
    const id = window.setTimeout(() => setStretching(false), STRETCH_MS)
    return () => clearTimeout(id)
  }, [active])

  // Rotation, and the iOS URL bar collapsing, both resize the container; a pill measured against
  // the old width would sit visibly off its option.
  useEffect(() => {
    const el = container.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // Label widths shift when the webfont swaps in for the fallback.
  useEffect(() => {
    document.fonts?.ready.then(measure).catch(() => {})
  }, [measure])

  const register = useCallback(
    (key: K) => (el: HTMLElement | null) => {
      if (el) items.current.set(key, el)
      else items.current.delete(key)
    },
    [],
  )

  /** Geometry and timing only — background, radius and shadow are the caller's business. */
  const pillStyle: CSSProperties | null = box && {
    position: 'absolute',
    left: 0,
    top: 0,
    width: box.w,
    height: box.h,
    // `translate` and `scale` as separate CSS properties, NOT one `transform`. They're two
    // independent motions on different clocks: the travel runs the full duration while the
    // stretch relaxes partway through. Packed into `transform`, relaxing the stretch rewrites the
    // same property mid-flight and restarts the travel — on an overshooting curve, so it
    // overshoots a second time and snaps back.
    translate: `${box.x}px ${box.y}px`,
    scale: `${stretching ? STRETCH : 1} 1`,
    '--pill-scale-ms': stretching ? GROW.ms : RELAX.ms,
    '--pill-scale-ease': stretching ? GROW.ease : RELAX.ease,
    opacity: ready && present ? 1 : 0,
    transition: ready ? undefined : 'none',
  } as CSSProperties

  return { container, register, pillStyle }
}
