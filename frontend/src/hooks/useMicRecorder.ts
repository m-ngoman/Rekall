import { useCallback, useRef } from 'react'

// Defaults only — both are now user settings, because mic sensitivity varies enough between
// devices that no single constant works everywhere. These are the fallbacks used before settings
// have loaded, and they match the server-side defaults.
const DEFAULT_SILENCE_THRESHOLD = 10
const DEFAULT_SILENCE_TIMEOUT_MS = 1500
const MIN_SPEECH_MS = 300 // ignore amplitude blips before the user has properly started talking
const MAX_RECORDING_MS = 30000 // safety cap so a stuck-open mic can't record forever
/** Give up (and hand back an empty transcript) if nobody starts talking at all. The streaming
 * transcriber is billed by the minute, so a cycle nobody speaks into is pure waste — it used to
 * run the full 30s cap. Voice mode drops to its free local watcher instead, which is where an
 * unattended screen belongs. */
const NO_SPEECH_TIMEOUT_MS = 7000

// Runs on the audio-rendering thread so it can't be blocked by main-thread work. Buffers several
// 128-sample render quanta into ~2048-sample (~43ms @ 48kHz) chunks before posting to the main
// thread — sending every 128-sample block as its own WebSocket frame would be ~375 tiny messages
// a second for no latency benefit.
const PCM_WORKLET_SOURCE = `
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.buffered = 0
    this.target = 2048
  }
  process(inputs) {
    const input = inputs[0][0]
    if (input) {
      this.chunks.push(input.slice())
      this.buffered += input.length
      if (this.buffered >= this.target) {
        const merged = new Float32Array(this.buffered)
        let offset = 0
        for (const chunk of this.chunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        const pcm = new Int16Array(merged.length)
        for (let i = 0; i < merged.length; i++) {
          const s = Math.max(-1, Math.min(1, merged[i]))
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer])
        this.chunks = []
        this.buffered = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-worklet', PCMWorklet)
`
let workletModuleUrl: string | null = null

/** Speech energy, not overall loudness.
 *
 * The old measurement averaged every frequency bin, which on a phone is dominated by the bins
 * below speech — handling noise, a fan, traffic rumble. That inflated the level so it never fell
 * back under the silence threshold, and the turn just kept listening after the user stopped
 * talking. Averaging only the band voices actually occupy (roughly 300Hz-3.4kHz, the same range
 * telephony keeps) both removes that rumble and raises the contrast between talking and not.
 */
function speechLevel(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number {
  analyser.getByteFrequencyData(data)
  const perBin = analyser.context.sampleRate / 2 / data.length
  const lo = Math.max(1, Math.floor(300 / perBin))
  const hi = Math.min(data.length - 1, Math.ceil(3400 / perBin))
  let sum = 0
  for (let i = lo; i <= hi; i++) sum += data[i]
  return sum / (hi - lo + 1)
}

/** How far above the room's own noise level speech has to be. A fixed threshold alone can't work
 * everywhere: 10 is silence in a café and shouting in a quiet bedroom. */
const OVER_FLOOR = 6

/** Tracks the quiet baseline of the room: drops to any new low immediately, climbs back only
 * slowly, so a burst of talking can't drag the floor up behind it and deafen the detector. */
function noiseFloorTracker() {
  let floor = -1
  return (level: number) => {
    floor = floor < 0 || level < floor ? level : floor * 0.998 + level * 0.002
    return floor
  }
}

export interface MicTuning {
  /** Amplitude floor below which input counts as silence. */
  sensitivity?: number
  /** How long a pause ends the turn. Ignored entirely when pushToTalk is on. */
  silenceMs?: number
  /** Hold the mic open until stopped explicitly, rather than ending on silence. */
  pushToTalk?: boolean
}

export function useMicRecorder(tuning: MicTuning = {}) {
  // Held in a ref so changing a setting mid-session takes effect on the next utterance without
  // re-creating the recorder and dropping the live audio graph.
  const tuningRef = useRef(tuning)
  tuningRef.current = tuning
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const start = useCallback(async (): Promise<AnalyserNode> => {
    // Reuse a capture that's already live. The amplitude watcher hands straight over to a real
    // listening cycle, and tearing the stream down only to call getUserMedia again costs a few
    // hundred milliseconds — which land precisely on the user's first syllable.
    const existing = streamRef.current
    if (existing?.active && analyserRef.current && audioCtxRef.current) {
      await audioCtxRef.current.resume()
      return analyserRef.current
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser

    return analyser
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
  }, [])

  const getAnalyser = useCallback(() => analyserRef.current, [])

  /** Cheap "has the user started talking" watch — local mic amplitude only, no transcription
   * connection, so it can run indefinitely for free. Used both to catch a barge-in while the
   * tutor is speaking and to hold voice mode open between turns without paying for silence.
   *
   * Fires `onDetected` once amplitude sustains above the threshold for MIN_SPEECH_MS (the same
   * bar a real utterance has to clear, so speaker bleed and coughs don't trigger it) and stops
   * watching.
   *
   * Neither firing nor `cancel()` releases the microphone: one capture serves a whole voice
   * session, because iOS asks for permission again on every re-acquisition and this watcher
   * starts and stops several times per exchange. Releasing it is `stop()`'s job, called when
   * voice mode ends or the screen unmounts.
   */
  const watchForSpeech = useCallback(
    async (onDetected: () => void): Promise<{ cancel: () => void }> => {
      const analyser = await start()
      let cancelled = false
      let loudSince: number | null = null
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const floorOf = noiseFloorTracker()
      const intervalId = window.setInterval(() => {
        if (cancelled) return
        const avg = speechLevel(analyser, dataArray)
        const floor = floorOf(avg)
        const now = Date.now()

        if (avg > (tuningRef.current.sensitivity ?? DEFAULT_SILENCE_THRESHOLD) && avg > floor + OVER_FLOOR) {
          if (loudSince === null) loudSince = now
          if (now - loudSince > MIN_SPEECH_MS) {
            clearInterval(intervalId)
            onDetected()
          }
        } else {
          loudSince = null
        }
      }, 100)

      const cancel = () => {
        cancelled = true
        clearInterval(intervalId)
      }
      return { cancel }
    },
    [start, stop],
  )

  /** Starts recording and streams raw PCM live to our backend's Deepgram proxy (see
   * app/services/live_stt.py — proxied rather than a direct browser connection since the raw key
   * can't safely reach the client and every other cloud service in this app is backend-only too)
   * for word-by-word partial transcripts (via `onPartial`), auto-stopping once the user has
   * spoken and then gone quiet for the configured silence timeout (or MAX_RECORDING_MS elapses) —
   * same silence-detection loop as before, just driving a live websocket instead of a
   * MediaRecorder blob. Resolves with the final transcript text (no audio blob — nothing
   * downstream needs it once we transcribe live).
   */
  const listenUntilSilence = useCallback(
    async (onPartial: (text: string) => void): Promise<{ promise: Promise<string>; cancel: () => void }> => {
      const analyser = await start()
      const audioCtx = audioCtxRef.current!
      const stream = streamRef.current!

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${wsProtocol}//${window.location.host}/api/tutor/live-transcribe?sample_rate=${audioCtx.sampleRate}`)
      let finalText = ''

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('Could not reach the transcription server'))
      })

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        const transcript = msg?.channel?.alternatives?.[0]?.transcript as string | undefined
        if (transcript) {
          if (msg.is_final) finalText = (finalText + ' ' + transcript).trim()
          onPartial(msg.is_final ? finalText : (finalText + ' ' + transcript).trim())
        }
      }

      if (!workletModuleUrl) {
        workletModuleUrl = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }))
      }
      await audioCtx.audioWorklet.addModule(workletModuleUrl)
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-worklet')
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(worklet)
      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(e.data)
      }

      /** Ends this turn's transcription without releasing the microphone.
       *
       * The mic used to be stopped after every utterance and re-acquired for the next one, which
       * meant several getUserMedia calls per exchange. iOS re-prompts on re-acquisition, so a
       * single conversation could ask for permission repeatedly. One capture now serves the whole
       * voice session and is released when voice mode ends (see the safety net in TutorScreen).
       */
      const releaseGraph = () => {
        worklet.port.onmessage = null
        try {
          source.disconnect()
          worklet.disconnect()
        } catch {
          // Already disconnected — nothing to undo.
        }
      }

      let cancelled = false
      let intervalId = 0

      // Deepgram sends a `Metadata` message once it's flushed everything after CloseStream —
      // that's the signal this utterance is fully done, not just "no more audio incoming".
      //
      // The timeout is not optional. Waiting for that message unconditionally means a dropped or
      // half-open socket strands the microphone open (the recording indicator stays lit after
      // voice mode is over) and leaves this promise unresolved forever, so the turn never ends.
      // A late transcript is worth waiting a moment for; it is not worth the mic.
      const FINAL_MESSAGE_TIMEOUT_MS = 2000
      const finish = (): Promise<string> => {
        return new Promise((resolve) => {
          if (socket.readyState !== WebSocket.OPEN) {
            releaseGraph()
            resolve(finalText.trim())
            return
          }
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            socket.removeEventListener('message', onFinalMessage)
            socket.close()
            releaseGraph()
            resolve(finalText.trim())
          }
          const onFinalMessage = (e: MessageEvent) => {
            const msg = JSON.parse(e.data)
            if (msg.type === 'Metadata') done()
          }
          const timer = window.setTimeout(done, FINAL_MESSAGE_TIMEOUT_MS)
          socket.addEventListener('message', onFinalMessage)
          socket.send(JSON.stringify({ type: 'CloseStream' }))
        })
      }

      const promise = new Promise<string>((resolve) => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const floorOf = noiseFloorTracker()
        let speechStarted = false
        let lastLoudTime = Date.now()
        const startTime = Date.now()

        intervalId = window.setInterval(() => {
          if (cancelled) return
          const avg = speechLevel(analyser, dataArray)
          const floor = floorOf(avg)
          const now = Date.now()

          if (avg > (tuningRef.current.sensitivity ?? DEFAULT_SILENCE_THRESHOLD) && avg > floor + OVER_FLOOR) {
            if (!speechStarted && now - startTime > MIN_SPEECH_MS) speechStarted = true
            lastLoudTime = now
          }

          const silentFor = now - lastLoudTime
          const elapsed = now - startTime
          // Push-to-talk never ends on silence — only the explicit stop, or the safety cap.
          // The cap still applies: it's what stops a pocketed phone streaming indefinitely.
          const silenceMs = tuningRef.current.silenceMs ?? DEFAULT_SILENCE_TIMEOUT_MS
          const endedBySilence = !tuningRef.current.pushToTalk && speechStarted && silentFor > silenceMs
          // Nobody ever started: end early rather than streaming silence to a metered API. Not
          // gated on pushToTalk — holding the button and saying nothing is still nothing to
          // transcribe, and voice mode simply falls back to watching locally.
          const nobodySpoke = !speechStarted && elapsed > NO_SPEECH_TIMEOUT_MS
          if (endedBySilence || nobodySpoke || elapsed > MAX_RECORDING_MS) {
            clearInterval(intervalId)
            finish().then(resolve)
          }
        }, 100)
      })

      const cancel = () => {
        cancelled = true
        clearInterval(intervalId)
        socket.close()
        releaseGraph()
      }

      return { promise, cancel }
    },
    [start, stop],
  )

  return { start, stop, getAnalyser, listenUntilSilence, watchForSpeech }
}
