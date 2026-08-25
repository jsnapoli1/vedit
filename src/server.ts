import {
  emptyDocument,
  type DocumentStage,
  type VeditDocument,
  type VeditVersion,
} from './core/types'
import { migrateDocument } from './core/migrate'
import { isProductionLike } from './core/env'
import type { ComponentSummary } from './core/registry'
import { documentToCss } from './runtime/css'
import { DEFAULT_BREAKPOINTS, type BreakpointWidths } from './core/types'

export { createRealtimeHandler, createUnsafeLocalRealtimeHandler } from './realtime-server'
export { migrateDocument, inspectDocument, DOCUMENT_VERSION } from './core/migrate'
export { componentManifest } from './core/registry'
export type { ComponentSummary } from './core/registry'
export { applyOperations, describeDocument, OperationError } from './core/operations'
export type {
  ContentPatch,
  DocumentSummary,
  OperationResult,
  VeditOperation,
} from './core/operations'
export type { MigrationReport } from './core/migrate'
export type { RealtimeHandlerOptions } from './realtime-server'
export { documentToCss, emptyDocument }
export type { DocumentStage, VeditDocument, VeditVersion }

/**
 * Where the server keeps documents. Implement this against your own database.
 * A store that ignores `stage` simply has no draft/publish distinction, and the
 * editor hides the publish button accordingly.
 */
export interface VeditServerStore {
  read(key: string, stage?: DocumentStage): Promise<VeditDocument | null>
  write(doc: VeditDocument, stage?: DocumentStage): Promise<void>
  /** Optional: which documents exist. Switches on `GET /v1/documents` in the API. */
  list?(): Promise<Array<{ key: string; updatedAt?: string }>>
  /**
   * Optional: the components pages may be composed from. A store that fetches
   * documents from a site can fetch its manifest too, which is how `vedit-mcp
   * --endpoint` learns what an agent is allowed to place.
   */
  listComponents?(): Promise<ComponentSummary[]>
  /** Optional history. Implement both to switch on the editor's History panel. */
  listVersions?(key: string): Promise<VeditVersion[]>
  readVersion?(key: string, versionId: string): Promise<VeditDocument | null>
}

/** A `VeditServerStore` backed by JSON files on disk — fine for small sites. */
export function fileStore(directory: string): VeditServerStore {
  const slug = (key: string) => key.replace(/[^a-z0-9._-]+/gi, '_') || 'default'
  const fileFor = (key: string, stage: DocumentStage) =>
    `${slug(key)}${stage === 'draft' ? '.draft' : ''}.json`

  const readJson = async (path: string) => {
    const { readFile } = await import('node:fs/promises')
    try {
      return JSON.parse(await readFile(path, 'utf8')) as VeditDocument
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  const writeJson = async (path: string, doc: VeditDocument) => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(doc, null, 2), 'utf8')
  }

  const versionDir = async (key: string) => {
    const { join } = await import('node:path')
    return join(directory, 'versions', slug(key))
  }

  return {
    async read(key, stage = 'published') {
      const { join } = await import('node:path')
      const doc = await readJson(join(directory, fileFor(key, stage)))
      // A draft that was never saved starts from whatever is live.
      if (!doc && stage === 'draft') return readJson(join(directory, fileFor(key, 'published')))
      return doc
    },

    async write(doc, stage = 'published') {
      const { join } = await import('node:path')
      await writeJson(join(directory, fileFor(doc.key, stage)), doc)
      // Every write is a point you can come back to.
      const stamp = doc.updatedAt.replace(/[:.]/g, '-')
      await writeJson(join(await versionDir(doc.key), `${stage}-${stamp}.json`), doc)
    },

    async list() {
      const { readdir, readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      let names: string[] = []
      try {
        names = await readdir(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const items: Array<{ key: string; updatedAt?: string }> = []
      for (const name of names) {
        // Drafts are listed under the same key as what they are a draft of.
        if (!name.endsWith('.json') || name.endsWith('.draft.json')) continue
        try {
          const doc = JSON.parse(await readFile(join(directory, name), 'utf8')) as VeditDocument
          if (typeof doc?.key === 'string') items.push({ key: doc.key, updatedAt: doc.updatedAt })
        } catch {
          // A file that isn't a document simply isn't one.
        }
      }
      return items.sort((a, b) => a.key.localeCompare(b.key))
    },

    async listVersions(key) {
      const { readdir } = await import('node:fs/promises')
      let names: string[] = []
      try {
        names = await readdir(await versionDir(key))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return names
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const id = name.replace(/\.json$/, '')
          const [stage, ...stamp] = id.split('-')
          return {
            id,
            savedAt: restoreTimestamp(stamp.join('-')),
            published: stage === 'published',
          }
        })
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
        .slice(0, 50)
    },

    async readVersion(key, versionId) {
      const { join } = await import('node:path')
      // Never let a crafted id walk out of the versions directory.
      if (!/^[a-z0-9._-]+$/i.test(versionId)) return null
      return readJson(join(await versionDir(key), `${versionId}.json`))
    },
  }
}

/** `2026-08-23T12-00-00-000Z` back to a real ISO timestamp. */
function restoreTimestamp(stamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp)
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : stamp
}

export interface HandlerOptions {
  store: VeditServerStore
  /**
   * Decide whether a request may write. Required, and deliberately so: a handler
   * without one saves whatever any request sends it. Where that really is what
   * you want — a laptop, a preview no one else can reach — say it out loud with
   * `createUnsafeLocalHandler` rather than by leaving a field off.
   */
  authorize: (request: Request) => boolean | Promise<boolean>
}

/**
 * A Web-standard `Request -> Response` handler that pairs with `httpAdapter`.
 * Works anywhere the Fetch API does: Next.js route handlers, Remix, Hono,
 * Cloudflare Workers, Deno or Bun.
 *
 * - `GET  ?key=…[&stage=draft]` — read a document
 * - `GET  ?key=…&versions=1`    — list the history
 * - `GET  ?key=…&version=…`     — read one version
 * - `PUT  ?key=…`               — save the draft
 * - `POST ?action=publish`      — make the draft live
 */
export function createVeditHandler({ store, authorize }: HandlerOptions) {
  // The types say this already, but a JavaScript caller never hears them, and the
  // failure is silent: an endpoint that saves for anyone who finds it.
  if (typeof authorize !== 'function') {
    throw new TypeError(
      'createVeditHandler needs an `authorize` callback: without one every request could write. ' +
        'Use createUnsafeLocalHandler({ store }) if an open endpoint is genuinely what you want.',
    )
  }
  return handler(store, authorize)
}

/**
 * `createVeditHandler` with the authorization opted out of — every request may
 * write. For a laptop, a test, or a preview nothing else can reach. The name is
 * the point: on a deployed site this is the whole vulnerability.
 */
export function createUnsafeLocalHandler({ store }: { store: VeditServerStore }) {
  if (isProductionLike()) {
    console.warn(
      '[vedit] createUnsafeLocalHandler is serving writes to anyone in a production build. ' +
        'Use createVeditHandler({ store, authorize }) instead.',
    )
  }
  return handler(store, () => true)
}

function handler(
  store: VeditServerStore,
  authorize: (request: Request) => boolean | Promise<boolean>,
) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = url.searchParams.get('key') ?? 'default'

    if (request.method === 'GET') {
      if (url.searchParams.get('versions')) {
        const items = store.listVersions ? await store.listVersions(key) : []
        return json({ items })
      }
      const versionId = url.searchParams.get('version')
      if (versionId) {
        const doc = store.readVersion ? await store.readVersion(key, versionId) : null
        return doc ? json(doc) : json({ error: 'No such version' }, 404)
      }
      const stage = url.searchParams.get('stage') === 'draft' ? 'draft' : 'published'
      const doc = await store.read(key, stage)
      return json(doc ? migrateDocument(doc, key) : emptyDocument(key))
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      if (!(await authorize(request))) {
        return json({ error: 'Not allowed' }, 403)
      }
      const body = (await request.json()) as VeditDocument
      if (!body || typeof body !== 'object' || typeof body.key !== 'string' || !body.nodes) {
        return json({ error: 'Malformed document' }, 400)
      }
      // Whatever the client sent is stored data now: bring it to this build's
      // shape before it reaches disk, rather than on every later read.
      const doc = migrateDocument(body, body.key)
      const publishing = url.searchParams.get('action') === 'publish'
      await store.write(doc, publishing ? 'published' : 'draft')
      return json({ ok: true, stage: publishing ? 'published' : 'draft' })
    }

    return json({ error: 'Method not allowed' }, 405)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Renders overrides as a `<style>` tag for server-side rendering, so the first
 * paint already carries the edits instead of flashing the original design.
 */
export function veditStyleTag(
  doc: VeditDocument | null,
  breakpoints: BreakpointWidths = DEFAULT_BREAKPOINTS,
): string {
  if (!doc) return ''
  const css = documentToCss(doc, breakpoints)
  return css ? `<style data-vedit-overrides>${css}</style>` : ''
}
