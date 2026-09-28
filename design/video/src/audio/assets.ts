import { getAudioData } from '@remotion/media-utils'
import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, getStaticFiles, staticFile } from 'remotion'
import type { AudioSamples } from '../lib/orb'

/** The tutor's line, made by scripts/tts-inworld.mjs. Until it exists the video renders silent:
 * the karaoke still runs on the committed word timings and the orb on its seeded stand-in. */
export const VOICE_FILE = 'audio/tutor-sn1-sn2.wav'
/** An optional music bed, if one has been licensed and dropped in. */
export const MUSIC_FILES = ['audio/music.mp3', 'audio/music.wav', 'audio/music.m4a', 'audio/local/music.mp3', 'audio/local/music.wav', 'audio/local/music.m4a']

export const hasStaticFile = (name: string) => getStaticFiles().some((f) => f.name === name)
export const voiceSrc = (): string | null => (hasStaticFile(VOICE_FILE) ? staticFile(VOICE_FILE) : null)
export const musicSrc = (): string | null => {
  const found = MUSIC_FILES.find(hasStaticFile)
  return found ? staticFile(found) : null
}

/** The voice take's samples, decoded once, for the orb's analyser — or null when there is no take.
 * Holds the render until it has decoded, so no frame is drawn from a half-loaded file. */
export function useVoiceSamples(silent = false): AudioSamples | null {
  const src = silent ? null : voiceSrc()
  const [samples, setSamples] = useState<AudioSamples | null>(null)
  const [handle] = useState(() => (src ? delayRender('Decoding the voice take') : null))
  useEffect(() => {
    if (!src || handle === null) return
    getAudioData(src)
      .then((d) => {
        setSamples({ samples: d.channelWaveforms[0], sampleRate: d.sampleRate })
        continueRender(handle)
      })
      .catch((err) => cancelRender(err))
  }, [src, handle])
  return samples
}
