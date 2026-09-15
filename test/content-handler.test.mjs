import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createContentHandler, createUnsafeLocalContentHandler, memoryContentStore } from '../dist/content-server.js'
import { createAuth, usersCollection } from '../dist/auth.js'
import { memoryMediaStore } from '../dist/media.js'

const SECRET = 'a-secret-that-is-long-enough'
const ADMIN = { email: 'sam@example.com', password: 'correct horse', name: 'Sam' }

const collections = {
  posts: {
    fields: { title: { type: 'text', required: true }, body: 'richtext', position: 'number' },
    titleField: 'title',
    orderField: 'position',
  },
  categories: { fields: { name: 'text' } },
  inquiries: {
    fields: { email: { type: 'text', required: true }, message: 'text' },
    drafts: false,
    access: { create: 'public', read: 'admin', update: 'admin', delete: 'admin' },
  },
  // A function rule: only the editor account may change a note, whatever the
  // role table says.
  notes: {
    fields: { text: 'text' },
    access: { update: ({ user }) => user?.email === 'editor@example.com' },
  },
}
const globals = { site: { fields: { name: 'text' } } }
const SEED = {
  posts: [{ id: 'p1', title: 'Hello', position: 0 }],
  notes: [{ id: 'n1', text: 'A note' }],
}

const request = (path, init = {}, token) =>
  new Request(`http://localhost/vedit/v1/${path}`, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
const get = (path, token) => request(path, {}, token)
const post = (path, body, token) => request(path, { method: 'POST', body: JSON.stringify(body) }, token)
const call = async (handle, req) => {
  const res = await handle(req)
  return { res, status: res.status, body: res.status === 204 ? null : await res.json() }
}
const titles = (items) => items.map((item) => item.title).sort()

/**
 * A handler over a memory store with the admin bootstrapped. `as(role)` signs
 * the caller in through the handler's own login route and hands back the
 * bearer token, creating the author and editor accounts on first use.
 */
async function setup({ collections: spec = collections, ...options } = {}) {
  const store = memoryContentStore({ collections: { ...spec, _users: usersCollection }, globals }, { seed: SEED })
  await store.init()
  const auth = createAuth({ store, secret: SECRET, bootstrap: ADMIN })
  const handle = createContentHandler({ collections: spec, globals, store, auth, media: memoryMediaStore(), ...options })
  const tokens = {}
  const signIn = async (email, password) => {
    const { status, body } = await call(handle, post('auth/login', { email, password }))
    assert.equal(status, 200, `login as ${email}`)
    return body.token
  }
  const as = async (role) => {
    if (tokens[role]) return tokens[role]
    if (role === 'admin') return (tokens.admin = await signIn(ADMIN.email, ADMIN.password))
    const email = `${role}@example.com`
    await auth.createUser({ email, password: `pw-for-${role}`, role })
    return (tokens[role] = await signIn(email, `pw-for-${role}`))
  }
  return { store, auth, handle, as }
}

test('createContentHandler refuses to start without auth or authorize', async () => {
  const store = memoryContentStore({ collections })
  assert.throws(() => createContentHandler({ collections, store }), TypeError)
  // With auth, `_users` is the handler's to add; a caller-supplied one is a mistake.
  const auth = createAuth({ store, secret: SECRET })
  assert.throws(() => createContentHandler({ collections: { ...collections, _users: usersCollection }, store, auth }), TypeError)
  assert.equal(typeof createContentHandler({ collections, store, auth }), 'function')
  assert.equal(typeof createContentHandler({ collections, store, authorize: () => true }), 'function')

  // The unsafe handler is everything allowed, as an admin.
  const open = createUnsafeLocalContentHandler({ collections, store })
  const { status, body } = await call(open, get('capabilities'))
  assert.equal(status, 200)
  assert.equal(body.user, null)
  assert.equal(body.login, false)
  assert.deepEqual(body.can, { write: true, publish: true, upload: true, data: { write: true, delete: true } })
})

test('capabilities are public and say who the caller is', async () => {
  const { handle, as } = await setup()
  const anonymous = await call(handle, get('capabilities'))
  assert.equal(anonymous.status, 200)
  assert.deepEqual(anonymous.body, {
    user: null,
    login: true,
    can: { write: false, publish: false, upload: false, data: { write: false, delete: false } },
    sources: ['posts', 'categories', 'inquiries', 'notes', '_users', 'site'],
    api: 1,
  })

  const author = await call(handle, get('capabilities', await as('author')))
  assert.equal(author.body.user.email, 'author@example.com')
  assert.equal(author.body.user.role, 'author')
  assert.equal('passwordHash' in author.body.user, false)
  assert.deepEqual(author.body.can, { write: true, publish: false, upload: true, data: { write: true, delete: false } })

  const editor = await call(handle, get('capabilities', await as('editor')))
  assert.deepEqual(editor.body.can, { write: true, publish: true, upload: true, data: { write: true, delete: true } })

  const admin = await call(handle, get('capabilities', await as('admin')))
  assert.equal(admin.body.user.name, 'Sam')
  assert.deepEqual(admin.body.can, { write: true, publish: true, upload: true, data: { write: true, delete: true } })

  // With `authorize` alone there is no login and a trusted request is an admin.
  const store = memoryContentStore({ collections, globals })
  const keyed = createContentHandler({
    collections,
    globals,
    store,
    authorize: (request) => request.headers.get('x-key') === 'open sesame',
  })
  const trusted = await call(keyed, request('capabilities', { headers: { 'x-key': 'open sesame' } }))
  assert.equal(trusted.body.user, null)
  assert.equal(trusted.body.login, false)
  assert.equal(trusted.body.can.publish, true)
  const stranger = await call(keyed, get('capabilities'))
  assert.equal(stranger.status, 200)
  assert.equal(stranger.body.can.write, false)
})

test('schema describes each source with what the caller may do', async () => {
  const { handle, as } = await setup()
  const anonymous = await call(handle, get('schema'))
  assert.equal(anonymous.status, 200)
  const byName = (body) => Object.fromEntries(body.sources.map((source) => [source.name, source]))
  const visitor = byName(anonymous.body)
  assert.deepEqual(Object.keys(visitor), ['posts', 'categories', 'inquiries', 'notes', '_users', 'site'])
  assert.deepEqual(visitor.posts.fields.map((field) => field.name), ['title', 'body', 'position'])
  assert.equal(visitor.posts.kind, 'collection')
  assert.equal(visitor.site.kind, 'global')
  assert.deepEqual(visitor.posts.can, { read: true, create: false, update: false, delete: false, publish: false })
  assert.deepEqual(visitor.inquiries.can, { read: false, create: true, update: false, delete: false, publish: false })
  assert.deepEqual(visitor._users.can, { read: false, create: false, update: false, delete: false, publish: false })
  assert.equal(visitor.notes.can.update, false)

  const author = byName((await call(handle, get('schema', await as('author')))).body)
  assert.deepEqual(author.posts.can, { read: true, create: true, update: true, delete: true, publish: false })
  assert.equal(author._users.can.read, false)
  // The function rule is run for the caller, not reported as "maybe".
  assert.equal(author.notes.can.update, false)
  const editor = byName((await call(handle, get('schema', await as('editor')))).body)
  assert.equal(editor.notes.can.update, true)
  assert.equal(editor.posts.can.publish, true)
  const admin = byName((await call(handle, get('schema', await as('admin')))).body)
  assert.deepEqual(admin._users.can, { read: true, create: true, update: true, delete: true, publish: true })
})

test('an anonymous read lists published rows only', async () => {
  const { handle, as } = await setup()
  const admin = await as('admin')
  const committed = await call(
    handle,
    post(
      'content/commit',
      { changes: { posts: { create: [{ id: 'new-1', title: 'Draft post' }], update: { p1: { title: 'Changed' } } } }, stage: 'draft' },
      admin,
    ),
  )
  assert.equal(committed.status, 200, JSON.stringify(committed.body))

  const listed = await call(handle, get('content/posts'))
  assert.equal(listed.status, 200)
  assert.deepEqual(titles(listed.body.items), ['Hello'])
  assert.equal(listed.body.items[0]._status, 'changed')

  const one = await call(handle, get('content/posts/p1'))
  assert.equal(one.status, 200)
  assert.equal(one.body.title, 'Hello')
  assert.equal((await call(handle, get('content/posts/missing'))).status, 404)
  assert.deepEqual((await call(handle, get('content/nope'))).body, { error: 'Not found' })

  // The query string is the same one parseRecordQuery reads.
  assert.equal((await call(handle, get('content/posts?where[title]=Hello'))).body.items.length, 1)
  assert.equal((await call(handle, get('content/posts?where[title]=Nope'))).body.items.length, 0)

  // A global is one record called global, there from the first read.
  const site = await call(handle, get('content/site'))
  assert.equal(site.body.items[0].id, 'global')
  assert.equal((await call(handle, get('content/site/global'))).status, 200)
})

test('an author reads drafts and a visitor asking for drafts is refused', async () => {
  const { handle, as } = await setup()
  await call(
    handle,
    post(
      'content/commit',
      { changes: { posts: { create: [{ id: 'new-1', title: 'Draft post' }], update: { p1: { title: 'Changed' } } } }, stage: 'draft' },
      await as('admin'),
    ),
  )
  const author = await as('author')
  const drafts = await call(handle, get('content/posts?stage=draft', author))
  assert.equal(drafts.status, 200)
  assert.deepEqual(titles(drafts.body.items), ['Changed', 'Draft post'])
  assert.equal((await call(handle, get('content/posts/p1?stage=draft', author))).body.title, 'Changed')
  // Without the stage the author sees what visitors see.
  assert.deepEqual(titles((await call(handle, get('content/posts', author))).body.items), ['Hello'])

  const refused = await call(handle, get('content/posts?stage=draft'))
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.body, { error: 'Not allowed' })
  assert.equal((await call(handle, get('content/posts/p1?stage=draft'))).status, 403)

  // Read access still applies on top of the stage rule.
  assert.equal((await call(handle, get('content/_users?stage=draft', author))).status, 403)
  assert.equal((await call(handle, get('content/_users', author))).status, 403)
})

test('commit checks access per source before writing anything', async () => {
  const { handle, store, as } = await setup()
  const author = await as('author')
  const before = (await store.list('posts', {}, 'draft')).length
  const users = (await store.list('_users', {}, 'published')).length

  // posts alone would be fine; `_users` is admin-only, so nothing lands.
  const mixed = await call(
    handle,
    post(
      'content/commit',
      {
        changes: {
          posts: { create: [{ id: 'new-1', title: 'Sneaky' }] },
          _users: { create: [{ id: 'new-2', email: 'x@example.com', role: 'admin', password: 'pw' }] },
        },
        stage: 'draft',
      },
      author,
    ),
  )
  assert.equal(mixed.status, 403)
  assert.deepEqual(mixed.body, { error: 'Not allowed' })
  assert.equal((await store.list('posts', {}, 'draft')).length, before)
  assert.equal((await store.list('_users', {}, 'published')).length, users)

  // A function rule is asked with the caller in hand.
  const note = { changes: { notes: { update: { n1: { text: 'Edited' } } } }, stage: 'draft' }
  assert.equal((await call(handle, post('content/commit', note, author))).status, 403)
  const editor = await as('editor')
  assert.equal((await call(handle, post('content/commit', note, editor))).status, 200)
  assert.equal((await store.get('notes', 'n1', 'draft')).text, 'Edited')

  // An unknown source is refused before anything is written too.
  const unknown = await call(
    handle,
    post('content/commit', { changes: { posts: { create: [{ id: 'new-3', title: 'X' }] }, nope: { delete: ['a'] } }, stage: 'draft' }, editor),
  )
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /nope/)
  assert.equal((await store.list('posts', {}, 'draft')).length, before)

  // Delete is its own action; an author may delete their sources' records, an anonymous caller may not.
  assert.equal((await call(handle, post('content/commit', { changes: { posts: { delete: ['p1'] } }, stage: 'draft' }, author))).status, 200)
})

test('an anonymous commit is 403', async () => {
  const { handle, store } = await setup()
  const body = { changes: { posts: { create: [{ id: 'new-1', title: 'Nope' }] } }, stage: 'draft' }
  const refused = await call(handle, post('content/commit', body))
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.body, { error: 'Not allowed' })
  assert.equal((await store.list('posts', {}, 'draft')).length, 1)
  assert.equal((await call(handle, post('content/operations', { operations: [{ op: 'set-record', source: 'posts', id: 'p1', data: { title: 'X' } }] }))).status, 403)
  assert.equal((await call(handle, post('content/publish', { records: { posts: ['p1'] } }))).status, 403)
  assert.equal((await call(handle, post('content/posts/p1/publish', {}))).status, 403)
})

test('an inquiry source accepts an anonymous create and refuses an anonymous read', async () => {
  const { handle, store, as } = await setup()
  const sent = await call(
    handle,
    post('content/commit', { changes: { inquiries: { create: [{ id: 'new-q', email: 'a@b.test', message: 'Hi' }] } }, stage: 'draft' }),
  )
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  const id = sent.body.idMap['new-q']
  assert.match(id, /^[a-z0-9]{10}$/)
  assert.equal(typeof sent.body.updatedAt, 'string')

  assert.equal((await call(handle, get('content/inquiries'))).status, 403)
  assert.equal((await call(handle, get(`content/inquiries/${id}`))).status, 403)
  assert.equal((await call(handle, post('content/commit', { changes: { inquiries: { update: { [id]: { message: 'Edited' } } } }, stage: 'draft' }))).status, 403)

  // Without drafts the record is live at once, so a "published" commit needs no publish right.
  // A script may leave the id out; the idMap still says which one the server chose.
  const live = await call(
    handle,
    post('content/commit', { changes: { inquiries: { create: [{ email: 'c@d.test' }] } }, stage: 'published' }),
  )
  assert.equal(live.status, 200)
  assert.equal(Object.keys(live.body.idMap).length, 1)
  assert.match(Object.values(live.body.idMap)[0], /^[a-z0-9]{10}$/)

  const admin = await as('admin')
  const seen = await call(handle, get('content/inquiries', admin))
  assert.equal(seen.status, 200)
  assert.deepEqual(seen.body.items.map((item) => item.email).sort(), ['a@b.test', 'c@d.test'])
  assert.equal(seen.body.items[0]._status, 'published')
  assert.equal((await store.get('inquiries', id, 'published')).message, 'Hi')
})

test('commit validates records and names the source and field', async () => {
  const { handle, as } = await setup()
  const admin = await as('admin')
  const missing = await call(
    handle,
    post('content/commit', { changes: { posts: { create: [{ id: 'new-1', position: 'first' }] } }, stage: 'draft' }, admin),
  )
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /posts/)
  assert.match(missing.body.error, /title is required/)
  assert.match(missing.body.error, /position must be a number/)
  assert.equal((await call(handle, get('content/posts?stage=draft', admin))).body.items.length, 1)

  // An update is checked as the record it produces, so a partial patch is fine
  // and clearing a required field is not.
  const blank = await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title: '' } } } }, stage: 'draft' }, admin))
  assert.equal(blank.status, 400)
  assert.equal(blank.body.error, 'posts: title is required')
  const partial = await call(handle, post('content/commit', { changes: { posts: { update: { p1: { position: 2 } } } }, stage: 'draft' }, admin))
  assert.equal(partial.status, 200)

  // Rich text is sanitised on the way in.
  await call(
    handle,
    post('content/commit', { changes: { posts: { update: { p1: { body: '<p>Hi<script>alert(1)</script></p>' } } } }, stage: 'draft' }, admin),
  )
  const stored = (await call(handle, get('content/posts/p1?stage=draft', admin))).body
  assert.equal(stored.body.includes('<script'), false)
  assert.match(stored.body, /Hi/)
  assert.equal(stored.position, 2)

  // Malformed bodies are 400s, not crashes.
  assert.equal((await call(handle, request('content/commit', { method: 'POST', body: 'nope' }, admin))).status, 400)
  assert.equal((await call(handle, post('content/commit', { changes: [] }, admin))).status, 400)
  assert.equal((await call(handle, post('content/commit', { changes: {}, stage: 'later' }, admin))).status, 400)
  assert.equal((await call(handle, post('content/commit', { changes: { posts: { create: [{ id: 'new-2', title: 'ok' }] } } }, admin))).status, 200)
})

test('operations folds then commits', async () => {
  const { handle, as } = await setup()
  const admin = await as('admin')
  const folded = await call(
    handle,
    post(
      'content/operations',
      {
        operations: [
          { op: 'create-record', source: 'categories', id: 'new-c', data: { name: 'News' } },
          { op: 'set-record', source: 'categories', id: 'new-c', data: { name: 'Updates' } },
          { op: 'set-record', source: 'posts', id: 'p1', data: { title: 'Folded' } },
        ],
        stage: 'draft',
      },
      admin,
    ),
  )
  assert.equal(folded.status, 200, JSON.stringify(folded.body))
  const id = folded.body.idMap['new-c']
  assert.match(id, /^[a-z0-9]{10}$/)
  assert.equal(typeof folded.body.updatedAt, 'string')
  assert.equal((await call(handle, get(`content/categories/${id}?stage=draft`, admin))).body.name, 'Updates')
  assert.equal((await call(handle, get('content/posts/p1?stage=draft', admin))).body.title, 'Folded')

  const malformed = await call(
    handle,
    post('content/operations', { operations: [{ op: 'set-record', source: 'posts', id: 'p1', data: { title: 'A' } }, { op: 'explode', source: 'posts' }], stage: 'draft' }, admin),
  )
  assert.equal(malformed.status, 400)
  assert.equal(malformed.body.index, 1)
  assert.match(malformed.body.error, /explode/)
  assert.equal((await call(handle, get('content/posts/p1?stage=draft', admin))).body.title, 'Folded')

  assert.equal((await call(handle, post('content/operations', { operations: 'no' }, admin))).status, 400)
  // The folded changes go through the same access check as a commit.
  const author = await as('author')
  const forbidden = await call(
    handle,
    post('content/operations', { operations: [{ op: 'delete-record', source: '_users', id: 'u1' }], stage: 'draft' }, author),
  )
  assert.equal(forbidden.status, 403)
  // Validation too.
  const invalid = await call(
    handle,
    post('content/operations', { operations: [{ op: 'create-record', source: 'posts', data: { position: 'x' } }], stage: 'draft' }, author),
  )
  assert.equal(invalid.status, 400)
  assert.match(invalid.body.error, /posts: title is required/)
})

test('an author cannot publish and an editor can', async () => {
  const { handle, as } = await setup()
  const author = await as('author')
  const draft = await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title: 'Changed' } } } }, stage: 'draft' }, author))
  assert.equal(draft.status, 200)
  assert.equal((await call(handle, get('content/posts/p1'))).body.title, 'Hello')

  const refused = await call(handle, post('content/publish', { records: { posts: ['p1'] } }, author))
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.body, { error: 'Not allowed' })
  assert.equal((await call(handle, post('content/posts/p1/publish', {}, author))).status, 403)
  // A commit straight to published is a publish as well.
  const direct = await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title: 'Live' } } } }, stage: 'published' }, author))
  assert.equal(direct.status, 403)
  assert.equal((await call(handle, get('content/posts/p1'))).body.title, 'Hello')

  const editor = await as('editor')
  const published = await call(handle, post('content/publish', { records: { posts: ['p1'] } }, editor))
  assert.equal(published.status, 200)
  assert.deepEqual(published.body, { ok: true })
  const visitor = await call(handle, get('content/posts/p1'))
  assert.equal(visitor.body.title, 'Changed')
  assert.equal(visitor.body._status, 'published')

  await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title: 'Again' } } } }, stage: 'draft' }, editor))
  assert.equal((await call(handle, post('content/posts/p1/publish', {}, editor))).status, 200)
  assert.equal((await call(handle, get('content/posts/p1'))).body.title, 'Again')

  const live = await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title: 'Straight' } } } }, stage: 'published' }, editor))
  assert.equal(live.status, 200)
  assert.equal((await call(handle, get('content/posts/p1'))).body.title, 'Straight')

  // A publish names its sources, so an unknown one is a 400 and nothing else is touched.
  assert.equal((await call(handle, post('content/publish', { records: { nope: ['x'] } }, editor))).status, 400)
  assert.equal((await call(handle, post('content/publish', { records: 'x' }, editor))).status, 400)
})

test('a user password is hashed on write and never read back', async () => {
  const { handle, store, as } = await setup()
  const admin = await as('admin')
  const created = await call(
    handle,
    post(
      'content/commit',
      { changes: { _users: { create: [{ id: 'new-u', email: 'new@example.com', role: 'author', password: 'pw-for-new' }] } }, stage: 'draft' },
      admin,
    ),
  )
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const id = created.body.idMap['new-u']
  const row = await store.get('_users', id, 'published')
  assert.match(row.passwordHash, /^pbkdf2-sha256\$/)
  assert.equal('password' in row, false)

  const listed = await call(handle, get('content/_users', admin))
  assert.equal(listed.status, 200)
  assert.equal(listed.body.items.length, 2)
  for (const item of listed.body.items) {
    assert.equal('passwordHash' in item, false)
    assert.equal('password' in item, false)
  }
  const one = await call(handle, get(`content/_users/${id}`, admin))
  assert.equal(one.body.email, 'new@example.com')
  assert.equal('passwordHash' in one.body, false)
  assert.equal((await call(handle, get(`content/_users/${id}?stage=draft`, admin))).body.passwordHash, undefined)

  // The new account signs in through the same handler.
  const login = await call(handle, post('auth/login', { email: 'new@example.com', password: 'pw-for-new' }))
  assert.equal(login.status, 200)

  // A blank password on an update keeps the current hash; a new one replaces it.
  const kept = await call(handle, post('content/commit', { changes: { _users: { update: { [id]: { password: '', name: 'New' } } } }, stage: 'draft' }, admin))
  assert.equal(kept.status, 200)
  const after = await store.get('_users', id, 'published')
  assert.equal(after.passwordHash, row.passwordHash)
  assert.equal(after.name, 'New')
  assert.equal('password' in after, false)
  await call(handle, post('content/commit', { changes: { _users: { update: { [id]: { password: 'changed-pw' } } } }, stage: 'draft' }, admin))
  assert.equal((await call(handle, post('auth/login', { email: 'new@example.com', password: 'pw-for-new' }))).status, 401)
  assert.equal((await call(handle, post('auth/login', { email: 'new@example.com', password: 'changed-pw' }))).status, 200)

  // Only an admin sees the users at all.
  assert.equal((await call(handle, get('content/_users', await as('editor')))).status, 403)
  assert.equal((await call(handle, get(`content/_users/${id}`, await as('author')))).status, 403)
})

test('versions list and restore', async () => {
  const { handle, as } = await setup()
  const admin = await as('admin')
  for (const title of ['One', 'Two']) {
    await call(handle, post('content/commit', { changes: { posts: { update: { p1: { title } } } }, stage: 'draft' }, admin))
  }
  const listed = await call(handle, get('content/posts/p1/versions', admin))
  assert.equal(listed.status, 200)
  assert.equal(listed.body.items.length, 2)
  for (const version of listed.body.items) {
    assert.deepEqual(Object.keys(version).sort(), ['id', 'savedAt', 'stage'])
    assert.equal(version.stage, 'draft')
  }
  // History shows drafts, so it is for people who may see drafts.
  assert.equal((await call(handle, get('content/posts/p1/versions'))).status, 403)
  assert.equal((await call(handle, get('content/posts/p1/versions', await as('author')))).status, 200)

  const oldest = listed.body.items[1]
  const restored = await call(handle, post(`content/posts/p1/versions/${oldest.id}/restore`, {}, admin))
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.body, { ok: true })
  assert.equal((await call(handle, get('content/posts/p1?stage=draft', admin))).body.title, 'One')
  assert.equal((await call(handle, get('content/posts/p1'))).body.title, 'Hello')
  assert.equal((await call(handle, get('content/posts/p1/versions', admin))).body.items.length, 3)

  assert.equal((await call(handle, post('content/posts/p1/versions/nope/restore', {}, admin))).status, 404)
  assert.equal((await call(handle, post(`content/posts/p1/versions/${oldest.id}/restore`, {}))).status, 403)
  // Restoring is an update, which an author may do.
  assert.equal((await call(handle, post(`content/posts/p1/versions/${oldest.id}/restore`, {}, await as('author')))).status, 200)
  assert.equal((await call(handle, get('content/nope/p1/versions', admin))).status, 404)
})

test('afterChange runs after the commit with the stored record', async () => {
  const seen = []
  const perSource = []
  const deleted = []
  let readAtHookTime = null
  const spec = {
    ...collections,
    posts: {
      ...collections.posts,
      hooks: {
        afterChange: async (record, ctx) => {
          perSource.push({ record, ctx })
          readAtHookTime = await store.get('posts', record.id, 'draft')
        },
        afterDelete: (id, ctx) => deleted.push({ id, ctx }),
      },
    },
  }
  const { handle, store, as } = await setup({
    collections: spec,
    hooks: { afterChange: (source, record, ctx) => seen.push({ source, record, ctx }) },
  })
  const admin = await as('admin')
  const committed = await call(
    handle,
    post(
      'content/commit',
      { changes: { posts: { create: [{ id: 'new-1', title: 'Made' }], update: { p1: { title: 'Edited' } } }, categories: { create: [{ id: 'new-2', name: 'C' }] } }, stage: 'draft' },
      admin,
    ),
  )
  assert.equal(committed.status, 200)
  const id = committed.body.idMap['new-1']

  // Both hooks saw the record as the store keeps it, real id included.
  assert.equal(perSource.length, 2)
  const made = perSource.find((call) => call.record.id === id)
  assert.equal(made.record.title, 'Made')
  assert.equal(made.record._status, 'draft')
  assert.equal(typeof made.record._updatedAt, 'string')
  assert.equal(made.ctx.source, 'posts')
  assert.equal(made.ctx.stage, 'draft')
  assert.equal(made.ctx.user.email, ADMIN.email)
  assert.equal('passwordHash' in made.ctx.user, false)
  assert.equal(readAtHookTime.title, 'Edited')

  assert.deepEqual(seen.map((call) => [call.source, call.record.title ?? call.record.name]).sort(), [['categories', 'C'], ['posts', 'Edited'], ['posts', 'Made']])
  assert.equal(seen[0].ctx.user.email, ADMIN.email)

  const removed = await call(handle, post('content/commit', { changes: { posts: { delete: ['p1'] } } , stage: 'draft' }, admin))
  assert.equal(removed.status, 200)
  assert.deepEqual(deleted.map((call) => call.id), ['p1'])
  assert.equal(deleted[0].ctx.stage, 'draft')
  assert.equal(seen.length, 3)

  // A refused commit runs no hook.
  await call(handle, post('content/commit', { changes: { posts: { create: [{ id: 'new-3', title: 'No' }] } }, stage: 'draft' }))
  assert.equal(perSource.length, 2)
})

test('media and auth routes answer under the same prefix and upload needs the upload capability', async () => {
  const { handle, as } = await setup()
  assert.equal((await call(handle, get('auth/me'))).status, 401)
  const login = await call(handle, post('auth/login', { email: ADMIN.email, password: ADMIN.password }))
  assert.equal(login.status, 200)
  assert.match(login.res.headers.get('set-cookie'), /^vedit_session=/)
  const cookie = login.res.headers.get('set-cookie').split(';')[0]
  const me = await call(handle, request('auth/me', { headers: { cookie } }))
  assert.equal(me.status, 200)
  assert.equal(me.body.user.email, ADMIN.email)

  const upload = (token) => {
    const form = new FormData()
    form.append('file', new File(['%PDF-1.4'], 'sheet.pdf', { type: 'application/pdf' }))
    return request('media', { method: 'POST', body: form }, token)
  }
  const refused = await call(handle, upload())
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.body, { error: 'Not allowed' })

  const author = await as('author')
  const uploaded = await call(handle, upload(author))
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body))
  const asset = uploaded.body
  assert.equal(asset.url, `/vedit/v1/media/${asset.id}`)
  assert.equal(asset.kind, 'file')

  // Anyone may read what was uploaded; only an editor may delete it.
  const served = await handle(get(`media/${asset.id}`))
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'application/pdf')
  assert.equal(await served.text(), '%PDF-1.4')
  assert.equal((await call(handle, get('media?kind=file'))).body.items.length, 1)
  assert.equal((await handle(request(`media/${asset.id}`, { method: 'DELETE' }, author))).status, 403)
  assert.equal((await handle(request(`media/${asset.id}`, { method: 'DELETE' }, await as('editor')))).status, 204)
  assert.equal((await handle(get(`media/${asset.id}`))).status, 404)

  // Without a media store or an auth there is nothing at those paths.
  const bare = createContentHandler({ collections, store: memoryContentStore({ collections }), authorize: () => true })
  assert.equal((await call(bare, get('media'))).status, 404)
  assert.equal((await call(bare, get('auth/me'))).status, 404)
})

test('unknown routes are 404 and wrong methods 405', async () => {
  const { handle, as } = await setup()
  const admin = await as('admin')
  const notFound = async (req) => {
    const { status, body } = await call(handle, req)
    assert.equal(status, 404)
    assert.deepEqual(body, { error: 'Not found' })
  }
  await notFound(get('nothing'))
  await notFound(get('content'))
  await notFound(get('content/posts/p1/extra'))
  await notFound(get('content/posts/p1/versions/x/undo'))
  await notFound(new Request('http://localhost/vedit/other'))
  await notFound(new Request('http://localhost/vedit/v1/content/posts/p1/versions/x/restore/more', { method: 'POST' }))

  const notAllowed = async (req, allow) => {
    const res = await handle(req)
    assert.equal(res.status, 405, `${req.method} ${new URL(req.url).pathname}`)
    assert.equal(res.headers.get('allow'), allow)
  }
  await notAllowed(request('capabilities', { method: 'POST' }), 'GET')
  await notAllowed(request('schema', { method: 'DELETE' }, admin), 'GET')
  await notAllowed(get('content/commit', admin), 'POST')
  await notAllowed(get('content/operations', admin), 'POST')
  await notAllowed(get('content/publish', admin), 'POST')
  await notAllowed(request('content/posts', { method: 'PUT' }, admin), 'GET')
  await notAllowed(request('content/posts/p1', { method: 'DELETE' }, admin), 'GET')
  await notAllowed(get('content/posts/p1/publish', admin), 'POST')
  await notAllowed(request('content/posts/p1/versions', { method: 'POST' }, admin), 'GET')
  await notAllowed(get('content/posts/p1/versions/x/restore', admin), 'POST')

  // cors, when asked for, answers preflights and marks every response.
  const store = memoryContentStore({ collections, globals })
  const open = createContentHandler({ collections, globals, store, media: memoryMediaStore(), authorize: () => true, cors: 'https://app.test' })
  const preflight = await open(request('content/commit', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.test')
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/)
  assert.equal((await open(get('capabilities'))).headers.get('access-control-allow-origin'), 'https://app.test')
  assert.equal((await open(get('media'))).headers.get('access-control-allow-origin'), 'https://app.test')
  assert.equal((await handle(get('capabilities'))).headers.get('access-control-allow-origin'), null)
})
