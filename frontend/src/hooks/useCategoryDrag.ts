import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'

/** Hold-then-drag for moving a note into a category.
 *
 * Hand-rolled on pointer events rather than HTML5 drag-and-drop, which is unusable here: its
 * `dragstart` never fires on a touch screen, and Rekall gets used on a phone more than a laptop.
 *
 * Three details are what make it behave on touch:
 *  - A drag only begins after a short hold, so an ordinary swipe still scrolls the page.
 *  - Once it begins, a **non-passive** touchmove listener calls `preventDefault()`. Without it the
 *    page keeps scrolling underneath the finger while the note follows it.
 *  - `pointercancel` (which the browser fires the moment it claims the gesture for a scroll)
 *    aborts rather than drops, so a note can't get refiled by a flick you meant as a scroll.
 *
 * A mouse doesn't wait for the hold — it starts dragging as soon as it moves past the tolerance,
 * which is what a mouse user expects and still leaves a plain click as a click.
 */

const HOLD_MS = 260
const MOVE_TOLERANCE_PX = 8

export interface CategoryDragState {
  noteId: string
  label: string
  x: number
  y: number
  /** `data-drop-key` of the category under the pointer: a deck id, `''` for Unfiled, `null` for
   * nothing droppable. */
  overKey: string | null
}

interface Armed {
  noteId: string
  label: string
  startX: number
  startY: number
  /** Touch waits out a hold; a mouse just needs to travel far enough to prove it isn't a click. */
  mode: 'hold' | 'threshold'
  timer: number
}

export function useCategoryDrag(onDrop: (noteId: string, dropKey: string) => void) {
  const [drag, setDrag] = useState<CategoryDragState | null>(null)
  const dragRef = useRef<CategoryDragState | null>(null)
  const armedRef = useRef<Armed | null>(null)
  // A finished drag ends in a pointerup, which the browser follows with a click on whatever is
  // underneath — without this the note would also open its detail view every time it was moved.
  const suppressClickRef = useRef(false)

  const applyDrag = (next: CategoryDragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const disarm = () => {
    if (armedRef.current) {
      clearTimeout(armedRef.current.timer)
      armedRef.current = null
    }
  }

  const beginDrag = (armed: Armed, x: number, y: number) => {
    disarm()
    applyDrag({ noteId: armed.noteId, label: armed.label, x, y, overKey: dropKeyAt(x, y) })
  }

  // Held in a ref so the window listeners below can be attached once. Taking `onDrop` as an
  // effect dependency would tear down and re-add every listener on each render — including the
  // renders the drag itself causes, which risks dropping a pointermove mid-gesture.
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const finish = (commit: boolean) => {
    const state = dragRef.current
    disarm()
    applyDrag(null)
    if (!state) return
    suppressClickRef.current = true
    if (commit && state.overKey !== null) onDropRef.current(state.noteId, state.overKey)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    const blockScroll = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault()
    }

    const onMove = (e: PointerEvent) => {
      const armed = armedRef.current
      if (armed && !dragRef.current) {
        const travelled = Math.hypot(e.clientX - armed.startX, e.clientY - armed.startY)
        if (travelled <= MOVE_TOLERANCE_PX) return
        // Travel means a scroll if we were waiting out a hold, and a drag if we weren't.
        if (armed.mode === 'hold') disarm()
        else beginDrag(armed, e.clientX, e.clientY)
        return
      }

      const state = dragRef.current
      if (!state) return
      applyDrag({ ...state, x: e.clientX, y: e.clientY, overKey: dropKeyAt(e.clientX, e.clientY) })
    }

    const onUp = () => {
      if (dragRef.current) finishRef.current(true)
      else disarm()
    }
    const onCancel = () => finishRef.current(false)

    window.addEventListener('touchmove', blockScroll, { passive: false })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('touchmove', blockScroll)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [])

  // Text selection would otherwise paint across the page as the mouse drags.
  useEffect(() => {
    if (!drag) return
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = previous
    }
  }, [drag])

  const onPointerDown = (noteId: string, label: string) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Clear here rather than on a timer: a drag that ends over empty space produces no click to
    // consume the flag, and a stale one would swallow the *next* real tap on a note.
    suppressClickRef.current = false
    disarm()

    const armed: Armed = {
      noteId,
      label,
      startX: e.clientX,
      startY: e.clientY,
      mode: e.pointerType === 'mouse' ? 'threshold' : 'hold',
      timer: 0,
    }
    if (armed.mode === 'hold') {
      armed.timer = window.setTimeout(() => beginDrag(armed, armed.startX, armed.startY), HOLD_MS)
    }
    armedRef.current = armed
  }

  /** True once per completed drag, so the tile can swallow the click the browser fires after it. */
  const consumeClickSuppression = () => {
    const suppressed = suppressClickRef.current
    suppressClickRef.current = false
    return suppressed
  }

  return { drag, onPointerDown, consumeClickSuppression }
}

/** The floating note follows the pointer, so it must not be `elementFromPoint`'s answer — it's
 * rendered `pointer-events: none` for exactly this lookup. */
function dropKeyAt(x: number, y: number): string | null {
  const target = document.elementFromPoint(x, y)?.closest('[data-drop-key]')
  return target?.getAttribute('data-drop-key') ?? null
}
