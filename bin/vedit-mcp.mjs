#!/usr/bin/env node
/**
 * The MCP server as a command, so a client that spawns processes can use it:
 *
 *   vedit-mcp --dir ./content
 *   vedit-mcp --endpoint https://example.com/api/vedit --token $VEDIT_TOKEN
 *   vedit-mcp --dir ./content --content-endpoint https://example.com/vedit --token $VEDIT_TOKEN
 *   vedit-mcp --dir ./content --content-db ./content.sqlite --schema ./schema.mjs
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
import { httpContentClient } from '../dist/content.js'
import { contentClientFromStore, nodeSqliteDriver, sqlContentStore } from '../dist/content-server.js'

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

  Records, when the site keeps its content in vedit (adds the record tools):
  --content-endpoint <url>   a vedit content API, e.g. https://example.com/vedit
                             (sent --token as a bearer)
  --content-db <file>        or: a SQLite file, read with Node's built-in sqlite
  --schema <module>          with --content-db: a module exporting { collections, globals }
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

const content = await contentClient()

const realtime = flag('realtime', null)
const room = flag('room', null)

const server = createVeditMcpServer({
  store,
  content,
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

/**
 * Where records come from, when the flags name a source; undefined otherwise,
 * so a site without content sees exactly the tools it always did. Node's
 * sqlite module is loaded only for `--content-db`: it is still marked
 * experimental and prints a warning on import.
 */
async function contentClient() {
  const contentEndpoint = flag('content-endpoint', null)
  const contentDb = flag('content-db', null)
  if (typeof contentEndpoint === 'string') {
    return httpContentClient({
      endpoint: contentEndpoint,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    })
  }
  if (typeof contentDb !== 'string') return undefined

  const schemaPath = flag('schema', null)
  if (typeof schemaPath !== 'string') {
    process.stderr.write('vedit-mcp: --content-db needs --schema <module exporting { collections, globals }>\n')
    process.exit(1)
  }
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const schema = await import(pathToFileURL(resolve(schemaPath)).href)
  if (!schema.collections || typeof schema.collections !== 'object') {
    process.stderr.write(`vedit-mcp: ${schemaPath} does not export { collections }\n`)
    process.exit(1)
  }
  const spec = { collections: schema.collections, globals: schema.globals ?? {} }

  const { DatabaseSync } = await import('node:sqlite')
  const contentStore = sqlContentStore(nodeSqliteDriver(new DatabaseSync(contentDb)), { dialect: 'sqlite', ...spec })
  await contentStore.init()
  return contentClientFromStore(contentStore, { spec })
}

process.stdin.setEncoding('utf8')
await serveStdio(server, { input: process.stdin, output: { write: (chunk) => process.stdout.write(chunk) } })
