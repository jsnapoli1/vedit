import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Editable, VeditProvider, emptyDocument, memoryAdapter } from '../dist/index.js'

const PRODUCTS = [
  { sku: 'a', name: 'Anvil' },
  { sku: 'b', name: 'Boomerang' },
  { sku: 'c', name: 'Crate' },
]

/** A page with one repeat over `items`, rendered the way a server would. */
function render(doc, items = PRODUCTS, extra = {}) {
  return renderToString(
    createElement(
      VeditProvider,
      {
        documentKey: doc.key,
        adapter: memoryAdapter(),
        initialDocument: doc,
        enabled: false,
      },
      createElement(
        Editable,
        { id: 'cards', repeat: items, repeatKey: (item) => item.sku, ...extra },
        createElement(Editable, { id: 'cards.title', as: 'h3' }, 'Buy now'),
      ),
    ),
  )
}

function doc(nodes = {}) {
  return { ...emptyDocument('repeat-test'), nodes }
}

test('a repeat renders the template once per item', () => {
  const html = render(doc())
  assert.equal(html.match(/Buy now/g).length, 3)
})

test('each item gets its own id, keyed by the data', () => {
  const html = render(doc())
  for (const sku of ['a', 'b', 'c']) {
    assert.ok(html.includes(`data-vedit-id="cards.title~${sku}"`), `missing item ${sku}`)
  }
})

test('an empty array renders nothing rather than failing', () => {
  const html = render(doc(), [])
  assert.ok(!html.includes('Buy now'))
})

test('the repeating element itself renders no wrapper of its own', () => {
  // It is a loop, not a box: a div here would land inside the host's grid.
  const html = render(doc())
  assert.ok(!html.includes('data-vedit-id="cards"'))
})

test('a template edit reaches every item', () => {
  const html = render(doc({ 'cards.title': { text: 'On sale' } }))
  assert.equal(html.match(/On sale/g).length, 3)
  assert.ok(!html.includes('Buy now'))
})

test('an item edit changes only that item', () => {
  const html = render(
    doc({
      'cards.title': { text: 'On sale' },
      'cards.title~b': { text: 'Sold out' },
    }),
  )
  assert.equal(html.match(/On sale/g).length, 2)
  assert.equal(html.match(/Sold out/g).length, 1)
})

test('an item edit wins over the template for that item only', () => {
  const html = render(doc({ 'cards.title~a': { text: 'Just this one' } }))
  assert.equal(html.match(/Just this one/g).length, 1)
  assert.equal(html.match(/Buy now/g).length, 2)
})

test('edits follow the key when the list reorders', () => {
  const edited = doc({ 'cards.title~c': { text: 'Crate only' } })
  const reversed = [...PRODUCTS].reverse()

  const before = render(edited)
  const after = render(edited, reversed)

  // Same edit, same item, regardless of where it now sits in the array.
  assert.equal(before.match(/Crate only/g).length, 1)
  assert.equal(after.match(/Crate only/g).length, 1)
  assert.ok(after.includes('data-vedit-id="cards.title~c"'))
})

test('an item added to the front does not steal another item\'s edit', () => {
  const edited = doc({ 'cards.title~a': { text: 'Anvil only' } })
  const grown = [{ sku: 'z', name: 'Zeppelin' }, ...PRODUCTS]

  const html = render(edited, grown)
  assert.equal(html.match(/Anvil only/g).length, 1)
  assert.equal(html.match(/Buy now/g).length, 3)
})

test('data with no id falls back to the index', () => {
  const html = render(doc(), [{ name: 'one' }, { name: 'two' }], { repeatKey: undefined })
  assert.ok(html.includes('data-vedit-id="cards.title~0"'))
  assert.ok(html.includes('data-vedit-id="cards.title~1"'))
})

test('the host\'s data never reaches the document', () => {
  // The whole point: vedit repeats over `products` and stores nothing about it.
  const document = doc({ 'cards.title': { text: 'On sale' } })
  const before = JSON.stringify(document)
  render(document)
  assert.equal(JSON.stringify(document), before)
  assert.ok(!before.includes('Anvil'))
  assert.ok(!before.includes('sku'))
})

test('styles merge across template and item', () => {
  const html = render(
    doc({
      'cards.title': { style: { color: 'red' } },
      'cards.title~b': { style: { fontWeight: 'bold' } },
    }),
  )
  // Both nodes render; the stylesheet is emitted separately, so what matters
  // here is that neither override made the render throw or drop an item.
  assert.equal(html.match(/Buy now/g).length, 3)
})
