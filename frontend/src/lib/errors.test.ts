import { describe, expect, it } from 'vitest'
import { ApiError, NotSignedIn, PaymentRequired, TooManyRequests } from '../api'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it("shows the server's sentence when it sent one", () => {
    const e = new ApiError(400, 'Bad Request', JSON.stringify({ detail: 'Could not parse CSV.' }))
    expect(errorMessage(e, 'Import failed.')).toBe('Could not parse CSV.')
  })

  it('never shows a status line and a body', () => {
    const e = new ApiError(500, 'Internal Server Error', '<html>oops</html>')
    expect(errorMessage(e, 'Import failed.')).toBe('Import failed.')
  })

  it('points at the connection only when the request never arrived', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), 'Import failed.')).toBe('Import failed. Check your connection and try again.')
  })

  it('keeps sentences written for the reader', () => {
    expect(errorMessage(new PaymentRequired('AI grading is part of Rekall AI.'), 'x')).toBe('AI grading is part of Rekall AI.')
    expect(errorMessage(new TooManyRequests("That's today's grading."), 'x')).toBe("That's today's grading.")
    expect(errorMessage(new Error('The tutor could not finish that reply.'), 'x')).toBe('The tutor could not finish that reply.')
  })

  it('says to sign in again when the session has gone', () => {
    expect(errorMessage(new NotSignedIn(), 'x')).toBe('You have been signed out. Reload to sign in again.')
  })

  it('falls back when what was thrown is not an error at all', () => {
    expect(errorMessage('nope', 'Import failed.')).toBe('Import failed.')
  })
})
