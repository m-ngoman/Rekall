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

  // Scrolling, within what the real pages allow (measured in the app: the form ends 75 px below a
  // desktop window and 279 px below a phone's). Down to the button before it's pressed — on the
  // desktop to 60, which shows the form whole with "Back" as its first line; on a phone to 282,
  // where the button clears the tab bar and the window's top edge falls between the paragraph and
  // "Add to" instead of through a line of text. (Those 3 px past the page's end show only more of
  // its background, under the tab bar.) While it runs the inputs only turn invisible, so the page
  // keeps its length. The result then replaces the form where the page already is — the app
  // doesn't scroll it. On the desktop the result fits the window, so the browser is back at the
  // top at once, and the camera leans in on the list instead. On a phone it goes back up to the
  // summary line, then down to the end of the page (312), where the dropped card is.
  const formScroll = desktop ? 60 : 282
  const resultScroll = 312
  const scrollY =
    phase === 'result'
      ? desktop
        ? 0
        : f < beats.result + 40
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
