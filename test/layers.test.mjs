import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, memoryAdapter } from '../dist/index.js'

const makeStore = () => new VeditStore({ key: 'home', adapter: memoryAdapter() })

test('style edits land in the cell for the active state and breakpoint', () => {
  const store = makeStore()
  store.setStyle('a', { color: 'red' })
  store.setStyleState('hover')
  store.setStyle('a', { color: 'blue' })
  store.setBreakpoint('lg')
  store.setStyle('a', { color: 'green' })

  const override = store.getOverride('a')
  assert.deepEqual(override.style, { color: 'red' })
  assert.deepEqual(override.states.hover.style, { color: 'blue' })
  assert.deepEqual(override.states.hover.responsive.lg, { color: 'green' })
})

test('reading a value follows the active cell', () => {
  const store = makeStore()
  store.setStyle('a', { color: 'red' })
  assert.equal(store.styleValue('a', 'color'), 'red')
  store.setStyleState('focus')
  assert.equal(store.styleValue('a', 'color'), undefined)
})

test('clearing the last declaration in a state removes the state', () => {
  const store = makeStore()
  store.setStyleState('hover')
  store.setStyle('a', { color: 'red' })
  store.clearStyle('a', 'color')
  assert.deepEqual(store.getState().doc.nodes, {})
})

test('tokens get unique slugs and can be renamed and removed', () => {
  const store = makeStore()
  const first = store.addToken({ name: 'Brand Blue', kind: 'color', value: '#00f' })
  const second = store.addToken({ name: 'Brand Blue', kind: 'color', value: '#00e' })
  assert.equal(first.id, 'brand-blue')
  assert.equal(second.id, 'brand-blue-2')

  store.updateToken(first.id, { value: '#123456' })
  assert.equal(store.getState().doc.tokens[0].value, '#123456')

  store.removeToken(second.id)
  assert.equal(store.getState().doc.tokens.length, 1)
})

test('inserted elements can be duplicated and re-parented', () => {
  const store = makeStore()
  const first = store.insert('section', 'box')
  store.setStyle(first, { background: 'red' })
  const copy = store.duplicateInserted(first)

  assert.equal(store.getState().doc.inserted.length, 2)
  assert.deepEqual(store.getOverride(copy), store.getOverride(first))
  assert.equal(store.getOverride(copy).style.background, 'red')
  assert.equal(store.insertedFor('section').map((n) => n.id).join(), `${first},${copy}`)

  store.moveInserted(copy, 'footer')
  assert.equal(store.insertedFor('section').length, 1)
  assert.equal(store.insertedFor('footer').length, 1)
})

test('duplicating something that is not an inserted element is a no-op', () => {
  const store = makeStore()
  assert.equal(store.duplicateInserted('home.hero.title'), null)
})

test('a multi-selection edit writes to every node and clears from every node', () => {
  const store = makeStore()
  store.setStyleMany([
    ['a', { color: 'red' }],
    ['b', { color: 'red' }],
  ])
  assert.equal(store.getOverride('b').style.color, 'red')

  store.clearStylesMany(['a', 'b'], ['color'])
  assert.deepEqual(store.getState().doc.nodes, {})
})

test('updateMany applies a content patch across nodes', () => {
  const store = makeStore()
  store.updateMany(['a', 'b'], { hidden: true })
  assert.equal(store.getOverride('a').hidden, true)
  assert.equal(store.getOverride('b').hidden, true)
})
