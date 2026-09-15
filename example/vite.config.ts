import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The example builds the library straight from source so changes show up instantly.
export default defineConfig({
  plugins: [react()],
  // The demo's `?rt=sse` mode talks to `realtime-server.mjs`, proxied so the
  // EventSource stays same-origin; the `/catalog` pages talk to
  // `content-server.mjs` the same way, so its session cookie is a first-party one.
  server: {
    proxy: {
      '/realtime': { target: 'http://localhost:5179', changeOrigin: true },
      '/vedit': { target: 'http://localhost:5180', changeOrigin: true },
    },
  },
  resolve: {
    // Subpaths first: Vite matches aliases in insertion order, and the bare
    // `vedit` key would otherwise turn `vedit/content` into `index.ts/content`.
    alias: {
      'vedit/content': fileURLToPath(new URL('../src/content.ts', import.meta.url)),
      'vedit/content-server': fileURLToPath(new URL('../src/content-server.ts', import.meta.url)),
      'vedit/media': fileURLToPath(new URL('../src/media.ts', import.meta.url)),
      'vedit/auth': fileURLToPath(new URL('../src/auth.ts', import.meta.url)),
      vedit: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
