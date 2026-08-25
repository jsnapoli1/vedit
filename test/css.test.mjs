import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentToCss, emptyDocument } from '../dist/index.js'

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
