import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NotSignedIn, PaymentRequired, TooManyRequests, parseSSEFrames, request, serverDetail, streamResult } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseSSEFrames', () => {
  it('splits whole frames off and keeps the unfinished rest', () => {
    const { frames, rest } = parseSSEFrames('event: token\ndata: {"text":"Hel"}\n\nevent: token\ndata: {"te')
    expect(frames).toEqual([{ event: 'token', data: '{"text":"Hel"}' }])
    expect(rest).toBe('event: token\ndata: {"te')
  })

  it('reads a frame with no event line as a message, and drops one with no data', () => {
    const { frames } = parseSSEFrames('data: {"a":1}\n\nevent: ping\n\nevent: done\ndata: {}\n\n')
    expect(frames).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'done', data: '{}' },
    ])
  })
})

/** The error a call failed with. */
const failure = (call: Promise<unknown>): Promise<Error> =>
  call.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (e: unknown) => e as Error,
  )

/** A fetch that answers once, with this status and body. Streams arrive in the given pieces. */
function answer(status: number, body: string | string[], statusText = 'Status') {
  const pieces = typeof body === 'string' ? [body] : body
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p))
      controller.close()
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status, statusText })))
}

describe('request', () => {
  it('keeps the old message and reads the server sentence out of the body', async () => {
    answer(503, '{"detail":"Purchases are switched off"}', 'Service Unavailable')
    const e = await failure(request('/billing/checkout'))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.message).toBe('503 Service Unavailable: {"detail":"Purchases are switched off"}')
    expect((e as ApiError).status).toBe(503)
    expect(serverDetail(e)).toBe('Purchases are switched off')
  })

  it('has no sentence to offer from a body that is not JSON', async () => {
    answer(500, 'Internal Server Error', 'Internal Server Error')
    const e = await failure(request('/x'))
    expect(e.message).toBe('500 Internal Server Error: Internal Server Error')
    expect(serverDetail(e)).toBeNull()
  })

  it('turns 401, 402 and 429 into their own errors', async () => {
    answer(401, '')
    expect(await failure(request('/x'))).toBeInstanceOf(NotSignedIn)
    answer(402, '{"detail":"Rekall AI isn\'t active on this account."}')
    const paid = await failure(request('/x'))
    expect(paid).toBeInstanceOf(PaymentRequired)
    expect(paid.message).toBe("Rekall AI isn't active on this account.")
    answer(429, 'not json')
    const capped = await failure(request('/x'))
    expect(capped).toBeInstanceOf(TooManyRequests)
    expect(capped.message).toBe("That's as much as today allows.")
  })

  it('answers undefined for a 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    expect(await request('/x')).toBeUndefined()
  })
})

describe('streamResult', () => {
  it('hands each event to its handler and resolves with done, however the bytes are split', async () => {
    answer(200, ['event: token\ndata: {"text":"Hel"}\n', '\nevent: tok', 'en\ndata: {"text":"lo"}\n\nevent: done\ndata: {"ok":true}\n\n'])
    const tokens: string[] = []
    const result = await streamResult<{ ok: boolean }>('/api/x', {}, { token: (d: { text: string }) => tokens.push(d.text) })
    expect(tokens).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ ok: true })
  })

  it('throws the server sentence from an error event', async () => {
    answer(200, 'event: token\ndata: {"text":"a"}\n\nevent: error\ndata: {"message":"Grading failed."}\n\n')
    await expect(streamResult('/api/x', {})).rejects.toThrow('Grading failed.')
  })

  it('fails a stream that ends without a result', async () => {
    answer(200, 'event: token\ndata: {"text":"a"}\n\n')
    await expect(streamResult('/api/x', {})).rejects.toThrow('Stream ended without a result')
  })

  it('reports a refused stream the way request() does', async () => {
    answer(402, '{"detail":"Out of pages."}')
    const e = await failure(streamResult('/api/x', {}))
    expect(e).toBeInstanceOf(PaymentRequired)
    expect(e.message).toBe('Out of pages.')
  })
})
