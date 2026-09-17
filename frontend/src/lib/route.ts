import type { Tab } from '../components/navIcons'

/** Where the app is, as one value. Study carries its deck; everything else is just a place. */
export type Route =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'pricing' }
  | { kind: 'admin' }
  | { kind: 'study'; deckId: string }

export const HOME: Route = { kind: 'tab', tab: 'home' }

const TAB_PATHS: Record<Tab, string> = {
  home: '/',
  cards: '/cards',
  calendar: '/calendar',
  notes: '/notes',
  tutor: '/tutor',
  settings: '/settings',
}

/** The URL for a route. The inverse of `parse`, and the only place paths are written. */
export function href(route: Route): string {
  switch (route.kind) {
    case 'tab':
      return TAB_PATHS[route.tab]
    case 'pricing':
      return '/plans'
    case 'admin':
      return '/admin'
    case 'study':
      return `/study/${route.deckId}`
  }
}

/** Reads a route out of a pathname. Anything unrecognised is Home, which is what the server's
 * fallback serves anyway — a URL nobody can produce should land somewhere real rather than on an
 * error the app would have to explain. */
export function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const study = /^\/study\/([0-9a-fA-F-]{36})$/.exec(path)
  if (study) return { kind: 'study', deckId: study[1] }
  if (path === '/plans') return { kind: 'pricing' }
  if (path === '/admin') return { kind: 'admin' }
  const tab = (Object.keys(TAB_PATHS) as Tab[]).find((t) => TAB_PATHS[t] === path)
  return tab ? { kind: 'tab', tab } : HOME
}

export function sameRoute(a: Route, b: Route): boolean {
  return href(a) === href(b)
}
