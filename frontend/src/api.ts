import type {
  AdminStats,
  Card,
  Dashboard,
  Deck,
  Exam,
  GenerationResult,
  ImportResult,
  MemoryCategory,
  MemoryNote,
  Note,
  NoteDetail,
  ReviewResult,
  Settings,
  SettingsPatch,
  StudyQueue,
  TutorPersonality,
  TutorSession,
  TutorTurnResult,
  TutorVoice,
  WordTiming,
} from './types'

/** Thrown on a 401 so callers can tell "you're signed out" apart from "that failed". */
export class NotSignedIn extends Error {
  constructor() {
    super('Not signed in')
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) throw new NotSignedIn()
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Reads an SSE response body (from `fetch`, not `EventSource` — this app's streams are POST-based,
 * which EventSource can't do) and calls `onEvent` for each `event:`/`data:` pair as it arrives.
 */
async function streamSSE(url: string, init: RequestInit, onEvent: (eventType: string, data: any) => void): Promise<void> {
  const res = await fetch(url, init)
  // Same 401 handling as request(): a session that expires mid-stream is being signed out, not a
  // stream that failed, and callers already know how to tell those apart.
  if (res.status === 401) throw new NotSignedIn()
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const eventType = rawEvent.match(/^event: (.+)$/m)?.[1] ?? 'message'
        const dataLine = rawEvent.match(/^data: (.+)$/m)?.[1]
        if (dataLine) {
          const data = JSON.parse(dataLine)
          // Handled here rather than by each caller. A stream that fails after the response has
          // committed to 200 can't report it as a status, so the backend sends this instead (see
          // backend/app/core/sse.py `guard`) — and every caller wants the same thing from it.
          if (eventType === 'error') throw new Error(data.message ?? 'That failed partway through.')
          onEvent(eventType, data)
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    // Throwing out of the loop leaves the body half-read; without this the connection stays open
    // until it is garbage collected.
    reader.cancel().catch(() => {})
  }
}

export function listDecks(): Promise<Deck[]> {
  return request('/decks')
}

export function getDashboard(): Promise<Dashboard> {
  return request('/dashboard')
}

export function importDeck(csv: string): Promise<ImportResult> {
  return request('/decks/import', { method: 'POST', body: JSON.stringify({ csv }) })
}

/** Creates an empty deck. The Notes tab calls this "new category" — same object either way, which
 * is what keeps a note linked to the cards generated from it. */
export function createDeck(name: string): Promise<Deck> {
  return request('/decks', { method: 'POST', body: JSON.stringify({ name }) })
}

export function renameDeck(deckId: string, name: string): Promise<Deck> {
  return request(`/decks/${deckId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function deleteDeck(deckId: string): Promise<void> {
  return request(`/decks/${deckId}`, { method: 'DELETE' })
}

/** Every card in a deck, newest first. */
export function listCards(deckId: string): Promise<Card[]> {
  return request(`/decks/${deckId}/cards`)
}

export function createCard(
  deckId: string,
  card: { question: string; answer: string; subtopic?: string },
): Promise<Card> {
  return request(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify(card) })
}

/** Text only — the server deliberately leaves scheduling alone, so fixing a typo doesn't reset
 * weeks of review history. Sending `subtopic: ''` clears it. */
export function updateCard(
  cardId: string,
  patch: { question?: string; answer?: string; subtopic?: string },
): Promise<Card> {
  return request(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteCard(cardId: string): Promise<void> {
  return request(`/cards/${cardId}`, { method: 'DELETE' })
}

export function getStudyQueue(deckId: string): Promise<StudyQueue> {
  return request(`/decks/${deckId}/study-queue`)
}

/** Streams the grading explanation as it's generated (for a typewriter display) via SSE, then
 * resolves with the final result once the `done` event arrives.
 */
export async function submitReviewStream(
  cardId: string,
  answerInput: string,
  onToken: (text: string) => void,
): Promise<ReviewResult> {
  let result: ReviewResult | null = null
  await streamSSE(
    `/api/cards/${cardId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_input: answerInput, input_mode: 'typed' }),
    },
    (eventType, data) => {
      if (eventType === 'token') onToken(data.text)
      else if (eventType === 'done') result = data
    },
  )
  if (!result) throw new Error('Stream ended without a result')
  return result
}

/** A self-assessed review: no answer was submitted and nothing is graded, so this returns the
 * same `ReviewResult` shape without any token stream. Kept separate from `submitReviewStream`
 * rather than bolted on with a flag — the two have genuinely different inputs, and the streaming
 * version's `onToken` would be dead weight here.
 */
export async function submitSelfAssessedReview(cardId: string, grade: number): Promise<ReviewResult> {
  let result: ReviewResult | null = null
  await streamSSE(
    `/api/cards/${cardId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_input: '', input_mode: 'self_assessed', grade }),
    },
    (eventType, data) => {
      if (eventType === 'done') result = data
    },
  )
  if (!result) throw new Error('Stream ended without a result')
  return result
}

/** The reference answer for one card, fetched only when the user taps "Show answer" in the
 * self-assessment flow. Not part of the study queue on purpose — see the endpoint's docstring.
 */
export function revealAnswer(cardId: string): Promise<{ answer: string }> {
  return request(`/cards/${cardId}/answer`)
}

export function createTutorSession(deckId?: string): Promise<TutorSession> {
  return request('/tutor/sessions', { method: 'POST', body: JSON.stringify({ deck_id: deckId ?? null }) })
}

export function updateTutorSession(
  sessionId: string,
  patch: { personality?: TutorPersonality; custom_prompt?: string; voice_id?: string },
): Promise<TutorSession> {
  return request(`/tutor/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function listTutorVoices(): Promise<TutorVoice[]> {
  return request('/tutor/voices')
}

/** A typed turn: text-only reply, streamed token-by-token — no TTS, see backend for why. `image`
 * is an optional photo (of notes, a textbook page, etc.) attached alongside the question.
 */
export async function sendTextTurn(
  sessionId: string,
  text: string,
  onToken: (text: string) => void,
  image?: Blob,
  /** The tutor proposing a calendar entry. Never written automatically — the UI turns this into a
   * button the student confirms. */
  onSuggestExam?: (exam: { name: string; date: string }) => void,
): Promise<TutorTurnResult> {
  const form = new FormData()
  form.append('text', text)
  if (image) form.append('image', image, 'photo.jpg')

  let result: TutorTurnResult | null = null
  await streamSSE(`/api/tutor/sessions/${sessionId}/text-turn`, { method: 'POST', body: form }, (eventType, data) => {
    if (eventType === 'token') onToken(data.text)
    else if (eventType === 'suggest_exam') onSuggestExam?.(data)
    else if (eventType === 'done') result = data
  })
  if (!result) throw new Error('Stream ended without a result')
  return result
}

/** A voice turn whose transcript was already produced client-side (live Deepgram streaming, see
 * useMicRecorder). The backend also still has an audio-upload `/voice-turn` endpoint (batch STT
 * via Groq/local Whisper) for when `stt_provider` isn't `"deepgram"` — not called from the
 * frontend currently, since switching STT providers back would need this file's caller rewritten
 * too, but the endpoint stays live and curl-testable as a fallback path.
 *
 * `signal` lets a caller abort mid-reply — for a pause-button or barge-in interrupt, where the
 * point is to stop the tutor talking immediately, not wait for the stream to finish on its own.
 */
export async function sendVoiceTurnText(
  sessionId: string,
  text: string,
  handlers: {
    onSentence: (text: string, audioBlob: Blob, words: WordTiming[]) => void
    onDone: (result: TutorTurnResult) => void
    onSuggestExam?: (exam: { name: string; date: string }) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  await streamSSE(
    `/api/tutor/sessions/${sessionId}/voice-turn-text`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal },
    (eventType, data) => {
      if (eventType === 'sentence') {
        const bytes = Uint8Array.from(atob(data.audio_b64), (c) => c.charCodeAt(0))
        handlers.onSentence(data.text, new Blob([bytes], { type: 'audio/wav' }), data.words ?? [])
      } else if (eventType === 'suggest_exam') handlers.onSuggestExam?.(data)
      else if (eventType === 'done') handlers.onDone(data)
    },
  )
}

export function listMemoryNotes(): Promise<MemoryNote[]> {
  return request('/tutor/memory')
}

export function createMemoryNote(category: MemoryCategory, content: string): Promise<MemoryNote> {
  return request('/tutor/memory', { method: 'POST', body: JSON.stringify({ category, content }) })
}

export function updateMemoryNote(id: string, patch: { category?: MemoryCategory; content?: string }): Promise<MemoryNote> {
  return request(`/tutor/memory/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteMemoryNote(id: string): Promise<void> {
  return request(`/tutor/memory/${id}`, { method: 'DELETE' })
}

/** Photos or a single PDF of notes -> flashcards. Two full LLM round-trips (draft, then verify)
 * happen server-side, so `onStage` drives a status label instead of leaving a bare spinner up.
 */
export async function generateDeck(
  files: File[],
  deckId: string | null,
  deckName: string,
  onStage: (label: string) => void,
): Promise<GenerationResult> {
  const form = new FormData()
  if (deckId) form.append('deck_id', deckId)
  if (deckName.trim()) form.append('deck_name', deckName.trim())
  for (const file of files) form.append('files', file, file.name)

  let result: GenerationResult | null = null
  await streamSSE('/api/notes/generate', { method: 'POST', body: form }, (eventType, data) => {
    if (eventType === 'stage') onStage(data.label)
    else if (eventType === 'done') result = data
  })
  if (!result) throw new Error('Stream ended without a result')
  return result
}

/** Same generation pipeline as generateDeck, over notes already in the library. `noteIds` order
 * is preserved end to end — the backend hands the pages to the model in this order, so a
 * multi-page topic reads in sequence rather than however the database returned the rows.
 *
 * Note the Content-Type: unlike generateDeck this posts JSON, so request()'s default header is
 * exactly right and must NOT be cleared the way the multipart calls clear it.
 */
export async function generateDeckFromNotes(
  noteIds: string[],
  deckId: string | null,
  deckName: string,
  onStage: (label: string) => void,
): Promise<GenerationResult> {
  // A failure after the stream opens can't arrive as an HTTP status — the response is already 200
  // and streaming — so it comes through as an `error` event, which streamSSE turns into a throw.
  let result: GenerationResult | null = null
  await streamSSE(
    '/api/notes/generate-from-notes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_ids: noteIds, deck_id: deckId ?? '', deck_name: deckName.trim() }),
    },
    (eventType, data) => {
      if (eventType === 'stage') onStage(data.label)
      else if (eventType === 'done') result = data
    },
  )
  if (!result) throw new Error('Stream ended without a result')
  return result
}

/** `q` runs Postgres full-text search over each note's stored transcription (stemmed, so
 * "chloroplast" matches "chloroplasts"); empty means list everything, newest first.
 */
export function listNotes(q = ''): Promise<Note[]> {
  return request(`/notes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
}

/** Saves notes to the library without generating cards — the Notes tab's own upload path, as
 * opposed to generateDeck() which is card-first. Each file becomes its own note.
 */
export function uploadNotes(files: File[], deckId: string | null, deckName = ''): Promise<Note[]> {
  const form = new FormData()
  if (deckId) form.append('deck_id', deckId)
  // Naming a category here creates it server-side in the same transaction as the notes, so a
  // failed upload can't leave an empty category behind. An existing category with that name is
  // reused rather than duplicated.
  if (deckName.trim()) form.append('deck_name', deckName.trim())
  for (const file of files) form.append('files', file, file.name)
  // Empty headers deliberately clears request()'s default application/json — the browser has to
  // set Content-Type itself for FormData so it can include the multipart boundary.
  return request('/notes', { method: 'POST', body: form, headers: {} })
}

/** Refiles a note under a different category, or under none (`null` = Unfiled). The null is sent
 * explicitly rather than omitted — the backend treats an absent field as "leave it alone", so
 * omitting it would make Unfiled unreachable. */
export function moveNote(id: string, deckId: string | null): Promise<Note> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ deck_id: deckId }) })
}

/** Names a note, or clears the name back to its transcription preview by passing an empty string.
 * Sent as its own call rather than folded into moveNote so a rename can't accidentally refile —
 * the backend distinguishes an omitted field from a null one, and this omits deck_id entirely. */
export function renameNote(id: string, title: string): Promise<Note> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
}

export function getNote(id: string): Promise<NoteDetail> {
  return request(`/notes/${id}`)
}

/** A note written in the app rather than uploaded. Only called once there's something to keep —
 * the editor doesn't create a row for a note that was opened and abandoned. Either a category id
 * or a new category's name files it, as with uploadNotes. */
export function createTextNote(
  input: { title: string; text: string; deckId: string | null; deckName?: string },
): Promise<NoteDetail> {
  return request('/notes/text', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title.trim() || null,
      text: input.text,
      deck_id: input.deckId,
      deck_name: input.deckName?.trim() ?? '',
    }),
  })
}

/** Saves the editor's title and body together. One call, not two, so the two fields can't be
 * left half-saved if the second request fails. deck_id is omitted so this can't refile. */
export function saveNoteContent(id: string, title: string, text: string): Promise<Note> {
  return request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ title, text }) })
}

export function deleteNote(id: string): Promise<void> {
  return request(`/notes/${id}`, { method: 'DELETE' })
}

/** The original upload, served by the backend from local disk — used directly as an <img>/<embed>
 * src rather than fetched, so the browser streams it instead of us buffering it into memory. */
export function noteFileUrl(id: string): string {
  return `/api/notes/${id}/file`
}

/** Seeds the onboarding starter deck. Not idempotent — calling twice makes two decks. */
export function createSampleDeck(): Promise<Deck> {
  return request('/decks/sample', { method: 'POST' })
}

export function listExams(): Promise<Exam[]> {
  return request('/exams')
}

export function createExam(name: string, date: string, deckIds: string[]): Promise<Exam> {
  return request('/exams', { method: 'POST', body: JSON.stringify({ name, date, deck_ids: deckIds }) })
}

/** `deck_ids`, when present, replaces the exam's whole link set — the sheet always knows the full
 * selection, so there's no add/remove delta protocol to get out of sync. */
export function updateExam(
  id: string,
  patch: { name?: string; date?: string; deck_ids?: string[] },
): Promise<Exam> {
  return request(`/exams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteExam(id: string): Promise<void> {
  return request(`/exams/${id}`, { method: 'DELETE' })
}

export function getSettings(): Promise<Settings> {
  return request('/settings')
}

/** Partial update — only the keys present are changed. Passing `accent: null` is meaningful and
 * resets to the app default, which is why this takes a Partial rather than the whole object. */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return request('/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}


/** Export runs as a plain navigation, not a fetch: the response carries a Content-Disposition
 * header, so letting the browser handle it gets a real "save file" flow on every platform —
 * including iOS Safari, where a blob URL built in JS often opens the file inline instead of
 * offering to save it.
 */
export function exportUrl(deckId: string | null, format: 'csv' | 'json'): string {
  const path = deckId ? `/api/decks/${deckId}/export` : '/api/decks/export'
  return `${path}?format=${format}`
}


export interface Me {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  tier: string
  /** True only for the account named by OWNER_EMAIL on the server. Gates the tutor's /bug
   * command; the endpoints behind it re-check it, so this is presentation only. */
  is_owner: boolean
}

export interface BugReport {
  id: string
  text: string
  created_at: string
  resolved_at: string | null
}

/** Files a note in the owner's bug inbox. 404s for everyone else, by design. */
export function reportBug(text: string, context: Record<string, unknown> = {}): Promise<BugReport> {
  return request('/bugs', { method: 'POST', body: JSON.stringify({ text, context }) })
}

export function listBugs(): Promise<BugReport[]> {
  return request('/bugs')
}

export function resolveBug(id: string): Promise<BugReport> {
  return request(`/bugs/${id}/resolve`, { method: 'POST' })
}

/** The signed-in user, or null. Resolves rather than throwing on 401 — being signed out is an
 * ordinary state at startup, not an error. */
export async function getMe(): Promise<Me | null> {
  try {
    return await request<Me>('/auth/me')
  } catch (e) {
    if (e instanceof NotSignedIn) return null
    throw e
  }
}

/** Aggregate usage counts for the owner dashboard. 404s for every other account, so callers
 * should only reach this behind `me.is_owner`. `days` sets the length of the daily series. */
export function getAdminStats(days = 30): Promise<AdminStats> {
  return request(`/admin/stats?days=${days}`)
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { method: 'POST' })
}
