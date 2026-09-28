import { DEFAULT_ACCENT } from '@app/lib/accent'

/** The theme every frame is drawn in: the app's dark theme and its default Coral accent — the same
 * pair as the README's study-loop shot (design/handoff/render-readme-shot.mjs). Set on the root
 * element exactly as useSettings sets it in the app, so index.css resolves every token the way the
 * app does. */
export function applyTheme() {
  const root = document.documentElement
  root.dataset.theme = 'dark'
  root.style.setProperty('--accent-pick', DEFAULT_ACCENT)
}
