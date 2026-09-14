import type { VeditRecord, VeditUser } from '../content/types'
import { newRecordId } from '../content/ids'
import { segmentsAfterVersion } from '../content/query'
import type { AuthAction, AuthOptions, AuthorizeContext, NewUser, VeditAuth } from './types'
import { hashPassword, verifyPassword } from './password'
import { signToken, verifyToken } from './token'
import { USERS_SOURCE, isRole, isUserRecord, normaliseEmail, publicUser, usersCollection } from './users'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = { attempts: 10, windowMs: 15 * 60 * 1000 }
const MIN_SECRET_LENGTH = 16

/** What each role may do. Each one includes the roles before it. */
const ROLE_ACTIONS: Record<VeditUser['role'], ReadonlySet<AuthAction>> = (() => {
  const author: AuthAction[] = ['read', 'write', 'upload', 'data:write']
  const editor: AuthAction[] = [...author, 'publish', 'data:delete']
  return { author: new Set(author), editor: new Set(editor), admin: new Set(editor) }
})()

/** An error the content handler can turn straight into a response. */
export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/**
 * Whether a request may act on the strength of its session cookie. Reads
 * always may. For anything else the browser has to say the request came from
 * our own site — `Sec-Fetch-Site`, or `Origin` on older browsers — because a
 * cookie is attached to a form another site posts at us just as readily. A
 * request with neither header is not from a browser at all (curl, a server),
 * and those carry no ambient credentials to abuse.
 *
 * Exported so the content handler applies the same rule to its own routes.
 */
export function cookieSessionAllowed(request: Request): boolean {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin' || site === 'same-site' || site === 'none'
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    // An `Origin` that is not a URL — `null` for a sandboxed frame, say — is
    // exactly the case the header exists to flag.
    return false
  }
}

export function createAuth(options: AuthOptions): VeditAuth {
  const { store, secret, bootstrap } = options
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new TypeError(`createAuth needs a secret of at least ${MIN_SECRET_LENGTH} characters to sign sessions with.`)
  }
  const ttlMs = options.sessionTtlMs ?? DEFAULT_TTL_MS
  const cookie = {
    name: options.cookie?.name ?? 'vedit_session',
    secure: options.cookie?.secure ?? 'auto',
    path: options.cookie?.path ?? '/',
  }
  const limit = {
    attempts: options.loginLimit?.attempts ?? DEFAULT_LIMIT.attempts,
    windowMs: options.loginLimit?.windowMs ?? DEFAULT_LIMIT.windowMs,
  }

  /* ------------------------------------------------------------ bootstrap */

  // Memoised so that several first requests arriving together create one
  // user, not one each; dropped again on failure so the next request retries.
  let bootstrapped: Promise<void> | null = null
  const ensureBootstrap = (): Promise<void> => {
    if (!bootstrapped) {
      bootstrapped = runBootstrap().catch((error: unknown) => {
        bootstrapped = null
        throw error
      })
    }
    return bootstrapped
  }
  async function runBootstrap(): Promise<void> {
    if (!bootstrap) return
    const existing = await store.list(USERS_SOURCE, {}, 'published')
    if (existing.length > 0) return
    await createUser({ ...bootstrap, role: bootstrap.role ?? 'admin' })
  }

  /* --------------------------------------------------------------- users */

  async function findByEmail(email: string): Promise<VeditRecord | null> {
    const rows = await store.list(USERS_SOURCE, { where: { email } }, 'published')
    return rows[0] ?? null
  }

  async function createUser(user: NewUser): Promise<VeditUser> {
    const email = normaliseEmail(String(user.email ?? ''))
    if (!email) throw new AuthError('An email is required', 400)
    if (typeof user.password !== 'string' || user.password.length === 0) throw new AuthError('A password is required', 400)
    if (!isRole(user.role)) throw new AuthError(`Unknown role ${String(user.role)}`, 400)
    if (await findByEmail(email)) throw new AuthError('A user with that email already exists', 409)

    // The store picks the real id and reports it against the temp one, the
    // same way an editor's creates come back from a commit.
    const tempId = newRecordId()
    const record: VeditRecord = { id: tempId, email, role: user.role, passwordHash: await hashPassword(user.password) }
    if (typeof user.name === 'string' && user.name) record.name = user.name
    const { idMap } = await store.commit({ [USERS_SOURCE]: { create: [record] } }, { stage: 'published' })
    return publicUser({ ...record, id: idMap[tempId] ?? tempId })
  }

  async function setPassword(id: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password.length === 0) throw new AuthError('A password is required', 400)
    const record = await store.get(USERS_SOURCE, id, 'published')
    if (!record) throw new AuthError('No such user', 404)
    const passwordHash = await hashPassword(password)
    await store.commit({ [USERS_SOURCE]: { update: { [id]: { passwordHash } } } }, { stage: 'published' })
  }

  /* ------------------------------------------------------------ sessions */

  async function userForToken(token: string): Promise<VeditUser | null> {
    const payload = await verifyToken(token, secret)
    if (!payload) return null
    // The store, not the token, says who the user is now: a deleted account or
    // a changed role takes effect on the next request rather than at expiry.
    const record = await store.get(USERS_SOURCE, payload.sub, 'published')
    return isUserRecord(record) ? publicUser(record) : null
  }

  /**
   * The signed-in user, and whether a cookie was turned away for coming from
   * another site. The two are told apart so `handle` can answer 403 rather
   * than 401 to a cross-site post: the difference is what a developer needs
   * to see when their own fetch forgot to say where it came from.
   */
  async function resolve(request: Request): Promise<{ user: VeditUser | null; refused: boolean }> {
    await ensureBootstrap()
    const fromCookie = readCookie(request, cookie.name)
    const fromBearer = readBearer(request)
    const cookieAllowed = fromCookie !== null && cookieSessionAllowed(request)
    for (const token of [cookieAllowed ? fromCookie : null, fromBearer]) {
      if (token === null) continue
      const user = await userForToken(token)
      if (user) return { user, refused: false }
    }
    return { user: null, refused: fromCookie !== null && !cookieAllowed }
  }

  async function session(request: Request): Promise<VeditUser | null> {
    return (await resolve(request)).user
  }

  async function authorize(request: Request, ctx: AuthorizeContext = { action: 'write' }): Promise<boolean> {
    const { user } = await resolve(request)
    if (!user) return false
    if (ctx.source === USERS_SOURCE) return user.role === 'admin'
    return ROLE_ACTIONS[user.role].has(ctx.action)
  }

  /* ---------------------------------------------------------- rate limit */

  // Failed sign-ins per `${ip}|${email}`. Kept in memory with lazy expiry:
  // per process on Node, per isolate on an edge runtime, which is documented
  // on `AuthOptions.loginLimit`.
  const failures = new Map<string, { count: number; resetAt: number }>()
  const bucketFor = (request: Request, email: string) => `${clientAddress(request)}|${email}`

  function limited(key: string, now: number): boolean {
    const bucket = failures.get(key)
    if (!bucket) return false
    if (bucket.resetAt <= now) {
      failures.delete(key)
      return false
    }
    return bucket.count >= limit.attempts
  }

  function recordFailure(key: string, now: number): void {
    // A sweep now and then keeps a flood of distinct addresses from growing
    // the map without bound between the lazy expiries.
    if (failures.size > 1000) {
      for (const [other, bucket] of failures) if (bucket.resetAt <= now) failures.delete(other)
    }
    const bucket = failures.get(key)
    if (!bucket || bucket.resetAt <= now) failures.set(key, { count: 1, resetAt: now + limit.windowMs })
    else bucket.count += 1
  }

  /* -------------------------------------------------------------- routes */

  // A real hash to verify unknown emails against, so the time a failed login
  // takes does not say whether the address exists.
  let dummyHash: Promise<string> | null = null
  const dummy = () => (dummyHash ??= hashPassword(`vedit-dummy-${Math.random()}`))

  async function login(request: Request): Promise<Response> {
    const body = await readJson(request)
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
      return json({ error: 'Send { email, password }' }, 400)
    }
    const email = normaliseEmail(body.email)
    const now = Date.now()
    const bucket = bucketFor(request, email)
    if (limited(bucket, now)) return json({ error: 'Too many attempts' }, 429)

    const record = await findByEmail(email)
    const user = isUserRecord(record) ? record : null
    // Verify either way: the unknown-email path costs the same as a wrong password.
    const ok = await verifyPassword(body.password, user ? user.passwordHash : await dummy())
    if (!user || !ok) {
      recordFailure(bucket, now)
      return json({ error: 'Wrong email or password' }, 401)
    }
    failures.delete(bucket)

    const token = await signToken({ sub: user.id, role: user.role, exp: now + ttlMs, iat: now, v: 1 }, secret)
    return json({ user: publicUser(user), token }, 200, {
      'set-cookie': serializeCookie(token, Math.max(0, Math.floor(ttlMs / 1000)), isSecure(request)),
    })
  }

  function isSecure(request: Request): boolean {
    if (cookie.secure === 'auto') return new URL(request.url).protocol === 'https:'
    return cookie.secure
  }

  function serializeCookie(value: string, maxAge: number, secure: boolean): string {
    const parts = [`${cookie.name}=${value}`, 'HttpOnly', 'SameSite=Lax', `Path=${cookie.path}`, `Max-Age=${maxAge}`]
    if (secure) parts.push('Secure')
    return parts.join('; ')
  }

  async function handle(request: Request): Promise<Response | null> {
    const segments = segmentsAfterVersion(new URL(request.url).pathname)
    if (!segments || segments[0] !== 'auth') return null
    if (segments.length !== 2) return json({ error: `No such route: /v1/${segments.join('/')}` }, 404)
    const route = segments[1]
    const method = request.method.toUpperCase()
    await ensureBootstrap()

    if (route === 'login') {
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      return login(request)
    }
    if (route === 'logout') {
      if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      const { refused } = await resolve(request)
      if (refused) return json({ error: 'Cross-site request refused' }, 403)
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'no-store', 'set-cookie': serializeCookie('', 0, isSecure(request)) },
      })
    }
    if (route === 'me') {
      if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      const { user } = await resolve(request)
      return user ? json({ user }) : json({ error: 'Not signed in' }, 401)
    }
    return json({ error: `No such route: /v1/auth/${route}` }, 404)
  }

  return { session, authorize, handle, createUser, setPassword, users: usersCollection }
}

/* ------------------------------------------------------------- requests */

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return null
}

function readBearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header && /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/**
 * The address a login attempt is counted against. Cloudflare's header is
 * set by the edge and cannot be forged from outside; `X-Forwarded-For` is
 * trusted as far as the first hop, which is only honest behind a proxy that
 * rewrites it. The email half of the bucket key still holds either way.
 */
function clientAddress(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0].trim()
  return first || 'local'
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    // Not JSON, or no body at all: the caller answers 400 either way.
    return null
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}
