import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itemId, itemKey, mergeOverrides, parseItemId } from '../dist/internal.js'

test('an item id is the template id and the key', () => {
  assert.equal(itemId('card.title', 'a'), 'card.title~a')
})

test('an item id parses back into its parts', () => {
  assert.deepEqual(parseItemId('card.title~a'), { templateId: 'card.title', key: 'a' })
})

test('an id with no item part parses as null', () => {
  assert.equal(parseItemId('card.title'), null)
})

test('a template id containing a dot still parses', () => {
  assert.deepEqual(parseItemId('home.cards.title~sku-1'), {
    templateId: 'home.cards.title',
    key: 'sku-1',
  })
})

test('a trailing separator is not an item id', () => {
  // `card.title~` would round-trip to an empty key, which names no item.
  assert.equal(parseItemId('card.title~'), null)
})

test('a leading separator is not an item id', () => {
  assert.equal(parseItemId('~a'), null)
})

test('the last separator wins, so a key may not contain one', () => {
  // Keys are sanitized on the way in; this documents the parse side of that.
  assert.deepEqual(parseItemId('a~b~c'), { templateId: 'a~b', key: 'c' })
})

test('a key comes from the data when there is one', () => {
  assert.equal(itemKey({ id: 'sku-1' }, 0), 'sku-1')
  assert.equal(itemKey({ key: 'k' }, 0), 'k')
  assert.equal(itemKey({ slug: 's' }, 0), 's')
})

test('a numeric id is usable as a key', () => {
  assert.equal(itemKey({ id: 42 }, 3), '42')
})

test('a key falls back to the index when the data has none', () => {
  assert.equal(itemKey({ name: 'no id here' }, 2), '2')
  assert.equal(itemKey('a string', 1), '1')
  assert.equal(itemKey(null, 4), '4')
})

test('an explicit key function wins over the data', () => {
  const key = itemKey({ id: 'ignored', sku: 'from-fn' }, 0, (item) => item.sku)
  assert.equal(key, 'from-fn')
})

test('an explicit key is sanitized like any other', () => {
  assert.equal(itemKey({}, 0, () => 'a~b'), 'a-b')
})

test('characters that structure an id are stripped from a key', () => {
  // `~`, `:`, `>`, `#` and `[]` all mean something in an id already.
  assert.equal(itemKey({ id: 'a~b' }, 0), 'a-b')
  assert.equal(itemKey({ id: 'a>b#c' }, 0), 'a-b-c')
})

test('a key that sanitizes to nothing falls back to the index', () => {
  assert.equal(itemKey({ id: '~~~' }, 7), '7')
})

test('an item override wins over the template', () => {
  const merged = mergeOverrides({ text: 'Buy now' }, { text: 'Sold out' })
  assert.equal(merged.text, 'Sold out')
})

test('the template shows through where the item says nothing', () => {
  const merged = mergeOverrides({ text: 'Buy now', href: '/buy' }, { text: 'Sold out' })
  assert.equal(merged.href, '/buy')
})

test('styles merge per property rather than wholesale', () => {
  const merged = mergeOverrides(
    { style: { padding: '8px', color: 'red' } },
    { style: { color: 'blue' } },
  )
  assert.deepEqual(merged.style, { padding: '8px', color: 'blue' })
})

test('a template breakpoint survives an item edit at another breakpoint', () => {
  const merged = mergeOverrides(
    { responsive: { lg: { fontSize: '48px' } } },
    { responsive: { sm: { fontSize: '20px' } } },
  )
  assert.deepEqual(merged.responsive, { lg: { fontSize: '48px' }, sm: { fontSize: '20px' } })
})

test('a shared breakpoint merges per property', () => {
  const merged = mergeOverrides(
    { responsive: { lg: { fontSize: '48px', color: 'red' } } },
    { responsive: { lg: { color: 'blue' } } },
  )
  assert.deepEqual(merged.responsive, { lg: { fontSize: '48px', color: 'blue' } })
})

test('interaction states merge rather than replace', () => {
  const merged = mergeOverrides(
    { states: { hover: { style: { color: 'red', textDecoration: 'underline' } } } },
    { states: { hover: { style: { color: 'blue' } } } },
  )
  assert.deepEqual(merged.states.hover.style, { color: 'blue', textDecoration: 'underline' })
})

test('a state only the template sets is kept', () => {
  const merged = mergeOverrides(
    { states: { hover: { style: { color: 'red' } } } },
    { states: { focus: { style: { outline: '2px solid' } } } },
  )
  assert.deepEqual(merged.states.hover.style, { color: 'red' })
  assert.deepEqual(merged.states.focus.style, { outline: '2px solid' })
})

test('props merge per name', () => {
  const merged = mergeOverrides(
    { props: { variant: 'solid', size: 'md' } },
    { props: { variant: 'outline' } },
  )
  assert.deepEqual(merged.props, { variant: 'outline', size: 'md' })
})

test('merging with nothing on either side is safe', () => {
  assert.deepEqual(mergeOverrides(undefined, undefined), {})
  assert.deepEqual(mergeOverrides({ text: 'a' }, undefined), { text: 'a' })
  assert.deepEqual(mergeOverrides(undefined, { text: 'b' }), { text: 'b' })
})

test('merging does not mutate either input', () => {
  const template = { style: { color: 'red' }, props: { a: 1 } }
  const item = { style: { color: 'blue' }, props: { b: 2 } }
  mergeOverrides(template, item)
  assert.deepEqual(template, { style: { color: 'red' }, props: { a: 1 } })
  assert.deepEqual(item, { style: { color: 'blue' }, props: { b: 2 } })
})
