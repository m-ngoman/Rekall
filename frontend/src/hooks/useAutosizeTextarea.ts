import { type RefObject, useEffect, useLayoutEffect } from 'react'

/** Grows a textarea with what's typed in it, up to `maxHeight` pixels, after which it scrolls. */
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement>, value: string, maxHeight: number) {
  // useLayoutEffect, not useEffect: this measures the textarea and then writes a pixel height
  // onto it. In a passive effect that write lands *after* the browser has painted, so opening the
  // tutor tab showed the composer at its natural height and then resized it a frame later —
  // visible as a delayed jump.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [ref, value, maxHeight])

  // The height above is measured in whatever font is rendering at the time. On a cold load that's
  // the fallback, and Nunito swapping in afterwards changes the line box — leaving the composer
  // sized for a font it is no longer using.
  useEffect(() => {
    document.fonts?.ready
      .then(() => {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
      })
      .catch(() => {})
  }, [ref, maxHeight])
}
