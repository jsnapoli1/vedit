import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STORE_SCHEMA_VERSION,
  contentClientFromStore,
  contentStore,
  memoryContentStore,
  memoryRowStore,
  nodeSqliteDriver,
  postgresDriver,
  sqlContentStore,
} from '../dist/content-server.js'

const sqlite = await import('node:sqlite').catch(() => null)
const sqliteSkip = sqlite ? false : 'node:sqlite unavailable'

const spec = {
  collections: {
    posts: {
      fields: {
        title: { type: 'text', required: true },
        position: 'number',
        category: { type: 'relation', to: 'categories' },
        tags: { type: 'relation', to: 'categories', many: true },
      },
      titleField: 'title',
      orderField: 'position',
      versions: 3,
    },
    categories: { fields: { name: 'text' } },
    inquiries: { fields: { email: 'text' }, drafts: false },
  },
  globals: {
    site: { fields: { name: { type: 'text', default: 'Untitled' }, tagline: 'text' } },
  },
}

const SERVER_ID = /^[a-z0-9]{10}$/
const ids = (records) => records.map((record) => record.id)
const titles = (records) => records.map((record) => record.title)
const byId = (records, id) => records.find((record) => record.id === id)

/**
 * Each factory hands back a store plus two probes the shared cases lean on: how
 * many rows the underlying table holds, and how the last reads were served
 * (point lookups by id versus full scans of a source). `failAtPut` makes the
 * Nth record write blow up inside the batch, after the earlier ones ran, which
 * is the only honest way to check that a batch is atomic.
 */
async function memory(seed, { failAtPut } = {}) {
  const rows = memoryRowStore()
  const reads = { point: 0, scan: 0 }
  const select = rows.select
  const selectOne = rows.selectOne
  rows.select = (...args) => {
    reads.scan += 1
    return select(...args)
  }
  rows.selectOne = (...args) => {
    reads.point += 1
    return selectOne(...args)
  }
  if (failAtPut) {
    const batch = rows.batch
    let puts = 0
    rows.batch = (ops) =>
      batch(
        ops.map((op) => {
          if (op.kind !== 'put' || ++puts !== failAtPut) return op
          return {
            kind: 'put',
            get row() {
              throw new Error('disk full')
            },
          }
        }),
      )
  }
  const store = contentStore(rows, spec)
  await store.init()
  const stamp = new Date().toISOString()
  await rows.batch(
    Object.entries(seed).flatMap(([source, records]) =>
      records.map((record) => ({
        kind: 'put',
        row: { source, id: record.id, stage: 'published', data: JSON.stringify(record), updated_at: stamp },
      })),
    ),
  )
  return {
    store,
    reads,
    async rowCount() {
      let count = 0
      for (const source of [...Object.keys(spec.collections), ...Object.keys(spec.globals)]) {
        count += (await select(source, 'draft')).length + (await select(source, 'published')).length
      }
      return count
    },
  }
}

async function nodeSqlite(seed, { failAtPut } = {}) {
  const db = new sqlite.DatabaseSync(':memory:')
  const inner = nodeSqliteDriver(db)
  const reads = { point: 0, scan: 0 }
  let puts = 0
  const driver = {
    query(sql, params) {
      if (/FROM vedit_records WHERE/.test(sql)) reads[/\bid = \?/.test(sql) ? 'point' : 'scan'] += 1
      return inner.query(sql, params)
    },
    batch(statements) {
      return inner.batch(
        statements.map((statement) => {
          if (!failAtPut || !/^INSERT INTO vedit_records/.test(statement.sql) || ++puts !== failAtPut) return statement
          return { ...statement, sql: 'INSERT INTO vedit_nowhere VALUES (1)' }
        }),
      )
    },
  }
  const store = sqlContentStore(driver, { dialect: 'sqlite', collections: spec.collections, globals: spec.globals })
  await store.init()
  const stamp = new Date().toISOString()
  const insert = db.prepare('INSERT INTO vedit_records (source, id, stage, data, updated_at) VALUES (?, ?, ?, ?, ?)')
  for (const [source, records] of Object.entries(seed)) {
    for (const record of records) insert.run(source, record.id, 'published', JSON.stringify(record), stamp)
  }
  return {
    store,
    reads,
    async rowCount() {
      return db.prepare('SELECT count(*) AS n FROM vedit_records').all()[0].n
    },
  }
}

const factories = [
  ['memory', memory, false],
  ['sqlite', nodeSqlite, sqliteSkip],
]

for (const [name, make, skip] of factories) {
  const shared = (title, run) => test(`[${name}] ${title}`, { skip }, run)

  shared('commit creates, updates and deletes across two sources in one call and returns an idMap', async () => {
    const { store } = await make({
      posts: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      categories: [{ id: 'c1', name: 'One' }],
    })
    const result = await store.commit(
      {
        posts: {
          create: [{ id: 'new-1', title: 'N' }, { title: 'Anon' }],
          update: { a: { title: 'A2' } },
          delete: ['b'],
        },
        categories: { create: [{ id: 'new-2', name: 'Fresh' }] },
      },
      { stage: 'published' },
    )
    assert.match(result.idMap['new-1'], SERVER_ID)
    assert.match(result.idMap['new-2'], SERVER_ID)
    assert.deepEqual(Object.keys(result.idMap).sort(), ['new-1', 'new-2'])
    assert.ok(!Number.isNaN(Date.parse(result.updatedAt)))

    const posts = await store.list('posts')
    assert.deepEqual(titles(posts).sort(), ['A2', 'Anon', 'N'])
    assert.equal(byId(posts, 'b'), undefined)
    assert.equal(byId(posts, result.idMap['new-1']).title, 'N')
    for (const post of posts) {
      assert.match(post.id, /^(a|[a-z0-9]{10})$/)
      assert.equal(post._updatedAt, result.updatedAt)
      assert.equal(post._status, 'published')
    }
    const categories = await store.list('categories')
    assert.deepEqual(ids(categories).sort(), ['c1', result.idMap['new-2']].sort())

    await assert.rejects(store.commit({ nope: { create: [{ id: 'x' }] } }, { stage: 'published' }), /Unknown source "nope"/)
    await assert.rejects(store.list('nope'), /Unknown source "nope"/)
  })

  shared('a commit that fails part way leaves nothing behind', async () => {
    const { store, rowCount } = await make({ posts: [{ id: 'a', title: 'A' }] }, { failAtPut: 2 })
    const before = await rowCount()
    await assert.rejects(
      store.commit(
        {
          posts: {
            create: [
              { id: 'new-1', title: 'X' },
              { id: 'new-2', title: 'Y' },
            ],
            update: { a: { title: 'A2' } },
          },
        },
        { stage: 'published' },
      ),
    )
    assert.equal(await rowCount(), before)
    assert.deepEqual(titles(await store.list('posts', {}, 'draft')), ['A'])
    assert.deepEqual(titles(await store.list('posts')), ['A'])
    assert.deepEqual(await store.versions('posts', 'a'), [])
  })

  shared('a draft commit is invisible to visitors until published', async () => {
    const { store } = await make({ posts: [{ id: 'a', title: 'A' }] })
    const { idMap } = await store.commit(
      { posts: { update: { a: { title: 'A2' } }, create: [{ id: 'new-1', title: 'N' }] } },
      { stage: 'draft' },
    )
    assert.deepEqual(titles(await store.list('posts')), ['A'])
    assert.deepEqual(titles(await store.list('posts', {}, 'published')), ['A'])
    assert.deepEqual(titles(await store.list('posts', {}, 'draft')).sort(), ['A2', 'N'])
    assert.equal((await store.get('posts', 'a')).title, 'A')
    assert.equal((await store.get('posts', 'a', 'draft')).title, 'A2')
    assert.equal(await store.get('posts', idMap['new-1']), null)
    assert.equal((await store.get('posts', idMap['new-1'], 'draft')).title, 'N')

    await store.publish({ posts: ['a', idMap['new-1']] })
    assert.deepEqual(titles(await store.list('posts')).sort(), ['A2', 'N'])
    assert.deepEqual(titles(await store.list('posts', {}, 'draft')).sort(), ['A2', 'N'])
  })

  shared('publishing copies the draft over the live copy and a draft delete removes the record', async () => {
    const { store } = await make({
      posts: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    })
    await store.commit({ posts: { delete: ['a'], update: { b: { title: 'B2' } } } }, { stage: 'draft' })
    assert.deepEqual(titles(await store.list('posts', {}, 'draft')), ['B2'])
    assert.deepEqual(titles(await store.list('posts')).sort(), ['A', 'B'])
    assert.equal(await store.get('posts', 'a', 'draft'), null)
    assert.equal((await store.get('posts', 'a')).title, 'A')

    await store.publish({ posts: ['a', 'b'] })
    assert.deepEqual(titles(await store.list('posts')), ['B2'])
    assert.deepEqual(titles(await store.list('posts', {}, 'draft')), ['B2'])
    assert.equal(await store.get('posts', 'a'), null)
    assert.equal(await store.get('posts', 'a', 'draft'), null)
    assert.equal((await store.get('posts', 'b'))._status, 'published')

    // Publishing something that has no draft is a no-op, not an error.
    await store.publish({ posts: ['b', 'missing'] })
    assert.deepEqual(titles(await store.list('posts')), ['B2'])
  })

  shared('_status says draft, changed or published', async () => {
    const { store } = await make({ posts: [{ id: 'a', title: 'A' }, { id: 'c', title: 'C' }] })
    assert.equal((await store.get('posts', 'a', 'draft'))._status, 'published')
    const { idMap } = await store.commit(
      { posts: { create: [{ id: 'new-1', title: 'N' }], update: { a: { title: 'A2' } } } },
      { stage: 'draft' },
    )
    const drafts = await store.list('posts', {}, 'draft')
    assert.equal(byId(drafts, 'a')._status, 'changed')
    assert.equal(byId(drafts, idMap['new-1'])._status, 'draft')
    assert.equal(byId(drafts, 'c')._status, 'published')
    // The live copy knows a draft is waiting too.
    assert.equal((await store.get('posts', 'a'))._status, 'changed')

    await store.publish({ posts: ['a', idMap['new-1']] })
    for (const post of await store.list('posts', {}, 'draft')) assert.equal(post._status, 'published')

    // A commit straight to published is published at once.
    await store.commit({ posts: { update: { c: { title: 'C2' } } } }, { stage: 'published' })
    assert.equal((await store.get('posts', 'c', 'draft'))._status, 'published')
    assert.equal((await store.get('posts', 'c'))._status, 'published')
  })

  shared('versions are kept per record and trimmed to the collection limit', async () => {
    const { store } = await make({ posts: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] })
    for (let i = 1; i <= 5; i += 1) {
      await store.commit({ posts: { update: { a: { title: `v${i}` } } } }, { stage: 'draft' })
    }
    await store.commit({ posts: { update: { b: { title: 'B2' } } } }, { stage: 'published' })

    const versions = await store.versions('posts', 'a')
    assert.equal(versions.length, 3, 'posts keeps three')
    for (const version of versions) {
      assert.equal(typeof version.id, 'string')
      assert.ok(!Number.isNaN(Date.parse(version.savedAt)))
      assert.equal(version.stage, 'draft')
    }
    assert.ok(versions[0].savedAt > versions[1].savedAt && versions[1].savedAt > versions[2].savedAt, 'newest first')
    assert.ok(new Set(versions.map((version) => version.id)).size === 3, 'ids are distinct')

    const other = await store.versions('posts', 'b')
    assert.equal(other.length, 1)
    assert.equal(other[0].stage, 'published')
    assert.deepEqual(await store.versions('posts', 'nobody'), [])
  })

  shared('restoring a version puts it back as the draft', async () => {
    const { store } = await make({ posts: [{ id: 'a', title: 'A' }], inquiries: [{ id: 'q', email: 'one' }] })
    await store.commit({ posts: { update: { a: { title: 'A1' } } } }, { stage: 'published' })
    await store.commit({ posts: { update: { a: { title: 'A2' } } } }, { stage: 'published' })
    const versions = await store.versions('posts', 'a')
    assert.equal(versions.length, 2)

    await store.restoreVersion('posts', 'a', versions[1].id)
    assert.equal((await store.get('posts', 'a', 'draft')).title, 'A1')
    assert.equal((await store.get('posts', 'a')).title, 'A2', 'the live copy waits for a publish')
    assert.equal((await store.get('posts', 'a', 'draft'))._status, 'changed')
    const after = await store.versions('posts', 'a')
    assert.equal(after.length, 3, 'the restore is a version of its own')
    assert.equal(after[0].stage, 'draft')

    await assert.rejects(store.restoreVersion('posts', 'a', 'nope'), /version/i)

    // Without drafts there is nowhere else for it to go.
    await store.commit({ inquiries: { update: { q: { email: 'two' } } } }, { stage: 'draft' })
    await store.commit({ inquiries: { update: { q: { email: 'three' } } } }, { stage: 'draft' })
    const inquiries = await store.versions('inquiries', 'q')
    await store.restoreVersion('inquiries', 'q', inquiries[1].id)
    assert.equal((await store.get('inquiries', 'q')).email, 'two')
  })

  shared('a global is one record called global, created empty on first read', async () => {
    const { store } = await make({})
    const site = await store.get('site', 'global')
    assert.equal(site.id, 'global')
    assert.equal(site.name, 'Untitled', 'field defaults fill the empty record')
    assert.equal(site.tagline, undefined)
    assert.equal(site._status, 'published')
    assert.equal(typeof site._updatedAt, 'string')
    assert.deepEqual(ids(await store.list('site')), ['global'])
    assert.deepEqual(ids(await store.list('site', {}, 'draft')), ['global'])

    await store.commit({ site: { update: { global: { tagline: 'Hello' } } } }, { stage: 'draft' })
    assert.equal((await store.get('site', 'global', 'draft')).tagline, 'Hello')
    assert.equal((await store.get('site', 'global', 'draft')).name, 'Untitled')
    assert.equal((await store.get('site', 'global')).tagline, undefined)
    await store.publish({ site: ['global'] })
    assert.equal((await store.get('site', 'global')).tagline, 'Hello')

    // A global that was never read still takes a write.
    const { store: fresh } = await make({})
    await fresh.commit({ site: { update: { global: { tagline: 'First' } } } }, { stage: 'published' })
    assert.equal((await fresh.get('site', 'global')).tagline, 'First')
    assert.equal((await fresh.get('site', 'global')).name, 'Untitled')
  })

  shared('reorder writes the order field', async () => {
    const { store } = await make({
      posts: [
        { id: 'a', title: 'A', position: 0 },
        { id: 'b', title: 'B', position: 1 },
        { id: 'c', title: 'C', position: 2 },
      ],
    })
    await store.commit({ posts: { order: ['c', 'a', 'b'], update: { a: { title: 'A2' } } } }, { stage: 'draft' })
    const drafts = await store.list('posts', { orderBy: 'position' }, 'draft')
    assert.deepEqual(
      drafts.map((post) => [post.id, post.position, post.title]),
      [
        ['c', 0, 'C'],
        ['a', 1, 'A2'],
        ['b', 2, 'B'],
      ],
    )
    assert.deepEqual(
      (await store.list('posts', { orderBy: 'position' })).map((post) => post.id),
      ['a', 'b', 'c'],
      'the live order waits for a publish',
    )

    // A row created in the same commit can be placed by its temp id.
    const { idMap } = await store.commit(
      { posts: { create: [{ id: 'new-1', title: 'N' }], order: ['new-1', 'c', 'a', 'b'] } },
      { stage: 'published' },
    )
    const live = await store.list('posts', { orderBy: 'position' })
    assert.deepEqual(ids(live), [idMap['new-1'], 'c', 'a', 'b'])
    assert.deepEqual(
      live.map((post) => post.position),
      [0, 1, 2, 3],
    )

    // A source without an order field has nothing to write.
    await store.commit({ categories: { create: [{ id: 'x', name: 'X' }], order: ['x'] } }, { stage: 'published' })
    assert.deepEqual(await store.get('categories', 'x').then(({ _status, _updatedAt, ...rest }) => rest), { id: 'x', name: 'X' })
  })

  shared('a collection without drafts writes straight to published', async () => {
    const { store } = await make({})
    const { idMap } = await store.commit({ inquiries: { create: [{ id: 'new-1', email: 'hi@example.com' }] } }, { stage: 'draft' })
    const id = idMap['new-1']
    const live = await store.list('inquiries')
    assert.deepEqual(ids(live), [id])
    assert.equal(live[0]._status, 'published')
    assert.equal((await store.get('inquiries', id)).email, 'hi@example.com')

    await store.commit({ inquiries: { delete: [id] } }, { stage: 'draft' })
    assert.deepEqual(await store.list('inquiries'), [])
    assert.deepEqual(await store.list('inquiries', {}, 'draft'), [])
  })

  shared('where on id is a point read; other filters, orderBy and limit apply in process', async () => {
    const { store, reads } = await make({
      posts: [
        { id: 'a', title: 'A', position: 2, category: 'c1', tags: ['c1', 'c2'] },
        { id: 'b', title: 'B', position: 0, category: 'c2' },
        { id: 'c', title: 'C', position: 1, category: 'c1', tags: ['missing'] },
      ],
      categories: [
        { id: 'c1', name: 'One' },
        { id: 'c2', name: 'Two' },
      ],
    })

    reads.point = 0
    reads.scan = 0
    assert.deepEqual(ids(await store.list('posts', { where: { id: 'b' } })), ['b'])
    assert.ok(reads.point > 0, 'looked the row up by id')
    assert.equal(reads.scan, 0, 'and never scanned the source')
    assert.deepEqual(ids(await store.list('posts', { where: { id: ['a', 'c', 'zzz'] } })).sort(), ['a', 'c'])
    assert.equal(reads.scan, 0)
    assert.deepEqual(await store.list('posts', { where: { id: 'a', category: 'c2' } }), [])
    assert.deepEqual(await store.list('posts', { where: { id: 'zzz' } }), [])

    reads.point = 0
    reads.scan = 0
    assert.deepEqual(ids(await store.list('posts', { where: { category: 'c1' }, orderBy: 'position' })), ['c', 'a'])
    assert.ok(reads.scan > 0)
    assert.equal(reads.point, 0)
    assert.deepEqual(ids(await store.list('posts', { orderBy: '-position', limit: 2 })), ['a', 'c'])
    assert.deepEqual(ids(await store.list('posts', { where: { category: ['c1', 'c2'] }, orderBy: 'title' })), ['a', 'b', 'c'])
    assert.deepEqual(ids(await store.list('posts', { limit: 1, orderBy: 'position' })), ['b'])

    const populated = await store.list('posts', { populate: ['category', 'tags'], orderBy: 'position' })
    assert.equal(byId(populated, 'b').category.name, 'Two')
    assert.equal(byId(populated, 'a').category.id, 'c1')
    assert.deepEqual(
      byId(populated, 'a').tags.map((tag) => tag.name),
      ['One', 'Two'],
    )
    assert.deepEqual(byId(populated, 'c').tags, [], 'a dangling id resolves to nothing')
    assert.equal(byId(populated, 'b').tags, undefined)
    assert.equal((await store.get('posts', 'b')).category, 'c2', 'the stored value is untouched')
  })
}

test('the sql store writes schema_version 1 into vedit_meta', { skip: sqliteSkip }, async () => {
  const db = new sqlite.DatabaseSync(':memory:')
  const store = sqlContentStore(nodeSqliteDriver(db), { dialect: 'sqlite', collections: spec.collections, globals: spec.globals })
  await store.init()
  assert.deepEqual(
    db.prepare("SELECT value FROM vedit_meta WHERE key = 'schema_version'").all().map((row) => row.value),
    ['1'],
  )
  assert.equal(STORE_SCHEMA_VERSION, 1)
  assert.deepEqual(store.sources(), { collections: spec.collections, globals: spec.globals })

  // A second init on the same database is harmless.
  await store.init()
  assert.equal(db.prepare('SELECT count(*) AS n FROM vedit_meta').all()[0].n, 1)

  // A database written by a newer layout is refused rather than misread.
  db.prepare("UPDATE vedit_meta SET value = '2' WHERE key = 'schema_version'").run()
  const newer = sqlContentStore(nodeSqliteDriver(db), { dialect: 'sqlite', collections: spec.collections, globals: spec.globals })
  await assert.rejects(newer.init(), /schema/i)
})

test('postgresDriver rewrites ? placeholders to $n', async () => {
  const calls = []
  let fail = false
  const client = {
    async query(text, values) {
      calls.push({ text, values })
      if (fail && /INSERT/.test(text)) throw new Error('duplicate key')
      return { rows: [{ ok: 1 }] }
    },
  }
  const driver = postgresDriver(client)

  const rows = await driver.query("SELECT * FROM t WHERE a = ? AND b = 'what?' AND c = ? AND d = \"?\"", [1, 2])
  assert.deepEqual(rows, [{ ok: 1 }])
  assert.deepEqual(calls[0], {
    text: "SELECT * FROM t WHERE a = $1 AND b = 'what?' AND c = $2 AND d = \"?\"",
    values: [1, 2],
  })
  // An escaped quote inside the string keeps the string going.
  await driver.query("SELECT ? WHERE x = 'it''s?' AND y = ?", ['a', 'b'])
  assert.equal(calls[1].text, "SELECT $1 WHERE x = 'it''s?' AND y = $2")

  calls.length = 0
  await driver.batch([
    { sql: 'INSERT INTO t VALUES (?, ?)', params: [1, 2] },
    { sql: 'DELETE FROM t WHERE a = ?', params: [3] },
  ])
  assert.deepEqual(
    calls.map((call) => call.text),
    ['BEGIN', 'INSERT INTO t VALUES ($1, $2)', 'DELETE FROM t WHERE a = $1', 'COMMIT'],
  )
  assert.deepEqual(calls[1].values, [1, 2])

  calls.length = 0
  fail = true
  await assert.rejects(driver.batch([{ sql: 'INSERT INTO t VALUES (?)', params: [1] }]), /duplicate key/)
  assert.deepEqual(
    calls.map((call) => call.text),
    ['BEGIN', 'INSERT INTO t VALUES ($1)', 'ROLLBACK'],
  )
})

test('contentClientFromStore exposes the store with capabilities for the given user', async () => {
  const store = memoryContentStore(spec, { seed: { posts: [{ id: 'a', title: 'A' }] } })
  await store.init()
  const author = { id: 'u1', email: 'a@example.com', role: 'author' }
  const editor = { id: 'u2', email: 'e@example.com', role: 'editor' }

  const asAuthor = contentClientFromStore(store, { user: author, spec })
  assert.deepEqual(await asAuthor.capabilities(), {
    user: author,
    login: false,
    can: { write: true, publish: false, upload: true, data: { write: true, delete: false } },
  })
  const schema = await asAuthor.schema()
  assert.deepEqual(
    schema.map((source) => source.name),
    ['posts', 'categories', 'inquiries', 'site'],
  )
  assert.equal(schema[0].can.publish, false)

  const asEditor = contentClientFromStore(store, { user: editor, spec })
  const editorCan = (await asEditor.capabilities()).can
  assert.equal(editorCan.publish, true)
  assert.equal(editorCan.data.delete, true)
  assert.equal((await asEditor.schema())[0].can.publish, true)

  // No user at all means the caller is the server itself: everything goes.
  const asServer = contentClientFromStore(store, { spec })
  assert.deepEqual(await asServer.capabilities(), {
    user: null,
    login: false,
    can: { write: true, publish: true, upload: true, data: { write: true, delete: true } },
  })
  assert.equal(asServer.login, undefined)

  // A user given as null is a visitor.
  const asVisitor = contentClientFromStore(store, { user: null, spec })
  const visitorCan = (await asVisitor.capabilities()).can
  assert.deepEqual(visitorCan, { write: false, publish: false, upload: false, data: { write: false, delete: false } })
  assert.equal((await asVisitor.schema())[0].can.read, true)
  assert.equal((await asVisitor.schema())[0].can.update, false)

  // Reads and writes go straight to the store.
  const { idMap } = await asServer.commit({ posts: { create: [{ id: 'new-1', title: 'N' }] } }, { stage: 'draft' })
  assert.deepEqual(titles(await asServer.list('posts')), ['A'])
  assert.deepEqual(titles(await asServer.list('posts', { stage: 'draft' })).sort(), ['A', 'N'])
  assert.equal((await asServer.get('posts', idMap['new-1'], { stage: 'draft' })).title, 'N')
  assert.equal(await asServer.get('posts', idMap['new-1']), null)
  await asServer.publish({ posts: [idMap['new-1']] })
  assert.equal((await asServer.get('posts', idMap['new-1'])).title, 'N')
  assert.equal((await asServer.versions('posts', idMap['new-1'])).length, 1)
  const [version] = await asServer.versions('posts', idMap['new-1'])
  await asServer.restoreVersion('posts', idMap['new-1'], version.id)
  assert.equal((await asServer.versions('posts', idMap['new-1'])).length, 2)
})

test("a date field with default 'now' is stamped when a record is created without one", async () => {
  const store = memoryContentStore({
    collections: {
      posts: { fields: { title: 'text', createdAt: { type: 'date', default: 'now' } } },
    },
  })
  await store.init()
  const before = Date.now()
  await store.commit(
    {
      posts: {
        create: [
          { id: 'fresh', title: 'Fresh' },
          { id: 'old', title: 'Old', createdAt: '2020-01-01T00:00:00.000Z' },
        ],
      },
    },
    { stage: 'published' },
  )
  const fresh = await store.get('posts', 'fresh', 'published')
  assert.ok(Date.parse(fresh.createdAt) >= before - 1000, `stamped: ${fresh.createdAt}`)
  const old = await store.get('posts', 'old', 'published')
  assert.equal(old.createdAt, '2020-01-01T00:00:00.000Z')
  // An update never rewrites it.
  await store.commit({ posts: { update: { fresh: { title: 'Fresher' } } } }, { stage: 'published' })
  assert.equal((await store.get('posts', 'fresh', 'published')).createdAt, fresh.createdAt)
})
