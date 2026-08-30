import { useCallback, useRef } from 'react'

/** A few milliseconds of silence, generated at the audio hardware's own sample rate.
 *
 * iOS won't let an AudioContext start, or an <audio> element play, outside a real user gesture —
 * and our first sentence arrives from the network long after the tap that started voice mode.
 * Playing this during that tap unlocks both.
 *
 * The rate has to match the context. A fixed 8kHz clip (the first version of this) pulled the
 * whole iOS audio session down to 8kHz, and since every AudioContext on the device shares that
 * session, the *microphone* then captured at 8kHz too — which the transcription service duly
 * received, badly. Building the clip from ctx.sampleRate makes that impossible.
 */
function silentClip(sampleRate: number): string {
  const frames = Math.round(sampleRate * 0.04)
  const bytes = new Uint8Array(44 + frames * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, frames * 2, true)
  // Samples are already zero — that's the silence.
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(binary)}`
}

/** Plays a queue of audio blobs sequentially (one per reply sentence), exposing a live
 * AnalyserNode for whatever's currently playing so the orb can react to real playback amplitude.
 *
 * `onQueueEmpty` fires once playback (not just generation) genuinely finishes — that's what
 * should drive the orb back to idle, not the SSE `done` event, since audio can still be queued
 * after the backend finishes generating.
 *
 * `onItemStart` fires as each queued item begins playing, with the tag it was enqueued under.
 * The tutor's focus view enqueues sentence N with tag N and uses this to light up the sentence
 * currently being read — the audio queue is the only component that actually knows when the
 * voice moves from one sentence to the next, so the karaoke highlight has to be driven from
 * here rather than from the SSE stream (which runs ahead of playback by design).
 */
export function useAudioPlayer(
  onQueueEmpty: () => void,
  speedPct = 100,
  onItemStart?: (tag: number) => void,
) {
  const ctxRef = useRef<AudioContext | null>(null)
  const elRef = useRef<HTMLAudioElement | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const queueRef = useRef<{ blob: Blob; tag: number }[]>([])
  const playingRef = useRef(false)
  /** The object URL currently loaded into the element. Tracked so each one is revoked when the
   * next loads — without this every spoken sentence leaked a blob URL for the life of the page. */
  const urlRef = useRef<string | null>(null)
  const onEmptyRef = useRef(onQueueEmpty)
  onEmptyRef.current = onQueueEmpty
  const onItemStartRef = useRef(onItemStart)
  onItemStartRef.current = onItemStart
  // Read through a ref so a speed change mid-reply applies to the next sentence without
  // rebuilding the AudioContext, which would cut off whatever is currently playing.
  const speedRef = useRef(speedPct)
  speedRef.current = speedPct

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext()
      const el = new Audio()
      const source = ctx.createMediaElementSource(el)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(ctx.destination)
      el.onended = () => playNext()
      ctxRef.current = ctx
      elRef.current = el
      analyserRef.current = analyser
    }
    ctxRef.current.resume()
    return elRef.current!
  }, [])

  const releaseUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  const playNext = useCallback(() => {
    releaseUrl()
    const item = queueRef.current.shift()
    if (!item) {
      playingRef.current = false
      onEmptyRef.current()
      return
    }
    playingRef.current = true
    const el = ensure()
    urlRef.current = URL.createObjectURL(item.blob)
    el.src = urlRef.current
    // preservesPitch keeps a sped-up voice from turning into a chipmunk. It's the default in
    // current browsers but was not always, and the failure is unpleasant enough to be explicit.
    el.preservesPitch = true
    el.playbackRate = speedRef.current / 100
    el.play().catch(() => {
      // Blocked or unplayable. Move on rather than leaving the queue wedged mid-reply with no
      // event ever coming.
      playNext()
    })
    // After the src swap, not before: assigning src resets currentTime to 0, and the karaoke
    // sweep starts reading the clock the moment this fires. Announcing the new sentence while
    // the element still held the previous one's playhead lit the whole sentence instantly.
    onItemStartRef.current?.(item.tag)
  }, [ensure])

  const enqueue = useCallback(
    (blob: Blob, tag = -1) => {
      queueRef.current.push({ blob, tag })
      if (!playingRef.current) playNext()
    },
    [playNext],
  )

  /** Call from inside a click/tap handler. Everything here is synchronous on purpose: iOS ties
   * permission to the gesture that is currently executing, and an `await` before `play()` can
   * hand the turn back to the event loop and spend it. So the element is played first and the
   * tidying happens in callbacks afterwards.
   */
  const unlock = useCallback(() => {
    const el = ensure() // also resumes the context
    try {
      el.src = silentClip(ctxRef.current?.sampleRate ?? 48000)
      el.muted = true
      const started = el.play()
      const release = () => {
        el.pause()
        el.muted = false
        el.removeAttribute('src')
      }
      if (started) started.then(release).catch(release)
      else release()
    } catch {
      // Nothing to recover: a browser that refuses this doesn't need it.
    }
  }, [ensure])

  const getAnalyser = useCallback(() => analyserRef.current, [])

  /** Playback position within the sentence currently playing, in seconds of media time.
   *
   * Media time, so it's directly comparable to the synthesizer's word timings no matter what
   * playbackRate is set to — a 1.5x reading reaches the same word at the same currentTime, just
   * sooner in wall-clock terms. That's what lets the highlight follow the speed setting for free.
   */
  const currentTime = useCallback(() => elRef.current?.currentTime ?? 0, [])

  /** Whether audio is audibly in progress. Lets the reply flow distinguish "the stream finished
   * and the voice has already gone quiet" from "the stream finished but sentences are still being
   * spoken" — the two need opposite next steps. */
  const isPlaying = useCallback(() => playingRef.current, [])

  /** Kills whatever's currently playing and drops anything queued — for a pause-button or
   * barge-in interrupt. Deliberately doesn't call onQueueEmpty: unlike playback finishing
   * naturally, an interrupt has a caller who already knows why it stopped and drives the next
   * state transition itself (e.g. straight into listening for a barge-in).
   */
  const stop = useCallback(() => {
    queueRef.current = []
    playingRef.current = false
    const el = elRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
    }
    releaseUrl()
  }, [])

  return { enqueue, getAnalyser, isPlaying, currentTime, unlock, stop }
}
