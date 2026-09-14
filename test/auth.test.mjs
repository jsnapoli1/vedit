import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  USERS_SOURCE,
  cookieSessionAllowed,
  createAuth,
  hashPassword,
  publicUser,
  signToken,
  usersCollection,
  verifyPassword,
  verifyToken,
} from '../dist/auth.js'

const SECRET = 'a-secret-long-enough-for-hmac'

/**
 * The smallest VeditContentStore that can hold users: a Map per source, ids
 * handed out for creates, `where` matched by equality. Stages are ignored —
 * `_users` has no drafts, so there is nothing to tell apart.
 */
function fakeStore() {
  const sources = new Map()
  let next = 1
  const rows = (source) => {
    if (!sources.has(source)) sources.set(source, new Map())
    return sources.get(source)
  }
  return {
    async init() {},
    sources: () => ({ collections: { [USERS_SOURCE]: usersCollection }, globals: {} }),
    async list(source, query = {}) {
      const where = query.where ?? {}
      return [...rows(source).values()].filter((row) =>
        Object.entries(where).every(([field, value]) => row[field] === value),
      )
    },
    async get(source, id) {
      return rows(source).get(id) ?? null
    },
    async commit(changes) {
      const idMap = {}
      for (const [source, change] of Object.entries(changes)) {
        const table = rows(source)
        for (const record of change.create ?? []) {
          const id = `u${next++}`
          if (record.id) idMap[record.id] = id
          table.set(id, { ...record, id })
        }
        for (const [id, patch] of Object.entries(change.update ?? {})) {
          table.set(id, { ...table.get(id), ...patch })
        }
        for (const id of change.delete ?? []) table.delete(id)
      }
      return { idMap, updatedAt: new Date().toISOString() }
    },
    async publish() {},
    async versions() {
      return []
    },
    async restoreVersion() {},
  }
}

const BOOTSTRAP = { email: 'sam@example.com', password: 'correct horse', name: 'Sam' }

function setup(options = {}) {
  const store = fakeStore()
  const auth = createAuth({ store, secret: SECRET, bootstrap: BOOTSTRAP, ...options })
  return { store, auth }
}

const post = (path, body, headers = {}) =>
  new Request(`http://localhost/vedit/v1/auth/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })

const get = (path, headers = {}) => new Request(`http://localhost/vedit/v1/auth/${path}`, { headers })

async function login(auth, email = BOOTSTRAP.email, password = BOOTSTRAP.password) {
  const res = await auth.handle(post('login', { email, password }))
  return { res, body: res.status === 204 ? null : await res.json() }
}

const cookieHeader = (res) => res.headers.get('set-cookie')
const cookieOf = (res) => cookieHeader(res).split(';')[0]

test('hashPassword produces a pbkdf2 string that verifyPassword accepts and a wrong password fails', async () => {
  const stored = await hashPassword('hunter22')
  assert.match(stored, /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
  assert.equal(await verifyPassword('hunter22', stored), true)
  assert.equal(await verifyPassword('hunter23', stored), false)
  // Two hashes of the same password differ: the salt is random.
  assert.notEqual(await hashPassword('hunter22'), stored)
  // Garbage never throws, it is simply not a match.
  assert.equal(await verifyPassword('hunter22', 'not a hash'), false)
  assert.equal(await verifyPassword('hunter22', 'pbkdf2-sha256$abc$!!$!!'), false)
  assert.equal(await verifyPassword('hunter22', ''), false)
})

test('the bootstrap user is created on the first request when no users exist', async () => {
  const { store, auth } = setup()
  assert.deepEqual(await store.list(USERS_SOURCE), [])
  const [first, second] = await Promise.all([
    auth.session(new Request('http://localhost/')),
    auth.session(new Request('http://localhost/')),
  ])
  assert.equal(first, null)
  assert.equal(second, null)
  const users = await store.list(USERS_SOURCE)
  // Two concurrent first requests still make one user.
  assert.equal(users.length, 1)
  assert.equal(users[0].email, BOOTSTRAP.email)
  assert.equal(users[0].role, 'admin')
  assert.equal(users[0].name, 'Sam')
  assert.match(users[0].passwordHash, /^pbkdf2-sha256\$/)
  assert.equal('password' in users[0], false)

  // A store that already has a user is left alone.
  const again = createAuth({ store, secret: SECRET, bootstrap: { ...BOOTSTRAP, email: 'other@example.com' } })
  await again.session(new Request('http://localhost/'))
  assert.equal((await store.list(USERS_SOURCE)).length, 1)
})

test('login with the right password sets an HttpOnly cookie and returns the user and a token', async () => {
  const { auth } = setup()
  const { res, body } = await login(auth)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(body.user.email, BOOTSTRAP.email)
  assert.equal(body.user.role, 'admin')
  assert.equal(body.user.name, 'Sam')
  assert.equal(typeof body.user.id, 'string')
  assert.equal('passwordHash' in body.user, false)
  assert.equal(typeof body.token, 'string')
  const cookie = cookieHeader(res)
  assert.ok(cookie.startsWith(`vedit_session=${body.token};`), cookie)
  assert.match(cookie, /; HttpOnly/)
  assert.match(cookie, /; SameSite=Lax/)
  assert.match(cookie, /; Path=\//)
  assert.match(cookie, /; Max-Age=604800/)
  assert.doesNotMatch(cookie, /Secure/)
  const payload = await verifyToken(body.token, SECRET)
  assert.equal(payload.sub, body.user.id)
  assert.equal(payload.role, 'admin')
  assert.equal(payload.v, 1)
})

test('login with the wrong password is 401', async () => {
  const { auth } = setup()
  const wrong = await login(auth, BOOTSTRAP.email, 'incorrect horse')
  assert.equal(wrong.res.status, 401)
  assert.deepEqual(wrong.body, { error: 'Wrong email or password' })
  assert.equal(cookieHeader(wrong.res), null)
  // An unknown email gets the same answer, so the response never says who exists.
  const unknown = await login(auth, 'nobody@example.com', 'incorrect horse')
  assert.equal(unknown.res.status, 401)
  assert.deepEqual(unknown.body, { error: 'Wrong email or password' })
  // A body that is not JSON is a 400, not a crash.
  const malformed = await auth.handle(
    new Request('http://localhost/vedit/v1/auth/login', { method: 'POST', body: 'nope' }),
  )
  assert.equal(malformed.status, 400)
})

test('the eleventh failed attempt in the window is 429', async () => {
  const { auth } = setup()
  for (let i = 0; i < 10; i++) {
    const { res } = await login(auth, BOOTSTRAP.email, 'incorrect horse')
    assert.equal(res.status, 401, `attempt ${i + 1}`)
  }
  const limited = await login(auth, BOOTSTRAP.email, BOOTSTRAP.password)
  assert.equal(limited.res.status, 429)
  assert.deepEqual(limited.body, { error: 'Too many attempts' })
  // The bucket is per address and email: another address is not locked out.
  const elsewhere = await auth.handle(
    post('login', { email: BOOTSTRAP.email, password: BOOTSTRAP.password }, { 'cf-connecting-ip': '203.0.113.9' }),
  )
  assert.equal(elsewhere.status, 200)
  // A smaller limit shows a success clearing the count.
  const small = setup({ loginLimit: { attempts: 2, windowMs: 60_000 } })
  await login(small.auth, BOOTSTRAP.email, 'wrong')
  assert.equal((await login(small.auth)).res.status, 200)
  await login(small.auth, BOOTSTRAP.email, 'wrong')
  assert.equal((await login(small.auth, BOOTSTRAP.email, 'wrong')).res.status, 401)
  assert.equal((await login(small.auth)).res.status, 429)
})

test('a cookie session resolves the user and a tampered token does not', async () => {
  const { auth } = setup()
  const { res, body } = await login(auth)
  const user = await auth.session(new Request('http://localhost/page', { headers: { cookie: cookieOf(res) } }))
  assert.equal(user.email, BOOTSTRAP.email)
  assert.equal('passwordHash' in user, false)
  // Other cookies around ours do not get in the way.
  const crowded = await auth.session(
    new Request('http://localhost/page', { headers: { cookie: `theme=dark; ${cookieOf(res)}; lang=en` } }),
  )
  assert.equal(crowded.email, BOOTSTRAP.email)

  const [payload, signature] = body.token.split('.')
  const flipped = signature.endsWith('A') ? 'B' : 'A'
  const tampered = `${payload}.${signature.slice(0, -1)}${flipped}`
  assert.equal(await auth.session(new Request('http://localhost/page', { headers: { cookie: `vedit_session=${tampered}` } })), null)
  assert.equal(await verifyToken(tampered, SECRET), null)
  // A payload edit without re-signing fails too, even one that keeps the JSON valid.
  const forged = await signToken({ sub: 'u1', role: 'admin', exp: Date.now() + 60_000, iat: Date.now(), v: 1 }, 'another-secret-of-length')
  assert.equal(await verifyToken(forged, SECRET), null)
  assert.equal(await verifyToken('', SECRET), null)
  assert.equal(await verifyToken('a.b.c', SECRET), null)
  assert.equal(await auth.session(new Request('http://localhost/page')), null)
})

test('a bearer token works without a cookie', async () => {
  const { auth } = setup()
  const { body } = await login(auth)
  const user = await auth.session(
    new Request('http://localhost/page', { headers: { authorization: `Bearer ${body.token}` } }),
  )
  assert.equal(user.email, BOOTSTRAP.email)
  assert.equal(await auth.authorize(new Request('http://localhost/page', { method: 'POST', headers: { authorization: `Bearer ${body.token}` } }), { action: 'write' }), true)
  assert.equal(await auth.session(new Request('http://localhost/page', { headers: { authorization: 'Basic abc' } })), null)
})

test('an expired token is refused', async () => {
  const { auth } = setup()
  const { body } = await login(auth)
  const expired = await signToken({ sub: body.user.id, role: 'admin', exp: Date.now() - 1000, iat: Date.now() - 2000, v: 1 }, SECRET)
  assert.equal(await verifyToken(expired, SECRET), null)
  assert.equal(await auth.session(new Request('http://localhost/page', { headers: { authorization: `Bearer ${expired}` } })), null)
  // The clock is a parameter, so the same token is fine a second before it expires.
  assert.equal((await verifyToken(expired, SECRET, Date.now() - 1500)).sub, body.user.id)
  // A version we do not know is refused as well.
  const future = await signToken({ sub: body.user.id, role: 'admin', exp: Date.now() + 1000, iat: Date.now(), v: 2 }, SECRET)
  assert.equal(await verifyToken(future, SECRET), null)

  const short = setup({ sessionTtlMs: -1000 })
  const stale = await login(short.auth)
  assert.equal(stale.res.status, 200)
  assert.equal(await short.auth.session(new Request('http://localhost/page', { headers: { cookie: cookieOf(stale.res) } })), null)

  // A deleted user's token stops working even before it expires.
  const { store, auth: other } = setup()
  const live = await login(other)
  await store.commit({ [USERS_SOURCE]: { delete: [live.body.user.id] } }, { stage: 'published' })
  assert.equal(await other.session(new Request('http://localhost/page', { headers: { cookie: cookieOf(live.res) } })), null)
})

test('a cookie-authenticated POST from another site is 403', async () => {
  const { auth } = setup()
  const { res, body } = await login(auth)
  const cookie = cookieOf(res)
  const crossSite = { cookie, 'sec-fetch-site': 'cross-site' }
  const refused = await auth.handle(post('logout', {}, crossSite))
  assert.equal(refused.status, 403)
  assert.deepEqual(await refused.json(), { error: 'Cross-site request refused' })
  assert.equal(await auth.authorize(post('logout', {}, crossSite), { action: 'write' }), false)
  assert.equal(await auth.session(post('logout', {}, crossSite)), null)
  // Reads are fine cross-site: the cookie cannot make one do anything.
  assert.equal((await auth.session(get('me', crossSite))).email, BOOTSTRAP.email)

  // A bearer token is something only our own script can attach, so it passes.
  const bearer = { authorization: `Bearer ${body.token}`, 'sec-fetch-site': 'cross-site' }
  assert.equal(await auth.authorize(post('logout', {}, bearer), { action: 'write' }), true)
  assert.equal((await auth.handle(post('logout', {}, bearer))).status, 204)

  // The rule itself, for the content handler to reuse.
  const unsafe = (headers) => new Request('http://localhost/vedit/v1/x', { method: 'POST', headers })
  assert.equal(cookieSessionAllowed(unsafe({ 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(cookieSessionAllowed(unsafe({ 'sec-fetch-site': 'same-site' })), true)
  assert.equal(cookieSessionAllowed(unsafe({ 'sec-fetch-site': 'none' })), true)
  assert.equal(cookieSessionAllowed(unsafe({ 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(cookieSessionAllowed(unsafe({ origin: 'http://localhost' })), true)
  assert.equal(cookieSessionAllowed(unsafe({ origin: 'http://evil.example' })), false)
  assert.equal(cookieSessionAllowed(unsafe({ origin: 'null' })), false)
  // Sec-Fetch-Site wins over Origin when both are there.
  assert.equal(cookieSessionAllowed(unsafe({ origin: 'http://localhost', 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(cookieSessionAllowed(unsafe({})), true)
  assert.equal(cookieSessionAllowed(new Request('http://localhost/vedit/v1/x', { headers: { 'sec-fetch-site': 'cross-site' } })), true)
})

test('logout clears the cookie', async () => {
  const { auth } = setup()
  const { res } = await login(auth)
  const out = await auth.handle(post('logout', {}, { cookie: cookieOf(res) }))
  assert.equal(out.status, 204)
  const cookie = cookieHeader(out)
  assert.match(cookie, /^vedit_session=;/)
  assert.match(cookie, /; Max-Age=0/)
  assert.match(cookie, /; HttpOnly/)
  assert.match(cookie, /; Path=\//)
  // Logging out without a session is not an error either.
  assert.equal((await auth.handle(post('logout', {}))).status, 204)
})

test('authorize maps roles onto actions', async () => {
  const { auth } = setup()
  const admin = (await login(auth)).body.token
  const author = await auth.createUser({ email: 'ann@example.com', password: 'pw-for-ann', role: 'author' })
  const editor = await auth.createUser({ email: 'ed@example.com', password: 'pw-for-ed', name: 'Ed', role: 'editor' })
  assert.equal(typeof author.id, 'string')
  assert.equal('passwordHash' in author, false)
  assert.equal(editor.name, 'Ed')
  const authorToken = (await login(auth, 'ann@example.com', 'pw-for-ann')).body.token
  const editorToken = (await login(auth, 'ed@example.com', 'pw-for-ed')).body.token

  const as = (token) => new Request('http://localhost/vedit/v1/content/commit', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
  const can = (token, ctx) => auth.authorize(as(token), ctx)

  assert.equal(await can(authorToken, { action: 'read' }), true)
  assert.equal(await can(authorToken, { action: 'write' }), true)
  assert.equal(await can(authorToken, { action: 'upload' }), true)
  assert.equal(await can(authorToken, { action: 'data:write' }), true)
  assert.equal(await can(authorToken, { action: 'publish' }), false)
  assert.equal(await can(authorToken, { action: 'data:delete' }), false)

  assert.equal(await can(editorToken, { action: 'publish' }), true)
  assert.equal(await can(editorToken, { action: 'data:delete' }), true)

  assert.equal(await can(authorToken, { action: 'read', source: USERS_SOURCE }), false)
  assert.equal(await can(editorToken, { action: 'data:write', source: USERS_SOURCE }), false)
  assert.equal(await can(admin, { action: 'data:write', source: USERS_SOURCE }), true)
  assert.equal(await can(admin, { action: 'data:delete', source: 'posts' }), true)

  // The single-argument form the document and realtime handlers use means "write".
  assert.equal(await auth.authorize(as(admin)), true)
  assert.equal(await auth.authorize(as(authorToken)), true)
  assert.equal(await auth.authorize(new Request('http://localhost/vedit/v1/content/commit', { method: 'POST' })), false)

  // Emails are unique, whatever the case.
  await assert.rejects(
    () => auth.createUser({ email: 'Ann@Example.com', password: 'again', role: 'author' }),
    (error) => error.status === 409,
  )
  // setPassword replaces the hash and the new password signs in.
  await auth.setPassword(author.id, 'new-pw-for-ann')
  assert.equal((await login(auth, 'ann@example.com', 'pw-for-ann')).res.status, 401)
  assert.equal((await login(auth, 'ann@example.com', 'new-pw-for-ann')).res.status, 200)
  await assert.rejects(() => auth.setPassword('missing', 'x'), (error) => error.status === 404)
})

test('me returns the user without passwordHash', async () => {
  const { auth, store } = setup()
  const { res } = await login(auth)
  const me = await auth.handle(get('me', { cookie: cookieOf(res) }))
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.deepEqual(Object.keys(body), ['user'])
  assert.deepEqual(Object.keys(body.user).sort(), ['email', 'id', 'name', 'role'])
  assert.equal(body.user.email, BOOTSTRAP.email)

  const anonymous = await auth.handle(get('me'))
  assert.equal(anonymous.status, 401)
  assert.deepEqual(await anonymous.json(), { error: 'Not signed in' })

  // Wrong methods and unknown routes are told apart; other paths are not ours.
  assert.equal((await auth.handle(post('me', {}))).status, 405)
  assert.equal((await auth.handle(get('login'))).status, 405)
  assert.equal((await auth.handle(get('nothing'))).status, 404)
  assert.equal(await auth.handle(new Request('http://localhost/vedit/v1/content/posts')), null)
  assert.equal(await auth.handle(new Request('http://localhost/auth/me')), null)

  const [record] = await store.list(USERS_SOURCE)
  assert.deepEqual(publicUser(record), { id: record.id, email: BOOTSTRAP.email, name: 'Sam', role: 'admin' })
  assert.equal(usersCollection.drafts, false)
  assert.equal(usersCollection.access.read, 'admin')
  assert.equal(usersCollection.fields.password.type, 'password')
})

test('the cookie is Secure on https and not on http', async () => {
  const { auth } = setup()
  const secure = await auth.handle(
    new Request('https://example.com/vedit/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: BOOTSTRAP.email, password: BOOTSTRAP.password }),
      headers: { 'content-type': 'application/json' },
    }),
  )
  assert.equal(secure.status, 200)
  assert.match(cookieHeader(secure), /; Secure$/)
  const plain = (await login(auth)).res
  assert.doesNotMatch(cookieHeader(plain), /Secure/)

  const forced = setup({ cookie: { secure: true, name: 'sid', path: '/vedit' } })
  const res = (await login(forced.auth)).res
  assert.match(cookieHeader(res), /^sid=.*; Path=\/vedit; .*Secure$/)
  const user = await forced.auth.session(new Request('http://localhost/vedit', { headers: { cookie: cookieOf(res) } }))
  assert.equal(user.email, BOOTSTRAP.email)
  assert.match(cookieHeader(await forced.auth.handle(post('logout', {}))), /^sid=; .*Path=\/vedit/)

  const off = setup({ cookie: { secure: false } })
  const https = await off.auth.handle(
    new Request('https://example.com/vedit/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: BOOTSTRAP.email, password: BOOTSTRAP.password }),
    }),
  )
  assert.doesNotMatch(cookieHeader(https), /Secure/)

  assert.throws(() => createAuth({ store: fakeStore(), secret: 'short' }), TypeError)
})
