import { useCallback, useEffect, useState } from 'react'
import { parse, href, sameRoute, type Route } from '../lib/route'

/** The app's location, kept in the browser's history rather than in component state alone.
 *
 * Before this, every screen was React state: refreshing landed you on Home wherever you were,
 * the browser's back button left the site entirely, and on iOS a back-swipe during a study
 * session closed the app rather than the session. All three are the same missing piece.
 *
 * Deliberately hand-rolled rather than a router dependency. There are nine routes, no nesting,
 * no loaders and no layouts to match — `parse` and `href` in lib/route.ts are the whole spec,
 * and a router would be more API surface than the thing it replaces.
 */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname))

  useEffect(() => {
    // The browser moved us: match it. `parse` never throws, so a hand-typed URL lands on Home.
    const onPop = () => setRoute(parse(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /** Go somewhere, adding a history entry. Navigating to where you already are is a no-op, so
   * tapping the current tab doesn't stack duplicates you then have to press back through.
   *
   * Compared against the address bar rather than inside a state updater: updaters have to be pure,
   * and React runs them twice in development, which pushed every navigation twice — one Back
   * then went nowhere. The address bar and `route` are kept in step by every path that moves
   * either, so they give the same answer. */
  const go = useCallback((next: Route) => {
    if (sameRoute(parse(window.location.pathname), next)) return
    window.history.pushState({}, '', href(next))
    setRoute(next)
  }, [])

  /** Go somewhere without a history entry — for corrections rather than navigations, like
   * landing on /admin without being the owner. */
  const replace = useCallback((next: Route) => {
    window.history.replaceState({}, '', href(next))
    setRoute(next)
  }, [])

  return { route, go, replace }
}
