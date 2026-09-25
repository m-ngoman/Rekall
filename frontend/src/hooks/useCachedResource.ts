import { useCallback, useEffect, useRef, useState } from 'react'

/** Survives unmount on purpose — that's the whole point. Screens are unmounted when you leave a
 * tab, so without somewhere outside React to keep the last value, every tab switch restarted
 * from `null` and the screen collapsed to a one-line "Loading…" before expanding again. */
const cache = new Map<string, unknown>()

/** Direct access, for a fetch whose shape doesn't fit the hook — NotesScreen's note list is
 * debounced and keyed by the search query, so it drives its own effect and just borrows the
 * cache to seed the first render. */
export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value)
}

/** How the last fetch went, beside the value it did or didn't replace. */
export interface ResourceStatus {
  /** The last request failed. The value, if there is one, is the last one that did load. */
  failed: boolean
  /** Asks again. */
  retry: () => void
}

/**
 * Stale-while-revalidate read of one endpoint, keyed by `key`.
 *
 * A revisit renders the last known value immediately and refreshes in the background, so only the
 * first visit in a session ever shows a loading state. That's what stops a tab switch from
 * collapsing the page height and jerking the scroll position back to the top.
 *
 * A failed request changes nothing it has no answer for. It used to put an empty fallback in
 * the value, and in the shared cache, so one dropped request made Home say "Nothing to remember
 * yet" to someone with four decks, and kept saying it on every tab that read the same key. Now
 * the last good value stays, `failed` says the refresh didn't land, and a screen with nothing to
 * show at all can say it couldn't load rather than that there is nothing. Empty-state copy is
 * for a successful response that was empty.
 *
 * `fetcher` is held in a ref rather than listed as an effect dep: it's a fresh closure on every
 * render, so depending on it would refetch in a loop. `key` is the real dependency, and `attempt`
 * is what `retry` bumps.
 */
export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
): [T | null, (next: T | ((prev: T | null) => T | null)) => void, ResourceStatus] {
  const [value, setValue] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    // Re-seed synchronously on a key change so the new key's cached value shows this render
    // rather than one frame later, which would flash the old key's data.
    setValue((cache.get(key) as T | undefined) ?? null)
    setFailed(false)

    let alive = true
    fetcherRef.current()
      .then((v) => {
        if (!alive) return
        cache.set(key, v)
        setValue(v)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [key, attempt])

  /** Local edits write through to the cache, so leaving and returning to the tab doesn't briefly
   * resurrect the pre-edit value while the background refresh is still in flight. */
  const update = useCallback(
    (next: T | ((prev: T | null) => T | null)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next
        if (v === null) cache.delete(key)
        else cache.set(key, v)
        return v
      })
    },
    [key],
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return [value, update, { failed, retry }]
}
