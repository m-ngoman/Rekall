/** Talking to the backend: the request and stream helpers every other module in api/ uses, and
 * the errors they throw. */

/** Thrown on a 401 so callers can tell "you're signed out" apart from "that failed". */
export class NotSignedIn extends Error {
  constructor() {
    super('Not signed in')
  }
}

/** The server said 402: the account is fine, the feature just isn't paid for.
 *
 * Its own class for the same reason NotSignedIn is. A 403 means "you switched this off in
 * settings" and a 402 means "this needs a plan", and they need different links — settings versus
 * pricing — so the screen has to be able to tell them apart without parsing a message. `message`
 * is the server's own sentence, which already says what's missing.
 */
export class PaymentRequired extends Error {}

/** The server said 429: a daily cap, not a missing plan.
 *
 * Its own class rather than folding into PaymentRequired, because the answer is different. A 402
 * has somewhere to send you; this has nothing to buy, so the sentence is the whole response and a
 * screen showing it must not offer a link to a page with nothing on it.
 */
export class TooManyRequests extends Error {}

/** Any other non-2xx answer. `message` is `"<status> <statusText>: <body>"` as it always was, so
 * nothing that shows or matches it changes; `detail` is the server's own sentence from a JSON
 * body, when it sent one — the part worth showing a person. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    body: string,
    readonly detail: string | null = detailIn(body),
  ) {
    super(`${status} ${statusText}: ${body}`)
  }
}

function detailIn(body: string): string | null {
  try {
    const detail = JSON.parse(body)?.detail
    return typeof detail === 'string' ? detail : null
  } catch {
    return null
  }
}

/** The server's own sentence out of a JSON error body, or `fallback` if it didn't send one. */
async function detailOf(res: Response, fallback: string): Promise<string> {
  try {
    return (await res.json()).detail ?? fallback
  } catch {
    /* a bare status with no body still needs a sentence */
    return fallback
  }
}

/** The error a failed response becomes. Shared by request() and the streams, so a status means
 * the same thing whichever way it arrived. */
async function failure(res: Response): Promise<Error> {
  if (res.status === 401) return new NotSignedIn()
  if (res.status === 402) return new PaymentRequired(await detailOf(res, 'This needs a Rekall AI plan.'))
  if (res.status === 429) return new TooManyRequests(await detailOf(res, "That's as much as today allows."))
  return new ApiError(res.status, res.statusText, await res.text())
}

/** The server's sentence from a failed call, for a screen that catches a generic error and wants
 * to say something more useful than "that failed". */
export function serverDetail(e: unknown): string | null {
  if (e instanceof ApiError) return e.detail
  return null
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw await failure(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface SSEFrame {
  event: string
  /** The data line's JSON, unparsed: parsing is the reader's, frame by frame. */
  data: string
}

/** Splits what has arrived of an event stream into whole frames and the unfinished rest. Frames
 * end at a blank line; a frame with no `event:` line is a `message`, and one with no `data:`
 * line carries nothing and is dropped. */
export function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = []
  let boundary = buffer.indexOf('\n\n')
  while (boundary !== -1) {
    const raw = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    const event = raw.match(/^event: (.+)$/m)?.[1] ?? 'message'
    const data = raw.match(/^data: (.+)$/m)?.[1]
    if (data) frames.push({ event, data })
    boundary = buffer.indexOf('\n\n')
  }
  return { frames, rest: buffer }
}

/** Reads an SSE response body (from `fetch`, not `EventSource` — this app's streams are POST-based,
 * which EventSource can't do) and calls `onEvent` for each event as it arrives.
 */
export async function streamSSE(url: string, init: RequestInit, onEvent: (event: string, data: unknown) => void): Promise<void> {
  const res = await fetch(url, init)
  // Same handling as request(): a session that expires mid-stream is being signed out, not a
  // stream that failed, and callers already know how to tell those apart.
  if (!res.ok) throw await failure(res)
  if (!res.body) throw new ApiError(res.status, res.statusText, '')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const { frames, rest } = parseSSEFrames(buffer + decoder.decode(value, { stream: true }))
      buffer = rest
      for (const frame of frames) {
        const { event } = frame
        const data: unknown = JSON.parse(frame.data)
        // Handled here rather than by each caller. A stream that fails after the response has
        // committed to 200 can't report it as a status, so the backend sends this instead (see
        // backend/app/core/sse.py `guard`) — and every caller wants the same thing from it.
        if (event === 'error') throw new Error((data as { message?: string }).message ?? 'That failed partway through.')
        onEvent(event, data)
      }
    }
  } finally {
    // Throwing out of the loop leaves the body half-read; without this the connection stays open
    // until it is garbage collected.
    reader.cancel().catch(() => {})
  }
}

/** What each kind of event does as it arrives. Each handler names the payload it expects; the
 * stream can't check it, the server's contract is what makes it true. */
export type EventHandlers = Record<string, ((data: never) => void) | undefined>

/** A stream that ends in a `done` event carrying the result: the handlers see everything before
 * it, and the result is what the call resolves to. A stream that ends without one is an error. */
export async function streamResult<T>(url: string, init: RequestInit, handlers: EventHandlers = {}): Promise<T> {
  let result: T | null = null
  await streamSSE(url, init, (event, data) => {
    if (event === 'done') result = data as T
    else handlers[event]?.(data as never)
  })
  if (!result) throw new Error('Stream ended without a result')
  return result
}
