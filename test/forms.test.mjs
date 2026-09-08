import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFormFields, validateField, validateForm, safeFormAction } from '../dist/index.js'

const field = (over = {}) => ({ name: 'email', type: 'email', ...over })

test('a required field rejects empty and accepts a value', () => {
  const f = field({ rules: [{ kind: 'required' }] })
  assert.ok(validateField(f, { email: '' }))
  assert.equal(validateField(f, { email: 'a@b.co' }), undefined)
})

test('a field with no rules is always valid', () => {
  assert.equal(validateField(field(), { email: 'nonsense' }), undefined)
})

/**
 * The timing guarantee stated as a test: an optional field someone has not
 * filled in is not yet wrong. Only `required` speaks about emptiness.
 */
test('an empty optional field skips its other rules', () => {
  const f = field({ rules: [{ kind: 'email' }] })
  assert.equal(validateField(f, { email: '' }), undefined)
})

test('email accepts a plain address and rejects one without a domain', () => {
  const f = field({ rules: [{ kind: 'email' }] })
  assert.equal(validateField(f, { email: 'someone@example.com' }), undefined)
  assert.ok(validateField(f, { email: 'someone@' }))
})

test('minLength counts at the boundary', () => {
  const f = field({ name: 'x', type: 'text', rules: [{ kind: 'minLength', value: 3 }] })
  assert.ok(validateField(f, { x: 'ab' }))
  assert.equal(validateField(f, { x: 'abc' }), undefined)
})

test('maxLength counts at the boundary', () => {
  const f = field({ name: 'x', type: 'text', rules: [{ kind: 'maxLength', value: 3 }] })
  assert.equal(validateField(f, { x: 'abc' }), undefined)
  assert.ok(validateField(f, { x: 'abcd' }))
})

test('min and max compare numerically, not as strings', () => {
  const f = field({ name: 'n', type: 'number', rules: [{ kind: 'min', value: 5 }] })
  assert.equal(validateField(f, { n: '10' }), undefined)
  assert.ok(validateField(f, { n: '4' }))
})

test('integer rejects a decimal', () => {
  const f = field({ name: 'n', type: 'number', rules: [{ kind: 'integer' }] })
  assert.equal(validateField(f, { n: '4' }), undefined)
  assert.ok(validateField(f, { n: '4.5' }))
})

test('a checkbox satisfies required only when checked', () => {
  const f = field({ name: 'ok', type: 'checkbox', rules: [{ kind: 'required' }] })
  assert.ok(validateField(f, { ok: false }))
  assert.equal(validateField(f, { ok: true }), undefined)
})

test('matches compares against a sibling field', () => {
  const f = field({ name: 'confirm', type: 'email', rules: [{ kind: 'matches', field: 'email' }] })
  assert.equal(validateField(f, { email: 'a@b.co', confirm: 'a@b.co' }), undefined)
  assert.ok(validateField(f, { email: 'a@b.co', confirm: 'typo@b.co' }))
})

test('each pattern preset accepts good input and rejects bad', () => {
  const cases = [
    ['usZip', '94110', '9411'],
    ['usPhone', '(415) 555-0132', '555'],
    ['postcodeUk', 'SW1A 1AA', 'NOTAPOSTCODE'],
    ['slug', 'hello-world', 'Hello World'],
    ['hexColor', '#1b7f4c', 'blue'],
  ]
  for (const [preset, good, bad] of cases) {
    const f = field({ name: 'v', type: 'text', rules: [{ kind: 'pattern', preset }] })
    assert.equal(validateField(f, { v: good }), undefined, `${preset} should accept ${good}`)
    assert.ok(validateField(f, { v: bad }), `${preset} should reject ${bad}`)
  }
})

test('a custom message replaces the default for that rule kind', () => {
  const f = field({ rules: [{ kind: 'required' }] })
  assert.equal(validateField(f, { email: '' }, { required: 'We need this' }), 'We need this')
})

test('validateForm reports per field and omits the valid ones', () => {
  const fields = [field({ rules: [{ kind: 'required' }] }), field({ name: 'name', type: 'text' })]
  const errors = validateForm(fields, { email: '', name: 'Ada' })
  assert.ok(errors.email)
  assert.equal(errors.name, undefined)
})

/* --------------------------------------------------------- untrusted parsing */

test('a non-array of descriptors parses to empty', () => {
  assert.deepEqual(parseFormFields(undefined), [])
  assert.deepEqual(parseFormFields('nope'), [])
  assert.deepEqual(parseFormFields({}), [])
})

test('an unknown field type falls back to text', () => {
  const [f] = parseFormFields([{ name: 'a', type: 'wat' }])
  assert.equal(f.type, 'text')
})

test('an unknown rule kind is dropped, keeping the known ones', () => {
  const [f] = parseFormFields([
    { name: 'a', type: 'text', rules: [{ kind: 'required' }, { kind: 'sudo' }] },
  ])
  assert.deepEqual(f.rules, [{ kind: 'required' }])
})

/**
 * The security property, as a test. A preset name that is not in the table can
 * never reach a `RegExp`, so a document cannot smuggle a pattern onto the page.
 */
test('an unknown pattern preset is dropped', () => {
  const [f] = parseFormFields([
    { name: 'a', type: 'text', rules: [{ kind: 'pattern', preset: 'evil' }] },
  ])
  assert.deepEqual(f.rules, [])
})

test('a field with no usable name is dropped', () => {
  assert.deepEqual(parseFormFields([{ type: 'text' }, { name: '', type: 'text' }]), [])
})

test('a duplicate name keeps the first and drops the rest', () => {
  const fields = parseFormFields([
    { name: 'a', type: 'text', label: 'First' },
    { name: 'a', type: 'text', label: 'Second' },
  ])
  assert.equal(fields.length, 1)
  assert.equal(fields[0].label, 'First')
})

test('a matches rule pointing at a field that does not exist is dropped', () => {
  const [f] = parseFormFields([
    { name: 'confirm', type: 'text', rules: [{ kind: 'matches', field: 'ghost' }] },
  ])
  assert.deepEqual(f.rules, [])
})

test('a numeric rule without a usable number is dropped', () => {
  const [f] = parseFormFields([
    { name: 'a', type: 'text', rules: [{ kind: 'minLength', value: 'lots' }] },
  ])
  assert.deepEqual(f.rules, [])
})

/* ------------------------------------------------------------- form action */

test('an executable scheme is refused as a form action', () => {
  assert.equal(safeFormAction('javascript:fetch(1)'), undefined)
  assert.equal(safeFormAction('data:text/html,x'), undefined)
})

test('a same-origin path is allowed', () => {
  assert.equal(safeFormAction('/api/contact'), '/api/contact')
})

test('an https url is allowed and a cross-origin http url is refused', () => {
  assert.equal(safeFormAction('https://forms.example.com/x'), 'https://forms.example.com/x')
  assert.equal(safeFormAction('http://evil.example.com/x'), undefined)
})
