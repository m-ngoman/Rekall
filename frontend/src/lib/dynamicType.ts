/** iOS Dynamic Type support.
 *
 * Safari does not apply the system Text Size setting to ordinary web text. The one hook is the
 * `-apple-system-body` font keyword, which resolves to the user's chosen Dynamic Type size — so
 * a hidden probe styled with it reports, in pixels, how large this person wants body text.
 *
 * That measurement drives `--text-scale`, which multiplies the root font size in index.css.
 * Doing it this way rather than setting `font: -apple-system-body` on the root directly keeps
 * our own type scale and the browser's own font-size preference intact — and setting any
 * font-size on the root would cancel the dynamic sizing anyway.
 *
 * The clamp is the deliberate compromise. Dynamic Type's accessibility sizes reach ~53px, over
 * 3x the default; at that scale a layout with fixed-pixel controls stops being a layout. Bigger
 * text, bounded, beats an unusable page.
 */

const BASELINE_PX = 17 // -apple-system-body at the default Text Size setting
const MIN_SCALE = 0.9
const MAX_SCALE = 1.4

/** True on iPhone/iPad only. macOS Safari also understands -apple-system-body but has no Dynamic
 * Type setting behind it, so measuring there would apply a scale nobody asked for. */
function isAppleTouchDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; touch points are what still give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function measureTextScale(): number | null {
  if (!isAppleTouchDevice()) return null
  if (!window.CSS?.supports?.('font: -apple-system-body')) return null

  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;font:-apple-system-body'
  document.documentElement.appendChild(probe)
  const px = parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()

  if (!px || Number.isNaN(px)) return null
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, px / BASELINE_PX))
}

/** Above this, tab-bar captions no longer fit beside each other and truncate to noise
 * ("Ho…", "Car…"). The bar drops to icons only past it — see index.css. */
const LARGE_SCALE = 1.15

function apply(): void {
  const scale = measureTextScale()
  if (scale === null) return
  document.documentElement.style.setProperty('--text-scale', String(Math.round(scale * 1000) / 1000))
  if (scale >= LARGE_SCALE) document.documentElement.dataset.textScale = 'large'
  else delete document.documentElement.dataset.textScale
}

/** Re-measures when the app comes back to the foreground: changing Text Size means leaving for
 * Settings and returning, and Safari fires no event for the setting itself. */
export function watchDynamicType(): void {
  apply()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply()
  })
  // Back/forward cache restores don't re-run the boot script, so they need their own re-measure.
  window.addEventListener('pageshow', apply)
}
