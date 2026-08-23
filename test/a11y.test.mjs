import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrastRatio, parseColor, luminance } from '../dist/index.js'

test('parses rgb and rgba, with alpha in either notation', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [255, 0, 0, 1])
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5])
  assert.deepEqual(parseColor('rgb(0 0 0 / 50%)'), [0, 0, 0, 0.5])
  assert.equal(parseColor('transparent'), null)
})

test('luminance matches the WCAG anchors', () => {
  assert.equal(Math.round(luminance([255, 255, 255, 1]) * 1000) / 1000, 1)
  assert.equal(luminance([0, 0, 0, 1]), 0)
})

test('contrast ratio is 21:1 for black on white and symmetric', () => {
  const black = [0, 0, 0, 1]
  const white = [255, 255, 255, 1]
  assert.equal(contrastRatio(black, white), 21)
  assert.equal(contrastRatio(white, black), 21)
  assert.equal(contrastRatio(white, white), 1)
})

test('a known failing pair lands below the 4.5 threshold', () => {
  // #767676 on white is the classic boundary case: passes. #888 does not.
  assert.ok(contrastRatio(parseColor('rgb(118, 118, 118)'), parseColor('rgb(255,255,255)')) >= 4.5)
  assert.ok(contrastRatio(parseColor('rgb(136, 136, 136)'), parseColor('rgb(255,255,255)')) < 4.5)
})
