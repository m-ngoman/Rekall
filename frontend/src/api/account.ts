/** Who is signed in, signing out, and the owner-only surfaces: the bug inbox and the usage dashboard. */

import type { AdminStats, BugReport, Me, Spend } from '../types'
import { NotSignedIn, request } from './client'

/** The signed-in user, or null. Resolves rather than throwing on 401 — being signed out is an
 * ordinary state at startup, not an error. */
export async function getMe(): Promise<Me | null> {
  try {
    return await request<Me>('/auth/me')
  } catch (e) {
    if (e instanceof NotSignedIn) return null
    throw e
  }
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { method: 'POST' })
}

/** Files a note in the owner's bug inbox. 404s for everyone else, by design. */
export function reportBug(text: string, context: Record<string, unknown> = {}): Promise<BugReport> {
  return request('/bugs', { method: 'POST', body: JSON.stringify({ text, context }) })
}

export function listBugs(): Promise<BugReport[]> {
  return request('/bugs')
}

export function resolveBug(id: string): Promise<BugReport> {
  return request(`/bugs/${id}/resolve`, { method: 'POST' })
}

/** Aggregate usage counts for the owner dashboard. 404s for every other account, so callers
 * should only reach this behind `me.is_owner`. `days` sets the length of the daily series. */
export function getAdminStats(days = 30): Promise<AdminStats> {
  return request(`/admin/stats?days=${days}`)
}

/** Where the money went, by feature and by day. Owner-only, like the rest of /admin. */
export function getSpend(days = 30): Promise<Spend> {
  return request(`/admin/spend?days=${days}`)
}
