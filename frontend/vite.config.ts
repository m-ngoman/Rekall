import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** MagicDNS name of this machine on the tailnet. Phone testing goes through
 * `tailscale serve`, which terminates TLS and proxies to this dev server, so requests
 * arrive with this in the Host header rather than `localhost`. */
const TAILNET_HOST = 'bazzite.tail54d21b.ts.net'

/** Tailnet IP of this machine. Binding here rather than 0.0.0.0 matters: 0.0.0.0 would also
 * expose the dev server to everything on the home LAN, while this listens on the tailnet
 * interface alone. */
const TAILNET_IP = '100.69.45.24'

/** How the dev server is being reached, set by the npm scripts:
 *   unset    - localhost only, ordinary desktop dev
 *   'direct' - phone hits http://<tailnet-ip>:5173 straight over the tailnet. Needs no root.
 *   'serve'  - behind `tailscale serve`, which terminates TLS on 443 and proxies to loopback.
 *              Needs a one-time `sudo tailscale set --operator=$USER` for cert access.
 *
 * The two differ in more than the bind address: under 'serve' the page loads over https on 443,
 * so the HMR client has to be pointed there — left to its default it would try
 * `wss://<host>:5173`, which the tunnel doesn't expose, and hot reload would sit there failing.
 * Under 'direct' the defaults are already right, since the page's origin *is* the dev server. */
// Declared locally rather than pulling in @types/node for one lookup — this file is the only
// place in the frontend that touches the Node environment.
declare const process: { env: Record<string, string | undefined> }

const reach = process.env.PIPCARDS_TAILNET  // 'direct' | 'serve' | undefined

/** `ws: true` needed for /api/tutor/live-transcribe (the Deepgram STT proxy) — Vite's plain
 * string shorthand doesn't upgrade WebSocket connections on its own. */
const API_PROXY = {
  '/api': { target: 'http://localhost:8000', ws: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    // Under 'serve' nothing needs to listen on a routable interface at all — the proxy reaches
    // loopback from this same machine. Under 'direct' the tailnet interface is the listener.
    // Either way the tailnet is the only route in, and Tailscale authenticates the device
    // before a packet ever gets here.
    host: reach === 'direct' ? TAILNET_IP : '127.0.0.1',
    // Vite rejects requests whose Host header it doesn't recognise (DNS-rebinding defence).
    // Naming our own MagicDNS host keeps that protection for every *other* name.
    allowedHosts: [TAILNET_HOST],
    ...(reach === 'serve' ? { hmr: { protocol: 'wss', host: TAILNET_HOST, clientPort: 443 } } : {}),
    proxy: API_PROXY,
  },
  // `vite preview` does NOT inherit `server.proxy` — it reads `preview.proxy`. Without this a
  // production build served locally 404s on every API call, which makes the preview useless for
  // checking anything that depends on real data.
  preview: {
    proxy: API_PROXY,
  },
})
