import { loadFont } from '@remotion/fonts'
import barlow600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'
import nunito from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2'

/** The app's two faces, from files in node_modules rather than Google's CDN, so a render never
 * depends on the network. Google serves the app one variable Nunito file for all three weights;
 * this is that same file, registered three times under the family name the app's CSS asks for
 * (Fontsource's own stylesheet would call it "Nunito Variable"). loadFont holds the render until
 * each face has loaded. */
export const fontsLoaded = Promise.all([
  ...(['500', '600', '700'] as const).map((weight) => loadFont({ family: 'Nunito', url: nunito, weight })),
  loadFont({ family: 'Barlow Condensed', url: barlow600, weight: '600' }),
])
