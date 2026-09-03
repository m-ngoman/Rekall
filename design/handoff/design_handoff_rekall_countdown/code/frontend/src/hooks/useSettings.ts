import { useCallback, useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../api'
import type { Settings, SettingsPatch, Theme } from '../types'

const THEME_KEY = 'pipcards:theme'
const ACCENT_KEY = 'pipcards:accent'

function mirror(settings: Settings): void {
  try {
    localStorage.setItem(THEME_KEY, settings.theme)
    if (settings.accent) localStorage.setItem(ACCENT_KEY, settings.accent)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    // Private browsing and similar. The settings still apply for this session.
  }
}

/** The exact sRGB value of --bg in each theme. Keep in step with index.css. */
export const THEME_BG = { light: '#faf4ec', dark: '#19120e' } as const

function applyTheme(theme: Theme): void {
  const resolved =
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[resolved])
}

/** Writes the user's *pick*. index.css derives --accent from it — same colour in dark, darkened
 * in light so it stays legible on the pale page. Nothing should set --accent directly. */
function applyAccent(accent: string | null, fallback: string): void {
  const value = accent ?? fallback
  document.documentElement.style.setProperty('--accent-pick', value)
  applyFavicon(value)
}

function applyFavicon(accent: string): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
<g stroke="${accent}" stroke-opacity=".42" stroke-linecap="round">
<line x1="26" y1="84" x2="56" y2="92" stroke-width="6"/>
<line x1="56" y1="92" x2="38" y2="58" stroke-width="6"/>
<line x1="38" y1="58" x2="26" y2="84" stroke-width="6"/>
<line x1="38" y1="58" x2="88" y2="40" stroke-width="5.5"/>
<line x1="56" y1="92" x2="88" y2="40" stroke-width="5.5"/></g>
<g fill="${accent}">
<circle cx="26" cy="84" r="8.5" fill-opacity=".58"/>
<circle cx="56" cy="92" r="8.5" fill-opacity=".58"/>
<circle cx="38" cy="58" r="8.5" fill-opacity=".58"/>
<circle cx="88" cy="40" r="13.5"/></g></svg>`

  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
  if (!link) return
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function useSettings(defaultAccent: string) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s)
        mirror(s)
        applyTheme(s.theme)
        applyAccent(s.accent, defaultAccent)
      })
      .catch(() => setError('Could not load your settings.'))
  }, [defaultAccent])

  useEffect(() => {
    if (settings?.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings?.theme])

  const update = useCallback(
    async (patch: SettingsPatch) => {
      setSettings((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...patch }
        mirror(next)
        if (patch.theme !== undefined) applyTheme(next.theme)
        if (patch.accent !== undefined) applyAccent(next.accent, defaultAccent)
        return next
      })
      setError(null)
      try {
        const saved = await updateSettings(patch)
        setSettings(saved)
        mirror(saved)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that setting.')
        try {
          const current = await getSettings()
          setSettings(current)
          mirror(current)
          applyTheme(current.theme)
          applyAccent(current.accent, defaultAccent)
        } catch {
          // Offline entirely; leave the optimistic value rather than blanking the screen.
        }
      }
    },
    [defaultAccent],
  )

  return { settings, error, update }
}
