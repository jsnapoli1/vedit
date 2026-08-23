import { defineConfig } from 'tsup'

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
}

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: true,
    // The `'use client'` directive is added after the build — see
    // scripts/use-client.mjs for why it can't be an esbuild banner.
  },
  {
    ...shared,
    // Deliberately without the directive: this half runs on the server.
    entry: { server: 'src/server.ts' },
  },
])
