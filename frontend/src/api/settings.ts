/** The signed-in user's settings. */

import type { Settings, SettingsPatch } from '../types'
import { request } from './client'

export function getSettings(): Promise<Settings> {
  return request('/settings')
}

/** Partial update — only the keys present are changed. Passing `accent: null` is meaningful and
 * resets to the app default, which is why this takes a Partial rather than the whole object. */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return request('/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}
