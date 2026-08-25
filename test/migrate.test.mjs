import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateDocument, inspectDocument, DOCUMENT_VERSION } from '../dist/server.js'
import { VeditStore, memoryAdapter } from '../dist/index.js'

const v1 = {
  version: 1,
  key: 'home',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: { 'home.hero.title': { text: 'Hello', style: { fontSize: '48px' } } },
  inserted: [{ id: 'home.hero::added-1', parentId: 'home.hero', kind: 'text', index: 0 }],
  tokens: [{ id: 'brand', name: 'Brand', kind: 'color', value: '#0d99ff' }],
}

test('a version 1 document still opens, unchanged', () => {
  const report = inspectDocument(v1)
  assert.deepEqual(report.doc, v1)
  assert.equal(report.from, 1)
  assert.equal(report.future, false)
  assert.deepEqual(report.warnings, [])
})

test('a document with no version is read as the current one', () => {
  const { version, ...versionless } = v1
  const report = inspectDocument(versionless)
  assert.equal(report.from, null)
  assert.equal(report.doc.version, DOCUMENT_VERSION)
  assert.deepEqual(report.doc.nodes, v1.nodes)
})

test('a document from a newer build keeps its data, its version, and says so', () => {
  const report = inspectDocument({ ...v1, version: 99, palettes: [{ id: 'sunset' }] })
  assert.equal(report.future, true)
  assert.equal(report.doc.version, 99, 'saving it back must not claim it is older than it is')
  assert.deepEqual(report.doc.palettes, [{ id: 'sunset' }], 'unknown fields ride along')
  assert.match(report.warnings[0], /newer version/)
})

test('nothing at all becomes an empty document', () => {
  assert.deepEqual(migrateDocument(null, 'home'), {
    version: DOCUMENT_VERSION,
    key: 'home',
    updatedAt: new Date(0).toISOString(),
    nodes: {},
    inserted: [],
    tokens: [],
  })
})

test('a malformed document is repaired rather than trusted', () => {
  const report = inspectDocument({
    key: 'home',
    nodes: { good: { text: 'yes' }, bad: 'not an object' },
    inserted: [{ id: 'a', parentId: 'b', kind: 'text', index: 0 }, { kind: 'wat' }, null],
    tokens: [{ id: 'brand', kind: 'color', value: '#fff' }, { id: 'broken' }],
  })

  assert.deepEqual(Object.keys(report.doc.nodes), ['good'])
  assert.equal(report.doc.inserted.length, 1)
  assert.deepEqual(report.doc.tokens, [{ id: 'brand', kind: 'color', value: '#fff', name: 'brand' }])
  assert.equal(report.warnings.length, 3)
})

test('a document that is not an object at all does not throw', () => {
  for (const value of ['a string', 42, [], true]) {
    const doc = migrateDocument(value, 'home')
    assert.equal(doc.key, 'home')
    assert.deepEqual(doc.nodes, {})
  }
})

test('the store migrates whatever the adapter hands it', async () => {
  const stored = { key: 'home', nodes: { a: { text: 'from disk' } } }
  const store = new VeditStore({
    key: 'home',
    adapter: { async load() { return stored }, async save() {} },
  })
  await store.load()

  const { doc } = store.getState()
  assert.equal(doc.version, DOCUMENT_VERSION)
  assert.equal(doc.text, undefined)
  assert.equal(doc.nodes.a.text, 'from disk')
  assert.deepEqual(doc.inserted, [], 'a missing array is repaired, not left undefined')
  assert.deepEqual(doc.tokens, [])
  assert.equal(store.dirty, false, 'loading is not an edit')
})

test('a document stored under another key adopts the key being edited', async () => {
  const store = new VeditStore({ key: 'pricing', adapter: memoryAdapter() })
  store.hydrate({ ...v1, key: 'home' })
  assert.equal(store.getState().doc.key, 'pricing')
})
