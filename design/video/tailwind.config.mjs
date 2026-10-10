import plugin from 'tailwindcss/plugin'
import app from '../../frontend/tailwind.config.js'

/** The app's Tailwind config, pointed at the video's sources.
 *
 * One change: `lg:` means "inside a desktop replica" (an ancestor with `.rk-desktop`) rather than
 * "the viewport is at least 1024px wide". The app uses no other breakpoint, so replica markup can
 * copy the app's class strings verbatim — but a 1080px-wide portrait frame would otherwise switch
 * the phone replica into its desktop layout. */
export default {
  ...app,
  content: {
    relative: true,
    files: ['./src/**/*.{ts,tsx}', '../../frontend/src/components/{Logo,navIcons,icons,BackButton,DeckTile,ActionCard}.tsx'],
  },
  theme: { ...app.theme, screens: {} },
  plugins: [...(app.plugins ?? []), plugin(({ addVariant }) => addVariant('lg', '.rk-desktop &'))],
}
