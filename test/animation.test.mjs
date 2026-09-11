import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANIMATION_PRESETS,
  REDUCED_MOTION_RULE,
  animationName,
  keyframesFor,
  parseAnimation,
  presetsIn,
  serializeAnimation,
} from '../dist/internal.js'

const PRESETS = ['spin', 'pulse', 'float', 'fadeIn', 'draw', 'wiggle']

test('the preset set is closed and every entry is complete', () => {
  assert.deepEqual(Object.keys(ANIMATION_PRESETS), PRESETS)
  for (const preset of PRESETS) {
    const entry = ANIMATION_PRESETS[preset]
    assert.equal(typeof entry.label, 'string')
    assert.ok(entry.label.length)
    assert.ok(entry.keyframes.includes('{'), preset)
    assert.ok(entry.duration > 0, preset)
    assert.equal(typeof entry.easing, 'string')
    assert.equal(typeof entry.loops, 'boolean')
  }
})

test('preset names are namespaced so they cannot collide with the host stylesheet', () => {
  assert.equal(animationName('spin'), 'vedit-spin')
  assert.equal(animationName('fadeIn'), 'vedit-fadeIn')
})

test('the looping presets loop and the one-shot ones do not', () => {
  assert.equal(ANIMATION_PRESETS.spin.loops, true)
  assert.equal(ANIMATION_PRESETS.pulse.loops, true)
  assert.equal(ANIMATION_PRESETS.float.loops, true)
  assert.equal(ANIMATION_PRESETS.wiggle.loops, true)
  assert.equal(ANIMATION_PRESETS.fadeIn.loops, false)
  assert.equal(ANIMATION_PRESETS.draw.loops, false)
})

test('draw sets the dasharray as well as animating the offset, so it works without any other setup', () => {
  const body = ANIMATION_PRESETS.draw.keyframes
  assert.match(body, /stroke-dasharray:1/)
  assert.match(body, /stroke-dashoffset:1/)
  assert.match(body, /stroke-dashoffset:0/)
})

test('a serialised animation names the preset, its duration, easing and repeat', () => {
  assert.equal(
    serializeAnimation({ preset: 'spin', duration: 2000, easing: 'linear', loops: true }),
    'vedit-spin 2000ms linear infinite',
  )
  assert.equal(
    serializeAnimation({ preset: 'fadeIn', duration: 400, easing: 'ease-out', loops: false }),
    'vedit-fadeIn 400ms ease-out 1',
  )
})

test('what serializeAnimation writes, parseAnimation reads back', () => {
  for (const preset of PRESETS) {
    const parts = {
      preset,
      duration: ANIMATION_PRESETS[preset].duration,
      easing: ANIMATION_PRESETS[preset].easing,
      loops: ANIMATION_PRESETS[preset].loops,
    }
    assert.deepEqual(parseAnimation(serializeAnimation(parts)), parts)
  }
})

test('seconds are accepted as well as milliseconds', () => {
  assert.equal(parseAnimation('vedit-spin 2s linear infinite').duration, 2000)
  assert.equal(parseAnimation('vedit-spin 1.5s linear infinite').duration, 1500)
  assert.equal(parseAnimation('vedit-spin 800ms linear infinite').duration, 800)
})

test('a repeat count other than infinite means it does not loop', () => {
  assert.equal(parseAnimation('vedit-pulse 1s ease 3').loops, false)
  assert.equal(parseAnimation('vedit-pulse 1s ease infinite').loops, true)
})

test('the order of the shorthand does not matter, as it does not to CSS', () => {
  const parts = parseAnimation('infinite 2s linear vedit-spin')
  assert.equal(parts.preset, 'spin')
  assert.equal(parts.duration, 2000)
  assert.equal(parts.loops, true)
})

test('missing pieces fall back to the preset defaults', () => {
  assert.deepEqual(parseAnimation('vedit-float'), {
    preset: 'float',
    duration: ANIMATION_PRESETS.float.duration,
    easing: ANIMATION_PRESETS.float.easing,
    loops: ANIMATION_PRESETS.float.loops,
  })
})

test('an easing with arguments of its own survives the round trip', () => {
  // `split(/[\s,]+/)` used to cut `cubic-bezier(0.1, 0.2, 0.3, 0.4)` into five
  // tokens, so the easing came back as `cubic-bezier(0.1` and what was written
  // out again was CSS the browser drops on the floor.
  for (const easing of [
    'cubic-bezier(0.1, 0.2, 0.3, 0.4)',
    'cubic-bezier(0.1 0.2 0.3 0.4)',
    'steps(4, end)',
  ]) {
    const parsed = parseAnimation(`vedit-spin 2s ${easing} infinite`)
    assert.equal(parsed.easing, easing, easing)
    assert.equal(parsed.duration, 2000, easing)
    assert.equal(parsed.loops, true, easing)
    assert.equal(serializeAnimation(parsed), `vedit-spin 2000ms ${easing} infinite`)
    assert.deepEqual(parseAnimation(serializeAnimation(parsed)), parsed, easing)
  }
})

test('anything not naming a vedit preset is null — a host animation is left alone', () => {
  assert.equal(parseAnimation('my-slide 2s linear infinite'), null)
  assert.equal(parseAnimation('vedit-nonsense 2s'), null)
  assert.equal(parseAnimation(undefined), null)
  assert.equal(parseAnimation(''), null)
  assert.equal(parseAnimation(3), null)
})

test('presetsIn finds every preset a declaration references, once each', () => {
  assert.deepEqual(presetsIn('vedit-spin 2s linear infinite'), ['spin'])
  assert.deepEqual(presetsIn('vedit-spin 2s, vedit-pulse 1s'), ['spin', 'pulse'])
  assert.deepEqual(presetsIn('vedit-spin 2s, vedit-spin 1s'), ['spin'])
  assert.deepEqual(presetsIn('my-own 2s'), [])
  assert.deepEqual(presetsIn(''), [])
})

test('presetsIn does not match a longer name that merely starts with a preset', () => {
  assert.deepEqual(presetsIn('vedit-spinner 2s linear'), [])
})

test('keyframesFor emits one block per preset and nothing for an empty set', () => {
  assert.equal(keyframesFor([]), '')
  const css = keyframesFor(['spin', 'draw'])
  assert.match(css, /@keyframes vedit-spin\{/)
  assert.match(css, /@keyframes vedit-draw\{/)
  assert.ok(!css.includes('vedit-pulse'))
  assert.equal((css.match(/@keyframes/g) ?? []).length, 2)
})

test('keyframesFor takes any iterable and emits each preset once', () => {
  const css = keyframesFor(new Set(['spin', 'spin', 'pulse']))
  assert.equal((css.match(/@keyframes/g) ?? []).length, 2)
})

test('the reduced-motion rule is the one !important, and it is on the visitor side', () => {
  assert.equal(
    REDUCED_MOTION_RULE,
    '@media (prefers-reduced-motion:reduce){[data-vedit-id]{animation-duration:.01ms!important;animation-iteration-count:1!important}}',
  )
})
