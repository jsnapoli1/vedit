import { test } from 'node:test'
import assert from 'node:assert/strict'
import { warnOnce, resetWarnings } from '../dist/internal.js'

function capture(run) {
  const lines = []
  const original = console.warn
  console.warn = (...args) => lines.push(args.join(' '))
  try {
    run()
  } finally {
    console.warn = original
  }
  return lines
}

test('a warning names the library, so it is searchable', () => {
  resetWarnings()
  const lines = capture(() => warnOnce('a', 'something is off'))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\[vedit\] something is off$/)
})

test('the same warning fires once, however often the render path runs', () => {
  resetWarnings()
  const lines = capture(() => {
    for (let i = 0; i < 100; i += 1) warnOnce('b', 'repeated')
  })
  assert.equal(lines.length, 1)
})

test('different problems each get their own warning', () => {
  resetWarnings()
  const lines = capture(() => {
    warnOnce('one', 'first')
    warnOnce('two', 'second')
  })
  assert.equal(lines.length, 2)
})

test('nothing is logged in a production build', () => {
  resetWarnings()
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    assert.deepEqual(capture(() => warnOnce('c', 'quiet please')), [])
  } finally {
    process.env.NODE_ENV = previous
  }
})
