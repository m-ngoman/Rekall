/** The tutor: sessions, voices, the three kinds of turn, and your profile, which is its memory. */

import type { PlotSpec } from '../lib/plot'
import type {
  StudentProfile,
  TutorPersonality,
  TutorSession,
  TutorSessionStart,
  TutorTurnResult,
  TutorVoice,
  WordTiming,
} from '../types'
import { request, streamResult, streamSSE } from './client'

/** Open the tutor: resumes the last conversation if it is still live, otherwise starts one.
 *
 * The server decides, not the client — it owns the idle window, and the same window defines a
 * session for the tutor's memory. Pass `fresh` to skip the lookup and deliberately begin again;
 * the old conversation is left alone, not deleted. */
export function startTutorSession(deckId?: string, fresh = false): Promise<TutorSessionStart> {
  return request('/tutor/sessions', {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId ?? null, fresh }),
  })
}

export function deleteTutorSession(sessionId: string): Promise<void> {
  return request(`/tutor/sessions/${sessionId}`, { method: 'DELETE' })
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
export function sendTextTurn(
  sessionId: string,
  text: string,
  onToken: (text: string) => void,
  image?: Blob,
  /** The tutor proposing a calendar entry. Never written automatically — the UI turns this into a
   * button the student confirms. */
  onSuggestExam?: (exam: { name: string; date: string }) => void,
  /** A graph the tutor drew. Validated server-side, so this is safe to render as-is. Typed turns
   * only — the backend never emits one on a voice turn. */
  onPlot?: (plot: PlotSpec) => void,
  /** Aborts the reply — starting a new conversation mid-reply, so nothing more lands in the old one. */
  signal?: AbortSignal,
): Promise<TutorTurnResult> {
  const form = new FormData()
  form.append('text', text)
  if (image) form.append('image', image, 'photo.jpg')

  return streamResult<TutorTurnResult>(`/api/tutor/sessions/${sessionId}/text-turn`, { method: 'POST', body: form, signal }, {
    token: (data: { text: string }) => onToken(data.text),
    suggest_exam: onSuggestExam,
    plot: onPlot,
  })
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
        const sentence = data as { text: string; audio_b64: string; words?: WordTiming[] }
        const bytes = Uint8Array.from(atob(sentence.audio_b64), (c) => c.charCodeAt(0))
        handlers.onSentence(sentence.text, new Blob([bytes], { type: 'audio/wav' }), sentence.words ?? [])
      } else if (eventType === 'suggest_exam') handlers.onSuggestExam?.(data as { name: string; date: string })
      else if (eventType === 'done') handlers.onDone(data as TutorTurnResult)
    },
  )
}

/** Everything the tutor remembers about you, as one file. */
export function getStudentProfile(): Promise<StudentProfile> {
  return request('/tutor/memory')
}

/** Saves your edit of the whole file. `rev` is the version you started from: if the tutor has
 * rewritten the file since, this fails with a 409 and nothing is saved. Lines you take out of the
 * tutor's are remembered as removed, so it can't write them back. */
export function saveStudentProfile(text: string, rev: number): Promise<StudentProfile> {
  return request('/tutor/memory', { method: 'PUT', body: JSON.stringify({ text, rev }) })
}
