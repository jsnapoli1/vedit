#!/usr/bin/env node
/**
 * The MCP server as a command, so a client that spawns processes can use it:
 *
 *   vedit-mcp --dir ./content
 *   vedit-mcp --endpoint https://example.com/api/vedit --token $VEDIT_TOKEN
 *
 * Add it to Claude Code with:
 *
 *   claude mcp add vedit -- npx -y vedit-mcp --dir ./content
 *
 * Everything it prints on stdout is protocol. Anything for a human goes to stderr.
 */
import { createRequire } from 'node:module'
import { createVeditMcpServer, serveStdio, notifyEditors } from '../dist/mcp.js'
import { fileStore } from '../dist/server.js'
import { remoteStore } from '../dist/api.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  if (at === -1) return fallback
  const value = argv[at + 1]
  return value && !value.startsWith('--') ? value : true
}

if (flag('help', false) || argv.includes('-h')) {
  process.stderr.write(`vedit-mcp — edit a site's overrides over MCP

  --dir <path>          documents on disk (default ./content)
  --endpoint <url>      or: a vedit open API to work through
  --token <token>       bearer token for --endpoint
  --key <key>           document to use when a tool call omits one
  --components <file>   component manifest JSON, so an agent can compose pages
  --stage draft|published   which copy to write (default draft)
  --read-only           expose only the tools that read
  --realtime <url>      relay to notify, so open editors update live
  --room <room>         realtime room (default: the document key)
`)
  process.exit(0)
}

const endpoint = flag('endpoint', null)
const token = flag('token', null)
const store =
  typeof endpoint === 'string'
    ? remoteStore({ endpoint, headers: token ? { authorization: `Bearer ${token}` } : undefined })
    : fileStore(typeof flag('dir', './content') === 'string' ? flag('dir', './content') : './content')

// The manifest is data, not code: an app can write `componentManifest(registry)`
// to a file at build time, and this command never has to import the site.
const manifestPath = flag('components', null)
let components
if (typeof manifestPath === 'string') {
  const { readFile } = await import('node:fs/promises')
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  components = Array.isArray(parsed) ? parsed : parsed.items
  if (!Array.isArray(components)) {
    process.stderr.write(`vedit-mcp: ${manifestPath} is not a component manifest\n`)
    process.exit(1)
  }
}

const realtime = flag('realtime', null)
const room = flag('room', null)

const server = createVeditMcpServer({
  store,
  stage: flag('stage', 'draft') === 'published' ? 'published' : 'draft',
  defaultKey: typeof flag('key', null) === 'string' ? flag('key', null) : undefined,
  writable: !flag('read-only', false),
  components,
  version: createRequire(import.meta.url)('../package.json').version,
  onChange:
    typeof realtime === 'string'
      ? notifyEditors({ endpoint: realtime, room: typeof room === 'string' ? room : undefined })
      : undefined,
})

const composable = components?.length ?? (typeof endpoint === 'string' ? '?' : 0)
process.stderr.write(`vedit-mcp ready — ${server.tools.length} tools, ${composable} components\n`)

process.stdin.setEncoding('utf8')
await serveStdio(server, { input: process.stdin, output: { write: (chunk) => process.stdout.write(chunk) } })
