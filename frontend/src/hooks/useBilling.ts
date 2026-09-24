import { useEffect, useState } from 'react'
import { getBillingStatus } from '../api'
import type { BillingStatus } from '../types'

/** What this account has paid for. Read once on load; nothing here changes without a round trip
 * through Stripe, and the webhook that grants it lands long before the next page view.
 *
 * Separate from useSettings on purpose. Settings are what the user chose; this is what they are
 * entitled to. They gate the same features and they are not the same question — turning AI
 * grading off in settings is a preference to respect, not having paid for it is a state to offer
 * a way out of, and only one of those should send someone to the pricing screen.
 *
 * Failure is silent and leaves `billing` null. Callers treat null as "assume entitled" (see
 * App.tsx), so a billing outage degrades to the paid experience with the server's 402 as the
 * backstop, rather than locking a paying user out of the app because one request failed.
 */
export function useBilling() {
  const [billing, setBilling] = useState<BillingStatus | null>(null)

  useEffect(() => {
    getBillingStatus()
      .then(setBilling)
      .catch(() => setBilling(null))
  }, [])

  return { billing }
}
