import type { ReactNode } from 'react'
import { AbsoluteFill, continueRender, delayRender } from 'remotion'
import { useEffect, useState } from 'react'
import { STUDY, demo } from '../data/demo'
import { fontsLoaded } from '../fonts'
import { AppCanvas, CANVAS } from '../primitives/AppCanvas'
import { ExamsScreen } from '../replica/ExamsScreen'
import { GenerateScreen } from '../replica/GenerateScreen'
import { Composer, TutorPage } from '../replica/TutorScreen'
import { HomeScreen } from '../replica/HomeScreen'
import { Shell } from '../replica/Shell'
import { StudyScreen, type StudyView } from '../replica/StudyScreen'
import type { Layout } from '../timeline'

/** The replicas at rest, one still per state that scripts/reference.mjs photographs in the real
 * app, at the same size — so scripts/fidelity.mjs can put them side by side and count the pixels
 * that differ. */
const study = (layout: Layout, phase: 'answering' | 'graded'): StudyView => ({
  desktop: layout === 'landscape',
  phase,
  deckName: STUDY.deckName,
  left: STUDY.total,
  total: STUDY.total,
  done: phase === 'graded' ? 1 : 0,
  examDays: STUDY.examDays,
  subtopic: demo.study.card.subtopic,
  question: demo.study.card.question,
  typed: demo.study.typed,
  caret: false,
  focused: phase === 'answering',
  streamed: phase === 'graded' ? demo.study.result.explanation : '',
  loaderMs: null,
  score: demo.study.result.score,
  gradeLabel: STUDY.gradeLabel,
  gradeColor: STUDY.gradeColor,
  due: STUDY.due,
  modelAnswer: demo.study.modelAnswer,
  queueAfter: STUDY.total - 1,
})

export const FIDELITY_STATES: Record<string, (layout: Layout) => ReactNode> = {
  'study-answering': (layout) => <StudyScreen {...study(layout, 'answering')} />,
  'study-graded': (layout) => <StudyScreen {...study(layout, 'graded')} />,
  home: () => (
    <Shell tab="home">
      <HomeScreen />
    </Shell>
  ),
  calendar: () => (
    <Shell tab="calendar">
      <ExamsScreen year={2026} month={9} />
    </Shell>
  ),
  tutor: (layout) => (
    <Shell tab="tutor" scrollY={layout === 'portrait' ? 32 : 0} overlay={<Composer />}>
      <TutorPage messages={[]} />
    </Shell>
  ),
  'tutor-log': () => (
    <Shell tab="tutor" overlay={<Composer composerFocused />}>
      <TutorPage
        messages={[
          { role: 'user', text: demo.tutor.question },
          { role: 'assistant', text: demo.tutor.reply },
        ]}
      />
    </Shell>
  ),
  'generate-form': () => (
    <Shell tab="cards">
      <GenerateScreen phase="form" />
    </Shell>
  ),
  'generate-result': (layout) => (
    <Shell tab="cards" scrollY={layout === 'portrait' ? 312 : 0}>
      <GenerateScreen phase="result" />
    </Shell>
  ),
  'calendar-next': () => (
    <Shell tab="calendar">
      <ExamsScreen year={2026} month={10} />
    </Shell>
  ),
}

/** The reference screenshots' size: the replica's viewport at its base scale. */
export const fidelitySize = (layout: Layout) => ({
  width: Math.round(CANVAS[layout].width * CANVAS[layout].base),
  height: Math.round(CANVAS[layout].height * CANVAS[layout].base),
})

export const Fidelity: React.FC<{ state: string; layout: Layout }> = ({ state, layout }) => {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsLoaded.then(() => continueRender(handle))
  }, [handle])
  const c = CANVAS[layout]
  return (
    <AbsoluteFill>
      <AppCanvas layout={layout} camera={{ x: c.width / 2, y: c.height / 2, z: 1 }} bare>
        {FIDELITY_STATES[state](layout)}
      </AppCanvas>
    </AbsoluteFill>
  )
}
