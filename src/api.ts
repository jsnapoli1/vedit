import { DOCUMENT_VERSION, migrateDocument } from './core/migrate'
import {
  OperationError,
  applyOperations,
  describeDocument,
  type VeditOperation,
} from './core/operations'
import { documentToCss } from './runtime/css'
import {
  DEFAULT_BREAKPOINTS,
  emptyDocument,
  type BreakpointWidths,
  type DesignToken,
  type DocumentStage,
  type NodeOverride,
  type VeditDocument,
  type VeditVersion,
} from './core/types'
import type { VeditServerStore } from './server'

/**
 * The open API: everything the editor can do to a document, over HTTP, without a
 * browser in the loop. It exists so something other than a person can design —
 * a script, a CI job, an agent. The MCP server in `vedit/mcp` is this same
 * vocabulary wearing a different coat.
 *
 * Routes are versioned in the path (`/v1/…`) and mount anywhere: the handler
 * finds the `/v1` segment itself, so `/api/vedit/v1/documents/home` and
 * `/vedit/v1/documents/home` both work.
 *
 * Document keys are path segments, so they must be URI-encoded — a key of
 * `/pricing` is `documents/%2Fpricing`.
 *
 *     GET    /v1                                    what this server supports
 *     GET    /v1/documents                          list keys (if the store can)
 *     GET    /v1/documents/{key}?stage=draft        read a document
 *     PUT    /v1/documents/{key}                    replace a document
 *     GET    /v1/documents/{key}/summary            what is overridden, without the style maps
 *     POST   /v1/documents/{key}/operations         apply a batch of changes
 *     GET    /v1/documents/{key}/css                the stylesheet visitors would get
 *     GET    /v1/documents/{key}/nodes/{id}         one node's override
 *     PUT    /v1/documents/{key}/nodes/{id}         replace one node's override
 *     DELETE /v1/documents/{key}/nodes/{id}         reset one node
 *     GET    /v1/documents/{key}/tokens             the design tokens
 *     PUT    /v1/documents/{key}/tokens/{id}        create or update a token
 *     DELETE /v1/documents/{key}/tokens/{id}        remove a token
 *     POST   /v1/documents/{key}/publish            make the draft live
 *     GET    /v1/documents/{key}/versions           list history
 *     GET    /v1/documents/{key}/versions/{id}      read one version
 *     POST   /v1/documents/{key}/versions/{id}/restore   copy it back over the draft
 */
export const API_VERSION = 1

/** What a request is trying to do, handed to `authorize` before anything happens. */
export interface ApiRequestContext {
  method: string
  /** The document being read or written, when the route names one. */
  key: string | null
  /** True when the request would change stored data. */
  write: boolean
  /** Which copy of the document the request is aimed at. */
  stage: DocumentStage
  /** The matched route, e.g. `documents/:key/operations`. */
  route: string
}

export interface VeditApiOptions {
  store: VeditServerStore
  /**
   * Decide whether a request may go ahead. Required, and deliberately so: this
   * API can rewrite a live site. Pass `() => true` only where nothing but you can
   * reach the endpoint.
   */
  authorize: (request: Request, context: ApiRequestContext) => boolean | Promise<boolean>
  /** Used when rendering `/css`. Match your `VeditProvider`. */
  breakpoints?: BreakpointWidths
  /**
   * Sent as `Access-Control-Allow-Origin`, and makes the handler answer preflight
   * requests. Leave unset unless a browser on another origin has to call this.
   */
  cors?: string
  /**
   * Called after a write lands. Use it to tell open editors that something moved —
   * `postPatch` in `vedit/mcp` does exactly this against the realtime relay.
   */
  onChange?: (change: ApiChange) => void | Promise<void>
}

export interface ApiChange {
  key: string
  stage: DocumentStage
  doc: VeditDocument
  /** Node ids the change touched, when the route knows them. */
  changed?: string[]
}

/**
 * A Fetch-standard handler, like `createVeditHandler` — Next route handlers,
 * Remix, Hono, Workers, Deno and Bun all take it as-is.
 */
export function createVeditApi(options: VeditApiOptions) {
  const { store, authorize, breakpoints = DEFAULT_BREAKPOINTS, cors, onChange } = options

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = routeSegments(url.pathname)
    if (!segments) {
      return fail(404, `No such route. Every path starts at /v${API_VERSION}.`, cors)
    }

    const method = request.method.toUpperCase()
    if (method === 'OPTIONS' && cors) {
      return new Response(null, { status: 204, headers: corsHeaders(cors) })
    }

    const stage: DocumentStage = url.searchParams.get('stage') === 'draft' ? 'draft' : 'published'
    const write = method !== 'GET' && method !== 'HEAD'

    try {
      const match = matchRoute(segments)
      if (!match) return fail(404, `No such route: /v${API_VERSION}/${segments.join('/')}`, cors)

      const allowed = await authorize(request, { method, key: match.key, write, stage, route: match.route })
      if (!allowed) return fail(403, 'Not allowed', cors)

      return await run(match, { request, url, method, stage, store, breakpoints, cors, onChange })
    } catch (error) {
      if (error instanceof OperationError) {
        return json({ error: { message: error.message, operation: error.index } }, 400, cors)
      }
      return fail(500, error instanceof Error ? error.message : String(error), cors)
    }
  }
}

/* ------------------------------------------------------------------ routes */

interface RouteMatch {
  route: string
  key: string | null
  /** Trailing path parameter — a node id, token id or version id. */
  id: string | null
  /** Second trailing parameter, used by `versions/:id/restore`. */
  action: string | null
}

/** Everything after the `/v1` segment, decoded. `null` when the path has none. */
function routeSegments(pathname: string): string[] | null {
  const parts = pathname.split('/').filter(Boolean)
  const at = parts.lastIndexOf(`v${API_VERSION}`)
  if (at === -1) return null
  return parts.slice(at + 1).map((part) => decodeURIComponent(part))
}

function matchRoute(segments: string[]): RouteMatch | null {
  if (segments.length === 0) return { route: '', key: null, id: null, action: null }
  if (segments[0] !== 'documents') return null
  if (segments.length === 1) return { route: 'documents', key: null, id: null, action: null }

  const key = segments[1]
  const [, , section, id, action] = segments
  const route = ['documents/:key', section, id ? ':id' : null, action]
    .filter((part): part is string => Boolean(part))
    .join('/')

  const known = new Set(['summary', 'operations', 'css', 'nodes', 'tokens', 'publish', 'versions'])
  if (section && !known.has(section)) return null
  if (segments.length > 5) return null
  if (action && action !== 'restore') return null

  return { route, key, id: id ?? null, action: action ?? null }
}

/* ----------------------------------------------------------------- running */

interface Context {
  request: Request
  url: URL
  method: string
  stage: DocumentStage
  store: VeditServerStore
  breakpoints: BreakpointWidths
  cors?: string
  onChange?: (change: ApiChange) => void | Promise<void>
}

async function run(match: RouteMatch, context: Context): Promise<Response> {
  const { method, cors, store } = context

  if (match.route === '') {
    return json(
      {
        api: API_VERSION,
        documentVersion: DOCUMENT_VERSION,
        capabilities: {
          list: typeof store.list === 'function',
          versions: typeof store.listVersions === 'function' && typeof store.readVersion === 'function',
        },
      },
      200,
      cors,
    )
  }

  if (match.route === 'documents') {
    if (method !== 'GET') return notAllowed(cors)
    if (!store.list) return fail(501, 'This store cannot list documents', cors)
    return json({ items: await store.list() }, 200, cors)
  }

  const key = match.key!
  const read = async (): Promise<VeditDocument> => {
    const stored = await store.read(key, context.stage)
    return stored ? migrateDocument(stored, key) : emptyDocument(key)
  }

  const commit = async (doc: VeditDocument, changed?: string[]): Promise<VeditDocument> => {
    const saved = { ...doc, key, updatedAt: new Date().toISOString() }
    await store.write(saved, context.stage)
    await context.onChange?.({ key, stage: context.stage, doc: saved, changed })
    return saved
  }

  switch (match.route) {
    case 'documents/:key': {
      if (method === 'GET') return json(await read(), 200, cors)
      if (method === 'PUT') {
        const body = await readJson(context.request)
        return json(await commit(migrateDocument(body, key)), 200, cors)
      }
      return notAllowed(cors)
    }

    case 'documents/:key/summary': {
      if (method !== 'GET') return notAllowed(cors)
      return json(describeDocument(await read()), 200, cors)
    }

    case 'documents/:key/css': {
      if (method !== 'GET') return notAllowed(cors)
      const css = documentToCss(await read(), context.breakpoints)
      return new Response(css, {
        headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(cors) },
      })
    }

    case 'documents/:key/operations': {
      if (method !== 'POST') return notAllowed(cors)
      const body = (await readJson(context.request)) as { operations?: VeditOperation[] }
      const operations = Array.isArray(body) ? (body as VeditOperation[]) : body?.operations
      if (!Array.isArray(operations)) {
        return fail(400, 'Send `{ "operations": [...] }`, or an array of operations', cors)
      }
      const result = applyOperations(await read(), operations)
      const doc = await commit(result.doc, result.changed)
      return json({ changed: result.changed, created: result.created, updatedAt: doc.updatedAt }, 200, cors)
    }

    case 'documents/:key/nodes/:id': {
      const id = match.id!
      const doc = await read()
      if (method === 'GET') {
        const override = doc.nodes[id]
        return override ? json(override, 200, cors) : fail(404, `No overrides for \`${id}\``, cors)
      }
      if (method === 'PUT') {
        const override = (await readJson(context.request)) as NodeOverride
        if (!override || typeof override !== 'object' || Array.isArray(override)) {
          return fail(400, 'Expected an override object', cors)
        }
        const next = applyOperations(doc, [{ op: 'reset-node', id }]).doc
        next.nodes[id] = override
        await commit(next, [id])
        return json(override, 200, cors)
      }
      if (method === 'DELETE') {
        const result = applyOperations(doc, [{ op: 'reset-node', id }])
        await commit(result.doc, result.changed)
        return json({ ok: true }, 200, cors)
      }
      return notAllowed(cors)
    }

    case 'documents/:key/tokens': {
      if (method !== 'GET') return notAllowed(cors)
      return json({ items: (await read()).tokens }, 200, cors)
    }

    case 'documents/:key/tokens/:id': {
      const id = match.id!
      const doc = await read()
      if (method === 'PUT') {
        const token = (await readJson(context.request)) as DesignToken
        const result = applyOperations(doc, [{ op: 'set-token', token: { ...token, id } }])
        await commit(result.doc)
        return json({ ...token, id }, 200, cors)
      }
      if (method === 'DELETE') {
        const result = applyOperations(doc, [{ op: 'remove-token', id }])
        await commit(result.doc)
        return json({ ok: true }, 200, cors)
      }
      return notAllowed(cors)
    }

    case 'documents/:key/publish': {
      if (method !== 'POST') return notAllowed(cors)
      const draft = await store.read(key, 'draft')
      const doc = { ...migrateDocument(draft ?? (await read()), key), updatedAt: new Date().toISOString() }
      await store.write(doc, 'published')
      await context.onChange?.({ key, stage: 'published', doc })
      return json({ ok: true, updatedAt: doc.updatedAt }, 200, cors)
    }

    case 'documents/:key/versions': {
      if (method !== 'GET') return notAllowed(cors)
      if (!store.listVersions) return fail(501, 'This store keeps no history', cors)
      return json({ items: await store.listVersions(key) }, 200, cors)
    }

    case 'documents/:key/versions/:id': {
      if (method !== 'GET') return notAllowed(cors)
      if (!store.readVersion) return fail(501, 'This store keeps no history', cors)
      const doc = await store.readVersion(key, match.id!)
      return doc ? json(migrateDocument(doc, key), 200, cors) : fail(404, 'No such version', cors)
    }

    case 'documents/:key/versions/:id/restore': {
      if (method !== 'POST') return notAllowed(cors)
      if (!store.readVersion) return fail(501, 'This store keeps no history', cors)
      const doc = await store.readVersion(key, match.id!)
      if (!doc) return fail(404, 'No such version', cors)
      const restored = await commit(migrateDocument(doc, key))
      return json({ ok: true, updatedAt: restored.updatedAt }, 200, cors)
    }

    default:
      return fail(404, 'No such route', cors)
  }
}

/* ------------------------------------------------------------------- util */

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new OperationError('Body is not valid JSON', 0, null)
  }
}

function corsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  }
}

function json(body: unknown, status = 200, cors?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(cors) },
  })
}

function fail(status: number, message: string, cors?: string): Response {
  return json({ error: { message } }, status, cors)
}

function notAllowed(cors?: string): Response {
  return fail(405, 'Method not allowed on this route', cors)
}

/* --------------------------------------------------------------- a client */

export interface RemoteStoreOptions {
  /** Base URL of a `createVeditApi` mount, with or without the `/v1`. */
  endpoint: string
  /** Sent with every request — an API key, a session cookie, whatever gates it. */
  headers?: Record<string, string>
  /** Passed through as `?stage=`. Defaults to whatever the caller asks for. */
  fetch?: typeof globalThis.fetch
}

/**
 * A `VeditServerStore` that reads and writes through someone else's open API,
 * so tooling can point at a deployed site instead of a local directory. This is
 * what `vedit-mcp --endpoint …` uses.
 */
export function remoteStore(options: RemoteStoreOptions): VeditServerStore {
  const base = options.endpoint.replace(/\/+$/, '').replace(/\/v\d+$/, '')
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const doFetch = options.fetch ?? globalThis.fetch
    const response = await doFetch(`${base}/v${API_VERSION}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...options.headers, ...init.headers },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`vedit API ${response.status} on ${path}${detail ? `: ${detail}` : ''}`)
    }
    return response.status === 204 ? null : response.json()
  }
  const at = (key: string) => `/documents/${encodeURIComponent(key)}`

  return {
    async read(key, stage = 'published') {
      return (await call(`${at(key)}?stage=${stage}`)) as VeditDocument | null
    },
    async write(doc, stage = 'published') {
      await call(`${at(doc.key)}?stage=${stage}`, { method: 'PUT', body: JSON.stringify(doc) })
    },
    async list() {
      const body = (await call('/documents')) as { items?: Array<{ key: string; updatedAt?: string }> } | null
      return body?.items ?? []
    },
    async listVersions(key) {
      const body = (await call(`${at(key)}/versions`)) as { items?: VeditVersion[] } | null
      return body?.items ?? []
    },
    async readVersion(key, versionId) {
      return (await call(`${at(key)}/versions/${encodeURIComponent(versionId)}`)) as VeditDocument | null
    },
  }
}
