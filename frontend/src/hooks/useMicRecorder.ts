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

/** How much quieter than the starting bar a voice may go and still count as "still talking".
 *
 * Starting and continuing were one test, and that is the reason turns ended mid-sentence. Speech
 * is not continuous: it dips between words and dips further between clauses, several times a
 * sentence. Gated on the same bar, every one of those dips reads as silence, and the turn ends
 * as soon as one of them outlasts the silence timeout — a second, on the settings actually in
 * use. The louder the starting bar is set, the more of ordinary speech falls under it, which is
 * why raising sensitivity made this worse rather than better.
 *
 * Hysteresis is the standard answer: a high bar to open, a low bar to hold. Starting still has
 * to clear the user's full setting, so nothing is easier to trigger by accident. */
const CONTINUE_RATIO = 0.5

/** Tracks the quiet baseline of the room: drops to any new low immediately, climbs back only
 * slowly, so a burst of talking can't drag the floor up behind it and deafen the detector.
 *
 * One of these per capture, never per turn — see floorFor. The first reading it is given becomes
 * the floor outright, because a fresh tracker has nothing better to go on, and that is only safe
 * if the first reading is actually of a quiet room. */
function noiseFloorTracker() {
  let floor = -1
  return (level: number) => {
    floor = floor < 0 || level < floor ? level : floor * 0.998 + level * 0.002
    return floor
  }
}

export interface MicTurnDebug {
  reason: 'silence' | 'transcriber' | 'nobody-spoke' | 'max-length'
  ms: number
  peak: number
  mean: number
  floor: number
  startBar: number
  silenceMs: number
  /** Worklet buffers posted this turn, and how long since the last one. If audio stops arriving
   * while somebody is still speaking, the fault is upstream of every threshold. */
  chunks: number
  msSinceAudio: number
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
  // One source node for the whole capture. See start() for why there must only ever be one.
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  /** A silent path from the capture to the speakers. It exists to be connected, not heard.
   *
   * Web Audio renders by pulling from the destination backwards. A branch with no route there is
   * not guaranteed to be rendered at all, and the capture graph had no route: source fed the
   * analyser and the worklet, and both were dead ends. Desktop Chrome pulls them anyway. A phone,
   * throttling its audio thread, is under no obligation to — and when it stops, the worklet stops
   * posting PCM and the analyser freezes at once, mid-word, with nothing raised anywhere.
   *
   * Gain stays at zero, so nothing is audible and no echo is fed back into the microphone. */
  const muteRef = useRef<GainNode | null>(null)
  const floorRef = useRef<((level: number) => number) | null>(null)
  /** What the last turn's detector actually saw. Diagnostic only — two wrong guesses at why
   * turns were ending early is two more than it should take to just look. */
  const debugRef = useRef<MicTurnDebug | null>(null)

  /** The room's noise floor, shared by every watcher and listen cycle on one capture.
   *
   * It used to be built fresh inside each of them, which quietly broke the hand-off between the
   * two. A tracker's first reading becomes its floor, and listenUntilSilence is entered from the
   * watcher at the exact moment speech was detected — so its brand-new tracker took its first
   * reading of a person mid-word and adopted *speech* as the room's baseline. Everything then had
   * to clear speech + OVER_FLOOR to count as speech: a loud opening syllable would trip
   * speechStarted, nothing after it registered, lastLoudTime went stale, and the turn ended on
   * silence about a second and a half in. Two or three words, then cut off.
   *
   * It showed up on phones and not desktops because the difference is latency: a slower hand-off
   * lands the first reading further into the word. Turning the sensitivity threshold up made it
   * worse rather than better, which is the tell that the floor and not the threshold was wrong.
   *
   * A room's quiet is a property of the room, not of a turn, and the watcher between turns is
   * listening to exactly that. Shared, it learns the floor in real silence and the listen cycle
   * inherits it. Reset only when the capture ends. */
  const floorFor = useCallback((level: number) => {
    if (!floorRef.current) floorRef.current = noiseFloorTracker()
    return floorRef.current(level)
  }, [])

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
    // Created here and nowhere else. A MediaStream feeds exactly one source node reliably:
    // build a second from the same stream and the browser stops delivering audio to one of
    // them, with no error anywhere. listenUntilSilence used to make its own per utterance, so
    // a conversation accumulated one node per turn and the analyser this one feeds went silent
    // after the first — the silence detector then saw nothing, every later turn timed out at
    // NO_SPEECH_TIMEOUT_MS, and the transcript came back empty while the socket looked healthy.
    const source = audioCtx.createMediaStreamSource(stream)
    sourceRef.current = source
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const mute = audioCtx.createGain()
    mute.gain.value = 0
    mute.connect(audioCtx.destination)
    muteRef.current = mute

    source.connect(analyser)
    // Anchors the branch. Without it the analyser is a leaf the renderer may skip.
    analyser.connect(mute)
    analyserRef.current = analyser

    return analyser
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    sourceRef.current = null
    muteRef.current = null
    // The next capture is a new room as far as this is concerned.
    floorRef.current = null
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

      const floorOf = floorFor
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
    [start, stop, floorFor],
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
      const source = sourceRef.current!

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${wsProtocol}//${window.location.host}/api/tutor/live-transcribe?sample_rate=${audioCtx.sampleRate}`)
      let finalText = ''
      /** Last moment *anything* said the user was still talking. Amplitude is one witness; the
       * transcriber is the other, and it is the better one.
       *
       * Amplitude alone cannot tell a pause from an ending, because a pause is silence — that is
       * what a pause is. Somebody breaking mid-sentence at an em dash, or drawing breath before
       * the next clause, produces exactly the trace of somebody who has stopped, and the turn
       * ended on them mid-thought. Deepgram is running its own endpointing over the same audio
       * and keeps emitting while it believes the utterance is still open, so its output is a
       * direct read on "still going" that no amount of level-watching can reconstruct.
       *
       * The turn now ends only when both have gone quiet. */
      let endedByTranscriber = false
      let chunks = 0
      let lastChunkAt = Date.now()

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('Could not reach the transcription server'))
      })

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        const transcript = msg?.channel?.alternatives?.[0]?.transcript as string | undefined
        // `speech_final` is Deepgram's own endpointing saying this utterance is over — a real
        // end-of-speech decision made on the audio, not a guess from amplitude. Interim results
        // are NOT evidence of the opposite: Deepgram keeps re-emitting its running hypothesis
        // through a pause, so treating any transcript as "still talking" kept the turn alive
        // until the 30s cap and it never ended on its own at all.
        if (msg.speech_final) endedByTranscriber = true
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
      source.connect(worklet)
      // Same reason as the analyser: a worklet nothing pulls from is a worklet that may stop
      // being asked for samples.
      worklet.connect(muteRef.current!)
      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        // Counted so a turn that dies can say whether the audio thread was still producing.
        // If these stop while the user is mid-word, nothing downstream of here is the problem.
        chunks += 1
        lastChunkAt = Date.now()
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
          // Only this turn's edge. A bare source.disconnect() would also drop the analyser the
          // silence detector and the between-turns watcher both read, which is the same failure
          // by a different route — the mic stays open and nothing ever hears anything again.
          source.disconnect(worklet)
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
        const floorOf = floorFor
        let speechStarted = false
        let lastLoudTime = Date.now()
        const startTime = Date.now()
        // Kept so a turn that ends wrongly can say what it saw, rather than being guessed at from
        // the outside. Surfaced by TutorScreen only when ?mic=debug is on the URL.
        let peak = 0
        let levelSum = 0
        let levelCount = 0

        intervalId = window.setInterval(() => {
          if (cancelled) return
          const avg = speechLevel(analyser, dataArray)
          const floor = floorOf(avg)
          const now = Date.now()

          // Two bars. Opening one has to clear the user's setting outright; holding one only has
          // to clear half of it, so the dips inside a sentence don't read as the end of it.
          const startBar = tuningRef.current.sensitivity ?? DEFAULT_SILENCE_THRESHOLD
          const loudEnough = speechStarted
            ? avg > startBar * CONTINUE_RATIO && avg > floor + OVER_FLOOR * CONTINUE_RATIO
            : avg > startBar && avg > floor + OVER_FLOOR
          if (loudEnough) {
            if (!speechStarted && now - startTime > MIN_SPEECH_MS) speechStarted = true
            lastLoudTime = now
          }
          if (avg > peak) peak = avg
          levelSum += avg
          levelCount += 1

          const silentFor = now - lastLoudTime
          const elapsed = now - startTime
          // Push-to-talk never ends on silence — only the explicit stop, or the safety cap.
          // The cap still applies: it's what stops a pocketed phone streaming indefinitely.
          const silenceMs = tuningRef.current.silenceMs ?? DEFAULT_SILENCE_TIMEOUT_MS
          const endedBySilence = !tuningRef.current.pushToTalk && speechStarted && silentFor > silenceMs
          // Deepgram's verdict counts the same as our own, and usually arrives first.
          const endedByVoice = !tuningRef.current.pushToTalk && speechStarted && endedByTranscriber
          // Nobody ever started: end early rather than streaming silence to a metered API. Not
          // gated on pushToTalk — holding the button and saying nothing is still nothing to
          // transcribe, and voice mode simply falls back to watching locally.
          const nobodySpoke = !speechStarted && elapsed > NO_SPEECH_TIMEOUT_MS
          if (endedBySilence || endedByVoice || nobodySpoke || elapsed > MAX_RECORDING_MS) {
            debugRef.current = {
              reason: endedByVoice
                ? 'transcriber'
                : endedBySilence
                  ? 'silence'
                  : nobodySpoke
                    ? 'nobody-spoke'
                    : 'max-length',
              ms: elapsed,
              peak: Math.round(peak),
              mean: levelCount ? Math.round(levelSum / levelCount) : 0,
              floor: Math.round(floor),
              startBar: tuningRef.current.sensitivity ?? DEFAULT_SILENCE_THRESHOLD,
              silenceMs,
              chunks,
              msSinceAudio: now - lastChunkAt,
            }
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
    [start, stop, floorFor],
  )

  return { stop, getAnalyser, listenUntilSilence, watchForSpeech, debugRef }
}
