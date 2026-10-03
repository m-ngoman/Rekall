// The four videos, the frames the render scripts need about each, and where they go; and the app's
// viewport in each layout with the scale the video draws it at, which scripts/reference.mjs
// photographs the real app at. Kept in step with src/timeline.ts and CANVAS
// (src/primitives/AppCanvas.tsx) by src/__tests__/scripts.test.ts.
export const CUTS = {
  Launch30: { frames: 900, voiceStart: 420, fadeOut: 30, posters: { cover: 0, graded: 250, voice: 560, end: 899 } },
  Launch60: { frames: 1770, voiceStart: 612, fadeOut: 40, posters: { cover: 0, graded: 300, voice: 765, end: 1769 } },
}
export const COMPOSITIONS = {
  'Launch30-Landscape': { cut: 'Launch30', out: 'rekall-launch-30s-16x9', width: 1920, height: 1080 },
  'Launch30-Portrait': { cut: 'Launch30', out: 'rekall-launch-30s-9x16', width: 1080, height: 1920 },
  'Launch60-Landscape': { cut: 'Launch60', out: 'rekall-launch-60s-16x9', width: 1920, height: 1080 },
  'Launch60-Portrait': { cut: 'Launch60', out: 'rekall-launch-60s-9x16', width: 1080, height: 1920 },
}
export const VIEWPORTS = {
  landscape: { width: 1280, height: 720, scale: 1.15 },
  portrait: { width: 390, height: 643, scale: 2.2 },
}
/** The profile images (src/tools/bannerSpecs.ts): composition id -> file. */
export const PROFILES = {
  'Banner-x': 'x-header',
  'Banner-linkedin': 'linkedin-banner',
  'Banner-youtube': 'youtube-banner',
  Avatar: 'avatar',
}
