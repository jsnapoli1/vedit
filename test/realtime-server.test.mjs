import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRealtimeHandler,
  createUnsafeLocalRealtimeHandler,
} from '../dist/server.js'

/** Read the next `data:` frame off an SSE stream. */
async function nextMessage(response, timeoutMs = 1000) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  let buffer = ''
  while (Date.now() < deadline) {
    // `read()` waits forever on a quiet stream, so race it against the deadline.
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ value: undefined, done: true }), deadline - Date.now())),
    ])
    const { value, done } = chunk
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frame = /data: (.*)\n\n/.exec(buffer)
    if (frame) {
      void reader.cancel()
      return JSON.parse(frame[1])
    }
  }
  void reader.cancel()
  return null
}

test('a published message reaches the other subscriber', async () => {
  const handle = createUnsafeLocalRealtimeHandler()
  const listener = await handle(new Request('https://s.test/rt?room=home&peer=alex'))
  assert.equal(listener.headers.get('content-type'), 'text/event-stream')

  const posted = await handle(
    new Request('https://s.test/rt?room=home&peer=sam', {
      method: 'POST',
      body: JSON.stringify({ type: 'presence', peer: { id: 'sam', name: 'Sam', color: '#000' } }),
    }),
  )
  assert.equal(posted.status, 204)

  const message = await nextMessage(listener)
  assert.equal(message.type, 'presence')
  assert.equal(message.peer.name, 'Sam')
})

test('the sender does not hear their own message', async () => {
  const handle = createUnsafeLocalRealtimeHandler({ heartbeatMs: 60_000 })
  const listener = await handle(new Request('https://s.test/rt?room=home&peer=sam'))
  await handle(
    new Request('https://s.test/rt?room=home&peer=sam', {
      method: 'POST',
      body: JSON.stringify({ type: 'bye', peerId: 'sam' }),
    }),
  )
  assert.equal(await nextMessage(listener, 200), null)
})

test('rooms are isolated from each other', async () => {
  const handle = createUnsafeLocalRealtimeHandler({ heartbeatMs: 60_000 })
  const listener = await handle(new Request('https://s.test/rt?room=marketing&peer=alex'))
  await handle(
    new Request('https://s.test/rt?room=docs&peer=sam', {
      method: 'POST',
      body: JSON.stringify({ type: 'bye', peerId: 'sam' }),
    }),
  )
  assert.equal(await nextMessage(listener, 200), null)
})

test('malformed messages are rejected rather than relayed', async () => {
  const handle = createUnsafeLocalRealtimeHandler()
  const response = await handle(
    new Request('https://s.test/rt?room=home&peer=sam', { method: 'POST', body: 'not json' }),
  )
  assert.equal(response.status, 400)
})

test('authorize gates both directions', async () => {
  const handle = createRealtimeHandler({ authorize: () => false })
  assert.equal((await handle(new Request('https://s.test/rt?room=home'))).status, 403)
  assert.equal(
    (await handle(new Request('https://s.test/rt?room=home', { method: 'POST', body: '{}' }))).status,
    403,
  )
})

test('a relay without authorize is refused at construction', () => {
  assert.throws(() => createRealtimeHandler(), /authorize/)
  assert.throws(() => createRealtimeHandler({}), /authorize/)
  assert.throws(() => createRealtimeHandler({ heartbeatMs: 60_000 }), /authorize/)
  // The escape hatch exists, but you have to name it.
  assert.doesNotThrow(() => createUnsafeLocalRealtimeHandler())
})

test('an authorized relay passes messages through', async () => {
  const seen = []
  const handle = createRealtimeHandler({
    heartbeatMs: 60_000,
    authorize: (request) => {
      seen.push(new URL(request.url).searchParams.get('peer'))
      return true
    },
  })
  const listener = await handle(new Request('https://s.test/rt?room=home&peer=alex'))
  await handle(
    new Request('https://s.test/rt?room=home&peer=sam', {
      method: 'POST',
      body: JSON.stringify({ type: 'bye', peerId: 'sam' }),
    }),
  )
  assert.equal((await nextMessage(listener)).type, 'bye')
  assert.deepEqual(seen, ['alex', 'sam'])
})
