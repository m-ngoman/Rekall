import demo from './demo.json'

export { demo }

/** Whole days from the demo's today to `iso` — the app's daysUntil, with today fixed. */
export function daysFromToday(iso: string): number {
  const [y1, m1, d1] = demo.today.split('-').map(Number)
  const [y2, m2, d2] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

export const upcomingExams = () => demo.exams.filter((e) => e.date >= demo.today).sort((a, b) => a.date.localeCompare(b.date))
export const nextExam = () => upcomingExams()[0]
export const deckById = (id: string) => demo.decks.find((d) => d.id === id)!

/** The study screen's fixed facts, derived the way StudyScreen derives them. */
export const STUDY = {
  deckName: deckById(demo.study.deckId).name,
  total: demo.study.queueLength,
  examDays: daysFromToday(nextExam().date),
  gradeLabel: ({ 1: 'Forgot', 2: 'Hard', 3: 'Good', 4: 'Easy' } as Record<number, string>)[demo.study.result.grade],
  gradeColor: ({ 1: 'var(--grade-forgot)', 2: 'var(--grade-hard)', 3: 'var(--grade-good)', 4: 'var(--grade-good)' } as Record<number, string>)[demo.study.result.grade],
  due: `Back in ${daysFromToday(demo.study.result.due.slice(0, 10))} days`,
}
