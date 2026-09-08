import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSubmission, isHoneypotFilled, HONEYPOT_NAME } from '../dist/index.js'

/**
 * The hook itself needs a DOM, and this suite deliberately has none — its job is
 * to check what `dist/` exports, not to host React. The pure half is tested
 * here; the timing, focus and submission behaviour is in `e2e/forms.spec.ts`.
 */

test('a submission carries the form id, the values and a timestamp', () => {
  const body = buildSubmission('contact', { email: 'a@b.co' })
  assert.equal(body.formId, 'contact')
  assert.deepEqual(body.values, { email: 'a@b.co' })
  assert.ok(!Number.isNaN(Date.parse(body.submittedAt)))
})

test('the honeypot field is bookkeeping, not an answer, so it is not submitted', () => {
  const body = buildSubmission('contact', { email: 'a@b.co', [HONEYPOT_NAME]: '' })
  assert.deepEqual(body.values, { email: 'a@b.co' })
})

test('a filled honeypot is detected', () => {
  assert.equal(isHoneypotFilled({ [HONEYPOT_NAME]: 'spam' }), true)
  assert.equal(isHoneypotFilled({ [HONEYPOT_NAME]: '' }), false)
  assert.equal(isHoneypotFilled({}), false)
})
