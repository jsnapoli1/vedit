import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, emptyDocument, memoryAdapter } from '../dist/index.js'

const makeStore = () => new VeditStore({ key: 'home', adapter: memoryAdapter() })

test('style edits land in the bucket for the active breakpoint', () => {
  const store = makeStore()
  store.setStyle('a', { fontSize: '20px' })
  store.setBreakpoint('md')
  store.setStyle('a', { fontSize: '40px' })

  assert.deepEqual(store.getOverride('a').style, { fontSize: '20px' })
  assert.deepEqual(store.getOverride('a').responsive.md, { fontSize: '40px' })
})

test('clearing the last declaration removes the node entirely', () => {
  const store = makeStore()
  store.setStyle('a', { color: 'red' })
  store.clearStyle('a', 'color')
  assert.deepEqual(store.getState().doc.nodes, {})
})

test('undo and redo walk the history', () => {
  const store = makeStore()
  store.update('a', { text: 'one' })
  store.update('a', { text: 'two' })
  store.undo()
  assert.equal(store.getOverride('a').text, 'one')
  store.redo()
  assert.equal(store.getOverride('a').text, 'two')
})

test('a drag collapses into a single undo step', () => {
  const store = makeStore()
  store.update('a', { text: 'start' })
  store.beginHistory()
  store.setStyle('a', { width: '10px' }, { history: false })
  store.setStyle('a', { width: '20px' }, { history: false })
  store.setStyle('a', { width: '30px' }, { history: false })
  store.undo()
  assert.equal(store.getOverride('a').style, undefined)
  assert.equal(store.getOverride('a').text, 'start')
})

test('a gesture collapses its writes into one undo step', () => {
  const store = makeStore()
  store.setStyle('a', { width: '5px' })
  store.beginGesture()
  store.setStyle('a', { width: '10px' })
  store.setStyle('a', { width: '20px' })
  store.setStyle('a', { width: '30px' })
  store.endGesture()
  assert.equal(store.getOverride('a').style.width, '30px')
  store.undo()
  assert.equal(store.getOverride('a').style.width, '5px')
})

test('a gesture longer than the history limit still undoes to where it started', () => {
  const store = makeStore()
  store.setStyle('a', { width: '5px' })
  store.beginGesture()
  for (let i = 1; i <= 150; i++) store.setStyle('a', { width: `${i}px` })
  store.endGesture()
  assert.equal(store.getOverride('a').style.width, '150px')
  store.undo()
  assert.equal(store.getOverride('a').style.width, '5px')
})

test('a gesture that writes nothing leaves no undo step', () => {
  const store = makeStore()
  store.setStyle('a', { width: '5px' })
  const before = store.getState().past.length
  store.beginGesture()
  store.endGesture()
  assert.equal(store.getState().past.length, before)
  store.undo()
  assert.equal(store.getOverride('a').style, undefined)
})

test('a write outside a gesture is its own undo step', () => {
  const store = makeStore()
  store.beginGesture()
  store.setStyle('a', { width: '10px' })
  store.setStyle('a', { width: '20px' })
  store.endGesture()
  store.setStyle('a', { width: '30px' })
  store.setStyle('a', { width: '40px' })
  store.undo()
  assert.equal(store.getOverride('a').style.width, '30px')
  store.undo()
  assert.equal(store.getOverride('a').style.width, '20px')
  store.undo()
  assert.equal(store.getOverride('a').style, undefined)
})

test('dirty tracking survives a save round trip', async () => {
  const store = makeStore()
  assert.equal(store.dirty, false)
  store.update('a', { text: 'hi' })
  assert.equal(store.dirty, true)
  await store.save()
  assert.equal(store.dirty, false)
})

test('inserted nodes get defaults and can be removed', () => {
  const store = makeStore()
  const id = store.insert('section', 'text')
  assert.equal(store.getOverride(id).text, 'New text')
  assert.equal(store.insertedFor('section').length, 1)
  store.removeInserted(id)
  assert.deepEqual(store.getState().doc.inserted, [])
  assert.deepEqual(store.getState().doc.nodes, {})
})

test('loading replaces the document and clears history', async () => {
  const store = new VeditStore({
    key: 'home',
    adapter: memoryAdapter({ key: 'home', nodes: { a: { text: 'saved' } }, inserted: [] }),
  })
  await store.load()
  assert.equal(store.getOverride('a').text, 'saved')
  assert.equal(store.getState().past.length, 0)
  assert.equal(store.dirty, false)
})

test("a stale cleanup does not unregister the element that replaced it", () => {
  // React runs the new element's registration before an old keyed sibling's
  // cleanup in some orders; the cleanup names its own element and must leave
  // the newer registration alone.
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter() })
  const older = { isConnected: true }
  const newer = { isConnected: true }
  const node = (element) => ({ id: 'cards.title~a', kind: 'text', label: 'Title', element, parentId: null, auto: false, container: false })
  store.register(node(older))
  store.register(node(newer))
  store.unregister('cards.title~a', older)
  assert.equal(store.getNode('cards.title~a')?.element, newer)
  store.unregister('cards.title~a', newer)
  assert.equal(store.getNode('cards.title~a'), undefined)
  // Without an element the call is the old unconditional one.
  store.register(node(older))
  store.unregister('cards.title~a')
  assert.equal(store.getNode('cards.title~a'), undefined)
})

test('Publish is only on offer when the draft differs from what visitors see', async () => {
  const docs = {
    'home:published': { ...emptyDocument('home'), nodes: { a: { text: 'live' } } },
    'home:draft': { ...emptyDocument('home'), nodes: { a: { text: 'live' } } },
  }
  const adapter = {
    async load(key, opts) { return docs[`${key}:${opts?.stage ?? 'published'}`] ?? null },
    async save(doc) { docs[`${doc.key}:draft`] = doc },
    async publish(doc) { docs[`${doc.key}:published`] = doc },
  }
  const store = new VeditStore({ key: 'home', adapter })
  await store.load('draft')
  assert.equal(store.unpublished, false, 'the draft is the published document, nothing to publish')

  store.update('a', { text: 'edited' })
  await store.save()
  assert.equal(store.unpublished, true, 'a saved draft that differs is publishable')

  await store.publish()
  assert.equal(store.unpublished, false)
  assert.equal(docs['home:published'].nodes.a.text, 'edited')
})
