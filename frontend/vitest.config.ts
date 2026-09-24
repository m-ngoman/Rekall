import { defineConfig } from 'vitest/config'

// Unit tests for the pure modules under src/lib (and anything else as pure). Node, not a DOM: the
// screens are checked end to end by the Playwright scripts in design/handoff, and a jsdom copy of
// the browser would be a third thing to keep honest.
//
// UTC because the date helpers are local-time by design, and a test that passes in one timezone
// and fails in another is testing the machine, not the code.
// Declared locally, as in vite.config.ts, rather than pulling in @types/node for one assignment.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
