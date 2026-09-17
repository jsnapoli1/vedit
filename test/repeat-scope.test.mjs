import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, memoryAdapter } from '../dist/index.js'

const makeStore = () => new VeditStore({ key: 'home', adapter: memoryAdapter() })

test('an edit to a repeat item defaults to the whole repeat', () => {
  const store = makeStore()
  store.update('cards.title~b', { text: 'On sale' })

  // Written to the template, so every card gets it.
  assert.equal(store.getOverride('cards.title').text, 'On sale')
  assert.deepEqual(store.getOverride('cards.title~b'), {})
})

test('scoping to one item writes to that item', () => {
  const store = makeStore()
  store.setRepeatScope('item')
  store.update('cards.title~b', { text: 'Sold out' })

  assert.equal(store.getOverride('cards.title~b').text, 'Sold out')
  assert.deepEqual(store.getOverride('cards.title'), {})
})

test('a node outside a repeat is unaffected by the scope', () => {
  const store = makeStore()
  store.setRepeatScope('item')
  store.update('hero.title', { text: 'Hello' })

  assert.equal(store.getOverride('hero.title').text, 'Hello')
})

test('styles follow the scope too', () => {
  const store = makeStore()
  store.setStyle('cards.title~a', { color: 'red' })
  assert.deepEqual(store.getOverride('cards.title').style, { color: 'red' })

  store.setRepeatScope('item')
  store.setStyle('cards.title~a', { color: 'blue' })
  assert.deepEqual(store.getOverride('cards.title~a').style, { color: 'blue' })
  // The template keeps what it had.
  assert.deepEqual(store.getOverride('cards.title').style, { color: 'red' })
})

test('editing several items of one repeat writes the template once', () => {
  const store = makeStore()
  store.updateMany(['cards.title~a', 'cards.title~b', 'cards.title~c'], { hidden: true })

  assert.equal(store.getOverride('cards.title').hidden, true)
  for (const key of ['a', 'b', 'c']) {
    assert.deepEqual(store.getOverride(`cards.title~${key}`), {})
  }
})

test('resetting an item drops its override and leaves the template', () => {
  const store = makeStore()
  store.update('cards.title', { text: 'Buy now' })
  store.setRepeatScope('item')
  store.update('cards.title~b', { text: 'Sold out' })

  store.resetRepeatItem('cards.title~b')

  assert.deepEqual(store.getOverride('cards.title~b'), {})
  assert.equal(store.getOverride('cards.title').text, 'Buy now')
})

test('resetting an item is not redirected by the scope', () => {
  // The one write that always means the item. Redirecting it would clear the
  // shared edit for every card — the opposite of what the button offers.
  const store = makeStore()
  store.update('cards.title', { text: 'Buy now' })
  store.setRepeatScope('all')
  store.update('cards.title~b', { text: 'ignored' })
  store.setRepeatScope('item')
  store.update('cards.title~b', { text: 'Sold out' })

  store.resetRepeatItem('cards.title~b')
  assert.ok(store.getOverride('cards.title').text)
  assert.deepEqual(store.getOverride('cards.title~b'), {})
})

test('resetting a node that is not a repeat item does nothing', () => {
  const store = makeStore()
  store.update('hero.title', { text: 'Hello' })
  store.resetRepeatItem('hero.title')
  assert.equal(store.getOverride('hero.title').text, 'Hello')
})

test('the scope is editor state and never reaches the document', () => {
  const store = makeStore()
  store.setRepeatScope('item')
  assert.ok(!JSON.stringify(store.getState().doc).includes('repeatScope'))
})

test('a style written from the inspector to one or several items follows the scope', () => {
  // The inspector fans a field out over the selection with the `Many` variants;
  // they have to redirect like a single write, or a colour set on "every card"
  // lands on the one that was clicked.
  const store = makeStore()
  store.setStyleMany([
    ['cards.title~a', { color: 'red' }],
    ['cards.title~b', { color: 'red' }],
  ])
  assert.equal(store.getOverride('cards.title').style.color, 'red')
  assert.deepEqual(store.getOverride('cards.title~a'), {})
  assert.deepEqual(store.getOverride('cards.title~b'), {})

  store.clearStylesMany(['cards.title~a'], ['color'])
  assert.deepEqual(store.getOverride('cards.title'), {})

  store.setRepeatScope('item')
  store.setStyleMany([['cards.title~a', { color: 'blue' }]])
  assert.equal(store.getOverride('cards.title~a').style.color, 'blue')
  assert.deepEqual(store.getOverride('cards.title'), {})
})

test('a per-item write can still opt out of the redirect', () => {
  // Re-ordering siblings writes each item's own `order`; that is a write to
  // the item and never to the template.
  const store = makeStore()
  store.setStyleMany([['cards.title~a', { order: '2' }]], { redirect: false })
  assert.equal(store.getOverride('cards.title~a').style.order, '2')
  assert.deepEqual(store.getOverride('cards.title'), {})
})
