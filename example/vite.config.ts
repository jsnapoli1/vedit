import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The example builds the library straight from source so changes show up instantly.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vedit: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
