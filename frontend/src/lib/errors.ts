import { NotSignedIn, PaymentRequired, serverDetail, TooManyRequests } from '../api'

/** What to tell a person when a call failed, with `fallback` saying what didn't happen.
 *
 * The server's own sentence is preferred whenever it sent one: a `detail` on an error response,
 * or the sentence a stream sends when it fails part-way. Those are better than anything a screen
 * could invent. What is never shown is machine wording: a status line with the JSON body after it
 * tells a student nothing, and `fetch` says "Failed to fetch" when the network drops. A server
 * that answered without a sentence gets the fallback alone; only a request that never reached it
 * gets "check your connection".
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof NotSignedIn) return 'You have been signed out. Reload to sign in again.'
  // Both carry a sentence written for the person reading it, and the status-line filter below
  // would otherwise replace a 429's with "check your connection", which is wrong and unactionable.
  if (error instanceof PaymentRequired || error instanceof TooManyRequests) return error.message
  const detail = serverDetail(error)
  if (detail) return detail
  if (!(error instanceof Error)) return fallback
  const raw = error.message
  if (/^\d{3}\s/.test(raw)) return fallback
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) return `${fallback} Check your connection and try again.`
  return raw
}
