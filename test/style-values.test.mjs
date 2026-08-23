import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTransform,
  serializeTransform,
  withTransform,
  parseGradient,
  serializeGradient,
} from '../dist/index.js'

test('a transform round-trips through its parts', () => {
  const parts = parseTransform('translate(10px, -4px) rotate(45deg) scale(1.5)')
  assert.deepEqual(parts, { translateX: 10, translateY: -4, rotate: 45, scaleX: 1.5, scaleY: 1.5 })
  assert.equal(serializeTransform(parts), 'translate(10px, -4px) rotate(45deg) scale(1.5)')
})

test('editing one part of a transform keeps the others', () => {
  assert.equal(
    withTransform('rotate(30deg) scale(2)', { translateX: 8, translateY: 0 }),
    'translate(8px, 0px) rotate(30deg) scale(2)',
  )
})

test('an identity transform serializes to nothing', () => {
  assert.equal(withTransform('translate(4px, 4px)', { translateX: 0, translateY: 0 }), undefined)
})

test('gradients round-trip, including colours containing commas', () => {
  const gradient = parseGradient('linear-gradient(45deg, rgba(0, 0, 0, .5) 0%, #fff 100%)')
  assert.equal(gradient.type, 'linear')
  assert.equal(gradient.angle, 45)
  assert.deepEqual(gradient.stops, [
    { color: 'rgba(0, 0, 0, .5)', position: 0 },
    { color: '#fff', position: 100 },
  ])
  assert.equal(serializeGradient(gradient), 'linear-gradient(45deg, rgba(0, 0, 0, .5) 0%, #fff 100%)')
})

test('stops without positions are spread evenly', () => {
  const gradient = parseGradient('linear-gradient(#000, #888, #fff)')
  assert.deepEqual(gradient.stops.map((s) => s.position), [0, 50, 100])
})

test('non-gradient values parse to null', () => {
  assert.equal(parseGradient('none'), null)
  assert.equal(parseGradient(undefined), null)
  assert.equal(parseGradient('url(a.png)'), null)
})

test('stops are sorted when serialized', () => {
  const css = serializeGradient({
    type: 'linear',
    angle: 90,
    stops: [
      { color: '#fff', position: 100 },
      { color: '#000', position: 0 },
    ],
  })
  assert.equal(css, 'linear-gradient(90deg, #000 0%, #fff 100%)')
})
