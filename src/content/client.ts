import { contentClientFromStore } from '../content-server/client'
import { memoryContentStore } from '../content-server/memory'
import type {
  CollectionSpec,
  CommitResult,
  GlobalSpec,
  RecordQuery,
  RecordVersion,
  SourceSchema,
  VeditCapabilities,
  VeditContentClient,
  VeditRecord,
  VeditUser,
} from './types'

export interface HttpContentClientOptions {
  /** Where `createContentHandler` is mounted, e.g. `'/vedit'` or `'https://cms.example.com/vedit'`. */
  endpoint: string
  /** Extra headers, e.g. an auth token. Re-evaluated on every request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  fetch?: typeof fetch
}

/**
 * Talks to `createContentHandler` over HTTP. Pair it with `vedit/content-server`.
 *
 * Every request goes out with `credentials: 'same-origin'`, so the session
 * cookie the auth routes set rides along on the host's own domain. The token
 * `login` returns is kept in memory and sent as a bearer as well: harmless next
 * to the cookie, and the only thing that works when there is no cookie — a
 * script, or a site whose API lives on another origin.
 */
export function httpContentClient(options: HttpContentClientOptions): VeditContentClient {
  const doFetch = options.fetch ?? globalThis.fetch
  const base = `${options.endpoint.replace(/\/+$/, '')}/v1`
  let token: string | null = null

  const resolveHeaders = async (): Promise<Record<string, string>> => {
    const given = typeof options.headers === 'function' ? await options.headers() : options.headers ?? {}
    return token ? { ...given, authorization: `Bearer ${token}` } : { ...given }
  }

  const url = (path: string, params?: URLSearchParams) => {
    const search = params?.toString()
    return `${base}${path}${search ? `?${search}` : ''}`
  }

  const request = async (path: string, init: { method?: string; params?: URLSearchParams; body?: unknown } = {}) => {
    const headers = await resolveHeaders()
    const hasBody = init.body !== undefined
    if (hasBody) headers['content-type'] = 'application/json'
    const response = await doFetch(url(path, init.params), {
      method: init.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    })
    if (!response.ok) throw new Error(await errorMessage(response))
    return response
  }

  const readJson = async <T>(response: Response): Promise<T> => (await response.json()) as T

  return {
    async schema() {
      const body = await readJson<{ sources?: SourceSchema[] }>(await request('/schema'))
      return body.sources ?? []
    },

    async list(source, query) {
      const body = await readJson<{ items?: VeditRecord[] }>(
        await request(`/content/${encodeURIComponent(source)}`, { params: encodeQuery(query) }),
      )
      return body.items ?? []
    },

    async get(source, id, opts) {
      const params = new URLSearchParams()
      if (opts?.stage) params.set('stage', opts.stage)
      const headers = await resolveHeaders()
      // A record that is not there is an answer, not a failure.
      const response = await doFetch(url(recordPath(source, id), params), { headers, credentials: 'same-origin' })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(await errorMessage(response))
      return readJson<VeditRecord>(response)
    },

    async commit(changes, opts) {
      return readJson<CommitResult>(await request('/content/commit', { method: 'POST', body: { changes, stage: opts.stage } }))
    },

    async publish(records) {
      await request('/content/publish', { method: 'POST', body: { records } })
    },

    async versions(source, id) {
      const body = await readJson<{ items?: RecordVersion[] } | RecordVersion[]>(
        await request(`${recordPath(source, id)}/versions`),
      )
      return Array.isArray(body) ? body : body.items ?? []
    },

    async restoreVersion(source, id, versionId) {
      await request(`${recordPath(source, id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' })
    },

    async capabilities() {
      return readJson<VeditCapabilities>(await request('/capabilities'))
    },

    async login(email, password) {
      const body = await readJson<{ user: VeditUser; token?: string }>(
        await request('/auth/login', { method: 'POST', body: { email, password } }),
      )
      token = body.token ?? null
      return body.user
    },

    async logout() {
      await request('/auth/logout', { method: 'POST' })
      token = null
    },
  }
}

/** `/content/:source/:id`, both segments encoded so a slash in an id stays one segment. */
function recordPath(source: string, id: string): string {
  return `/content/${encodeURIComponent(source)}/${encodeURIComponent(id)}`
}

/**
 * The list query the way `parseRecordQuery` on the server reads it back:
 * `stage`, `where[field]=value` (repeated for "any of these"), `orderBy`,
 * `limit` and `populate` joined with commas.
 */
function encodeQuery(query: RecordQuery | undefined): URLSearchParams | undefined {
  if (!query) return undefined
  const params = new URLSearchParams()
  if (query.stage) params.set('stage', query.stage)
  for (const [field, value] of Object.entries(query.where ?? {})) {
    for (const one of Array.isArray(value) ? value : [value]) params.append(`where[${field}]`, String(one))
  }
  if (query.orderBy) params.set('orderBy', query.orderBy)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.populate?.length) params.set('populate', query.populate.join(','))
  return params
}

/** The server's `error` field when the body is JSON with one, else the status line. */
async function errorMessage(response: Response): Promise<string> {
  const parsed = parseJson(await response.text())
  if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') return parsed.error
  return `${response.status} ${response.statusText}`.trim()
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON — an HTML error page from a proxy, or nothing at all.
    return null
  }
}

/* ------------------------------------------------------------------- local */

export interface LocalContentClientOptions {
  collections: Record<string, CollectionSpec>
  globals?: Record<string, GlobalSpec>
  /** Records to start with, by source. They land as published. */
  seed?: Record<string, VeditRecord[]>
  /**
   * Who the client acts as. Left out, everything is allowed; `null` makes it
   * a visitor. There is no login: the role is whatever the caller says.
   */
  user?: VeditUser | null
}

/**
 * A `VeditContentClient` over an in-memory store in the same process — for
 * demos, tests and a first look at `vedit/content` without a server. Nothing
 * survives a reload. The store is brought up on the first call, so there is
 * no init step to remember.
 */
export function localContentClient({ collections, globals, seed, user }: LocalContentClientOptions): VeditContentClient {
  const spec = { collections, globals: globals ?? {} }
  const store = memoryContentStore(spec, { seed })
  const inner = contentClientFromStore(store, { user, spec })

  // One init however many calls race for it; the seed is written inside it.
  let ready: Promise<void> | null = null
  const init = () => (ready ??= store.init())

  return {
    async schema() {
      await init()
      return inner.schema()
    },
    async list(source, query) {
      await init()
      return inner.list(source, query)
    },
    async get(source, id, opts) {
      await init()
      return inner.get(source, id, opts)
    },
    async commit(changes, opts) {
      await init()
      return inner.commit(changes, opts)
    },
    async publish(records) {
      await init()
      return store.publish(records)
    },
    async versions(source, id) {
      await init()
      return store.versions(source, id)
    },
    async restoreVersion(source, id, versionId) {
      await init()
      return store.restoreVersion(source, id, versionId)
    },
    async capabilities() {
      await init()
      return inner.capabilities()
    },
  }
}
