import { Audio } from '@remotion/media'
import { Sequence } from 'remotion'
import { FPS, voiceStartFrame, type Cut } from '../timeline'
import take from './tutor-sn1-sn2.words.json'
import { musicSrc, sfxSrc, voiceSrc } from './assets'
import { musicGain } from './ducking'

/** The voice line at the frame the voice scene starts it, the sound effects (one track, the cut's
 * length, from its first frame) and the music bed. Any of them can be absent and the video still
 * renders: silent, it is still whole, because the captions and the karaoke carry it — which is how
 * most feeds autoplay it anyway. */
export function Soundtrack({ cut, silent = false, music = true, sfx = true }: { cut: Cut; silent?: boolean; music?: boolean; sfx?: boolean }) {
  const voice = silent ? null : voiceSrc()
  const bed = silent || !music ? null : musicSrc()
  const effects = silent || !sfx ? null : sfxSrc(cut.id)
  const start = voiceStartFrame(cut)
  return (
    <>
      {voice && (
        <Sequence from={start} durationInFrames={Math.ceil(take.duration * FPS) + 3} layout="none" name="Voice">
          <Audio src={voice} />
        </Sequence>
      )}
      {effects && <Audio src={effects} />}
      {bed && <Audio src={bed} volume={(f) => musicGain(f, start, cut.durationInFrames, cut.id === 'Launch30' ? 30 : 40)} />}
    </>
  )
}
