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
    // Its own build rather than another entry alongside `index`: sharing a build
    // would split the two into common chunks, and the client directive has to be
    // the first statement of a real entry file.
    entry: { internal: 'src/internal.ts' },
  },
  {
    ...shared,
    // Deliberately without the directive: these run on the server.
    entry: { server: 'src/server.ts', api: 'src/api.ts', mcp: 'src/mcp.ts' },
  },
])
