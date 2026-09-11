import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOperations, describeDocument, emptyDocument } from '../dist/server.js'
import { VeditStore, memoryAdapter } from '../dist/index.js'

const blank = () => emptyDocument('home')

test('styles land in the cell the operation names', () => {
  const { doc } = applyOperations(blank(), [
    { op: 'set-styles', id: 'title', styles: { fontSize: '48px' } },
    { op: 'set-styles', id: 'title', styles: { fontSize: '32px' }, breakpoint: 'md' },
    { op: 'set-styles', id: 'title', styles: { color: 'red' }, state: 'hover' },
  ])

  assert.deepEqual(doc.nodes.title.style, { fontSize: '48px' })
  assert.deepEqual(doc.nodes.title.responsive.md, { fontSize: '32px' })
  assert.deepEqual(doc.nodes.title.states.hover.style, { color: 'red' })
})

test('replace drops what it does not name, merge keeps it', () => {
  const start = applyOperations(blank(), [
    { op: 'set-styles', id: 'a', styles: { color: 'red', fontSize: '10px' } },
  ]).doc

  const merged = applyOperations(start, [{ op: 'set-styles', id: 'a', styles: { color: 'blue' } }]).doc
  assert.deepEqual(merged.nodes.a.style, { color: 'blue', fontSize: '10px' })

  const replaced = applyOperations(start, [{ op: 'replace-styles', id: 'a', styles: { color: 'blue' } }]).doc
  assert.deepEqual(replaced.nodes.a.style, { color: 'blue' })
})

test('clearing the last declaration removes the node', () => {
  const start = applyOperations(blank(), [{ op: 'set-styles', id: 'a', styles: { color: 'red' } }]).doc
  const { doc } = applyOperations(start, [{ op: 'clear-styles', id: 'a', properties: ['color'] }])
  assert.deepEqual(doc.nodes, {})
})

test('content fields are set with strings and removed with null', () => {
  const start = applyOperations(blank(), [
    { op: 'set-content', id: 'a', content: { text: 'Hello', href: '/x', hidden: true } },
  ]).doc
  assert.deepEqual(start.nodes.a, { text: 'Hello', href: '/x', hidden: true })

  const { doc } = applyOperations(start, [{ op: 'set-content', id: 'a', content: { href: null } }])
  assert.equal(doc.nodes.a.href, undefined)
  assert.equal(doc.nodes.a.text, 'Hello')
})

test('inserting returns the new id and places it among its siblings', () => {
  const first = applyOperations(blank(), [{ op: 'insert-node', parentId: 'hero', kind: 'text' }])
  const second = applyOperations(first.doc, [
    { op: 'insert-node', parentId: 'hero', kind: 'image', id: 'hero::pinned', index: 0 },
  ])

  assert.equal(first.created.length, 1)
  assert.match(first.created[0], /^hero::added-/)
  assert.deepEqual(
    second.doc.inserted.map((node) => [node.id, node.index]),
    [['hero::pinned', 0], [first.created[0], 1]],
  )
  assert.equal(second.doc.nodes['hero::pinned'].src.length > 0, true, 'defaults are applied')
})

test('moving renumbers the siblings it moved between', () => {
  let doc = blank()
  for (const id of ['a', 'b', 'c']) {
    doc = applyOperations(doc, [{ op: 'insert-node', parentId: 'hero', kind: 'text', id }]).doc
  }
  doc = applyOperations(doc, [{ op: 'move-node', id: 'c', index: 0 }]).doc

  assert.deepEqual(
    doc.inserted.sort((x, y) => x.index - y.index).map((node) => node.id),
    ['c', 'a', 'b'],
  )
})

test('remove-node refuses a node that is not inserted, and says what to use instead', () => {
  const start = applyOperations(blank(), [{ op: 'set-content', id: 'title', content: { text: 'x' } }]).doc
  assert.throws(() => applyOperations(start, [{ op: 'remove-node', id: 'title' }]), /reset-node/)
  assert.deepEqual(applyOperations(start, [{ op: 'reset-node', id: 'title' }]).doc.nodes, {})
})

test('tokens are created, updated in place, and removed', () => {
  const created = applyOperations(blank(), [
    { op: 'set-token', token: { id: 'brand', name: 'Brand', kind: 'color', value: '#000' } },
  ]).doc
  const updated = applyOperations(created, [
    { op: 'set-token', token: { id: 'brand', name: 'Brand', kind: 'color', value: '#fff' } },
  ]).doc

  assert.equal(updated.tokens.length, 1)
  assert.equal(updated.tokens[0].value, '#fff')
  assert.deepEqual(applyOperations(updated, [{ op: 'remove-token', id: 'brand' }]).doc.tokens, [])
})

test('a bad operation fails the whole batch, leaving the document untouched', () => {
  const start = applyOperations(blank(), [{ op: 'set-content', id: 'a', content: { text: 'before' } }]).doc

  assert.throws(
    () =>
      applyOperations(start, [
        { op: 'set-content', id: 'a', content: { text: 'after' } },
        { op: 'set-styles', id: 'b', styles: { color: { nope: true } } },
      ]),
    (error) => error.name === 'OperationError' && error.index === 1,
  )
  assert.equal(start.nodes.a.text, 'before', 'the input document is never mutated')
})

test('a shape with no geometry takes the rest of the batch down with it', () => {
  const start = applyOperations(blank(), [{ op: 'set-content', id: 'a', content: { text: 'before' } }]).doc

  assert.throws(
    () =>
      applyOperations(start, [
        { op: 'set-content', id: 'a', content: { text: 'after' } },
        { op: 'insert-node', parentId: 'hero', kind: 'shape' },
      ]),
    (error) => error.name === 'OperationError' && error.index === 1 && /`shape` is required/.test(error.message),
  )
  assert.equal(start.nodes.a.text, 'before')
  assert.deepEqual(start.inserted, [])
})

test('an unknown operation is refused by name', () => {
  assert.throws(() => applyOperations(blank(), [{ op: 'delete-everything' }]), /delete-everything/)
})

test('an unknown content field is refused rather than stored', () => {
  assert.throws(() => applyOperations(blank(), [{ op: 'set-content', id: 'a', content: { onclick: 'x' } }]), /onclick/)
})

test('describeDocument summarises what is overridden without the style maps', () => {
  const { doc } = applyOperations(blank(), [
    { op: 'set-content', id: 'title', content: { text: 'Hello' } },
    { op: 'set-styles', id: 'title', styles: { color: 'red' }, breakpoint: 'lg', state: 'hover' },
    { op: 'insert-node', parentId: 'hero', kind: 'box', id: 'hero::b' },
    { op: 'set-token', token: { id: 'brand', name: 'Brand', kind: 'color', value: '#000' } },
  ])

  const summary = describeDocument(doc)
  const title = summary.nodes.find((node) => node.id === 'title')
  assert.deepEqual(title.overrides, ['text', 'hover:lg'])
  assert.equal(title.text, 'Hello')
  assert.equal(summary.nodes.find((node) => node.id === 'hero::b').inserted, true)
  assert.deepEqual(summary.counts, { nodes: 2, inserted: 1, tokens: 1 })
})

test('the store applies a batch as one undo step', () => {
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter() })
  store.apply([
    { op: 'set-content', id: 'a', content: { text: 'one' } },
    { op: 'set-content', id: 'b', content: { text: 'two' } },
  ])

  assert.equal(store.getOverride('a').text, 'one')
  store.undo()
  assert.deepEqual(store.getState().doc.nodes, {})
})
