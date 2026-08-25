import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, memoryAdapter } from '../dist/index.js'

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
