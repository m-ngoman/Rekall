/** What is for sale, what this account has, and paying for more. */

import type { BillingStatus, Catalogue } from '../types'
import { request } from './client'

/** What is for sale. The pricing screen renders exactly this and knows no product ids, so a
 * price or plan change is a backend edit and never a frontend one. */
export function getCatalogue(): Promise<Catalogue> {
  return request('/billing/catalogue')
}

export function getBillingStatus(): Promise<BillingStatus> {
  return request('/billing/status')
}

/** Starts a Stripe-hosted checkout and returns the page to send the browser to. The server
 * refuses this until it can also deliver — see billing.py — so a 503 here is expected while
 * purchases are switched off. */
export function startCheckout(productId: string): Promise<{ url: string }> {
  return request(`/billing/checkout?product=${encodeURIComponent(productId)}`, { method: 'POST' })
}
