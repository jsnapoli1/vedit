import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVeditHandler, emptyDocument, veditStyleTag } from '../dist/server.js'

function fakeStore() {
  const documents = new Map()
  return {
    documents,
    async read(key) {
      return documents.get(key) ?? null
    },
    async write(doc) {
      documents.set(doc.key, doc)
    },
  }
}

test('GET returns an empty document for an unknown key', async () => {
  const handle = createVeditHandler({ store: fakeStore() })
  const response = await handle(new Request('https://site.test/api/vedit?key=home'))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.key, 'home')
  assert.deepEqual(body.nodes, {})
})

test('PUT stores the document and GET reads it back', async () => {
  const store = fakeStore()
  const handle = createVeditHandler({ store })
  const doc = { ...emptyDocument('home'), nodes: { a: { text: 'hello' } } }
  const put = await handle(
    new Request('https://site.test/api/vedit', { method: 'PUT', body: JSON.stringify(doc) }),
  )
  assert.equal(put.status, 200)
  const body = await (await handle(new Request('https://site.test/api/vedit?key=home'))).json()
  assert.equal(body.nodes.a.text, 'hello')
})

test('writes are refused when authorize says no', async () => {
  const store = fakeStore()
  const handle = createVeditHandler({ store, authorize: () => false })
  const response = await handle(
    new Request('https://site.test/api/vedit', {
      method: 'PUT',
      body: JSON.stringify(emptyDocument('home')),
    }),
  )
  assert.equal(response.status, 403)
  assert.equal(store.documents.size, 0)
})

test('malformed payloads are rejected', async () => {
  const handle = createVeditHandler({ store: fakeStore() })
  const response = await handle(
    new Request('https://site.test/api/vedit', { method: 'PUT', body: JSON.stringify({ nope: true }) }),
  )
  assert.equal(response.status, 400)
})

test('the SSR style tag carries the overrides', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { style: { color: 'red' } } } }
  assert.match(veditStyleTag(doc), /^<style data-vedit-overrides>.*color:red.*<\/style>$/)
  assert.equal(veditStyleTag(null), '')
})

test('drafts and published documents are kept apart', async () => {
  const documents = new Map()
  const store = {
    async read(key, stage = 'published') {
      return documents.get(`${key}:${stage}`) ?? null
    },
    async write(doc, stage = 'published') {
      documents.set(`${doc.key}:${stage}`, doc)
    },
  }
  const handle = createVeditHandler({ store })
  const draft = { ...emptyDocument('home'), nodes: { a: { text: 'draft copy' } } }

  await handle(new Request('https://s.test/api?key=home', { method: 'PUT', body: JSON.stringify(draft) }))
  const live = await (await handle(new Request('https://s.test/api?key=home'))).json()
  assert.deepEqual(live.nodes, {}, 'visitors still see the old document')

  const editing = await (await handle(new Request('https://s.test/api?key=home&stage=draft'))).json()
  assert.equal(editing.nodes.a.text, 'draft copy')

  await handle(
    new Request('https://s.test/api?key=home&action=publish', { method: 'POST', body: JSON.stringify(draft) }),
  )
  const published = await (await handle(new Request('https://s.test/api?key=home'))).json()
  assert.equal(published.nodes.a.text, 'draft copy')
})

test('version listing and reading route through the store', async () => {
  const store = {
    async read() { return null },
    async write() {},
    async listVersions() { return [{ id: 'v1', savedAt: '2026-08-23T10:00:00.000Z', published: true }] },
    async readVersion(key, id) {
      return id === 'v1' ? { ...emptyDocument(key), nodes: { a: { text: 'old' } } } : null
    },
  }
  const handle = createVeditHandler({ store })

  const list = await (await handle(new Request('https://s.test/api?key=home&versions=1'))).json()
  assert.equal(list.items[0].id, 'v1')

  const one = await (await handle(new Request('https://s.test/api?key=home&version=v1'))).json()
  assert.equal(one.nodes.a.text, 'old')

  const missing = await handle(new Request('https://s.test/api?key=home&version=nope'))
  assert.equal(missing.status, 404)
})

test('publishing is refused when authorize says no', async () => {
  let written = 0
  const handle = createVeditHandler({
    store: { async read() { return null }, async write() { written += 1 } },
    authorize: () => false,
  })
  const response = await handle(
    new Request('https://s.test/api?action=publish', { method: 'POST', body: JSON.stringify(emptyDocument('home')) }),
  )
  assert.equal(response.status, 403)
  assert.equal(written, 0)
})
