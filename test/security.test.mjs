import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentToCss, emptyDocument, safeUrl, sanitizeHtml } from '../dist/index.js'

/**
 * An overrides document is data. It reaches every visitor's page, so it is only
 * as trustworthy as whoever can write to the store — these are the checks that
 * keep a compromised document from becoming a compromised site.
 */

test('a style value cannot close its rule and inject more CSS', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { a: { style: { color: 'red}body{display:none;}' } } },
  }
  const css = documentToCss(doc)
  assert.equal(css.split('{').length - 1, 1, 'exactly one block was opened')
  assert.ok(!css.includes('body{'))
})

test('a style value cannot escape the <style> element', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { a: { style: { content: '"</style><script>alert(1)</script>"' } } },
  }
  const css = documentToCss(doc)
  assert.ok(!css.includes('</style'))
  assert.ok(!css.includes('<script'))
})

test('a token cannot inject through its value or its name', () => {
  const doc = {
    ...emptyDocument('home'),
    tokens: [
      { id: 'brand', name: 'Brand', kind: 'color', value: 'red}body{display:none' },
      { id: 'evil}body{color:red', name: 'Evil', kind: 'color', value: 'blue' },
    ],
  }
  const css = documentToCss(doc)
  assert.equal(css.split('}').length - 1, 1)
  assert.ok(!css.includes('--vedit-evil'), 'a malformed token id is dropped entirely')
})

test('property names that are not property names are dropped', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { a: { style: { 'color:red;background': 'url(x)', color: 'blue' } } },
  }
  assert.equal(documentToCss(doc), '[data-vedit-id="a"][data-vedit-id="a"]{color:blue}')
})

test('legitimate values survive intact', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: {
      a: {
        style: {
          fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
          background: 'linear-gradient(90deg, rgba(0,0,0,.5) 0%, #fff 100%)',
          transform: 'translate(4px, -8px) rotate(45deg)',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        },
      },
    },
  }
  const css = documentToCss(doc)
  assert.ok(css.includes('"Helvetica Neue", Helvetica, sans-serif'))
  assert.ok(css.includes('linear-gradient(90deg, rgba(0,0,0,.5) 0%, #fff 100%)'))
  assert.ok(css.includes('translate(4px, -8px) rotate(45deg)'))
  assert.ok(css.includes('repeat(3, minmax(0, 1fr))'))
})

test('executable URL schemes are refused', () => {
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
  assert.equal(safeUrl('  JaVaScRiPt:alert(1)'), undefined)
  assert.equal(safeUrl('vbscript:msgbox'), undefined)
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), undefined)
})

test('leading control characters do not hide a scheme', () => {
  const hidden = `${String.fromCharCode(1, 9, 10)}javascript:alert(1)`
  assert.equal(safeUrl(hidden), undefined)
})

test('ordinary URLs pass through', () => {
  assert.equal(safeUrl('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d')
  assert.equal(safeUrl('/pricing'), '/pricing')
  assert.equal(safeUrl('#section'), '#section')
  assert.equal(safeUrl('mailto:hi@example.com'), 'mailto:hi@example.com')
})

test('inline images are allowed for src and refused for href', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(safeUrl(png, { allowDataImage: true }), png)
  assert.equal(safeUrl(png), undefined)
  assert.equal(safeUrl('data:text/html;base64,PHN2Zz4=', { allowDataImage: true }), undefined)
})

test('rich text keeps formatting and loses everything else', () => {
  const html = sanitizeHtml('<b>bold</b><script>alert(1)</script><a href="javascript:x">no</a>')
  assert.ok(html.includes('<b>bold</b>'))
  assert.ok(!html.includes('script'))
  assert.ok(!html.includes('javascript:'))
})
