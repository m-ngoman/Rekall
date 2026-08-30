import { useEffect, useRef, useState } from 'react'

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const TICK_MS = 28
const SHUFFLE_TICKS_PER_CHAR = 3 // a couple of random flickers, then the real character lands
const OVERLAP_WINDOW = 2 // this many characters shuffle concurrently, staggered — see below

function randomChar(): string {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
}

/** Renders `target` with a "slot machine" reveal, for the live transcription display: the next
 * not-yet-revealed characters flicker through a couple of random characters before landing on the
 * real one. Up to OVERLAP_WINDOW characters shuffle at once, staggered — the second one starts
 * counting down as soon as the first is added rather than waiting for it to fully land, so by the
 * time the first locks in, the second is already partway through its own countdown. That overlap
 * is what makes the reveal noticeably faster than strict one-at-a-time, while it still reads left
 * to right since locking only ever happens in order. Self-corrects if `target` changes
 * retroactively (Deepgram's partial transcripts sometimes revise an earlier word, not just append
 * text) by re-syncing to the new shared prefix and re-revealing from the divergence point.
 */
export function useScrambleText(target: string): string {
  const [display, setDisplay] = useState('')
  const settledRef = useRef('') // the locked-in prefix, guaranteed to match the last-seen target
  const pendingRef = useRef<number[]>([]) // ticksLeft for each character currently in the overlap window
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = targetRef.current
      let settled = settledRef.current
      let pending = pendingRef.current

      // Re-sync if the target diverged from what's already settled or in-flight.
      const known = settled.length + pending.length
      let shared = 0
      while (shared < settled.length && shared < t.length && settled[shared] === t[shared]) shared++
      if (shared < settled.length || known > t.length) {
        settled = settled.slice(0, shared)
        pending = []
        settledRef.current = settled
        pendingRef.current = pending
      }

      // Top up the overlap window — at most one new slot per tick, not a full refill at once, so
      // a newly-joined character starts a couple of ticks behind its predecessor instead of two
      // characters landing in lockstep unison every few ticks (verified via simulation: capping
      // this at one/tick gives a genuine staggered cascade instead of simultaneous double-locks).
      if (pending.length < OVERLAP_WINDOW && settled.length + pending.length < t.length) {
        pending.push(SHUFFLE_TICKS_PER_CHAR)
      }

      if (pending.length === 0) {
        setDisplay(settled) // no-op re-render when unchanged — React bails out on identical state
        return
      }

      pending = pending.map((n) => n - 1)
      while (pending.length > 0 && pending[0] <= 0) {
        settled += t[settled.length]
        pending = pending.slice(1)
        if (pending.length < OVERLAP_WINDOW && settled.length + pending.length < t.length) {
          pending.push(SHUFFLE_TICKS_PER_CHAR)
        }
      }
      settledRef.current = settled
      pendingRef.current = pending

      setDisplay(settled + pending.map((ticksLeft) => (ticksLeft > 0 ? randomChar() : '')).join(''))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return display
}
