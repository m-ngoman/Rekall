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

/**
 * Stale-while-revalidate read of one endpoint, keyed by `key`.
 *
 * A revisit renders the last known value immediately and refreshes in the background, so only the
 * first visit in a session ever shows a loading state. That's what stops a tab switch from
 * collapsing the page height and jerking the scroll position back to the top.
 *
 * `fetcher` and `fallback` are held in refs rather than listed as effect deps: both are fresh
 * closures on every render, so depending on them would refetch in a loop. `key` is the only real
 * dependency.
 */
export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: () => T,
): [T | null, (next: T | ((prev: T | null) => T | null)) => void] {
  const [value, setValue] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)
  const fetcherRef = useRef(fetcher)
  const fallbackRef = useRef(fallback)
  fetcherRef.current = fetcher
  fallbackRef.current = fallback

  useEffect(() => {
    // Re-seed synchronously on a key change so the new key's cached value shows this render
    // rather than one frame later, which would flash the old key's data.
    setValue((cache.get(key) as T | undefined) ?? null)

    let alive = true
    fetcherRef.current()
      .then((v) => {
        if (!alive) return
        cache.set(key, v)
        setValue(v)
      })
      .catch(() => {
        if (!alive) return
        // The fallback is cached too. Without that, a screen whose request keeps failing would
        // re-show "Loading…" on every single visit instead of its empty state.
        const v = fallbackRef.current()
        cache.set(key, v)
        setValue(v)
      })
    return () => {
      alive = false
    }
  }, [key])

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

  return [value, update]
}
