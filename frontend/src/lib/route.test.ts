import { describe, expect, it } from 'vitest'
import { HOME, href, parse, sameRoute, type Route } from './route'

// The other half of this contract is _APP_ROUTES in backend/app/main.py: every path here has to be
// one the server answers with the app shell, or it 404s on refresh.
const ROUTES: [Route, string][] = [
  [HOME, '/'],
  [{ kind: 'tab', tab: 'cards' }, '/cards'],
  [{ kind: 'tab', tab: 'calendar' }, '/calendar'],
  [{ kind: 'tab', tab: 'notes' }, '/notes'],
  [{ kind: 'tab', tab: 'tutor' }, '/tutor'],
  [{ kind: 'tab', tab: 'settings' }, '/settings'],
  [{ kind: 'pricing' }, '/plans'],
  [{ kind: 'admin' }, '/admin'],
  [{ kind: 'study', deckId: '0d1c3b8e-5f2a-4c1e-9b7d-2a6f8e4c1d3b' }, '/study/0d1c3b8e-5f2a-4c1e-9b7d-2a6f8e4c1d3b'],
]

describe('routes', () => {
  it.each(ROUTES)('%o is %s both ways', (route, path) => {
    expect(href(route)).toBe(path)
    expect(parse(path)).toEqual(route)
  })

  it('ignores a trailing slash', () => {
    expect(parse('/cards/')).toEqual({ kind: 'tab', tab: 'cards' })
  })

  it.each(['/nope', '/study', '/study/not-a-uuid', '/cards/extra'])('sends %s home', (path) => {
    expect(parse(path)).toEqual(HOME)
  })

  it('compares routes by where they lead', () => {
    expect(sameRoute({ kind: 'tab', tab: 'notes' }, parse('/notes'))).toBe(true)
    expect(sameRoute(HOME, { kind: 'pricing' })).toBe(false)
  })
})
