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
 * The tests above ran the *server* pass. The whitelist only exists in the
 * browser pass, and there is no DOM under `node:test`, so the tests below give
 * the sanitiser just enough of one: a `<template>` whose `innerHTML` parses into
 * elements with the handful of members the walk uses. It is a stand-in, not a
 * browser — it knows void tags, raw-text tags and quoted or bare attributes, and
 * nothing else — but that is exactly the surface the sanitiser touches, so what
 * it proves about the whitelist holds in a real one.
 */

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input'])
const RAW_TEXT_TAGS = new Set(['script', 'style'])

class FakeNode {
  parentNode = null
  remove() {
    if (!this.parentNode) return
    const siblings = this.parentNode.childNodes
    siblings.splice(siblings.indexOf(this), 1)
    this.parentNode = null
  }
  replaceWith(...nodes) {
    const parent = this.parentNode
    const at = parent.childNodes.indexOf(this)
    for (const node of nodes) node.remove()
    parent.childNodes.splice(at, 1, ...nodes)
    for (const node of nodes) node.parentNode = parent
  }
}

class FakeText extends FakeNode {
  constructor(data) {
    super()
    this.data = data
  }
  serialize() {
    return this.data
  }
}

class FakeElement extends FakeNode {
  childNodes = []
  attributes = []
  constructor(tagName) {
    super()
    this.tagName = tagName.toUpperCase()
  }
  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement)
  }
  getAttribute(name) {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null
  }
  removeAttribute(name) {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name)
  }
  append(node) {
    node.remove()
    node.parentNode = this
    this.childNodes.push(node)
  }
  get innerHTML() {
    return this.childNodes.map((node) => node.serialize()).join('')
  }
  set innerHTML(html) {
    this.childNodes = []
    parseInto(this, html)
  }
  serialize() {
    const tag = this.tagName.toLowerCase()
    const attributes = this.attributes.map(({ name, value }) => ` ${name}="${value.replace(/"/g, '&quot;')}"`).join('')
    if (VOID_TAGS.has(tag)) return `<${tag}${attributes}>`
    return `<${tag}${attributes}>${this.innerHTML}</${tag}>`
  }
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseInto(root, html) {
  const open = [root]
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g
  let index = 0
  let match
  while ((match = tag.exec(html))) {
    const parent = open[open.length - 1]
    if (match.index > index) parent.append(new FakeText(html.slice(index, match.index)))
    index = match.index + match[0].length
    const name = match[2].toLowerCase()
    if (match[1]) {
      const at = open.findIndex((element) => element.tagName === name.toUpperCase())
      if (at > 0) open.length = at
      continue
    }
    const element = new FakeElement(name)
    for (const attribute of match[3].matchAll(ATTRIBUTE)) {
      element.attributes.push({ name: attribute[1].toLowerCase(), value: attribute[2] ?? attribute[3] ?? attribute[4] ?? '' })
    }
    parent.append(element)
    if (RAW_TEXT_TAGS.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'ig')
      close.lastIndex = index
      const end = close.exec(html)
      element.append(new FakeText(html.slice(index, end ? end.index : html.length)))
      index = end ? end.index + end[0].length : html.length
      tag.lastIndex = index
      continue
    }
    if (!VOID_TAGS.has(name) && !match[4]) open.push(element)
  }
  if (index < html.length) open[open.length - 1].append(new FakeText(html.slice(index)))
}

/** Run with a `document` whose only trick is `createElement('template')`. */
function inBrowser(run) {
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'template')
      const template = new FakeElement('template')
      template.content = new FakeElement('#document-fragment')
      Object.defineProperty(template, 'innerHTML', {
        get: () => template.content.innerHTML,
        set: (html) => {
          template.content.innerHTML = html
        },
      })
      return template
    },
  }
  try {
    return run()
  } finally {
    delete globalThis.document
  }
}

test('the block profile keeps headings, lists, links and images', () => {
  const html = inBrowser(() =>
    sanitizeHtml(
      '<h1>Title</h1><h2>Sub</h2><p>A <strong>bold</strong> <em>word</em> and <code>x</code>.</p>' +
        '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote>quote</blockquote>' +
        '<a href="https://example.com/a">link</a><img src="/hero.png" alt="Hero"><br>',
      { profile: 'block' },
    ),
  )
  assert.ok(html.includes('<h1>Title</h1>'))
  assert.ok(html.includes('<h2>Sub</h2>'))
  assert.ok(html.includes('<p>A <strong>bold</strong> <em>word</em> and <code>x</code>.</p>'))
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'))
  assert.ok(html.includes('<ol><li>first</li></ol>'))
  assert.ok(html.includes('<blockquote>quote</blockquote>'))
  assert.ok(html.includes('<a href="https://example.com/a">link</a>'))
  assert.ok(html.includes('<img src="/hero.png" alt="Hero">'))
  assert.ok(html.includes('<br>'))
})

test('the block profile still drops scripts, styles, handlers and javascript hrefs', () => {
  const html = inBrowser(() =>
    sanitizeHtml(
      '<p onclick="alert(1)">hi</p><script>window.__pwned = 1</script><style>body{display:none}</style>' +
        '<iframe src="//evil.test"></iframe><svg><script>alert(2)</script></svg>' +
        '<a href="javascript:alert(3)">no</a><div class="c" id="i" style="color:red">plain</div>',
      { profile: 'block' },
    ),
  )
  assert.equal(html, '<p>hi</p><a>no</a>plain')
})

test('an image in rich text keeps a data image and loses everything else', () => {
  const kept = inBrowser(() =>
    sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="a" onerror="x" style="y" class="z">', { profile: 'block' }),
  )
  assert.equal(kept, '<img src="data:image/png;base64,AAAA" alt="a">')

  const dropped = inBrowser(() => sanitizeHtml('<img src="data:text/html,<script>x</script>" alt="a">', { profile: 'block' }))
  assert.equal(dropped, '<img alt="a">')
})

test('a handler inside an unwrapped tag is stripped too', () => {
  // Unwrapping splices the children into the parent after the parent's list
  // was snapshotted, so a walk that unwraps first never sees them.
  assert.equal(
    inBrowser(() => sanitizeHtml('<div><span onclick="alert(1)">x</span><svg><script>alert(2)</script></svg></div>')),
    '<span>x</span>alert(2)',
  )
  assert.equal(
    inBrowser(() => sanitizeHtml('<div><svg><script>alert(2)</script></svg></div>', { profile: 'block' })),
    '',
  )
})

test('the default profile still unwraps block tags', () => {
  assert.equal(
    inBrowser(() => sanitizeHtml('<p>hi</p>')),
    'hi',
  )
  assert.equal(
    inBrowser(() => sanitizeHtml('<h1>x</h1><img src="/a.png"><b>bold</b>')),
    'x<b>bold</b>',
  )
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

test('an unclosed dangerous tag takes its text with it', () => {
  // Without a parser there is no subtree to remove, so the strip has to run to
  // the next `<`. Unwrapping the tag alone would store `.a{fill:red}` as text,
  // and the browser paints text that sits outside a `<text>`.
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><style>.a{fill:red}<path d="M0 0h10"/></svg>')
  assert.ok(result)
  assert.ok(result.svg.includes('<path'), 'the drawing survives')
  assert.ok(!result.svg.includes('.a{fill:red}'))
  assert.ok(!/style/i.test(result.svg))
})

test('an unclosed <script> leaves no source behind as text', () => {
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><script>var a=1;<path d="M0 0h10"/></svg>')
  assert.ok(result)
  assert.ok(result.svg.includes('<path'), 'the drawing survives')
  assert.ok(!result.svg.includes('var a=1;'))
  assert.ok(!/script/i.test(result.svg))
})

test('an on* attribute with no space before it is stripped too', () => {
  // `<path/onload=…>` is one token to a regex looking for whitespace, and the
  // browser reads the `/` as an attribute separator — so it counts as one here.
  const result = sanitizeSvg('<svg viewBox="0 0 10 10"><path/onload=alert(1) d="M0 0h10"/></svg>')
  assert.ok(result)
  assert.ok(result.svg.includes('<path'), 'the drawing survives')
  assert.ok(!/onload/i.test(result.svg))
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
