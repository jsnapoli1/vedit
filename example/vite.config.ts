import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The example builds the library straight from source so changes show up instantly.
export default defineConfig({
  plugins: [react()],
  // The demo's `?rt=sse` mode talks to `realtime-server.mjs`, proxied so the
  // EventSource stays same-origin.
  server: {
    proxy: {
      '/realtime': { target: 'http://localhost:5179', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      vedit: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
