import { useMemo } from 'react'
import { STUDY, demo } from '../data/demo'
import { cameraAt } from '../lib/camera'
import { pointerAt, pressed } from '../lib/cursor'
import { gradeLanding } from '../lib/grade'
import { typedChars } from '../lib/stream'
import { caretVisible, typedAt, typingSchedule } from '../lib/typing'
import { AppCanvas } from '../primitives/AppCanvas'
import { Pointer } from '../primitives/Pointer'
import { StudyScreen } from '../replica/StudyScreen'
import { FPS, type Layout, type StudyBeats } from '../timeline'
import { centre, ms, useSceneFrame } from './common'

/** A card answered and graded: the answer typed, "Check my answer", the mark while the grader
 * reads it, the explanation typed out, the score landing — and in the 60 s cut, the card saved
 * for the tutor. Everything on screen is StudyScreen's; this decides only when. */
export function StudyScene({ layout, beats }: { layout: Layout; beats: StudyBeats }) {
  const f = useSceneFrame()
  const desktop = layout === 'landscape'
  const typing = useMemo(() => typingSchedule(demo.study.typed, beats.typeStart, beats.typeEnd, 'answer'), [beats.typeStart, beats.typeEnd])

  const released = beats.press + 2
  const phase = f < released ? 'answering' : f < beats.land ? 'grading' : 'graded'
  const typed = typedAt(f, demo.study.typed, typing)
  const landing = f >= beats.land && f < beats.land + 16 ? gradeLanding(f, beats.land) : undefined
  const save = beats.save
  const explanation = demo.study.result.explanation
  const written = typedChars(f, explanation, beats.streamStart, beats.streamEnd)

  // The pointer: to "Check my answer", then (60 s) to "Save for tutor".
  const check = centre(layout, 'study-answering', 'check')
  const saveAt = centre(layout, 'study-graded', 'save')
  let pointer: { x: number; y: number; visible: number; down: boolean; hand: boolean } | null = null
  if (desktop) {
    const rest = { x: check.x + 330, y: check.y + 150 }
    if (save && f >= save.pointerStart) {
      // Once the button has become its confirmation there's nothing under the hand to press: it
      // turns back into an arrow and drifts off the words, into the empty page below.
      const off = { x: saveAt.x + 36, y: saveAt.y + 74 }
      const p = f < save.press + 6 ? pointerAt(f, { x: check.x + 40, y: check.y + 60 }, saveAt, save.pointerStart, save.hover) : pointerAt(f, saveAt, off, save.press + 6, save.press + 26)
      pointer = { ...p, visible: Math.min(1, (f - save.pointerStart) / 4), down: pressed(f, save.press), hand: f >= save.hover - 2 && f < save.press + 2 }
    } else if (f >= beats.pointerStart && f < beats.land) {
      const p = f < released + 4 ? pointerAt(f, rest, check, beats.pointerStart, beats.hover) : pointerAt(f, check, { x: check.x + 40, y: check.y + 60 }, released + 4, released + 16)
      pointer = { ...p, visible: Math.min(1, (f - beats.pointerStart) / 4) * Math.min(1, (beats.land - f) / 6), down: pressed(f, beats.press), hand: f >= beats.hover - 2 && f < released + 6 }
    }
  } else {
    if (f >= beats.press - 2 && f < beats.press + 8) pointer = { ...check, visible: f < beats.press + 3 ? 1 : (beats.press + 8 - f) / 5, down: pressed(f, beats.press), hand: false }
    if (save && f >= save.press - 2 && f < save.press + 8) pointer = { ...saveAt, visible: f < save.press + 3 ? 1 : (save.press + 8 - f) / 5, down: pressed(f, save.press), hand: false }
  }

  return (
    <AppCanvas layout={layout} camera={cameraAt(f, beats.camera[layout])}>
      <StudyScreen
        desktop={desktop}
        phase={phase}
        deckName={STUDY.deckName}
        left={STUDY.total}
        total={STUDY.total}
        done={phase === 'graded' ? (landing ? landing.swap : 1) : 0}
        examDays={STUDY.examDays}
        subtopic={demo.study.card.subtopic}
        question={demo.study.card.question}
        typed={phase === 'answering' ? typed.text : demo.study.typed}
        caret={phase === 'answering' && caretVisible(f, typed.lastKey, FPS)}
        focused={phase === 'answering'}
        streamed={phase === 'answering' ? '' : phase === 'graded' ? explanation : explanation.slice(0, written)}
        unwritten={phase === 'grading' ? explanation.slice(written) : undefined}
        loaderMs={phase === 'grading' ? ms(f - released) : null}
        score={demo.study.result.score}
        gradeLabel={STUDY.gradeLabel}
        gradeColor={STUDY.gradeColor}
        due={STUDY.due}
        modelAnswer={demo.study.modelAnswer}
        queueAfter={STUDY.total - 1}
        landing={landing}
        check={{ hover: desktop && f >= beats.hover && f < released, down: pressed(f, beats.press) }}
        save={save ? { hover: desktop && f >= save.hover && f < save.press + 2, down: pressed(f, save.press), saved: f >= save.press + 2 } : undefined}
        touch={!desktop}
      />
      {pointer && pointer.visible > 0 && <Pointer kind={desktop ? 'mouse' : 'touch'} x={pointer.x} y={pointer.y} hand={pointer.hand} down={pointer.down} opacity={pointer.visible} />}
    </AppCanvas>
  )
}
