import { demo } from '../data/demo'
import { barGrowth } from '../lib/calendar'
import { cameraAt } from '../lib/camera'
import { digitRise } from '../lib/countdown'
import { pointerAt, pressed } from '../lib/cursor'
import { pillAt } from '../lib/pill'
import { AppCanvas } from '../primitives/AppCanvas'
import { Pointer } from '../primitives/Pointer'
import { ExamsScreen } from '../replica/ExamsScreen'
import { Shell } from '../replica/Shell'
import { tabBox } from '../replica/TabBar'
import type { CalendarBeats, Layout } from '../timeline'
import { centre, useSceneFrame } from './common'

/** The calendar as a workload: the countdown with the cards before the exam, and each day's bar
 * filling in from today. In the 60 s cut, on to November, where the exam is. Arrived at from Home,
 * so on a phone the tab bar's pill slides across to Calendar as the scene opens. */
export function CalendarScene({ layout, beats }: { layout: Layout; beats: CalendarBeats }) {
  const f = useSceneFrame()
  const desktop = layout === 'landscape'
  const [y, m] = demo.today.split('-').map(Number)
  const next = beats.nextMonth
  const turned = next ? f >= next.press + 2 : false
  const month = turned ? m : m - 1 // 0-based: October, then November
  const barsFrom = turned ? next!.press + 4 : 4
  const nav = centre(layout, 'calendar', 'nextMonth')
  const pointer =
    next && f >= next.pointerStart && f < next.press + 8
      ? desktop
        ? { ...pointerAt(f, { x: nav.x - 240, y: nav.y + 260 }, nav, next.pointerStart, next.press - 4), visible: Math.min(1, (f - next.pointerStart) / 4, (next.press + 8 - f) / 5), hand: f >= next.press - 6 }
        : f >= next.press - 2
          ? { ...nav, visible: f < next.press + 3 ? 1 : (next.press + 8 - f) / 5, hand: false }
          : null
      : null
  return (
    <AppCanvas layout={layout} camera={cameraAt(f, beats.camera[layout])}>
      <Shell tab="calendar" pill={desktop ? undefined : pillAt(f, 0, tabBox('home'), tabBox('calendar'))}>
        <ExamsScreen
          year={y}
          month={month}
          bars={(order) => barGrowth(f, barsFrom, order)}
          digits={digitRise(f, 0, 2)}
          nextMonth={next ? { hover: desktop && f >= next.press - 6 && f < next.press, down: pressed(f, next.press) } : undefined}
          touch={!desktop}
        />
      </Shell>
      {pointer && pointer.visible > 0 && <Pointer kind={desktop ? 'mouse' : 'touch'} x={pointer.x} y={pointer.y} hand={pointer.hand} down={pressed(f, next!.press)} opacity={pointer.visible} />}
    </AppCanvas>
  )
}
