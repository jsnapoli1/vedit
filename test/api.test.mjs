import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVeditApi, remoteStore } from '../dist/api.js'
import { emptyDocument } from '../dist/server.js'

/** A `VeditServerStore` in memory, with drafts, publishing and one saved version. */
function testStore() {
  const stages = new Map()
  const versions = new Map()
  return {
    stages,
    async read(key, stage = 'published') {
      return stages.get(`${stage}:${key}`) ?? null
    },
    async write(doc, stage = 'published') {
      stages.set(`${stage}:${doc.key}`, doc)
      versions.set(`${doc.key}:v1`, doc)
    },
    async list() {
      return [{ key: 'home' }]
    },
    async listVersions() {
      return [...versions.keys()].map((id) => ({ id: id.split(':')[1], savedAt: '2026-01-01T00:00:00.000Z' }))
    },
    async readVersion(key, versionId) {
      return versions.get(`${key}:${versionId}`) ?? null
    },
  }
}

const api = (store, options = {}) => createVeditApi({ store, authorize: () => true, ...options })

const call = (handle, method, path, body) =>
  handle(
    new Request(`https://site.test/api/vedit/v1${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
  )

test('the root says what this server can do', async () => {
  const response = await call(api(testStore()), 'GET', '')
  const body = await response.json()
  assert.equal(body.api, 1)
  assert.equal(body.documentVersion, 1)
  assert.deepEqual(body.capabilities, { list: true, versions: true, components: false })
})

test('the components a page can be built from are served, and shown as a capability', async () => {
  const components = [{ id: 'Hero', name: 'Hero', group: 'Sections', fields: [{ name: 'align', type: 'select' }] }]
  const handle = api(testStore(), { components })

  assert.equal((await (await call(handle, 'GET', '')).json()).capabilities.components, true)
  assert.deepEqual((await (await call(handle, 'GET', '/components')).json()).items, components)
})

test('a component is placed into a slot and comes back in the summary', async () => {
  const store = testStore()
  const handle = api(store)

  const placed = await call(handle, 'POST', '/documents/home/operations', {
    operations: [{ op: 'insert-node', parentId: 'home.sections', kind: 'component', component: 'Hero' }],
  })
  const { created } = await placed.json()
  assert.equal(created.length, 1)

  const summary = await (await call(handle, 'GET', '/documents/home/summary')).json()
  assert.deepEqual(summary.nodes, [
    { id: created[0], overrides: [], inserted: true, parentId: 'home.sections', index: 0, component: 'Hero' },
  ])
  assert.equal(store.stages.get('published:home').inserted[0].component, 'Hero')
})

test('a component node with no component name is refused', async () => {
  const response = await call(api(testStore()), 'POST', '/documents/home/operations', {
    operations: [{ op: 'insert-node', parentId: 'home.sections', kind: 'component' }],
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error.message, /`component` is required/)
})

test('a document that was never saved reads as an empty one', async () => {
  const response = await call(api(testStore()), 'GET', '/documents/home')
  assert.deepEqual(await response.json(), emptyDocument('home'))
})

test('operations are applied and stored, and report what they touched', async () => {
  const store = testStore()
  const handle = api(store)

  const response = await call(handle, 'POST', '/documents/home/operations?stage=draft', {
    operations: [
      { op: 'set-content', id: 'title', content: { text: 'Ship it' } },
      { op: 'set-styles', id: 'title', styles: { fontSize: '48px' }, breakpoint: 'lg' },
    ],
  })

  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).changed, ['title'])
  assert.equal(store.stages.get('draft:home').nodes.title.text, 'Ship it')
  assert.equal(store.stages.get('published:home'), undefined, 'a draft write does not touch the live copy')
})

test('a malformed operation is a 400 that names which one', async () => {
  const response = await call(api(testStore()), 'POST', '/documents/home/operations', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'ok' } }, { op: 'nonsense' }],
  })
  const body = await response.json()
  assert.equal(response.status, 400)
  assert.equal(body.error.operation, 1)
  assert.match(body.error.message, /nonsense/)
})

test('keys with slashes survive the round trip', async () => {
  const store = testStore()
  const handle = api(store)
  await call(handle, 'POST', `/documents/${encodeURIComponent('/pricing')}/operations`, {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'Plans' } }],
  })

  assert.equal(store.stages.get('published:/pricing').key, '/pricing')
  const read = await call(handle, 'GET', `/documents/${encodeURIComponent('/pricing')}`)
  assert.equal((await read.json()).nodes.a.text, 'Plans')
})

test('a summary is smaller than the document and still says what is set', async () => {
  const handle = api(testStore())
  await call(handle, 'POST', '/documents/home/operations', {
    operations: [{ op: 'set-styles', id: 'title', styles: { color: 'red' }, state: 'hover' }],
  })
  const body = await (await call(handle, 'GET', '/documents/home/summary')).json()
  assert.deepEqual(body.nodes, [{ id: 'title', overrides: ['hover'], inserted: false }])
})

test('the css route renders what a visitor would get', async () => {
  const handle = api(testStore())
  await call(handle, 'POST', '/documents/home/operations', {
    operations: [{ op: 'set-styles', id: 'title', styles: { color: 'red' } }],
  })
  const response = await call(handle, 'GET', '/documents/home/css')
  assert.match(response.headers.get('content-type'), /text\/css/)
  assert.match(await response.text(), /\[data-vedit-id="title"\]/)
})

test('one node can be read, replaced and reset', async () => {
  const handle = api(testStore())
  await call(handle, 'PUT', '/documents/home/nodes/title', { text: 'Hello', style: { color: 'red' } })

  assert.deepEqual(await (await call(handle, 'GET', '/documents/home/nodes/title')).json(), {
    text: 'Hello',
    style: { color: 'red' },
  })

  await call(handle, 'DELETE', '/documents/home/nodes/title')
  assert.equal((await call(handle, 'GET', '/documents/home/nodes/title')).status, 404)
})

test('tokens are listed, written and removed', async () => {
  const handle = api(testStore())
  await call(handle, 'PUT', '/documents/home/tokens/brand', { name: 'Brand', kind: 'color', value: '#0d99ff' })
  assert.deepEqual((await (await call(handle, 'GET', '/documents/home/tokens')).json()).items, [
    { name: 'Brand', kind: 'color', value: '#0d99ff', id: 'brand' },
  ])

  await call(handle, 'DELETE', '/documents/home/tokens/brand')
  assert.deepEqual((await (await call(handle, 'GET', '/documents/home/tokens')).json()).items, [])
})

test('publishing copies the draft over the live copy', async () => {
  const store = testStore()
  const handle = api(store)
  await call(handle, 'POST', '/documents/home/operations?stage=draft', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'draft only' } }],
  })
  assert.equal(store.stages.get('published:home'), undefined)

  await call(handle, 'POST', '/documents/home/publish')
  assert.equal(store.stages.get('published:home').nodes.a.text, 'draft only')
})

test('a version can be listed, read and restored', async () => {
  const store = testStore()
  const handle = api(store)
  await call(handle, 'POST', '/documents/home/operations', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'first' } }],
  })
  await call(handle, 'POST', '/documents/home/operations', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'second' } }],
  })

  const versions = await (await call(handle, 'GET', '/documents/home/versions')).json()
  assert.equal(versions.items.length, 1)

  await call(handle, 'POST', `/documents/home/versions/${versions.items[0].id}/restore`)
  assert.equal(store.stages.get('published:home').nodes.a.text, 'second')
})

test('authorize sees what the request is about, and a refusal is a 403', async () => {
  const seen = []
  const handle = createVeditApi({
    store: testStore(),
    authorize: (request, context) => {
      seen.push(context)
      return !context.write
    },
  })

  assert.equal((await call(handle, 'GET', '/documents/home')).status, 200)
  assert.equal((await call(handle, 'POST', '/documents/home/operations', { operations: [] })).status, 403)
  assert.deepEqual(seen.map((context) => [context.route, context.write, context.stage]), [
    ['documents/:key', false, 'published'],
    ['documents/:key/operations', true, 'published'],
  ])
})

test('a route that does not exist is a 404, not a 500', async () => {
  const handle = api(testStore())
  assert.equal((await call(handle, 'GET', '/documents/home/nonsense')).status, 404)
  assert.equal((await handle(new Request('https://site.test/api/vedit/documents/home'))).status, 404)
})

test('the wrong method on a real route is a 405', async () => {
  assert.equal((await call(api(testStore()), 'DELETE', '/documents/home')).status, 405)
})

test('onChange hears about every write', async () => {
  const changes = []
  const handle = api(testStore(), { onChange: (change) => changes.push(change) })
  await call(handle, 'POST', '/documents/home/operations?stage=draft', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'x' } }],
  })

  assert.equal(changes.length, 1)
  assert.deepEqual([changes[0].key, changes[0].stage, changes[0].changed], ['home', 'draft', ['a']])
})

test('remoteStore drives another server through the same API', async () => {
  const backing = testStore()
  const handle = api(backing)
  const remote = remoteStore({
    endpoint: 'https://site.test/api/vedit',
    fetch: (url, init) => handle(new Request(url, init)),
  })

  await remote.write({ ...emptyDocument('home'), nodes: { a: { text: 'through the wire' } } }, 'draft')
  const doc = await remote.read('home', 'draft')

  assert.equal(doc.nodes.a.text, 'through the wire')
  assert.deepEqual(await remote.list(), [{ key: 'home' }])
})
