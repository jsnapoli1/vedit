/**
 * Marks the browser half of the bundle as client code. Next's App Router needs
 * the directive to be the first statement of the entry file, and the treeshake
 * pass strips it when esbuild emits it as a banner — so it goes on afterwards.
 */
import { readFile, writeFile } from 'node:fs/promises'

const DIRECTIVE = "'use client';\n"
const entries = ['dist/index.js', 'dist/index.cjs']

for (const entry of entries) {
  const source = await readFile(entry, 'utf8')
  if (source.startsWith(DIRECTIVE)) continue
  await writeFile(entry, DIRECTIVE + source, 'utf8')
}

console.log(`marked ${entries.length} client entries`)
