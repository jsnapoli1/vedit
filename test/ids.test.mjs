import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAutoId } from '../dist/index.js'

/** Enough of an element to satisfy the id walker, without pulling in a DOM. */
function el(tag, options = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id: options.id ?? '',
    attributes: options.attributes ?? {},
    children: [],
    parentElement: null,
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
  }
  for (const child of options.children ?? []) {
    child.parentElement = node
    node.children.push(child)
  }
  return node
}

test('ids describe the path from the nearest anchor', () => {
  const h1 = el('h1')
  const root = el('body', { children: [el('header'), el('section', { children: [h1] })] })
  assert.equal(computeAutoId(h1, root), 'auto:section>h1')
})

test('repeated tags are disambiguated by index', () => {
  const second = el('p')
  const root = el('body', { children: [el('p'), second] })
  assert.equal(computeAutoId(second, root), 'auto:p[1]')
})

test('an element id anchors the path so markup above it can change freely', () => {
  const span = el('span')
  const root = el('body', { children: [el('div', { children: [el('main', { id: 'app', children: [span] })] })] })
  assert.equal(computeAutoId(span, root), 'auto:#app>span')
})

test('an Editable ancestor anchors the path without stacking prefixes', () => {
  const span = el('span')
  const wrapper = el('div', { attributes: { 'data-vedit-id': 'auto:#app>section' }, children: [span] })
  const root = el('body', { children: [wrapper] })
  assert.equal(computeAutoId(span, root), 'auto:#app>section>span')
})
