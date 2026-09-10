import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFilter, serializeFilter, withFilter, FILTER_IDENTITY } from '../dist/internal.js'

test('an absent filter parses to the identity', () => {
  assert.deepEqual(parseFilter(undefined), FILTER_IDENTITY)
  assert.deepEqual(parseFilter('none'), FILTER_IDENTITY)
  assert.deepEqual(parseFilter(12), FILTER_IDENTITY)
})

test('the identity serialises to undefined, so the property is cleared rather than set to nothing', () => {
  assert.equal(serializeFilter(FILTER_IDENTITY), undefined)
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, rest: [] }), undefined)
})

test('each part round-trips', () => {
  const parts = { blur: 4, brightness: 1.2, contrast: 0.8, saturate: 1.5, hueRotate: 90, grayscale: 0.25 }
  const css = serializeFilter(parts)
  assert.equal(css, 'blur(4px) brightness(1.2) contrast(0.8) saturate(1.5) hue-rotate(90deg) grayscale(0.25)')
  const back = parseFilter(css)
  for (const [key, value] of Object.entries(parts)) assert.equal(back[key], value, key)
})

test('identity parts are omitted from the serialised value', () => {
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, blur: 6 }), 'blur(6px)')
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, hueRotate: 45 }), 'hue-rotate(45deg)')
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, grayscale: 1 }), 'grayscale(1)')
})

test('values are rounded to three decimal places', () => {
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, brightness: 1 / 3 }), 'brightness(0.333)')
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, blur: 2.00001 }), 'blur(2px)')
})

test('a drop shadow rides along with the colour parts', () => {
  const css = serializeFilter({ ...FILTER_IDENTITY, blur: 2, dropShadow: '0 2px 4px rgba(0, 0, 0, .3)' })
  assert.equal(css, 'blur(2px) drop-shadow(0 2px 4px rgba(0, 0, 0, .3))')
  assert.equal(parseFilter(css).dropShadow, '0 2px 4px rgba(0, 0, 0, .3)')
  assert.equal(parseFilter(css).blur, 2)
})

test('a drop shadow alone is not the identity', () => {
  assert.equal(serializeFilter({ ...FILTER_IDENTITY, dropShadow: '0 1px 2px #000' }), 'drop-shadow(0 1px 2px #000)')
})

test('unknown filter functions survive a round trip, verbatim and in order', () => {
  const parts = parseFilter('sepia(0.4) blur(3px) invert(1)')
  assert.deepEqual(parts.rest, ['sepia(0.4)', 'invert(1)'])
  assert.equal(parts.blur, 3)
  // The unknown parts come first so editing a slider never reorders someone's hand-written value.
  assert.equal(serializeFilter(parts), 'sepia(0.4) invert(1) blur(3px)')
})

test('a value made only of unknown functions is not the identity', () => {
  assert.equal(serializeFilter(parseFilter('sepia(1)')), 'sepia(1)')
})

test('withFilter changes one part and leaves the rest alone', () => {
  assert.equal(withFilter('blur(2px) saturate(1.5)', { blur: 8 }), 'blur(8px) saturate(1.5)')
  assert.equal(withFilter('sepia(1) blur(2px)', { blur: 0 }), 'sepia(1)')
  assert.equal(withFilter('blur(2px)', { blur: 0 }), undefined)
  assert.equal(withFilter(undefined, { hueRotate: 180 }), 'hue-rotate(180deg)')
})

test('withFilter can clear a drop shadow without touching the colour parts', () => {
  assert.equal(withFilter('blur(2px) drop-shadow(0 1px 2px #000)', { dropShadow: undefined }), 'blur(2px)')
})

test('a nested paren inside drop-shadow does not end the function early', () => {
  const parts = parseFilter('drop-shadow(0 0 6px rgb(255, 0, 0)) blur(1px)')
  assert.equal(parts.dropShadow, '0 0 6px rgb(255, 0, 0)')
  assert.equal(parts.blur, 1)
})

test('garbage in a stored value never throws', () => {
  assert.deepEqual(parseFilter('blur(banana)'), { ...FILTER_IDENTITY, rest: ['blur(banana)'] })
  assert.equal(parseFilter('').blur, 0)
})
