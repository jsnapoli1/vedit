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
