import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentToCss, emptyDocument } from '../dist/index.js'
import { safeUrl, sanitizeHtml, sanitizeSvg, SVG_LIMIT } from '../dist/internal.js'

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

/**
 * `sanitizeSvg` under `node:test` exercises the *server* path — there is no
 * `DOMParser` here. That path is the conservative one; the browser path is the
 * authoritative one and runs before anything reaches the DOM, so
 * `e2e/shapes.spec.ts` imports a file with a real `<script>` in it and asserts
 * nothing ran.
 */

test('an imported SVG loses everything that executes', () => {
  const result = sanitizeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <script>window.__pwned = 1</script>
      <path d="M0 0h24v24H0z" onload="alert(1)" onclick="alert(2)"/>
      <foreignObject><body><iframe src="//evil.test"></iframe></body></foreignObject>
    </svg>
  `)
  assert.ok(result)
  assert.ok(!/script/i.test(result.svg))
  assert.ok(!/foreignObject/i.test(result.svg))
  assert.ok(!/iframe/i.test(result.svg))
  assert.ok(!/on\w+\s*=/i.test(result.svg))
  assert.ok(result.svg.includes('d="M0 0h24v24H0z"'), 'the drawing survives')
  assert.equal(result.viewBox, '0 0 24 24')
})

test('a <style> in an imported SVG is removed, because it would style the page', () => {
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><style>body{display:none}</style><rect/></svg>')
  assert.ok(result)
  assert.ok(!/style/i.test(result.svg))
  assert.ok(!result.svg.includes('display:none'))
})

test('animation and external-reference elements go too', () => {
  const result = sanitizeSvg(
    '<svg viewBox="0 0 10 10"><image href="//evil.test/x.png"/><a href="//evil.test">x</a>' +
      '<animate attributeName="x"/><set attributeName="x"/><circle r="5"/></svg>',
  )
  assert.ok(result)
  assert.ok(!/<image/i.test(result.svg))
  assert.ok(!/<a[\s>]/i.test(result.svg))
  assert.ok(!/<animate/i.test(result.svg))
  assert.ok(!/<set/i.test(result.svg))
  assert.ok(result.svg.includes('circle'))
})

test('href survives only when it points inside the document', () => {
  const external = sanitizeSvg('<svg viewBox="0 0 10 10"><use href="//evil.test/x.svg#a"/></svg>')
  assert.ok(external)
  assert.ok(!external.svg.includes('evil.test'))

  const internal = sanitizeSvg('<svg viewBox="0 0 10 10"><use href="#a"/></svg>')
  assert.ok(internal)
  assert.ok(internal.svg.includes('href="#a"'))
})

test('a style attribute that reaches out of the page is dropped', () => {
  const result = sanitizeSvg(
    '<svg viewBox="0 0 10 10"><rect style="fill:url(//evil.test/x)"/>' +
      '<circle style="fill:red"/></svg>',
  )
  assert.ok(result)
  assert.ok(!result.svg.includes('evil.test'))
  assert.ok(result.svg.includes('fill:red'), 'an ordinary style attribute stays')
})

test('ids and the references to them are scoped', () => {
  const result = sanitizeSvg(
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="paint0_linear"/></defs>' +
      '<rect fill="url(#paint0_linear)"/><use href="#paint0_linear"/></svg>',
    { scope: 'hero::added-ab12' },
  )
  assert.ok(result)
  assert.ok(!result.svg.includes('"paint0_linear"'), 'the bare id is gone')
  assert.ok(result.svg.includes('id="hero-added-ab12-paint0_linear"'))
  assert.ok(result.svg.includes('url(#hero-added-ab12-paint0_linear)'))
  assert.ok(result.svg.includes('href="#hero-added-ab12-paint0_linear"'))
})

test('an unscoped import keeps its ids, so the stored markup stays portable', () => {
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><linearGradient id="g"/></svg>')
  assert.ok(result)
  assert.ok(result.svg.includes('id="g"'))
})

test('markup with no <svg> root is refused', () => {
  assert.equal(sanitizeSvg('<div>not a drawing</div>'), null)
  assert.equal(sanitizeSvg(''), null)
})

test('an illustration too big to live in a document is refused', () => {
  const huge = `<svg viewBox="0 0 10 10"><path d="${'M0 0'.repeat(SVG_LIMIT / 4)}"/></svg>`
  assert.equal(sanitizeSvg(huge), null)
})

test('a missing viewBox is taken from width and height, then from the box', () => {
  const sized = sanitizeSvg('<svg width="48" height="24"><rect/></svg>')
  assert.equal(sized?.viewBox, '0 0 48 24')

  const bare = sanitizeSvg('<svg><rect/></svg>')
  assert.equal(bare?.viewBox, '0 0 100 100')
})
