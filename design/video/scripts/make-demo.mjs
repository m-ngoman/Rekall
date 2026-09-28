// Writes src/data/demo.json: everything the video shows, and everything the reference screenshots'
// mocked API serves (scripts/lib/mock-api.mjs), from one place so the two can't disagree.
//
// Numbers follow design/handoff/seed_fixture.py — four decks of 612/240/180/95 cards, 41 due today
// as 18 + 23, the SN1 card first — with one deliberate change: Pharmacology's exam is at +47 days,
// not +16. Home's countdown is always the *nearest* exam (FINDINGS.md §7), so with Pharmacology at
// +16 the hero would read "Pharmacology, 16 days" while the video studies organic chemistry. At
// +47 the app itself puts "Organic Chemistry II, 34 days" on Home, with nothing staged.
//
//   node scripts/make-demo.mjs
import fs from 'node:fs'
import path from 'node:path'

const TODAY = '2026-10-07' // a Wednesday
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

// Cards per day, the calendar's whole subject. Each deck with an exam paces its new cards to land
// before the date, so each contributes a ramp that ends on its exam day; a small base is reviews
// with no exam behind them. The wobble is the fixture's, so neighbouring days differ the way real
// FSRS days do. Today is what is due now: the 41 on Home.
function cardsOn(t) {
  if (t === 0) return 41
  let n = 3
  if (t <= 34) n += 6 + 0.75 * t // Organic Chemistry II, exam +34
  if (t <= 47) n += 4 + 0.35 * t // Pharmacology, exam +47
  if (t <= 40) n += 2 + 0.25 * t // Statistics, exam +40
  return Math.round(n * (1 + 0.16 * Math.sin(t * 2.1)))
}
// Deck ids are UUID-shaped because the app's router only opens /study/<36-character id>.
const ID = {
  orgo: '0f2c9a4e-7b1d-4c3a-9e5f-000000000001',
  pharm: '0f2c9a4e-7b1d-4c3a-9e5f-000000000002',
  stats: '0f2c9a4e-7b1d-4c3a-9e5f-000000000003',
  anat: '0f2c9a4e-7b1d-4c3a-9e5f-000000000004',
}
const load = {}
for (let t = 0; t <= 75; t++) load[addDays(TODAY, t)] = cardsOn(t)

const demo = {
  today: TODAY,
  decks: [
    { id: ID.orgo, name: 'Organic Chemistry II', total: 612, due: 18, new: 0, new_today: 0, learned: 612, exam_paused: false },
    { id: ID.pharm, name: 'Pharmacology', total: 240, due: 23, new: 0, new_today: 0, learned: 240, exam_paused: false },
    { id: ID.stats, name: 'Statistics', total: 180, due: 0, new: 0, new_today: 0, learned: 180, exam_paused: false },
    { id: ID.anat, name: 'Anatomy', total: 95, due: 0, new: 0, new_today: 0, learned: 95, exam_paused: true },
  ],
  exams: [
    { id: 'exam-orgo', name: 'Organic Chemistry II', date: addDays(TODAY, 34), deck_ids: [ID.orgo] },
    { id: 'exam-stats', name: 'Statistics', date: addDays(TODAY, 40), deck_ids: [ID.stats] },
    { id: 'exam-pharm', name: 'Pharmacology', date: addDays(TODAY, 47), deck_ids: [ID.pharm] },
    { id: 'exam-anat', name: 'Anatomy', date: addDays(TODAY, -12), deck_ids: [ID.anat] },
  ],
  dashboard: { reviewed_today: 0, goal_today: 41, streak_days: 12, remaining_today: 41 },
  load,
  // The card on the sign-in screen (frontend/src/screens/SignInScreen.tsx): the app's own public
  // example of a graded answer. A partial answer on purpose — a 5/5 proves nothing a string
  // comparison couldn't (see design/handoff/render-readme-shot.mjs).
  study: {
    deckId: ID.orgo,
    queueLength: 18,
    card: {
      id: 'card-sn1',
      subtopic: 'Substitution reactions',
      question: 'Why does an SN1 reaction give a racemic mixture?',
      is_new: false,
      is_math: false,
    },
    typed: 'You get a carbocation in the middle of the reaction.',
    result: {
      grade: 2,
      score: 3,
      explanation: 'You missed why it matters: the carbocation is planar, so the nucleophile can attack either face equally.',
      state: 'review',
      due: addDays(TODAY, 7) + 'T12:00:00Z',
      reviews: 3,
      lapses: 0,
    },
    // The fixture's reference answer for this card (seed_fixture.py SN1_A).
    modelAnswer:
      'The leaving group departs first, giving a planar sp2 carbocation intermediate. The nucleophile can attack either face of that plane with equal probability, so stereochemistry at the reacting carbon is lost and the product is a 50:50 mixture of both enantiomers.',
  },
  tutor: {
    personality: 'direct',
    voice: 'Ashley',
    memoryNotes: 3,
    question: 'How do I tell if it goes SN1 or SN2?',
    // The line backend/tests/test_tts_inworld.py pins, word timings and all.
    reply: 'Tertiary substrates go SN1; primary ones almost always go SN2.',
  },
  // The saved note is the fixture's; the cards are what that note supports, and the dropped one is
  // what the verification pass exists to catch: a question the notes don't answer.
  generate: {
    deckId: ID.orgo,
    note: {
      id: 'note-sn1',
      title: 'SN1 vs SN2 mechanisms',
      body: 'SN1 goes through a planar carbocation, so the nucleophile attacks either face and you lose stereochemistry. SN2 is one concerted step with backside attack, so configuration inverts every time. Tertiary substrates favour SN1, primary favour SN2.',
    },
    stages: ['Starting…', 'Generating flashcards…', 'Double-checking against your notes…'],
    added: [
      { id: 'gen-1', subtopic: 'Substitution reactions', question: 'Why does an SN1 reaction lose stereochemistry?', answer: 'It goes through a planar carbocation, so the nucleophile can attack either face.', is_math: false },
      { id: 'gen-2', subtopic: 'Substitution reactions', question: 'What happens to configuration in an SN2 reaction?', answer: 'It inverts every time: one concerted step, with backside attack.', is_math: false },
      { id: 'gen-3', subtopic: 'Substitution reactions', question: 'Which substrates favour SN1, and which favour SN2?', answer: 'Tertiary substrates favour SN1; primary substrates favour SN2.', is_math: false },
      { id: 'gen-4', subtopic: 'Substitution reactions', question: 'How many steps does an SN2 reaction take?', answer: 'One: the nucleophile attacks as the leaving group leaves.', is_math: false },
    ],
    dropped: [{ question: 'Which solvents favour SN1?', reason: "Your notes don't mention solvents, so nothing supports it." }],
  },
}

const out = path.resolve(import.meta.dirname, '../src/data/demo.json')
fs.writeFileSync(out, JSON.stringify(demo, null, 2) + '\n')
console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(load).length} days of load, today ${load[TODAY]}`)
