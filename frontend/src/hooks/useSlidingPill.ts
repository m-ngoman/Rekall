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

/* --- Rejection bounce -------------------------------------------------------------------------
 * When an option can't be selected, the pill lunges at it, rebounds off it and returns. It says
 * "I heard you, and no" in one gesture — which a dead button that simply ignores the tap does not.
 *
 * The easing matters more than the timing here. An ease-out on the way over finishes at zero
 * velocity, so the pill arrives, comes to a dead stop, and only then starts back — which reads as
 * a failed navigation, not a bounce. It travels on an *accelerating* curve instead, so it's still
 * moving when it turns around, and the reversal itself is what sells the wall. Nothing is held at
 * the far end and there is no squash: a deformation needs time to be seen, and time at the far end
 * is exactly what must not exist.
 */
const REJECT_OUT_MS = 150
const REJECT_BACK_MS = 300
/** How far toward the blocked option the pill actually gets. Deliberately short of 1: at 1 the
 * pill's box lands exactly on the target's, which is indistinguishable from having selected it —
 * the gesture then reads as "selected, then un-selected", i.e. broken. Stopping here leaves it
 * visibly pressed into the option's near side, overlapping it without ever wearing it. */
const REJECT_REACH = 0.78
/** Ends at full speed (final slope 1) so the turnaround is a rebound, not a restart. */
const REJECT_OUT_EASE = 'cubic-bezier(0.4, 0, 0.85, 0.85)'
/** Leaves at speed (initial slope ~6) and settles — the other half of the rebound. */
const REJECT_BACK_EASE = 'cubic-bezier(0.15, 0.9, 0.35, 1)'

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
  /** Non-null only while the bounce is playing. `box` is where the pill is being thrown to, and is
   * null on the way home — it returns to whatever the active option's box is by then, so a resize
   * mid-gesture can't strand it. */
  const [reject, setReject] = useState<{ box: Box | null; phase: 'out' | 'back' } | null>(null)
  const rejectTimers = useRef<number[]>([])
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

  /** Play the "no" gesture toward `key` without selecting it. Safe to call repeatedly — a second
   * tap restarts the bounce rather than queueing another one behind the first. */
  const rejectTo = useCallback((key: K) => {
    const target = items.current.get(key)
    const from = items.current.get(active)
    if (!target || !from) return
    // Respected here rather than in CSS: with transitions disabled the pill would teleport out and
    // back, which is worse than no feedback at all.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    rejectTimers.current.forEach(clearTimeout)
    // Keeps its own width and height — only the position moves. Growing into the target's size on
    // the way over is half of what made it look like a selection rather than a refusal.
    const to: Box = {
      x: from.offsetLeft + (target.offsetLeft - from.offsetLeft) * REJECT_REACH,
      y: from.offsetTop,
      w: from.offsetWidth,
      h: from.offsetHeight,
    }

    // Two beats, not three. The pill turns around the instant it arrives — anything held at the
    // far end stops reading as a bounce and starts reading as a failed navigation.
    setReject({ box: to, phase: 'out' })
    rejectTimers.current = [
      window.setTimeout(() => setReject({ box: null, phase: 'back' }), REJECT_OUT_MS),
      window.setTimeout(() => setReject(null), REJECT_OUT_MS + REJECT_BACK_MS),
    ]
  }, [active])

  useEffect(() => () => rejectTimers.current.forEach(clearTimeout), [])

  const register = useCallback(
    (key: K) => (el: HTMLElement | null) => {
      if (el) items.current.set(key, el)
      else items.current.delete(key)
    },
    [],
  )

  /** Where the pill is drawn right now: the thrown-to box mid-bounce, the active option's box
   * otherwise. On the way home `reject.box` is null, so this falls back to `box` and the return
   * lands wherever the active option actually is by then. */
  const shown = (reject?.box ?? box) as Box | null

  /** Which half of the bounce is running, and on what clock. */
  const beat = !reject
    ? null
    : reject.phase === 'out'
      ? { ms: REJECT_OUT_MS, ease: REJECT_OUT_EASE }
      : { ms: REJECT_BACK_MS, ease: REJECT_BACK_EASE }

  /** Geometry and timing only — background, radius and shadow are the caller's business. */
  const pillStyle: CSSProperties | null = box && shown && {
    position: 'absolute',
    left: 0,
    top: 0,
    width: shown.w,
    height: shown.h,
    // `translate` and `scale` as separate CSS properties, NOT one `transform`. They're two
    // independent motions on different clocks: the travel runs the full duration while the
    // stretch relaxes partway through. Packed into `transform`, relaxing the stretch rewrites the
    // same property mid-flight and restarts the travel — on an overshooting curve, so it
    // overshoots a second time and snaps back.
    translate: `${shown.x}px ${shown.y}px`,
    // Stretched on the way out (momentum), squashed on arrival (the wall), resting on the way
    // back. The bounce takes priority over the ordinary selection stretch — they can't both be
    // running, since a rejected tap never changes `active`.
    scale: `${!reject && stretching ? STRETCH : 1} 1`,
    '--pill-scale-ms': beat ? `${beat.ms}ms` : stretching ? GROW.ms : RELAX.ms,
    '--pill-scale-ease': beat ? beat.ease : stretching ? GROW.ease : RELAX.ease,
    // The travel curve is normally the caller's stylesheet's business, but each beat of the bounce
    // needs its own clock — the default 400ms glide would smear the three into one slide. Drives
    // width as well as position; see the `.sliding-pill` rule.
    '--pill-move-ms': beat ? `${beat.ms}ms` : undefined,
    '--pill-move-ease': beat ? beat.ease : undefined,
    opacity: ready && present ? 1 : 0,
    transition: ready ? undefined : 'none',
  } as CSSProperties

  return { container, register, pillStyle, rejectTo }
}
