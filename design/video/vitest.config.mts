import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Node, UTC and the `@app` alias: the frame maths is pure, and the drift tests read the app's
// sources as text, so nothing here needs a DOM.
export default defineConfig({
  resolve: { alias: { '@app': path.resolve(__dirname, '../../frontend/src') } },
  test: {
    environment: 'node',
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.ts'],
  },
  server: { fs: { allow: ['../..'] } },
})
