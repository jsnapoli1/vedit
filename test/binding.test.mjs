import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import {
  Editable,
  EditableFile,
  VeditProvider,
  emptyDocument,
  memoryAdapter,
  useVeditRecords,
  useVeditStore,
} from '../dist/index.js'

const ROWS = [
  {
    id: 'a',
    title: 'Anvil',
    blurb: '<p>Heavy</p><script>alert(1)</script>',
    photo: { url: '/media/a.png', kind: 'image', alt: 'An anvil' },
    datasheet: { url: '/media/a.pdf', kind: 'file', name: 'a.pdf' },
  },
  {
    id: 'b',
    title: 'Boomerang',
    blurb: '<p>Comes back</p>',
    // Imported from somewhere older: a bare url instead of an asset object.
    photo: '/media/b.png',
    datasheet: '/media/b.pdf',
  },
]

const SCHEMA = [
  {
    name: 'products',
    kind: 'collection',
    label: 'Products',
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'blurb', type: 'richtext', label: 'Blurb' },
      { name: 'photo', type: 'image', label: 'Photo' },
      { name: 'datasheet', type: 'file', label: 'Datasheet' },
    ],
    drafts: true,
    can: { read: true, create: true, update: true, delete: true, publish: true },
  },
]

/** A client that must never be asked anything: rendering a page fetches nothing. */
function silentClient() {
  const refuse = async () => {
    throw new Error('rendering reached the content client')
  }
  return { schema: refuse, list: refuse, get: refuse, commit: refuse, capabilities: refuse }
}

/**
 * `renderToString` runs no effects, so the store is driven from inside the tree:
 * this renders before the nodes that read it, and they see the result.
 */
function Drive({ run }) {
  run(useVeditStore())
  return null
}

/** A page rendered the way a server would, with a hook to drive the store first. */
function render(children, { drive = () => undefined, content = silentClient() } = {}) {
  return renderToString(
    h(
      VeditProvider,
      {
        documentKey: 'catalog',
        adapter: memoryAdapter(),
        initialDocument: emptyDocument('catalog'),
        enabled: false,
        content,
      },
      h(Drive, { run: drive }),
      children,
    ),
  )
}

/** The catalog the phase-3 demo renders: a repeat over rows, with bound children. */
function catalog(rows = ROWS, ...children) {
  return h(
    Editable,
    { id: 'products', repeat: rows, source: 'products' },
    ...(children.length ? children : [h(Editable, { id: 'products.title', as: 'h3', bind: 'title' }, 'Untitled')]),
  )
}

const count = (html, needle) => (html.match(new RegExp(needle, 'g')) ?? []).length

test('a bound node renders the field from its row', () => {
  const html = render(catalog())
  assert.equal(count(html, '>Anvil<'), 1)
  assert.equal(count(html, '>Boomerang<'), 1)
  assert.ok(!html.includes('Untitled'), 'the source text is only a fallback')
  assert.ok(html.includes('data-vedit-id="products.title~a"'))
})

test('a record edit in the store shows on the page without a document change', () => {
  let store
  const html = render(catalog(), {
    drive: (each) => {
      store = each
      store.setRecord('products', 'a', { title: 'Anvil, on sale' })
    },
  })
  assert.equal(count(html, '>Anvil, on sale<'), 1)
  assert.equal(count(html, '>Boomerang<'), 1)
  assert.deepEqual(store.getState().doc.nodes, {}, 'the document is untouched')
  assert.equal(store.dirty, true, 'the record edit is what needs saving')
})

test('bind inside a repeat with a source resolves to the row of that item', () => {
  const html = render(catalog(), {
    drive: (store) => store.setRecord('products', 'b', { title: 'Boomerang, back soon' }),
  })
  assert.equal(count(html, '>Anvil<'), 1)
  assert.equal(count(html, '>Boomerang, back soon<'), 1)
  assert.ok(!html.includes('>Boomerang<'))

  // Outside a repeat a field name has no row to resolve against, so the node
  // renders as if unbound, and says so once rather than silently.
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const loose = render(h(Editable, { id: 'hero.title', as: 'h1', bind: 'title' }, 'Hello'))
    assert.ok(loose.includes('>Hello<'))
    assert.ok(
      warnings.some((line) => line.includes('hero.title') && line.includes('bind')),
      `expected a warning naming hero.title, got ${JSON.stringify(warnings)}`,
    )
  } finally {
    console.warn = original
  }
})

test('a bound image and a bound file resolve an asset object to its url', () => {
  const html = render(
    catalog(
      ROWS,
      h(Editable, { id: 'products.photo', as: 'img', bind: 'photo', src: '/placeholder.png', alt: 'Product' }),
      h(EditableFile, { id: 'products.sheet', bind: 'datasheet', href: '#' }, 'Datasheet'),
    ),
  )
  assert.ok(html.includes('src="/media/a.png"'))
  assert.ok(html.includes('src="/media/b.png"'), 'a bare url still renders')
  assert.ok(html.includes('href="/media/a.pdf"'))
  assert.ok(html.includes('href="/media/b.pdf"'))
  assert.ok(!html.includes('/placeholder.png'))
  assert.ok(!html.includes('href="#"'))
  assert.ok(html.includes('alt="An anvil"'), 'the asset carries its own description')
  assert.ok(html.includes('alt="Product"'), 'without one the host alt stays')
  assert.ok(html.includes('data-vedit-kind="file"'))
})

test('a bound richtext field renders block markup, sanitised', () => {
  const blurb = h(Editable, { id: 'products.blurb', as: 'div', bind: 'blurb' }, 'No description yet')
  const html = render(catalog(ROWS, blurb), {
    // The schema arrives from the client after load, which a server render
    // never waits for; putting it in place is what the client would have done.
    drive: (store) => {
      store.state = { ...store.getState(), schema: SCHEMA }
    },
  })
  assert.ok(html.includes('<p>Heavy</p>'), 'block markup survives')
  assert.ok(html.includes('<p>Comes back</p>'))
  assert.ok(!html.includes('<script'), 'script does not')
  assert.ok(!html.includes('No description yet'))

  // Without a schema nobody has said the field is rich text, so it is text.
  const plain = render(catalog(ROWS, blurb))
  assert.ok(plain.includes('&lt;p&gt;Heavy&lt;/p&gt;'))
  assert.ok(!plain.includes('<p>Heavy</p>'))
})

test('useVeditRecords returns the host rows for a visitor and overlays local changes for an editor', () => {
  function Titles({ rows, fallback }) {
    const records = useVeditRecords('products', { rows, fallback })
    return h('pre', null, records.map((record) => record.title).join('|'))
  }

  const visitor = render(h(Titles, { rows: ROWS }))
  assert.ok(visitor.includes('<pre>Anvil|Boomerang</pre>'))

  const editor = render(h(Titles, { rows: ROWS }), {
    drive: (store) => {
      store.setEditing(true)
      store.setRecord('products', 'a', { title: 'Anvil, on sale' })
      store.createRecord('products', { title: 'Crate' })
      store.deleteRecord('products', 'b')
    },
  })
  assert.ok(editor.includes('<pre>Anvil, on sale|Crate</pre>'))

  // Without rows nothing is known yet, so the fallback stands in.
  const empty = render(h(Titles, { fallback: [{ id: 'x', title: 'Loading' }] }))
  assert.ok(empty.includes('<pre>Loading</pre>'))

  // Without a content client there is nowhere to fetch from, and the rows are the answer.
  const offline = render(h(Titles, { rows: ROWS }), { content: undefined })
  assert.ok(offline.includes('<pre>Anvil|Boomerang</pre>'))
})
