import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Fixture-only: the same app pointed at the fixture backend on 8011, for design comparison
// screenshots. Never used for a deploy — `vite build` reads vite.config.ts, and this file is
// only ever passed explicitly to `vite` (dev).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    proxy: { '/api': { target: 'http://localhost:8011', ws: true } },
  },
})
