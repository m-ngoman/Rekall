// The backend, as far as the video's screens need one: every endpoint they call, answered from
// src/data/demo.json. Used by scripts/reference.mjs to drive the real frontend into the exact
// states the replicas draw, so the two can be compared pixel for pixel with nothing else differing.
import fs from 'node:fs'
import path from 'node:path'

const demo = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../src/data/demo.json'), 'utf8'))
export { demo }

const nextExam = (deckId) =>
  demo.exams.filter((e) => e.deck_ids.includes(deckId) && e.date >= demo.today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null

const settings = {
  onboarded_at: '2026-09-01T09:00:00Z',
  theme: 'dark',
  accent: null,
  new_cards_per_day: 20,
  session_size: 0,
  daily_goal: 0,
  grading_strictness: 'balanced',
  fsrs_retention_pct: 90,
  fsrs_max_interval_days: 0,
  tts_speed_pct: 100,
  mic_sensitivity: 20,
  mic_silence_ms: 1200,
  push_to_talk: false,
  ai_grading: true,
  ai_generation: true,
  ai_tutor: true,
  ai_voice: true,
  tutor_personality: demo.tutor.personality,
  tutor_voice_id: null,
  tutor_custom_prompt: null,
  tutor_auto_memory: true,
}

/** The session the study screen is handed: the SN1 card first, then the rest of today's 18. */
const studyQueue = () => ({
  deck_id: demo.study.deckId,
  deck_name: demo.decks.find((d) => d.id === demo.study.deckId).name,
  cards: [
    demo.study.card,
    ...Array.from({ length: demo.study.queueLength - 1 }, (_, i) => ({
      id: `card-${i + 2}`,
      subtopic: 'Substitution reactions',
      question: `Organic Chemistry II card ${i + 2}`,
      is_new: false,
      is_math: false,
    })),
  ],
  later: 0,
  waiting: 0,
})

const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')

/** A response for `method path`, or null for anything the demo doesn't cover. */
export function respond(method, url) {
  const { pathname, searchParams } = new URL(url, 'http://demo')
  const p = pathname.replace(/^\/api/, '')
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  const stream = (events) => ({ status: 200, contentType: 'text/event-stream', body: sse(events) })

  if (method === 'GET' && p === '/auth/me') return json({ id: 'user-demo', email: 'dev@rekall.study', name: 'Adam', avatar_url: null, tier: 'friend', is_owner: false })
  if (p === '/settings') return json(settings)
  if (p === '/billing/status')
    return json({ text_ai: true, text_ai_lifetime: false, text_ai_expires_at: null, voice_credits: 36000, voice_hours: 10, generation_pages: 0, generation_pages_today: 30, tier: 'ai' })
  if (p === '/decks') return json(demo.decks.map((d) => ({ ...d, next_exam: nextExam(d.id) && { name: nextExam(d.id).name, date: nextExam(d.id).date } })))
  if (p === '/exams') return json(demo.exams)
  if (p === '/dashboard') return json(demo.dashboard)
  if (p === '/dashboard/load') {
    const [start, end] = [searchParams.get('start'), searchParams.get('end')]
    return json(Object.fromEntries(Object.entries(demo.load).filter(([d]) => d >= start && d <= end && d >= demo.today)))
  }
  if (p === `/decks/${demo.study.deckId}/study-queue`) return json(studyQueue())
  if (method === 'POST' && p === `/cards/${demo.study.card.id}/review`) {
    const words = demo.study.result.explanation.split(/(?<=\s)/)
    return stream([...words.map((w) => ['token', { text: w }]), ['done', demo.study.result]])
  }
  if (p === `/cards/${demo.study.card.id}/answer`) return json({ answer: demo.study.modelAnswer })
  if (p === `/cards/${demo.study.card.id}/study-list`) return json({})
  if (method === 'POST' && p === '/tutor/sessions') return json({ id: 'session-demo', deck_id: null, personality: demo.tutor.personality, custom_prompt: null, voice_id: null })
  if (method === 'POST' && p === '/tutor/sessions/session-demo/text-turn') {
    const words = demo.tutor.reply.split(/(?<=\s)/)
    return stream([...words.map((w) => ['token', { text: w }]), ['done', { transcript: demo.tutor.question, reply: demo.tutor.reply }]])
  }
  if (p === '/tutor/voices') return json([{ id: 'Ashley', name: demo.tutor.voice, description: 'A warm, natural female voice', gender: 'female' }])
  if (p === '/tutor/memory')
    return json(
      Array.from({ length: demo.tutor.memoryNotes }, (_, i) => ({ id: `memory-${i}`, category: 'gap', content: `Weak spot ${i + 1}`, source: 'auto' })),
    )
  if (p === '/notes')
    return json([
      {
        id: demo.generate.note.id,
        deck_id: demo.generate.deckId,
        deck_name: demo.decks.find((d) => d.id === demo.generate.deckId).name,
        title: demo.generate.note.title,
        file_type: 'text',
        preview: demo.generate.note.body.slice(0, 120),
        created_at: '2026-10-07T08:00:00Z',
      },
    ])
  if (method === 'POST' && p === '/notes/generate-from-notes') {
    const deck = demo.decks.find((d) => d.id === demo.generate.deckId)
    return stream([
      ...demo.generate.stages.slice(1).map((label) => ['stage', { label }]),
      ['done', { deck_id: deck.id, deck_name: deck.name, cards_added: demo.generate.added, cards_dropped: demo.generate.dropped }],
    ])
  }
  return null
}
