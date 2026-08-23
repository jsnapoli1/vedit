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
