import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import type { ReactNode } from 'react'
import { Soundtrack } from '../audio/Soundtrack'
import { CAPTIONS } from '../data/copy'
import { progress } from '../lib/ease'
import { Caption } from '../primitives/Caption'
import { SafeZones } from '../primitives/SafeZones'
import { CalendarScene } from '../scenes/CalendarScene'
import { SceneOffset } from '../scenes/common'
import { EndCard } from '../scenes/EndCard'
import { GenerateScene } from '../scenes/GenerateScene'
import { HomeScene } from '../scenes/HomeScene'
import { StudyScene } from '../scenes/StudyScene'
import { VoiceScene } from '../scenes/VoiceScene'
import { LAUNCH30, LAUNCH60, type Cut as CutSpec, type Layout, type Scene } from '../timeline'

export const CUTS_BY_ID = { Launch30: LAUNCH30, Launch60: LAUNCH60 } as const

export type CutProps = {
  cut: keyof typeof CUTS_BY_ID
  layout: Layout
  /** Render without any audio, even when a voice take is present. */
  silent?: boolean
  /** Leave out the music bed (the voice stays). */
  music?: boolean
  /** Leave out the sound effects (the voice stays). */
  sfx?: boolean
  /** Draw the platforms' overlay zones, for review. */
  guides?: boolean
  /** Draw the captions (off for the automated check that their band is empty). */
  captions?: boolean
}

function renderScene(scene: Scene, layout: Layout, prev: Scene | undefined, silent: boolean): ReactNode {
  switch (scene.kind) {
    case 'study':
      return <StudyScene layout={layout} beats={scene.beats} />
    case 'voice':
      return <VoiceScene layout={layout} beats={scene.beats} silent={silent} />
    case 'generate':
      return <GenerateScene layout={layout} beats={scene.beats} />
    case 'home':
      return <HomeScene layout={layout} beats={scene.beats} from={prev?.kind === 'generate' ? 'cards' : undefined} />
    case 'calendar':
      return <CalendarScene layout={layout} beats={scene.beats} />
    case 'end':
      return <EndCard layout={layout} />
  }
}

/** A scene fading in over the one before it: the video's own transition, used only where the app
 * has none to show. Navigation inside the app is a cut, because in the app it is instant. */
function FadeIn({ frames, children }: { frames: number; children: ReactNode }) {
  const f = useCurrentFrame()
  return <AbsoluteFill style={{ opacity: frames > 0 ? progress(f, 0, frames, (x) => x) : 1 }}>{children}</AbsoluteFill>
}

/** One cut of the video, in one format, from the storyboard in timeline.ts. */
export const Cut: React.FC<CutProps> = ({ cut: id, layout, silent = false, music = true, sfx = true, guides = false, captions = true }) => {
  const cut: CutSpec = CUTS_BY_ID[id]
  return (
    <AbsoluteFill style={{ background: 'var(--bg)' }}>
      {cut.scenes.map((scene, i) => {
        const t = i > 0 ? cut.transitions[i - 1] : undefined
        const lead = t?.kind === 'crossfade' ? t.frames : 0
        return (
          <Sequence key={i} from={scene.start - lead} durationInFrames={scene.duration + lead} name={scene.kind}>
            <SceneOffset.Provider value={lead}>
              <FadeIn frames={lead}>{renderScene(scene, layout, cut.scenes[i - 1], silent)}</FadeIn>
            </SceneOffset.Provider>
          </Sequence>
        )
      })}
      {captions && cut.captions.map((c) => <Caption key={`${c.id}-${c.from}`} text={CAPTIONS[c.id]} from={c.from} to={c.to} place={layout} />)}
      <Soundtrack cut={cut} silent={silent} music={music} sfx={sfx} />
      {guides && <SafeZones layout={layout} />}
    </AbsoluteFill>
  )
}
