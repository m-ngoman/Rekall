import { useEffect, useRef, useState } from 'react'

const TICK_MS = 28

/** Renders `target` one character at a time, for the live transcription display.
 *
 * The point is the gate, not the animation. Deepgram does not send words: each message carries
 * the whole interim transcript for the current segment, so `target` jumps by a phrase at a time
 * and the tail is rewritten whenever the recognizer revises itself. Painting that straight to the
 * screen reads as text flinching. Paying it out at one character per tick turns those jumps into
 * a steady left-to-right reveal at roughly the speed someone talks.
 *
 * Self-corrects if `target` changes retroactively by re-syncing to the new shared prefix and
 * re-revealing from the divergence point — which also covers the target getting shorter, since a
 * shrunk target shares only a prefix of what is already on screen.
 *
 * This used to flicker a couple of random characters ahead of the reveal, slot-machine style. The
 * pacing was the useful half; the flicker was noise, and it is gone.
 */
export function useRevealText(target: string): string {
  const [display, setDisplay] = useState('')
  const settledRef = useRef('') // what is on screen, guaranteed to be a prefix of the last-seen target
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = targetRef.current
      let settled = settledRef.current

      let shared = 0
      while (shared < settled.length && shared < t.length && settled[shared] === t[shared]) shared++
      if (shared < settled.length) settled = settled.slice(0, shared)

      if (settled.length < t.length) settled += t[settled.length]

      settledRef.current = settled
      setDisplay(settled) // no-op re-render when unchanged — React bails out on identical state
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return display
}
