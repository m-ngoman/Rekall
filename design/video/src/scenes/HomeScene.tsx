import { cameraAt } from '../lib/camera'
import { digitRise } from '../lib/countdown'
import { pointerAt, pressed } from '../lib/cursor'
import { pillAt } from '../lib/pill'
import { AppCanvas } from '../primitives/AppCanvas'
import { Pointer } from '../primitives/Pointer'
import { HomeScreen } from '../replica/HomeScreen'
import { Shell } from '../replica/Shell'
import { tabBox } from '../replica/TabBar'
import type { Tab } from '@app/lib/route'
import type { HomeBeats, Layout } from '../timeline'
import { centre, useSceneFrame } from './common'

/** Home: the countdown to the next exam, the day's cards, one button. The count rises into place;
 * then the exam's name — a button to the calendar in the app — is pressed. `from` is the tab the
 * phone's tab bar pill slides over from, when the scene is arrived at by the tab bar. */
export function HomeScene({ layout, beats, from }: { layout: Layout; beats: HomeBeats; from?: Tab }) {
  const f = useSceneFrame()
  const desktop = layout === 'landscape'
  const name = centre(layout, 'home', 'examName')
  const pointer =
    f >= beats.pointerStart && f < beats.press + 6
      ? desktop
        ? { ...pointerAt(f, { x: name.x + 260, y: name.y + 330 }, name, beats.pointerStart, beats.press - 4), visible: Math.min(1, (f - beats.pointerStart) / 4), hand: f >= beats.press - 6 }
        : f >= beats.press - 2
          ? { ...name, visible: 1, hand: false }
          : null
      : null
  const pill = from && !desktop ? pillAt(f, 0, tabBox(from), tabBox('home')) : undefined
  return (
    <AppCanvas layout={layout} camera={cameraAt(f, beats.camera[layout])}>
      <Shell tab="home" pill={pill}>
        <HomeScreen digits={digitRise(f, 0, 2)} examName={{ hover: desktop && f >= beats.press - 6 && f < beats.press, down: pressed(f, beats.press) }} touch={!desktop} />
      </Shell>
      {pointer && <Pointer kind={desktop ? 'mouse' : 'touch'} x={pointer.x} y={pointer.y} hand={pointer.hand} down={pressed(f, beats.press)} opacity={pointer.visible} />}
    </AppCanvas>
  )
}
