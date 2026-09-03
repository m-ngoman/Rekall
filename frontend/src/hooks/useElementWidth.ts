import { useEffect, useRef, useState } from 'react'

/**
 * The rendered width of an element, kept up to date as it resizes.
 *
 * For SVG charts. The tempting alternative — a fixed `viewBox` with
 * `preserveAspectRatio="none"` — scales the *stroke* along with the geometry, so a 2px line comes
 * out thick and horizontally smeared at one width and hairline at another. Measuring instead means
 * the chart is plotted in real pixels and every mark keeps the width it was specified at.
 *
 * Returns 0 until the first measurement lands, so callers should skip rendering the plot until
 * it's non-zero rather than dividing by it.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Measured synchronously as well as observed: ResizeObserver only fires on the *next* frame,
    // which would otherwise leave the chart blank for one paint on every mount.
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref as React.RefObject<T>, width]
}
