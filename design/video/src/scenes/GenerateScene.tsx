import { demo } from '../data/demo'
import { cameraAt } from '../lib/camera'
import { pointerAt, pressed } from '../lib/cursor'
import { CAMERA_EASE, lerp, progress } from '../lib/ease'
import { AppCanvas } from '../primitives/AppCanvas'
import { Pointer } from '../primitives/Pointer'
import { sidebarItemCentre } from '../replica/DesktopSidebar'
import { GenerateScreen } from '../replica/GenerateScreen'
import { Shell } from '../replica/Shell'
import { tabBox } from '../replica/TabBar'
import type { GenerateBeats, Layout } from '../timeline'
import { centre, ms, useSceneFrame } from './common'

/** Cards from a saved note: the form with the note picked, the run with the backend's own stage
 * labels, and the result — including the card the check dropped, which is the point. The page
 * scrolls the way the app's would, to reach the button and then the dropped card. */
export function GenerateScene({ layout, beats }: { layout: Layout; beats: GenerateBeats }) {
  const f = useSceneFrame()
  const desktop = layout === 'landscape'
  const phase = f < beats.press + 2 ? 'form' : f < beats.result ? 'busy' : 'result'
  const stageIndex = beats.stages.filter((s) => f >= s).length - 1
  const stage = demo.generate.stages[Math.max(0, stageIndex)]

  // Scrolling: down to the button before it's pressed. The result then replaces the form where the
  // page already is — the app doesn't scroll it — so it goes back up to the summary line, and then
  // down to what the check dropped.
  const formScroll = desktop ? 90 : 270
  const resultScroll = desktop ? 150 : 372
  const scrollY =
    phase === 'result'
      ? f < beats.result + 40
        ? lerp(formScroll, 0, progress(f, beats.result + 6, 18, CAMERA_EASE))
        : lerp(0, resultScroll, progress(f, beats.result + 40, 40, CAMERA_EASE))
      : lerp(0, formScroll, progress(f, beats.pointerStart - 22, 20, CAMERA_EASE))

  const button = centre(layout, 'generate-form', 'generate', formScroll)
  const home = desktop ? sidebarItemCentre('home') : { x: 20 + 1 + tabBox('home').x + 32, y: 587 }
  const pointer = (() => {
    if (f >= beats.pointerStart && f < beats.press + 8) {
      return desktop
        ? { ...pointerAt(f, { x: button.x + 280, y: button.y - 160 }, button, beats.pointerStart, beats.press - 4), visible: Math.min(1, (f - beats.pointerStart) / 4, (beats.press + 8 - f) / 5), hand: f >= beats.press - 6, press: beats.press }
        : f >= beats.press - 2
          ? { ...button, visible: f < beats.press + 3 ? 1 : (beats.press + 8 - f) / 5, hand: false, press: beats.press }
          : null
    }
    if (f >= beats.homePointerStart && f < beats.homePress + 8) {
      return desktop
        ? { ...pointerAt(f, { x: home.x + 420, y: home.y + 240 }, home, beats.homePointerStart, beats.homePress - 4), visible: Math.min(1, (f - beats.homePointerStart) / 4), hand: f >= beats.homePress - 6, press: beats.homePress }
        : f >= beats.homePress - 2
          ? { ...home, visible: 1, hand: false, press: beats.homePress }
          : null
    }
    return null
  })()

  return (
    <AppCanvas layout={layout} camera={cameraAt(f, beats.camera[layout])}>
      <Shell tab="cards" scrollY={scrollY} pressedNav={desktop && pressed(f, beats.homePress) ? 'home' : null}>
        <GenerateScreen
          phase={phase}
          stage={stage}
          loaderMs={ms(f - beats.press - 2)}
          generate={{ hover: desktop && f >= beats.press - 6 && f < beats.press, down: pressed(f, beats.press) }}
          touch={!desktop}
        />
      </Shell>
      {pointer && pointer.visible > 0 && <Pointer kind={desktop ? 'mouse' : 'touch'} x={pointer.x} y={pointer.y} hand={pointer.hand} down={pressed(f, pointer.press)} opacity={pointer.visible} />}
    </AppCanvas>
  )
}
