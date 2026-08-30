import { useCallback, useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../api'
import type { Settings, SettingsPatch, Theme } from '../types'

const THEME_KEY = 'pipcards:theme'
const ACCENT_KEY = 'pipcards:accent'

/** What index.html applies before React mounts. The server is the source of truth — this is only
 * a mirror, so the first paint doesn't have to wait on a request to know what to look like. */
function mirror(settings: Settings): void {
  try {
    localStorage.setItem(THEME_KEY, settings.theme)
    if (settings.accent) localStorage.setItem(ACCENT_KEY, settings.accent)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    // Private browsing and similar. The settings still apply for this session.
  }
}

/** The exact sRGB value of --bg in each theme. iOS Safari paints the strip above the page (and
 * Chrome its toolbar) from theme-color, so any drift from --bg shows up as a seam along the top
 * edge of the screen. Keep these in step with the tokens in index.css. */
export const THEME_BG = { light: '#faf4ec', dark: '#19120e' } as const

/** Resolves 'system' against the OS and writes the result to the root element. */
function applyTheme(theme: Theme): void {
  const resolved =
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
  // Driven by the theme actually in force, not by prefers-color-scheme: someone running the app
  // dark on a light phone would otherwise get a pale bar above a dark page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[resolved])
}

function applyAccent(accent: string | null, fallback: string): void {
  const value = accent ?? fallback
  document.documentElement.style.setProperty('--accent', value)
  applyFavicon(value)
}

/** Repaints the browser-tab icon in the user's accent.
 *
 * A static SVG favicon can respond to `prefers-color-scheme` but cannot read the page's CSS
 * variables — a favicon is rendered by browser chrome, outside the document — so matching a
 * user-chosen colour means swapping the `href` for a freshly built data URI.
 *
 * Deliberately NOT done for the home-screen or PWA icons: those are baked at install time and
 * can't change afterwards, and an app icon's job is to be recognisable among sixty others rather
 * than to match the theme inside.
 */
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
  // encodeURIComponent rather than base64: a data URI with raw '#' from an oklch()/hex colour
  // terminates the URL early and silently yields a blank icon.
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * The user's settings, kept in one place because several of them have to be *applied* to the
 * document rather than merely displayed — theme and accent both paint the whole app.
 *
 * Writes are optimistic and applied to the DOM before the request goes out. A colour picker that
 * only changes colour once the server answers feels broken on a phone, and the failure it's
 * guarding against (a PATCH failing while the GET succeeded seconds earlier) is rare enough that
 * paying a round-trip on every tap to defend against it is the wrong trade.
 */
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

  // Only relevant while the user is on 'system': the OS flipping to dark at sunset should carry
  // straight through without a reload, but it must not override an explicit choice.
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
        // Put the server's version back rather than guessing which field was rejected.
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
