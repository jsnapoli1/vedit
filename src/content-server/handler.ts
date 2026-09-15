import type { DocumentStage } from '../core/types'
import { isProductionLike } from '../core/env'
import type {
  AccessAction,
  AccessContext,
  AccessLevel,
  CollectionSpec,
  GlobalSpec,
  HookContext,
  RecordChanges,
  RecordOperation,
  SourceChanges,
  SourceSchema,
  VeditCapabilities,
  VeditRecord,
  VeditUser,
} from '../content/types'
import { accessRule, normalizeFields, roleAtLeast, schemaFor } from '../content/schema'
import { newRecordId } from '../content/ids'
import { RecordOperationError, applyRecordOperations } from '../content/operations'
import { parseRecordQuery, segmentsAfterVersion } from '../content/query'
import { validateRecord } from '../content/validate'
import { hashPassword } from '../auth/password'
import type { AuthAction, VeditAuth } from '../auth/types'
import { USERS_SOURCE } from '../auth/users'
import { createMediaHandler } from '../media/handler'
import type { VeditMediaStore } from '../media/types'
import type { VeditContentStore } from './types'

/** The version in every path; a breaking change to the routes would bump it. */
const API_VERSION = 1

/** What a request is trying to do, handed to a custom `authorize` before anything happens. */
export interface ContentRequestContext {
  action: AuthAction
  /** The content source involved, when the route names one. */
  source?: string
  /** The record involved, when the route names one. */
  id?: string
}

export interface ContentHandlerHooks {
  /** Runs after any record lands, whichever source it belongs to, with the record as stored. */
  afterChange?(source: string, record: VeditRecord, ctx: HookContext): void | Promise<void>
}

export interface ContentHandlerOptions {
  collections: Record<string, CollectionSpec>
  globals?: Record<string, GlobalSpec>
  store: VeditContentStore
  /** Answers `/v1/media/*` when given. Uploads need the `upload` capability, deletes `data:delete`. */
  media?: VeditMediaStore
  /**
   * Sign-in and roles. Answers `/v1/auth/*`, decides who the caller is, and
   * adds the `_users` collection to the sources served here.
   */
  auth?: VeditAuth
  /**
   * Instead of `auth`: decide whether a request is trusted. A trusted request
   * acts as an admin, anything else as a visitor. Required when `auth` is not
   * given, and deliberately so: a handler without either writes for anyone.
   * Say so out loud with `createUnsafeLocalContentHandler` if that is what you want.
   */
  authorize?: (request: Request, context: ContentRequestContext) => boolean | Promise<boolean>
  hooks?: ContentHandlerHooks
  /**
   * Sent as `Access-Control-Allow-Origin`, and makes the handler answer
   * preflight requests. Leave unset unless a browser on another origin has to call this.
   */
  cors?: string
}

/**
 * A Fetch-standard handler over a content store — records, publishing,
 * versions — with the media and auth handlers mounted beside it, so one route
 * serves the editor everything. Finds the `/v1` segment itself, like
 * `createVeditApi`, and mounts under any prefix.
 *
 *     GET  /v1/capabilities                          who the caller is and what they may do
 *     GET  /v1/schema                                { sources }, with `can` for the caller
 *     GET  /v1/content/{source}?stage=draft&…        { items }
 *     GET  /v1/content/{source}/{id}                 one record
 *     POST /v1/content/commit                        { changes, stage } → { idMap, updatedAt }
 *     POST /v1/content/operations                    { operations, stage } → the same
 *     POST /v1/content/publish                       { records: { [source]: ids } }
 *     POST /v1/content/{source}/{id}/publish
 *     GET  /v1/content/{source}/{id}/versions
 *     POST /v1/content/{source}/{id}/versions/{v}/restore
 *     *    /v1/media/*                               `createMediaHandler`, when `media` is given
 *     *    /v1/auth/*                                `auth.handle`, when `auth` is given
 */
export function createContentHandler(options: ContentHandlerOptions) {
  const { store, media, auth, authorize, cors } = options
  // The types say this already, but a JavaScript caller never hears them, and
  // the failure is silent: an endpoint that writes for anyone who finds it.
  if (!auth && typeof authorize !== 'function') {
    throw new TypeError(
      'createContentHandler needs `auth` or an `authorize` callback: without one every request could write. ' +
        'Use createUnsafeLocalContentHandler({ collections, store }) if an open endpoint is genuinely what you want.',
    )
  }
  if (auth && USERS_SOURCE in options.collections) {
    throw new TypeError(
      `createContentHandler adds the ${USERS_SOURCE} collection itself when \`auth\` is given; leave it out of \`collections\`.`,
    )
  }

  const collections: Record<string, CollectionSpec> = auth
    ? { ...options.collections, [USERS_SOURCE]: auth.users }
    : { ...options.collections }
  const globals = options.globals ?? {}
  const sources = new Map<string, CollectionSpec | GlobalSpec>([
    ...Object.entries(collections),
    ...Object.entries(globals),
  ])
  // Field lists per source, for validation and for knowing which fields hold
  // a password. Built once: the spec does not change under a running handler.
  const schemas = new Map<string, SourceSchema>(schemaFor(collections, globals, 'admin').map((source) => [source.name, source]))
  const passwordFields = new Map<string, string[]>()
  for (const [name, spec] of sources) {
    const fields = Object.entries(normalizeFields(spec.fields))
      .filter(([, field]) => field.type === 'password')
      .map(([fieldName]) => fieldName)
    if (fields.length > 0) passwordFields.set(name, fields)
  }

  /* --------------------------------------------------------------- caller */

  interface Caller {
    role: AccessLevel
    user: VeditUser | null
    can: VeditCapabilities['can']
    request: Request
  }

  /**
   * Who is asking. With `auth` that is the session; with a bare `authorize` a
   * trusted request is an admin and anything else a visitor. Resolved once per
   * request and shared with the media handler, which asks its own question.
   */
  const callers = new WeakMap<Request, Promise<Caller>>()
  const callerFor = (request: Request): Promise<Caller> => {
    let pending = callers.get(request)
    if (!pending) {
      pending = resolveCaller(request)
      callers.set(request, pending)
    }
    return pending
  }
  async function resolveCaller(request: Request): Promise<Caller> {
    let user: VeditUser | null = null
    let role: AccessLevel = 'public'
    if (auth) {
      user = await auth.session(request)
      role = user?.role ?? 'public'
    } else if (authorize && (await authorize(request, { action: 'write' }))) {
      role = 'admin'
    }
    return { role, user, request, can: capabilitiesFor(role) }
  }

  /** The access rule for one action on one source, answered for this caller. */
  const may = async (
    caller: Caller,
    source: string,
    action: AccessAction,
    detail: { id?: string; data?: Record<string, unknown> } = {},
  ): Promise<boolean> => {
    const spec = sources.get(source)
    if (!spec) return false
    const rule = accessRule(spec.access, action)
    if (typeof rule !== 'function') return roleAtLeast(caller.role, rule)
    const ctx: AccessContext = { role: caller.role, user: caller.user, source, action, request: caller.request }
    if (detail.id !== undefined) ctx.id = detail.id
    if (detail.data !== undefined) ctx.data = detail.data
    return Boolean(await rule(ctx))
  }

  /** Drafts are the editors' working copy, so seeing them takes an account on top of read access. */
  const mayRead = async (caller: Caller, source: string, stage: DocumentStage, id?: string): Promise<boolean> => {
    if (stage === 'draft' && !roleAtLeast(caller.role, 'author')) return false
    return may(caller, source, 'read', id === undefined ? {} : { id })
  }

  /* ---------------------------------------------------------------- media */

  const mediaHandler = media
    ? createMediaHandler({
        store: media,
        authorize: async (request, { action }) => {
          if (action === 'read') return true
          const { can } = await callerFor(request)
          return action === 'upload' ? can.upload : can.data.delete
        },
      })
    : null

  /* -------------------------------------------------------------- handler */

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = segmentsAfterVersion(url.pathname)
    if (!segments) return notFound(cors)

    const method = request.method.toUpperCase()
    if (method === 'OPTIONS' && cors) {
      return new Response(null, { status: 204, headers: corsHeaders(cors) })
    }

    try {
      // The media and auth handlers answer their own routes in full, cors aside.
      if (segments[0] === 'media') {
        return mediaHandler ? withCors(await mediaHandler(request), cors) : notFound(cors)
      }
      if (segments[0] === 'auth') {
        const answered = auth ? await auth.handle(request) : null
        return answered ? withCors(answered, cors) : notFound(cors)
      }

      const match = matchRoute(segments)
      if (!match) return notFound(cors)
      if (method !== match.method) return notAllowed(match.method, cors)

      const caller = await callerFor(request)
      return await run(match, caller, url)
    } catch (error) {
      if (error instanceof RecordOperationError) {
        return json({ error: error.message, index: error.index }, 400, cors)
      }
      if (error instanceof BadRequest) return json({ error: error.message }, 400, cors)
      return json({ error: error instanceof Error ? error.message : String(error) }, 500, cors)
    }
  }

  async function run(match: RouteMatch, caller: Caller, url: URL): Promise<Response> {
    switch (match.route) {
      case 'capabilities':
        return json(
          {
            user: caller.user,
            login: Boolean(auth),
            can: caller.can,
            sources: [...sources.keys()],
            api: API_VERSION,
          },
          200,
          cors,
        )

      case 'schema': {
        // `schemaFor` decides levels; function rules are ours to run, here,
        // for this caller, so the editor is told the truth about each one.
        const described = schemaFor(collections, globals, caller.role)
        for (const source of described) {
          for (const action of Object.keys(source.can) as AccessAction[]) {
            if (typeof accessRule(sources.get(source.name)?.access, action) === 'function') {
              source.can[action] = await may(caller, source.name, action)
            }
          }
        }
        return json({ sources: described }, 200, cors)
      }

      case 'content/:source': {
        const source = match.source!
        if (!sources.has(source)) return notFound(cors)
        const query = parseRecordQuery(url.searchParams)
        const stage = query.stage ?? 'published'
        if (!(await mayRead(caller, source, stage))) return forbidden(cors)
        const items = await store.list(source, query, stage)
        return json({ items: items.map((record) => publicRecord(source, record)) }, 200, cors)
      }

      case 'content/:source/:id': {
        const source = match.source!
        if (!sources.has(source)) return notFound(cors)
        const stage: DocumentStage = url.searchParams.get('stage') === 'draft' ? 'draft' : 'published'
        if (!(await mayRead(caller, source, stage, match.id!))) return forbidden(cors)
        const record = await store.get(source, match.id!, stage)
        return record ? json(publicRecord(source, record), 200, cors) : notFound(cors)
      }

      case 'content/commit': {
        const body = await readJson(caller.request)
        return commit(caller, readChanges(body.changes), readStage(body.stage))
      }

      case 'content/operations': {
        const body = await readJson(caller.request)
        const operations = body.operations
        if (!Array.isArray(operations)) throw new BadRequest('Send { operations: [...] }')
        // Folding validates the batch; a bad operation throws with its index
        // before anything is checked or written.
        return commit(caller, applyRecordOperations({}, operations as RecordOperation[]), readStage(body.stage))
      }

      case 'content/publish': {
        const body = await readJson(caller.request)
        return publish(caller, readPublishList(body.records))
      }

      case 'content/:source/:id/publish': {
        if (!sources.has(match.source!)) return notFound(cors)
        return publish(caller, { [match.source!]: [match.id!] })
      }

      case 'content/:source/:id/versions': {
        const source = match.source!
        if (!sources.has(source)) return notFound(cors)
        if (!(await mayRead(caller, source, 'draft', match.id!))) return forbidden(cors)
        return json({ items: await store.versions(source, match.id!) }, 200, cors)
      }

      case 'content/:source/:id/versions/:v/restore': {
        const source = match.source!
        const id = match.id!
        if (!sources.has(source)) return notFound(cors)
        if (!(await may(caller, source, 'update', { id }))) return forbidden(cors)
        const versions = await store.versions(source, id)
        if (!versions.some((version) => version.id === match.version)) return notFound(cors)
        await store.restoreVersion(source, id, match.version!)
        const stage: DocumentStage = writeStage(source, 'draft')
        await notifyChange(source, id, stage, caller.user)
        return json({ ok: true }, 200, cors)
      }

      default:
        return notFound(cors)
    }
  }

  /* --------------------------------------------------------------- writes */

  // Declared as functions, not consts: everything below the handler's `return`
  // is reached only through hoisting.

  /** A global always has drafts; a collection unless it says otherwise. */
  function hasDrafts(source: string): boolean {
    const spec = sources.get(source)
    return !spec || !('drafts' in spec) || spec.drafts !== false
  }

  /** The stage a source is actually written at: one without drafts only has the live copy. */
  function writeStage(source: string, stage: DocumentStage): DocumentStage {
    return hasDrafts(source) ? stage : 'published'
  }

  async function commit(caller: Caller, changes: RecordChanges, stage: DocumentStage): Promise<Response> {
    // Every source is checked, and every record validated, before any row is
    // written: a refused `_users` create must not half-apply the posts beside it.
    for (const [source, entry] of Object.entries(changes)) {
      if (!sources.has(source)) throw new BadRequest(`Unknown source "${source}"`)
      for (const record of entry.create ?? []) {
        if (!(await may(caller, source, 'create', { data: record }))) return forbidden(cors)
      }
      for (const [id, patch] of Object.entries(entry.update ?? {})) {
        if (!(await may(caller, source, 'update', { id, data: patch }))) return forbidden(cors)
      }
      if (entry.order && !(await may(caller, source, 'update'))) return forbidden(cors)
      for (const id of entry.delete ?? []) {
        if (!(await may(caller, source, 'delete', { id }))) return forbidden(cors)
      }
      // Writing straight to the live copy is a publish. A source without
      // drafts has no other copy, so there the write right is the whole story.
      if (stage === 'published' && hasDrafts(source) && !(await may(caller, source, 'publish'))) {
        return forbidden(cors)
      }
    }

    for (const [source, entry] of Object.entries(changes)) {
      const problem = await prepare(source, entry, writeStage(source, stage))
      if (problem) return json({ error: problem }, 400, cors)
    }

    const result = await store.commit(changes, { stage })
    for (const [source, entry] of Object.entries(changes)) {
      const at = writeStage(source, stage)
      const rename = (id: string) => result.idMap[id] ?? id
      const touched = new Set<string>([
        ...(entry.create ?? []).map((record) => rename(record.id)),
        ...Object.keys(entry.update ?? {}).map(rename),
        ...(entry.order ?? []).map(rename),
      ])
      const deleted = new Set((entry.delete ?? []).map(rename))
      for (const id of touched) if (!deleted.has(id)) await notifyChange(source, id, at, caller.user)
      const spec = sources.get(source)
      for (const id of deleted) await spec?.hooks?.afterDelete?.(id, { source, stage: at, user: caller.user })
    }
    return json(result, 200, cors)
  }

  /**
   * Check one source's changes against its fields and hash what must never be
   * stored in the clear. Returns the first complaint, naming the source, or
   * null when everything is fine. Updates are judged as the record they
   * produce: a patch that leaves a required field alone is fine, one that
   * clears it is not.
   */
  async function prepare(source: string, entry: SourceChanges, stage: DocumentStage): Promise<string | null> {
    const schema = schemas.get(source)!
    const passwords = passwordFields.get(source) ?? []
    const created = new Map((entry.create ?? []).map((record) => [record.id, record]))

    for (const record of entry.create ?? []) {
      const messages = validateRecord(schema, record)
      if (messages.length > 0) return `${source}: ${messages.join('; ')}`
      await hashPasswords(record, passwords)
    }
    for (const [id, patch] of Object.entries(entry.update ?? {})) {
      const current = created.get(id) ?? (await store.get(source, id, stage)) ?? { id }
      const merged: VeditRecord = { ...current, ...patch, id }
      const messages = validateRecord(schema, merged)
      if (messages.length > 0) return `${source}: ${messages.join('; ')}`
      // Validation sanitises rich text on the merged copy; the patch is what
      // gets stored, so it has to carry the cleaned values.
      for (const key of Object.keys(patch)) patch[key] = merged[key]
      await hashPasswords(patch, passwords)
    }
    return null
  }

  /** `password` becomes `passwordHash`; a blank one means "keep what is there". */
  async function hashPasswords(data: Record<string, unknown>, fields: string[]): Promise<void> {
    for (const field of fields) {
      const value = data[field]
      delete data[field]
      if (typeof value === 'string' && value.length > 0) data[`${field}Hash`] = await hashPassword(value)
    }
  }

  async function publish(caller: Caller, records: Record<string, string[]>): Promise<Response> {
    for (const source of Object.keys(records)) {
      if (!sources.has(source)) throw new BadRequest(`Unknown source "${source}"`)
      if (!(await may(caller, source, 'publish'))) return forbidden(cors)
    }
    await store.publish(records)
    return json({ ok: true }, 200, cors)
  }

  /** Tell the hooks about a record that just landed, as the store now holds it. */
  async function notifyChange(source: string, id: string, stage: DocumentStage, user: VeditUser | null): Promise<void> {
    const spec = sources.get(source)
    const hook = spec?.hooks?.afterChange
    const global = options.hooks?.afterChange
    if (!hook && !global) return
    const stored = await store.get(source, id, stage)
    if (!stored) return
    const record = publicRecord(source, stored)
    const ctx: HookContext = { source, stage, user }
    await hook?.(record, ctx)
    await global?.(source, record, ctx)
  }

  /* ---------------------------------------------------------------- reads */

  /**
   * A record as it may leave the server: without the hash and without the
   * password that was never stored anyway. Applies to every source, not only
   * `_users`, so a host's own password field gets the same treatment.
   */
  function publicRecord(source: string, record: VeditRecord): VeditRecord {
    const hidden = new Set(['password', 'passwordHash'])
    for (const field of passwordFields.get(source) ?? []) {
      hidden.add(field)
      hidden.add(`${field}Hash`)
    }
    const clean: VeditRecord = { id: record.id }
    for (const [key, value] of Object.entries(record)) if (!hidden.has(key)) clean[key] = value
    return clean
  }
}

/**
 * `createContentHandler` with the authorization opted out of — every request
 * acts as an admin. For a laptop, a test, or a preview nothing else can reach.
 * The name is the point: on a deployed site this is the whole vulnerability.
 */
export function createUnsafeLocalContentHandler(options: Omit<ContentHandlerOptions, 'auth' | 'authorize'>) {
  if (isProductionLike()) {
    console.warn(
      '[vedit] createUnsafeLocalContentHandler is serving writes to anyone in a production build. ' +
        'Use createContentHandler({ ..., auth }) or an `authorize` callback instead.',
    )
  }
  return createContentHandler({ ...options, authorize: () => true })
}

/* ----------------------------------------------------------------- roles */

/** What each role may do in the editor. The same table `contentClientFromStore` answers from. */
function capabilitiesFor(role: AccessLevel): VeditCapabilities['can'] {
  return {
    write: roleAtLeast(role, 'author'),
    publish: roleAtLeast(role, 'editor'),
    upload: roleAtLeast(role, 'author'),
    data: { write: roleAtLeast(role, 'author'), delete: roleAtLeast(role, 'editor') },
  }
}

/* ---------------------------------------------------------------- routes */

interface RouteMatch {
  route: string
  method: 'GET' | 'POST'
  source: string | null
  id: string | null
  version: string | null
}

const FIXED_ROUTES: Record<string, RouteMatch['method']> = {
  'content/commit': 'POST',
  'content/operations': 'POST',
  'content/publish': 'POST',
}

function matchRoute(segments: string[]): RouteMatch | null {
  const none = { source: null, id: null, version: null }
  if (segments.length === 1 && (segments[0] === 'capabilities' || segments[0] === 'schema')) {
    return { route: segments[0], method: 'GET', ...none }
  }
  if (segments[0] !== 'content' || segments.length < 2) return null

  const fixed = segments.join('/')
  if (segments.length === 2 && fixed in FIXED_ROUTES) return { route: fixed, method: FIXED_ROUTES[fixed], ...none }

  const [, source, id, section, version, action] = segments
  const at = { source: source ?? null, id: id ?? null, version: version ?? null }
  switch (segments.length) {
    case 2:
      return { route: 'content/:source', method: 'GET', ...at }
    case 3:
      return { route: 'content/:source/:id', method: 'GET', ...at }
    case 4:
      if (section === 'publish') return { route: 'content/:source/:id/publish', method: 'POST', ...at }
      if (section === 'versions') return { route: 'content/:source/:id/versions', method: 'GET', ...at }
      return null
    case 6:
      if (section === 'versions' && action === 'restore') {
        return { route: 'content/:source/:id/versions/:v/restore', method: 'POST', ...at }
      }
      return null
    default:
      return null
  }
}

/* ---------------------------------------------------------------- bodies */

/** A request the caller got wrong. Becomes a 400 with the message. */
class BadRequest extends Error {}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    // Not JSON, or no body at all: the caller answers 400 either way.
    throw new BadRequest('Body is not valid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Expected a JSON object')
  return body as Record<string, unknown>
}

function readStage(value: unknown): DocumentStage {
  if (value === undefined || value === 'draft') return 'draft'
  if (value === 'published') return 'published'
  throw new BadRequest('stage must be "draft" or "published"')
}

function readChanges(value: unknown): RecordChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('Send { changes: { [source]: … }, stage }')
  const changes: RecordChanges = {}
  for (const [source, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequest(`Changes for "${source}" must be an object`)
    const given = entry as Record<string, unknown>
    const clean: SourceChanges = {}
    if (given.create !== undefined) {
      if (!Array.isArray(given.create) || !given.create.every(isObject)) throw new BadRequest(`${source}: create must be a list of records`)
      // A create from a script may leave the id out; a temp id here means the
      // store mints a real one and the idMap says which.
      clean.create = given.create.map((record): VeditRecord => ({
        ...record,
        id: typeof record.id === 'string' && record.id ? record.id : newRecordId(),
      }))
    }
    if (given.update !== undefined) {
      if (!isObject(given.update) || !Object.values(given.update).every(isObject)) {
        throw new BadRequest(`${source}: update must map ids to patches`)
      }
      clean.update = given.update as Record<string, Record<string, unknown>>
    }
    if (given.delete !== undefined) {
      if (!isIdList(given.delete)) throw new BadRequest(`${source}: delete must be a list of ids`)
      clean.delete = given.delete
    }
    if (given.order !== undefined) {
      if (!isIdList(given.order)) throw new BadRequest(`${source}: order must be a list of ids`)
      clean.order = given.order
    }
    changes[source] = clean
  }
  return changes
}

function readPublishList(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('Send { records: { [source]: [ids] } }')
  const records: Record<string, string[]> = {}
  for (const [source, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!isIdList(ids)) throw new BadRequest(`${source}: expected a list of ids`)
    records[source] = ids
  }
  return records
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id.length > 0)
}

/* ------------------------------------------------------------- responses */

function corsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  }
}

/** The same response with the cors headers on it, for answers the media and auth handlers built. */
function withCors(response: Response, origin?: string): Response {
  if (!origin) return response
  const copy = new Response(response.body, response)
  for (const [name, value] of Object.entries(corsHeaders(origin))) copy.headers.set(name, value)
  return copy
}

function json(body: unknown, status = 200, cors?: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(cors), ...headers },
  })
}

function notFound(cors?: string): Response {
  return json({ error: 'Not found' }, 404, cors)
}

function forbidden(cors?: string): Response {
  return json({ error: 'Not allowed' }, 403, cors)
}

function notAllowed(allow: string, cors?: string): Response {
  return json({ error: 'Method not allowed on this route' }, 405, cors, { allow })
}
