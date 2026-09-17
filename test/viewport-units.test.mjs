import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasViewportHeightUnit,
  pinViewportHeightUnits,
  referenceViewportHeight,
  viewportHeightFromUrl,
} from '../dist/internal.js'
import { canvasUrl } from '../dist/internal.js'

test('viewport height units are pinned to pixels of the reference height', () => {
  assert.equal(pinViewportHeightUnits('90vh', 900), '810px')
  assert.equal(pinViewportHeightUnits('calc(100vh - 80px)', 900), 'calc(900px - 80px)')
  assert.equal(pinViewportHeightUnits('100svh', 640), '640px')
  assert.equal(pinViewportHeightUnits('50dvh 2rem', 800), '400px 2rem')
  assert.equal(pinViewportHeightUnits('-10lvh', 900), '-90px')
  assert.equal(pinViewportHeightUnits('12.5vh', 800), '100px')
})

test('other units are left alone', () => {
  assert.equal(pinViewportHeightUnits('100vw', 900), '100vw')
  assert.equal(pinViewportHeightUnits('var(--vhx)', 900), 'var(--vhx)')
  assert.equal(hasViewportHeightUnit('100vw'), false)
  assert.equal(hasViewportHeightUnit('min(100vh, 900px)'), true)
})

test('the reference height is the editor screen, never a sliver', () => {
  assert.equal(referenceViewportHeight(1050), 1050)
  assert.equal(referenceViewportHeight(300), 600)
  assert.equal(referenceViewportHeight(899.6), 900)
})

test('the frame reads the reference height from its url', () => {
  assert.equal(viewportHeightFromUrl('?vedit-canvas=1&vedit-vh=900'), 900)
  assert.equal(viewportHeightFromUrl('?vedit-canvas=1'), null)
  assert.equal(viewportHeightFromUrl('?vedit-vh=nope'), null)
  assert.equal(viewportHeightFromUrl('?vedit-vh=-5'), null)
})

test('canvasUrl carries the reference height and does not inherit a stale one', () => {
  const url = new URL(canvasUrl('/pricing', 900))
  assert.equal(url.searchParams.get('vedit-canvas'), '1')
  assert.equal(url.searchParams.get('vedit-vh'), '900')
  assert.equal(new URL(canvasUrl('/pricing')).searchParams.get('vedit-vh'), null)
})

/** Just enough CSSOM for `pinnedRulesFor`: a rule list with nesting and parents. */
function styleOf(decls) {
  const names = Object.keys(decls)
  const style = { length: names.length }
  names.forEach((name, i) => (style[i] = name))
  style.getPropertyValue = (name) => decls[name]?.value ?? ''
  style.getPropertyPriority = (name) => decls[name]?.priority ?? ''
  return style
}
function styleRule(selectorText, decls, parentRule = null) {
  return { selectorText, style: styleOf(decls), parentRule }
}
function group(prelude, children) {
  const rule = { cssText: `${prelude} { … }`, cssRules: children, parentRule: null }
  children.forEach((child) => (child.parentRule = rule))
  return rule
}

test('rules that use viewport height units are copied with their nesting, pinned to px', async () => {
  const { pinnedRulesFor } = await import('../dist/internal.js')
  const media = group('@media (min-width: 768px)', [styleRule('.md\\:h-\\[90vh\\]', { height: { value: '90vh' } })])
  const layer = group('@layer utilities', [
    styleRule('.h-\\[80vh\\]', { height: { value: '80vh' } }),
    styleRule('.p-4', { padding: { value: '1rem' } }),
    media,
  ])
  const rules = [styleRule('.min-h-screen', { 'min-height': { value: '100vh', priority: 'important' } }), layer]
  assert.equal(
    pinnedRulesFor(rules, 900),
    [
      '.min-h-screen { min-height: 900px !important }',
      '@layer utilities { .h-\\[80vh\\] { height: 720px } }',
      '@layer utilities { @media (min-width: 768px) { .md\\:h-\\[90vh\\] { height: 810px } } }',
    ].join('\n'),
  )
})

test('a stylesheet without viewport height units yields nothing', async () => {
  const { pinnedRulesFor } = await import('../dist/internal.js')
  assert.equal(pinnedRulesFor([styleRule('.p-4', { padding: { value: '1rem' } })], 900), '')
})
