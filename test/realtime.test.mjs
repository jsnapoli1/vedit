import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VeditStore,
  RealtimeSession,
  memoryAdapter,
  diffDocuments,
  emptyDocument,
  colorForPeer,
  initialsOf,
} from '../dist/index.js'

/** An in-process transport: every connection in a room hears the others. */
function loopback() {
  const rooms = new Map()
  return {
    connect(room, onMessage) {
      const members = rooms.get(room) ?? new Set()
      const connection = {
        onMessage,
        send(message) {
          for (const other of members) {
            if (other !== connection) other.onMessage(JSON.parse(JSON.stringify(message)))
          }
        },
        close() {
          members.delete(connection)
        },
      }
      members.add(connection)
      rooms.set(room, members)
      return connection
    },
  }
}

function makeStore(key = 'home') {
  return new VeditStore({ key, adapter: memoryAdapter() })
}

async function pair(transport = loopback()) {
  const a = makeStore()
  const b = makeStore()
  const sessionA = new RealtimeSession(a, transport, memoryAdapter(), { id: 'sam', name: 'Sam' }, 'room')
  const sessionB = new RealtimeSession(b, transport, memoryAdapter(), { id: 'alex', name: 'Alex' }, 'room')
  await sessionA.start()
  await sessionB.start()
  return { a, b, sessionA, sessionB }
}

test('diffing reports added, changed and removed nodes', () => {
  const before = { ...emptyDocument('home'), nodes: { a: { text: 'one' }, b: { text: 'keep' } } }
  const after = { ...before, nodes: { a: { text: 'two' }, b: before.nodes.b, c: { text: 'new' } } }

  const patch = diffDocuments(before, after)
  assert.deepEqual(Object.keys(patch.nodes).sort(), ['a', 'c'])
  assert.equal(patch.nodes.a.text, 'two')

  const removal = diffDocuments(after, { ...after, nodes: { b: after.nodes.b } })
  assert.equal(removal.nodes.a, null)
  assert.equal(removal.nodes.c, null)
})

test('an unchanged document produces no patch', () => {
  const doc = emptyDocument('home')
  assert.equal(diffDocuments(doc, { ...doc }), null)
})

test('inserted elements and tokens travel too', () => {
  const before = emptyDocument('home')
  const after = { ...before, tokens: [{ id: 'brand', name: 'Brand', kind: 'color', value: '#000' }] }
  assert.equal(diffDocuments(before, after).tokens.length, 1)
})

test('peers see each other after joining', async () => {
  const { sessionA, sessionB } = await pair()
  assert.deepEqual(sessionA.getSnapshot().peers.map((p) => p.name), ['Alex'])
  assert.deepEqual(sessionB.getSnapshot().peers.map((p) => p.name), ['Sam'])
  sessionA.stop()
  assert.deepEqual(sessionB.getSnapshot().peers, [])
  sessionB.stop()
})

test('a selection is broadcast as presence', async () => {
  const { a, sessionA, sessionB } = await pair()
  a.register({ id: 'hero', kind: 'text', label: 'Hero', element: {}, parentId: null, auto: false, container: false })
  a.select('hero')
  assert.deepEqual(sessionB.getSnapshot().peers[0].selection, ['hero'])
  sessionA.stop()
  sessionB.stop()
})

test('edits to different elements both survive; the same element is last write wins', async () => {
  const { a, b, sessionA, sessionB } = await pair()

  a.update('title', { text: 'from Sam' })
  b.update('body', { text: 'from Alex' })

  assert.equal(b.getOverride('title').text, 'from Sam')
  assert.equal(a.getOverride('body').text, 'from Alex')

  a.update('title', { text: 'Sam again' })
  b.update('title', { text: 'Alex last' })
  assert.equal(a.getOverride('title').text, 'Alex last')

  sessionA.stop()
  sessionB.stop()
})

test('a remote change is not undoable — undo is for your own actions', async () => {
  const { a, b, sessionA, sessionB } = await pair()
  a.update('title', { text: 'mine' })
  b.update('body', { text: 'theirs' })

  a.undo()
  assert.equal(a.getOverride('title').text, undefined, 'my change is undone')
  assert.equal(a.getOverride('body').text, 'theirs', 'their change is untouched')

  sessionA.stop()
  sessionB.stop()
})

test('patches for another document are ignored', async () => {
  const transport = loopback()
  const a = makeStore('home')
  const b = makeStore('pricing')
  const sessionA = new RealtimeSession(a, transport, memoryAdapter(), { id: 'sam' }, 'room')
  const sessionB = new RealtimeSession(b, transport, memoryAdapter(), { id: 'alex' }, 'room')
  await sessionA.start()
  await sessionB.start()

  a.update('title', { text: 'home only' })
  assert.deepEqual(b.getState().doc.nodes, {})

  sessionA.stop()
  sessionB.stop()
})

test('comments propagate, take replies, resolve and delete', async () => {
  const { sessionA, sessionB } = await pair()

  const comment = sessionA.addComment({ body: 'Too long', nodeId: 'title', x: 0.5, y: 0.5 })
  assert.equal(sessionB.getSnapshot().comments[0].body, 'Too long')

  sessionB.reply(comment.id, 'Agreed')
  assert.equal(sessionA.getSnapshot().comments[0].replies[0].body, 'Agreed')
  assert.equal(sessionA.getSnapshot().comments[0].replies[0].author.name, 'Alex')

  sessionB.setResolved(comment.id, true)
  assert.equal(sessionA.getSnapshot().comments[0].resolved, true)

  sessionA.removeComment(comment.id)
  assert.deepEqual(sessionB.getSnapshot().comments, [])

  sessionA.stop()
  sessionB.stop()
})

test('someone else saving marks our copy stale', async () => {
  const { b, sessionA, sessionB } = await pair()
  assert.equal(sessionA.getSnapshot().staleSince, null)
  b.update('body', { text: 'theirs' })
  await b.save()
  assert.ok(sessionA.getSnapshot().staleSince, 'we know their save landed')
  assert.equal(sessionB.getSnapshot().staleSince, null, 'our own save is not a conflict')
  sessionA.stop()
  sessionB.stop()
})

test('a late joiner is told about existing comments', async () => {
  const transport = loopback()
  const { sessionA } = await pair(transport)
  sessionA.addComment({ body: 'Earlier note', x: 10, y: 10 })

  const late = new RealtimeSession(makeStore(), transport, memoryAdapter(), { id: 'kim' }, 'room')
  await late.start()
  assert.equal(late.getSnapshot().comments[0].body, 'Earlier note')
  late.stop()
  sessionA.stop()
})

test('peer colours are stable per identity', () => {
  assert.equal(colorForPeer('sam'), colorForPeer('sam'))
  assert.match(colorForPeer('sam'), /^#[0-9a-f]{6}$/)
  assert.equal(initialsOf('Sam Okafor'), 'SO')
  assert.equal(initialsOf('Anonymous Vole'), 'AV')
})
