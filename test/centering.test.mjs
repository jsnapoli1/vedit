import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centerActions, centeringStyles, parentLayout } from '../dist/internal.js'

const block = { display: 'block', flexDirection: 'row' }
const flexRow = { display: 'flex', flexDirection: 'row' }
const flexColumn = { display: 'flex', flexDirection: 'column' }
const grid = { display: 'grid', flexDirection: 'row' }

/** The action for one axis, or undefined when it wasn't offered. */
const on = (targets, axis) => centerActions(targets).find((action) => action.axis === axis)

test('a block parent centres horizontally with auto side margins', () => {
  assert.deepEqual(centeringStyles(block, 'horizontal'), { marginLeft: 'auto', marginRight: 'auto' })
})

test('a block parent is offered no vertical centring, because CSS has no answer there', () => {
  assert.equal(centeringStyles(block, 'vertical'), null)
  assert.equal(on([{ id: 'a', parent: block }], 'vertical'), undefined)
})

test('a flex row takes the free space with margins and crosses the line with align-self', () => {
  assert.deepEqual(centeringStyles(flexRow, 'horizontal'), { marginLeft: 'auto', marginRight: 'auto' })
  assert.deepEqual(centeringStyles(flexRow, 'vertical'), { alignSelf: 'center' })
})

test('a flex column swaps the two over', () => {
  assert.deepEqual(centeringStyles(flexColumn, 'horizontal'), { alignSelf: 'center' })
  assert.deepEqual(centeringStyles(flexColumn, 'vertical'), { marginTop: 'auto', marginBottom: 'auto' })
})

test('a grid parent has a self property per axis', () => {
  assert.deepEqual(centeringStyles(grid, 'horizontal'), { justifySelf: 'center' })
  assert.deepEqual(centeringStyles(grid, 'vertical'), { alignSelf: 'center' })
})

test('inline-flex and inline-grid parents count as their block forms', () => {
  assert.deepEqual(centeringStyles({ display: 'inline-grid', flexDirection: 'row' }, 'horizontal'), {
    justifySelf: 'center',
  })
  assert.deepEqual(centeringStyles({ display: 'inline-flex', flexDirection: 'column' }, 'horizontal'), {
    alignSelf: 'center',
  })
})

test('an element with no parent is offered nothing', () => {
  assert.equal(centeringStyles(null, 'horizontal'), null)
  assert.deepEqual(centerActions([{ id: 'a', parent: null }]), [])
})

test('the whole selection is written, each node the way its own parent allows', () => {
  const action = on(
    [
      { id: 'hero.title', parent: block },
      { id: 'hero.badge', parent: flexColumn },
      { id: 'hero.card', parent: grid },
    ],
    'horizontal',
  )
  assert.deepEqual(action.entries, [
    ['hero.title', { marginLeft: 'auto', marginRight: 'auto' }],
    ['hero.badge', { alignSelf: 'center' }],
    ['hero.card', { justifySelf: 'center' }],
  ])
  assert.equal(action.title, 'Centers each one the way its own parent allows')
})

test('a node whose parent cannot centre on that axis is left out of the write', () => {
  const action = on(
    [
      { id: 'hero.title', parent: block },
      { id: 'hero.badge', parent: flexRow },
    ],
    'vertical',
  )
  assert.deepEqual(action.entries, [['hero.badge', { alignSelf: 'center' }]])
})

test('margin longhands are written and never the shorthand', () => {
  const written = [block, flexRow, flexColumn, grid].flatMap((parent) =>
    centerActions([{ id: 'a', parent }]).flatMap((action) => Object.keys(action.entries[0][1])),
  )
  assert.ok(written.includes('marginLeft'))
  assert.ok(written.includes('marginTop'))
  assert.equal(
    written.some((property) => property === 'margin' || property.startsWith('margin-')),
    false,
  )
})

test('the tooltip says the declarations the button is about to write', () => {
  assert.equal(on([{ id: 'a', parent: block }], 'horizontal').title, 'Sets margin-left: auto and margin-right: auto')
  assert.equal(on([{ id: 'a', parent: grid }], 'vertical').title, 'Sets align-self: center')
})

test('the parent layout is read off the live element', () => {
  // Duck-typed the way the editor's other DOM readers are: a parent, the view
  // that computes its style, and nothing else.
  const parent = { ownerDocument: { defaultView: null } }
  parent.ownerDocument.defaultView = {
    getComputedStyle: (node) => (node === parent ? { display: 'flex', flexDirection: 'column-reverse' } : null),
  }
  assert.deepEqual(parentLayout({ parentElement: parent }), { display: 'flex', flexDirection: 'column-reverse' })
  assert.equal(parentLayout({ parentElement: null }), null)
  assert.equal(parentLayout(undefined), null)
})

test('a reversed flex direction centres on the same axes as its forward form', () => {
  const reversed = { display: 'flex', flexDirection: 'column-reverse' }
  assert.deepEqual(centeringStyles(reversed, 'horizontal'), { alignSelf: 'center' })
  assert.deepEqual(centeringStyles(reversed, 'vertical'), { marginTop: 'auto', marginBottom: 'auto' })
})
