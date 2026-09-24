import { type RefObject, useEffect, useRef, useState } from 'react'

/** How far the reader may drift from the newest line and still count as following it. Wide
 * enough that a nudge of the wheel, or a phone's rubber-band bounce, doesn't let go; narrow
 * enough that a deliberate scroll up does. */
const STICK_SLACK = 64

/** Keeps the page scrolled so a growing log's newest line (`bottomRef`) sits clear of the
 * composer, for as long as the reader is following it. `content` is what the log shows: a change
 * to it is followed even when the log's height stays the same.
 *
 * Returns `away`, true while the reader has scrolled off the newest line; `pinToLatest()`, which
 * follows again and goes there now; and `rejoin()`, which only follows again, for when whatever
 * arrives next will do the scrolling.
 */
export function useFollowLatest(
  logRef: RefObject<HTMLElement>,
  bottomRef: RefObject<HTMLElement>,
  composerRef: RefObject<HTMLElement>,
  content: unknown,
) {
  /* The log follows its newest line while a reply streams, and lets go the moment the reader
   * scrolls away from it.
   *
   * This was one line — scrollIntoView on every `messages` change — and the typewriter calls
   * setMessages on a 20ms interval, so it re-pinned fifty times a second and could not tell the
   * reader's scroll from its own. Measured before the fix: scrolling down 400px mid-reply was
   * dragged back up 319px inside 200ms, in a visible series of steps, because each call replaced
   * the in-flight smooth animation with a new one. `block: 'end'` was aiming at the wrong place
   * besides — it aligns the anchor with the viewport bottom, which put 173px of the newest reply
   * behind the composer, which is what the reader was scrolling down to uncover.
   */

  /** How much room above the viewport bottom the newest line needs: the composer's own height
   * plus a gap. Measured rather than a constant, because the composer grows with a wrapped draft
   * and with an attached photo, and sits at a different offset on desktop. */
  const clearance = () => {
    const el = composerRef.current
    return el ? window.innerHeight - el.getBoundingClientRect().top + 12 : 180
  }

  /** How far the log has drifted below where it should rest. Negative means it is already clear. */
  const drift = () => {
    const el = bottomRef.current
    return el ? el.getBoundingClientRect().bottom - window.innerHeight + clearance() : 0
  }

  /** Where `follow` last put the page. Anything else means the reader moved it.
   *
   * This ref is the whole answer to a pair of races, and both were measured rather than guessed.
   * Scroll events are dispatched at the next rendering opportunity; a ResizeObserver callback
   * runs *before* that. So within one frame the log can grow, the observer can fire, and a scroll
   * event describing a position from before the growth can arrive afterwards — in either order
   * relative to a scroll the reader just made. Geometry alone cannot tell "the reader scrolled
   * up" from "the log grew downward", because both move the anchor the same way. Comparing the
   * page against where we last put it can.
   */
  const ourScrollRef = useRef(0)

  /** Settle whether the log is still following, from where the page is right now. */
  const decide = () => {
    const stuck = drift() <= STICK_SLACK
    stickRef.current = stuck
    setAway(!stuck)
  }

  const follow = (force = false) => {
    // The page is somewhere we did not put it, so the reader moved it and the event saying so may
    // not have been dispatched yet. Losing this one re-engaged the follow permanently, because
    // the override lands exactly on the anchor.
    if (!force && Math.abs(window.scrollY - ourScrollRef.current) > 1) decide()
    if (!stickRef.current) return

    const by = drift()
    // Downward only, and instantly. The log grows downward, so a follow that scrolls *up* is
    // never following — it is undoing a scroll the reader just made. Instant rather than smooth
    // because at 20ms the deltas are a few pixels (it reads as smooth anyway), a restarted smooth
    // animation never settles, and landing exactly on the target is what makes `drift` a
    // trustworthy answer to "is the reader still with us".
    if (by > 0) {
      window.scrollTo(0, window.scrollY + by)
      ourScrollRef.current = window.scrollY
    }
  }

  /** Whether the log is still tracking its newest line. A ref because `follow` consults it on a
   * 20ms tick and must not re-render; `away` is the same fact as state, for the pill. */
  const stickRef = useRef(true)
  const [away, setAway] = useState(false)

  const pinToLatest = () => {
    stickRef.current = true
    setAway(false)
    // Forced: the reader is by definition somewhere we did not put them, which is the one case
    // where that must not be read as "they want to stay here".
    follow(true)
  }

  useEffect(() => {
    const onScroll = () => {
      // Only the reader's scrolls get a say. Our own arrive a frame late, by which time the log
      // may have grown underneath them — and a log that grew looks exactly like a reader who
      // scrolled up. That misreading stranded the follow 300px short every time a plot finished
      // measuring itself in the same frame, which is how it was found.
      if (Math.abs(window.scrollY - ourScrollRef.current) <= 1) return
      // Asymmetric by construction: scrolling further down only makes `drift` more negative, so
      // the reader can overscroll into the log's bottom padding without losing the follow. Only
      // scrolling *up*, past the slack, lets go.
      decide()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Driven by the column's height rather than by `messages`, because the two are not the same
  // event: a plot measures its container and renders a frame after the state change that carried
  // it, and the lazy KaTeX chunk reflows whenever it finishes loading. Both grow the log after
  // the message they belong to was already handled.
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    // Not `new ResizeObserver(follow)`: that hands the entries array in as `force`.
    const observer = new ResizeObserver(() => follow())
    observer.observe(el)
    return () => observer.disconnect()
  }, [logRef])

  // The discrete case the observer misses: content that changes without changing the height.
  useEffect(() => {
    follow()
  }, [content])


  const rejoin = () => {
    stickRef.current = true
    setAway(false)
  }

  return { away, pinToLatest, rejoin }
}
