import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Editable, EditableFile, VeditProvider, emptyDocument, memoryAdapter } from '../dist/index.js'

/** A page rendered the way a server would, with the overrides given. */
function render(children, nodes = {}) {
  const doc = { ...emptyDocument('file-test'), nodes }
  return renderToString(
    createElement(
      VeditProvider,
      { documentKey: doc.key, adapter: memoryAdapter(), initialDocument: doc, enabled: false },
      children,
    ),
  )
}

/** The rendered `<a>` for a node id, so assertions read the element and not the page. */
function anchorFor(html, id) {
  const match = html.match(new RegExp(`<a[^>]*data-vedit-id="${id}"[^>]*>`))
  assert.ok(match, `no anchor for ${id} in ${html}`)
  return match[0]
}

test('EditableFile renders an anchor carrying the file kind', () => {
  const html = render(
    createElement(EditableFile, { id: 'hero.datasheet', href: '/files/datasheet.pdf' }, 'Datasheet (PDF)'),
  )
  const anchor = anchorFor(html, 'hero.datasheet')
  assert.ok(anchor.includes('data-vedit-kind="file"'), anchor)
  assert.ok(anchor.includes('href="/files/datasheet.pdf"'), anchor)
  assert.ok(html.includes('Datasheet (PDF)'))
})

test('an anchor whose href ends in a document extension infers the file kind and a page link stays a link', () => {
  const html = render(
    createElement(
      'div',
      null,
      createElement(Editable, { id: 'doc', as: 'a', href: '/downloads/report.PDF?v=2' }, 'Report'),
      createElement(Editable, { id: 'zip', as: 'a', href: 'https://cdn.example.com/kit.zip' }, 'Kit'),
      createElement(Editable, { id: 'page', as: 'a', href: '/pricing' }, 'Pricing'),
      createElement(Editable, { id: 'dotted', as: 'a', href: '/about.html' }, 'About'),
    ),
  )
  assert.ok(anchorFor(html, 'doc').includes('data-vedit-kind="file"'))
  assert.ok(anchorFor(html, 'zip').includes('data-vedit-kind="file"'))
  assert.ok(anchorFor(html, 'page').includes('data-vedit-kind="link"'))
  assert.ok(anchorFor(html, 'dotted').includes('data-vedit-kind="link"'))
})

test('a file override href goes through safeUrl', () => {
  const html = render(
    createElement(EditableFile, { id: 'hero.datasheet', href: '/files/datasheet.pdf' }, 'Datasheet'),
    { 'hero.datasheet': { href: 'javascript:alert(1)' } },
  )
  const anchor = anchorFor(html, 'hero.datasheet')
  // Exactly what a link does with the same override: the executable scheme is
  // dropped and the anchor falls back to `#`.
  assert.ok(!anchor.includes('javascript:'), anchor)
  assert.ok(anchor.includes('href="#"'), anchor)
})
