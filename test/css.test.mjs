import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentToCss, emptyDocument } from '../dist/index.js'
import { REDUCED_MOTION_RULE } from '../dist/internal.js'

test('base overrides become a doubled-specificity rule', () => {
  const doc = { ...emptyDocument('home'), nodes: { 'hero.title': { style: { fontSize: '32px' } } } }
  const css = documentToCss(doc)
  assert.equal(css, '[data-vedit-id="hero.title"][data-vedit-id="hero.title"]{font-size:32px}')
})

test('numbers get px, unitless properties do not', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { style: { width: 40, opacity: 0.5, lineHeight: 1.4 } } } }
  const css = documentToCss(doc)
  assert.match(css, /width:40px/)
  assert.match(css, /opacity:0\.5/)
  assert.match(css, /line-height:1\.4/)
})

test('responsive overrides are emitted as min-width queries, smallest first', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { a: { responsive: { lg: { fontSize: '64px' }, md: { fontSize: '48px' } } } },
  }
  const css = documentToCss(doc)
  const mdIndex = css.indexOf('@media (min-width:768px)')
  const lgIndex = css.indexOf('@media (min-width:1024px)')
  assert.ok(mdIndex > -1 && lgIndex > mdIndex, css)
})

test('hidden nodes disappear for visitors but stay visible while editing', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { hidden: true } } }
  const css = documentToCss(doc)
  assert.match(css, /html:not\(\.vedit-editing\)[^\n]*display:none/)
  assert.match(css, /html\.vedit-editing[^\n]*opacity:\.35/)
})

test('ids containing quotes cannot break out of the selector', () => {
  const doc = { ...emptyDocument('home'), nodes: ({ 'a"]{}': { style: { color: 'red' } } }) }
  assert.ok(!documentToCss(doc).includes('a"]{}'))
})

test('state styles get their own rule and can be forced on by the editor', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { cta: { states: { hover: { style: { backgroundColor: '#000' } } } } },
  }
  const css = documentToCss(doc)
  const rule = css.split('\n').find((line) => line.includes('background-color:#000'))
  assert.ok(rule.startsWith('[data-vedit-id="cta"][data-vedit-id="cta"][data-vedit-id="cta"]:hover,'), rule)
  assert.ok(rule.includes('[data-vedit-force="hover"]{background-color:#000}'), rule)
})

test('a state rule outranks the same element base rule', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { cta: { style: { color: 'red' }, states: { hover: { style: { color: 'blue' } } } } },
  }
  const css = documentToCss(doc)
  const baseWeight = (css.match(/\[data-vedit-id="cta"\]/g) ?? []).length
  assert.ok(css.indexOf('color:red') < css.indexOf('color:blue'), 'base comes first')
  assert.ok(baseWeight > 4, 'state selector repeats the attribute more times')
})

test('states can be scoped to a breakpoint too', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { cta: { states: { focus: { responsive: { md: { outline: '2px solid' } } } } } },
  }
  const css = documentToCss(doc)
  assert.match(css, /@media \(min-width:768px\)\{.*:focus,.*\{outline:2px solid\}\}/)
})

test('tokens become custom properties on :root, before anything references them', () => {
  const doc = {
    ...emptyDocument('home'),
    tokens: [{ id: 'brand', name: 'Brand', kind: 'color', value: '#4f46e5' }],
    nodes: { a: { style: { color: 'var(--vedit-brand)' } } },
  }
  const css = documentToCss(doc)
  assert.match(css, /^:root\{--vedit-brand:#4f46e5\}/)
  assert.ok(css.indexOf(':root{') < css.indexOf('var(--vedit-brand)'))
})

test('a document with no tokens emits no :root block', () => {
  assert.ok(!documentToCss(emptyDocument('home')).includes(':root'))
})

test('a document with no animation emits exactly the CSS it did before motion existed', () => {
  const doc = {
    ...emptyDocument('home'),
    tokens: [{ id: 'brand', name: 'Brand', kind: 'color', value: '#4f46e5' }],
    nodes: {
      'hero.title': { style: { fontSize: '32px', color: 'var(--vedit-brand)' }, responsive: { md: { fontSize: '48px' } } },
      cta: { style: { color: 'red' }, states: { hover: { style: { color: 'blue' } } } },
      ghost: { hidden: true },
    },
  }
  // Captured from the emitter before keyframes were added. Byte-identical, not merely
  // equivalent: a page with no motion must not gain a single character of CSS.
  const expected =
    ':root{--vedit-brand:#4f46e5}\n' +
    '[data-vedit-id="hero.title"][data-vedit-id="hero.title"]{font-size:32px;color:var(--vedit-brand)}\n' +
    '[data-vedit-id="cta"][data-vedit-id="cta"]{color:red}\n' +
    '[data-vedit-id="cta"][data-vedit-id="cta"][data-vedit-id="cta"]:hover,[data-vedit-id="cta"][data-vedit-id="cta"][data-vedit-id="cta"][data-vedit-force="hover"]{color:blue}\n' +
    'html:not(.vedit-editing) [data-vedit-id="ghost"][data-vedit-id="ghost"][data-vedit-id="ghost"]{display:none !important}\n' +
    'html.vedit-editing [data-vedit-id="ghost"][data-vedit-id="ghost"][data-vedit-id="ghost"]{opacity:.35;outline:1px dashed var(--vedit-accent,#0d99ff)}\n' +
    '@media (min-width:768px){[data-vedit-id="hero.title"][data-vedit-id="hero.title"][data-vedit-id="hero.title"]{font-size:48px}}'
  assert.equal(documentToCss(doc), expected)
})

test('nothing animating means no keyframes and no reduced-motion rule', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { style: { animation: 'my-own-slide 2s linear' } } } }
  const css = documentToCss(doc)
  assert.ok(!css.includes('@keyframes'), css)
  assert.ok(!css.includes('prefers-reduced-motion'), css)
  // An unknown name is left for the host's own stylesheet to answer.
  assert.match(css, /animation:my-own-slide 2s linear/)
})

test('using a preset prepends its keyframes and appends the reduced-motion rule', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { style: { animation: 'vedit-spin 2s linear infinite' } } } }
  const css = documentToCss(doc)
  assert.ok(css.startsWith('@keyframes vedit-spin{'), css)
  assert.ok(css.endsWith(REDUCED_MOTION_RULE), css)
  assert.equal((css.match(/@keyframes/g) ?? []).length, 1)
})

test('only the presets actually in use are emitted', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: {
      a: { style: { animation: 'vedit-spin 2s linear infinite' } },
      b: { style: { animationName: 'vedit-pulse' } },
      c: { style: { animation: 'vedit-spin 4s linear infinite' } },
    },
  }
  const css = documentToCss(doc)
  assert.equal((css.match(/@keyframes/g) ?? []).length, 2)
  assert.match(css, /@keyframes vedit-spin\{/)
  assert.match(css, /@keyframes vedit-pulse\{/)
  assert.ok(!css.includes('vedit-float'), css)
})

test('a preset used only on hover or only at a breakpoint still gets its keyframes', () => {
  const hover = {
    ...emptyDocument('home'),
    nodes: { a: { states: { hover: { style: { animation: 'vedit-wiggle 300ms ease 1' } } } } },
  }
  assert.match(documentToCss(hover), /@keyframes vedit-wiggle\{/)

  const responsive = {
    ...emptyDocument('home'),
    nodes: { a: { responsive: { md: { animation: 'vedit-float 3s ease-in-out infinite' } } } },
  }
  assert.match(documentToCss(responsive), /@keyframes vedit-float\{/)
})

test('keyframes come before the rules that use them and after nothing else', () => {
  const doc = {
    ...emptyDocument('home'),
    tokens: [{ id: 'brand', name: 'Brand', kind: 'color', value: '#4f46e5' }],
    nodes: { a: { style: { animation: 'vedit-spin 2s linear infinite' } } },
  }
  const css = documentToCss(doc)
  assert.ok(css.indexOf('@keyframes') < css.indexOf(':root'), css)
  assert.ok(css.indexOf(':root') < css.indexOf('animation:vedit-spin'), css)
})

test('a style value naming a preset cannot smuggle CSS through the keyframes block', () => {
  const doc = {
    ...emptyDocument('home'),
    nodes: { a: { style: { animation: 'vedit-spin}body{display:none' } } },
  }
  const css = documentToCss(doc)
  // The value is stripped by declarations() as ever, and the keyframes bodies are
  // constants, so there is nothing to inject into.
  assert.ok(!css.includes('body{display:none'), css)
})

test('an animation iteration count given as a number is not turned into pixels', () => {
  const doc = { ...emptyDocument('home'), nodes: { a: { style: { animationIterationCount: 3 } } } }
  assert.match(documentToCss(doc), /animation-iteration-count:3\}/)
})
