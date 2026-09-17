import { useCallback, useState } from 'react'
import type { Confirmation } from '../components/ConfirmDialog'

/** Holds the one pending confirmation for a screen.
 *
 * `ask` takes the same shape ConfirmDialog renders, so a call site reads as the question it is
 * asking rather than as state plumbing. Render `<ConfirmDialog confirmation={confirmation}
 * onCancel={cancel} />` once per screen.
 */
export function useConfirm() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const ask = useCallback((next: Confirmation) => setConfirmation(next), [])
  const cancel = useCallback(() => setConfirmation(null), [])
  return { confirmation, ask, cancel }
}
