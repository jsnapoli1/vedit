import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, placeholdersIn, unknownPlaceholders } from '../dist/index.js'

test('a placeholder is replaced by the host value', () => {
  assert.equal(interpolate('Pay {amount} deposit', { amount: '$250' }), 'Pay $250 deposit')
})

test('several placeholders, including one used twice', () => {
  const out = interpolate('{a} then {b}, then {a} again', { a: 'one', b: 'two' })
  assert.equal(out, 'one then two, then one again')
})

test('text with no placeholder is returned untouched', () => {
  assert.equal(interpolate('Register for camp', { amount: '$250' }), 'Register for camp')
})

/**
 * The staleness guarantee, stated as a test: the same template renders whatever
 * the host says today. Nothing about `$250` survives in the template itself.
 */
test('the same template renders a new value when the host value changes', () => {
  const template = 'Pay {amount} deposit'
  assert.equal(interpolate(template, { amount: '$250' }), 'Pay $250 deposit')
  assert.equal(interpolate(template, { amount: '$300' }), 'Pay $300 deposit')
})

test('an unknown name is left as written rather than blanked', () => {
  assert.equal(interpolate('Pay {amonut} deposit', { amount: '$250' }), 'Pay {amonut} deposit')
})

test('no vars at all leaves every placeholder alone', () => {
  assert.equal(interpolate('Pay {amount} deposit', undefined), 'Pay {amount} deposit')
})

test('doubled braces escape to a single brace', () => {
  assert.equal(interpolate('{{amount}}', { amount: '$250' }), '{amount}')
  assert.equal(interpolate('{{literal}} and {amount}', { amount: '$250' }), '{literal} and $250')
})

test('escaping works with no vars supplied', () => {
  assert.equal(interpolate('{{amount}}', undefined), '{amount}')
})

test('an empty value substitutes as empty, and is not treated as missing', () => {
  assert.equal(interpolate('a{gap}b', { gap: '' }), 'ab')
  assert.deepEqual(unknownPlaceholders('a{gap}b', { gap: '' }), [])
})

test('placeholdersIn lists names in order without duplicates', () => {
  assert.deepEqual(placeholdersIn('{b} {a} {b} {c}'), ['b', 'a', 'c'])
})

test('placeholdersIn ignores escaped braces', () => {
  assert.deepEqual(placeholdersIn('{{notavar}} but {real}'), ['real'])
})

test('unknownPlaceholders names only what the host did not offer', () => {
  assert.deepEqual(unknownPlaceholders('{amount} {date}', { amount: '$250' }), ['date'])
})

test('a malformed placeholder is left alone rather than throwing', () => {
  assert.equal(interpolate('half open {amo', { amo: 'x' }), 'half open {amo')
  assert.equal(interpolate('{ spaced }', { spaced: 'x' }), '{ spaced }')
})
