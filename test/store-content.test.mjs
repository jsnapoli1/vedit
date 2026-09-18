import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, memoryAdapter } from '../dist/index.js'
import { isTempId } from '../dist/content.js'

const EDITOR = {
  user: { id: 'u1', email: 'sam@example.com', role: 'editor' },
  login: true,
  can: { write: true, publish: true, upload: true, data: { write: true, delete: true } },
}

/** A content client that remembers what it was asked, sharing `calls` with the adapter. */
function fakeClient({ calls = [], capabilities = EDITOR, rows = {}, schema = [], fail = () => false } = {}) {
  let caps = capabilities
  let serial = 0
  const client = {
    async schema() {
      calls.push(['schema'])
      return schema
    },
    async list(source, query) {
      calls.push(['list', source, query])
      return rows[source] ?? []
    },
    async get(source, id) {
      return (rows[source] ?? []).find((row) => row.id === id) ?? null
    },
    async commit(changes, opts) {
      calls.push(['commit', JSON.parse(JSON.stringify(changes)), opts])
      if (fail()) throw new Error('The content server is away')
      const idMap = {}
      for (const entry of Object.values(changes)) {
        for (const record of entry.create ?? []) idMap[record.id] = `real-${++serial}`
      }
      return { idMap, updatedAt: new Date().toISOString() }
    },
    async publish(records) {
      calls.push(['publish-records', JSON.parse(JSON.stringify(records))])
    },
    async capabilities() {
      calls.push(['capabilities'])
      return caps
    },
    async login(email) {
      calls.push(['login', email])
      caps = { ...caps, user: { id: 'u1', email, role: 'editor' } }
      return caps.user
    },
    async logout() {
      calls.push(['logout'])
      caps = { ...caps, user: null }
    },
  }
  return { client, calls, setCapabilities: (next) => (caps = next) }
}

/** An adapter that keeps one document per key and records saves and publishes. */
function keyedAdapter(calls = [], docs = {}) {
  return {
    async load(key) {
      return docs[key] ?? null
    },
    async save(doc) {
      calls.push(['save', doc.key])
      docs[doc.key] = doc
    },
    async publish(doc) {
      calls.push(['publish', doc.key])
    },
  }
}

const node = (id, extra = {}) => ({
  id,
  kind: 'text',
  label: id,
  element: {},
  parentId: null,
  auto: false,
  container: false,
  ...extra,
})

const bound = (id, binding, extra = {}) => node(id, { binding, ...extra })

const makeStore = (opts = {}) => {
  const { client, calls, setCapabilities } = fakeClient(opts)
  const store = new VeditStore({
    key: 'home',
    adapter: opts.adapter ?? memoryAdapter(),
    content: client,
    shared: opts.shared,
  })
  return { store, calls, setCapabilities }
}

test('a record edit lands in data and is one undo step', () => {
  const { store } = makeStore()
  store.setRecord('cards', 'r1', { title: 'Hello' })

  assert.deepEqual(store.getState().data, { cards: { update: { r1: { title: 'Hello' } } } })
  assert.equal(store.getState().past.length, 1)
  assert.deepEqual(store.getState().doc.nodes, {})

  store.undo()
  assert.deepEqual(store.getState().data, {})
  store.redo()
  assert.equal(store.getState().data.cards.update.r1.title, 'Hello')
})

test('undo restores data and the document together', () => {
  const { store } = makeStore()
  store.update('hero', { text: 'one' })
  store.setRecord('cards', 'r1', { title: 'Card' })
  store.update('hero', { text: 'two' })

  store.undo()
  assert.equal(store.getOverride('hero').text, 'one')
  assert.equal(store.getState().data.cards.update.r1.title, 'Card')

  store.undo()
  assert.equal(store.getOverride('hero').text, 'one')
  assert.deepEqual(store.getState().data, {})

  store.undo()
  assert.equal(store.getOverride('hero').text, undefined)

  store.redo()
  store.redo()
  assert.equal(store.getOverride('hero').text, 'one')
  assert.equal(store.getState().data.cards.update.r1.title, 'Card')
})

test('dirty is true with record changes alone', () => {
  const { store } = makeStore()
  assert.equal(store.dirty, false)
  assert.equal(store.hasRecordChanges, false)
  store.setRecord('cards', 'r1', { title: 'Hello' })
  assert.equal(store.dirty, true)
  assert.equal(store.hasRecordChanges, true)
  assert.deepEqual(store.getState().doc.nodes, {}, 'the document itself is untouched')
})

test('recordsFor overlays local changes on the rows it is given', () => {
  const { store } = makeStore()
  const rows = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ]
  store.setRecord('cards', 'a', { title: 'AA' })
  store.deleteRecord('cards', 'b')
  const created = store.createRecord('cards', { title: 'C' })

  const overlaid = store.recordsFor('cards', rows)
  assert.deepEqual(
    overlaid.map((row) => [row.id, row.title]),
    [
      ['a', 'AA'],
      [created, 'C'],
    ],
  )
  // The rows handed in are not changed.
  assert.equal(rows[0].title, 'A')
  // Without rows, only what was created locally exists.
  assert.deepEqual(
    store.recordsFor('cards').map((row) => row.id),
    [created],
  )
  assert.equal(store.recordValue({ source: 'cards', id: created, field: 'title' }), 'C')
  assert.equal(store.recordValue({ source: 'cards', id: 'b', field: 'title' }), undefined)
})

test('createRecord returns a temp id and deleting it again leaves nothing', () => {
  const { store } = makeStore()
  const id = store.createRecord('cards', { title: 'New' })
  assert.ok(isTempId(id))
  assert.deepEqual(store.getState().data.cards.create, [{ id, title: 'New' }])

  store.deleteRecord('cards', id)
  assert.deepEqual(store.getState().data, {})
  assert.equal(store.getState().past.length, 2, 'each was an undo step')
  assert.equal(store.dirty, false)
})

test('a content edit on a bound node writes the record, not the document', () => {
  const { store } = makeStore()
  const binding = { source: 'cards', id: 'r1', field: 'title' }
  store.register(bound('cards.title~r1', binding))

  store.update('cards.title~r1', { text: 'Fresh' })
  assert.deepEqual(store.getState().doc.nodes, {})
  assert.equal(store.getState().data.cards.update.r1.title, 'Fresh')
  assert.equal(store.recordValue(binding), 'Fresh')
  assert.equal(store.getState().past.length, 1)

  // Rich text wins over plain text, as it does in the document.
  store.update('cards.title~r1', { html: '<b>Rich</b>', text: undefined })
  assert.equal(store.recordValue(binding), '<b>Rich</b>')

  // A mixed patch is still one step: the record takes the content, the
  // document keeps the rest and follows the repeat scope.
  store.update('cards.title~r1', { text: 'Both', hidden: true })
  assert.equal(store.getState().past.length, 3)
  assert.equal(store.recordValue(binding), 'Both')
  assert.equal(store.getOverride('cards.title').hidden, true)
  assert.deepEqual(store.getOverride('cards.title~r1'), {})

  // updateMany routes the same way, deduplicating per record.
  store.register(bound('cards.title~r2', { source: 'cards', id: 'r2', field: 'title' }))
  store.updateMany(['cards.title~r1', 'cards.title~r2'], { text: 'All' })
  assert.equal(store.getState().data.cards.update.r1.title, 'All')
  assert.equal(store.getState().data.cards.update.r2.title, 'All')
  assert.equal(store.getOverride('cards.title').text, undefined)
})

test('copy on a bound link stays in the document while the href goes to the record', () => {
  const { store } = makeStore()
  const binding = { source: 'cards', id: 'r1', field: 'datasheet' }
  store.register(bound('cards.link~r1', binding, { kind: 'link' }))

  store.updateMany(['cards.link~r1'], { text: 'Download', href: 'https://example.test/sheet.pdf' })

  assert.deepEqual(store.getState().data, {
    cards: { update: { r1: { datasheet: 'https://example.test/sheet.pdf' } } },
  })
  assert.equal(store.getOverride('cards.link').text, 'Download')
  assert.equal(store.getOverride('cards.link').href, undefined)
  assert.equal(store.getState().past.length, 1, 'one step for both halves')

  // An image keeps its alt in the document too: only the source is the record's.
  store.register(bound('cards.photo~r1', { source: 'cards', id: 'r1', field: 'photo' }, { kind: 'image' }))
  store.updateMany(['cards.photo~r1'], { src: 'https://example.test/a.png', alt: 'A part' })
  assert.equal(store.getState().data.cards.update.r1.photo, 'https://example.test/a.png')
  assert.equal(store.getOverride('cards.photo').alt, 'A part')
  assert.equal(store.getOverride('cards.photo').src, undefined)

  // A box has no content to bind, so everything written to it is the document's.
  store.register(bound('cards.box~r1', { source: 'cards', id: 'r1', field: 'title' }, { kind: 'box' }))
  store.updateMany(['cards.box~r1'], { text: 'Nope' })
  assert.equal(store.getState().data.cards.update.r1.title, undefined)
  assert.equal(store.getOverride('cards.box').text, 'Nope')
})

test('a style edit on a bound repeat item still follows the repeat scope', () => {
  const { store } = makeStore()
  store.register(bound('cards.title~r1', { source: 'cards', id: 'r1', field: 'title' }))

  store.setStyle('cards.title~r1', { color: 'red' })
  assert.deepEqual(store.getOverride('cards.title').style, { color: 'red' })
  assert.deepEqual(store.getState().data, {})

  store.setRepeatScope('item')
  store.setStyle('cards.title~r1', { color: 'blue' })
  assert.deepEqual(store.getOverride('cards.title~r1').style, { color: 'blue' })
  assert.deepEqual(store.getOverride('cards.title').style, { color: 'red' })
})

test('save commits records before the document, then remaps temp ids everywhere', async () => {
  const calls = []
  const { store } = makeStore({ calls, adapter: keyedAdapter(calls) })
  await store.refreshCapabilities()
  calls.length = 0

  const id = store.createRecord('cards', { title: 'New' })
  store.setRecord('cards', id, { blurb: 'Fresh' })
  store.setRepeatScope('item')
  store.setStyle(`cards.title~${id}`, { color: 'red' })
  store.select(`cards.title~${id}`)
  const before = store.getState().past.length

  await store.save()

  assert.deepEqual(
    calls.map((call) => call[0]),
    ['commit', 'save'],
  )
  assert.deepEqual(calls[0][1], { cards: { create: [{ id, title: 'New', blurb: 'Fresh' }] } })

  const { doc, data, selection, pendingPublish, past } = store.getState()
  assert.deepEqual(data, {})
  assert.deepEqual(Object.keys(doc.nodes), ['cards.title~real-1'])
  assert.deepEqual(doc.nodes['cards.title~real-1'].style, { color: 'red' })
  assert.deepEqual(selection, ['cards.title~real-1'])
  assert.deepEqual(pendingPublish, { cards: ['real-1'] })
  assert.equal(store.dirty, false)
  assert.equal(past.length, before, 'saving is not an undo step')
  assert.ok(!JSON.stringify(past).includes(id), 'history was remapped too')
})

test('after a save the saved rows stay on the page', async () => {
  const rows = {
    cards: [
      { id: 'a', title: 'A', _status: 'published' },
      { id: 'b', title: 'B', _status: 'published' },
    ],
  }
  const { store } = makeStore({ rows })
  await store.refreshCapabilities()
  await store.loadRecords('cards')

  store.setRecord('cards', 'a', { title: 'AA' })
  store.deleteRecord('cards', 'b')
  const temp = store.createRecord('cards', { title: 'C' })
  assert.deepEqual(
    store.recordsFor('cards').map((row) => [row.id, row.title]),
    [
      ['a', 'AA'],
      [temp, 'C'],
    ],
  )

  await store.save()

  assert.deepEqual(store.getState().data, {})
  assert.deepEqual(
    store.recordsFor('cards').map((row) => [row.id, row.title]),
    [
      ['a', 'AA'],
      ['real-1', 'C'],
    ],
  )
  assert.deepEqual(store.getState().records.cards.map((row) => row.id), ['a', 'real-1'])
  assert.equal(store.recordValue({ source: 'cards', id: 'real-1', field: 'title' }), 'C')
  // Nothing the server did not say is made up about the rows.
  assert.equal(store.getState().records.cards[0]._status, 'published')
  assert.equal(store.getState().records.cards[1]._status, undefined)
})

test('ensureRecords fetches a source once and leaves a loaded one alone', async () => {
  const { store, calls } = makeStore({ rows: { site: [{ id: 'global', tagline: 'Ships today' }] } })
  store.ensureRecords('site')
  store.ensureRecords('site')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.filter((call) => call[0] === 'list').length, 1)
  assert.equal(store.recordValue({ source: 'site', id: 'global', field: 'tagline' }), 'Ships today')

  store.ensureRecords('site')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.filter((call) => call[0] === 'list').length, 1)
})

test('loading a site with a content client fetches the schema alongside capabilities', async () => {
  const schema = [{ name: 'cards', fields: [{ name: 'title', type: 'richtext' }] }]
  const { store, calls } = makeStore({ schema })
  assert.equal(store.getState().schema, null)

  await store.load()

  assert.deepEqual(store.getState().schema, schema)
  assert.equal(calls.filter((call) => call[0] === 'schema').length, 1, 'fetched once')
  assert.equal(calls.filter((call) => call[0] === 'capabilities').length, 1)
  assert.equal(store.getState().auth, 'ok')
})

test('a schema fetch that fails does not cost the capabilities', async () => {
  const { store, calls } = makeStore()
  store.content.schema = async () => {
    calls.push(['schema'])
    throw new Error('no schema today')
  }

  await store.load()

  assert.equal(store.getState().auth, 'ok')
  assert.equal(store.getState().status, 'ready')
  assert.equal(store.getState().schema, null)
})

test('a failed commit keeps the changes and the second save commits them once', async () => {
  const calls = []
  let failing = true
  const { store } = makeStore({ calls, adapter: keyedAdapter(calls), fail: () => failing })
  store.setRecord('cards', 'r1', { title: 'Hello' })
  store.update('hero', { text: 'Edited' })

  await assert.rejects(store.save(), /away/)
  assert.equal(store.getState().data.cards.update.r1.title, 'Hello', 'the changes survive')
  assert.equal(store.getState().status, 'error')
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['commit'],
    'the document was not saved',
  )
  assert.equal(store.dirty, true)

  failing = false
  await store.save()
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['commit', 'commit', 'save'],
  )
  assert.deepEqual(calls[1][1], { cards: { update: { r1: { title: 'Hello' } } } })
  assert.deepEqual(store.getState().data, {})
  assert.equal(store.getState().status, 'ready')
  assert.equal(store.dirty, false)
})

test('save is a draft commit when the client can publish and a published one when it cannot', async () => {
  const editor = makeStore()
  await editor.store.load()
  editor.store.setRecord('cards', 'r1', { title: 'Draft' })
  await editor.store.save()
  const commit = editor.calls.find((call) => call[0] === 'commit')
  assert.equal(commit[2].stage, 'draft')
  assert.deepEqual(editor.store.getState().pendingPublish, { cards: ['r1'] })
  assert.equal(editor.store.unpublished, true)

  const author = makeStore({
    capabilities: { ...EDITOR, can: { ...EDITOR.can, publish: false } },
  })
  await author.store.load()
  assert.equal(author.store.can('publish'), false)
  author.store.setRecord('cards', 'r1', { title: 'Live' })
  await author.store.save()
  const live = author.calls.find((call) => call[0] === 'commit')
  assert.equal(live[2].stage, 'published')
  assert.deepEqual(author.store.getState().pendingPublish, {})
})

test('publish saves, publishes each dirty document, then publishes the pending records', async () => {
  const calls = []
  const { store } = makeStore({ calls, adapter: keyedAdapter(calls), shared: ['site'] })
  await store.load()
  calls.length = 0
  store.register(node('nav.link', { scope: 'site' }))

  store.update('hero', { text: 'Main' })
  store.update('nav.link', { text: 'About' })
  store.setRecord('cards', 'r1', { title: 'Hello' })
  assert.equal(store.unpublished, true)

  await store.publish()

  assert.deepEqual(calls, [
    ['commit', { cards: { update: { r1: { title: 'Hello' } } } }, { stage: 'draft' }],
    ['save', 'home'],
    ['save', 'site'],
    ['publish', 'home'],
    ['publish', 'site'],
    ['publish-records', { cards: ['r1'] }],
  ])
  assert.deepEqual(store.getState().pendingPublish, {})
  assert.equal(store.getState().published, store.getState().doc)
  assert.equal(store.getState().sharedPublished.site, store.getState().shared.site)
  assert.equal(store.unpublished, false)
  assert.equal(store.dirty, false)
})

test('discard drops record changes too', () => {
  const { store } = makeStore({ shared: ['site'] })
  store.register(node('nav.link', { scope: 'site' }))
  store.update('hero', { text: 'Edited' })
  store.update('nav.link', { text: 'About' })
  store.setRecord('cards', 'r1', { title: 'Hello' })
  assert.equal(store.dirty, true)

  store.discard()
  assert.deepEqual(store.getState().data, {})
  assert.deepEqual(store.getState().doc.nodes, {})
  assert.deepEqual(store.getState().shared.site.nodes, {})
  assert.equal(store.dirty, false)
  assert.equal(store.getState().past.length, 0)
})

test('capabilities decide auth: none, required or ok', async () => {
  const plain = new VeditStore({ key: 'home', adapter: memoryAdapter() })
  assert.equal(plain.supportsContent, false)
  assert.equal(plain.getState().auth, 'ok', 'without a content client there is nothing to sign in to')
  assert.equal(plain.can('write'), true)
  assert.equal(plain.can('publish'), true)
  assert.equal(plain.can('data:delete'), true)

  const cases = [
    [{ user: null, login: false, can: { write: false, publish: false, upload: false, data: { write: false, delete: false } } }, 'none'],
    [{ user: null, login: true, can: { write: false, publish: false, upload: false, data: { write: false, delete: false } } }, 'required'],
    [EDITOR, 'ok'],
  ]
  for (const [capabilities, expected] of cases) {
    const { store } = makeStore({ capabilities })
    assert.equal(store.supportsContent, true)
    assert.equal(store.can('write'), false, 'nothing is allowed until the capabilities arrive')
    await store.load()
    assert.equal(store.getState().auth, expected)
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().capabilities, capabilities)
    assert.equal(store.can('write'), capabilities.can.write)
    assert.equal(store.can('upload'), capabilities.can.upload)
    assert.equal(store.can('data:write'), capabilities.can.data.write)
  }
})

test('can reports upload, publish and data permissions from capabilities', async () => {
  const { store, setCapabilities } = makeStore({
    capabilities: {
      user: { id: 'u2', email: 'ann@example.com', role: 'author' },
      login: true,
      can: { write: true, publish: false, upload: true, data: { write: true, delete: false } },
    },
  })
  await store.load()
  assert.equal(store.can('write'), true)
  assert.equal(store.can('publish'), false)
  assert.equal(store.can('upload'), true)
  assert.equal(store.can('data:write'), true)
  assert.equal(store.can('data:delete'), false)

  // A change on the server shows the moment the capabilities are fetched again.
  setCapabilities({ ...EDITOR, can: { write: false, publish: false, upload: false, data: { write: false, delete: false } } })
  await store.refreshCapabilities()
  assert.equal(store.can('upload'), false)
  assert.equal(store.can('data:write'), false)
})

test('without a content client every capability is allowed', () => {
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter() })
  for (const action of ['write', 'publish', 'upload', 'data:write', 'data:delete']) {
    assert.equal(store.can(action), true, action)
  }
  assert.equal(store.getState().capabilities, null)
})

test('login refreshes capabilities', async () => {
  const { store, calls } = makeStore({
    capabilities: { user: null, login: true, can: { write: false, publish: false, upload: false, data: { write: false, delete: false } } },
  })
  await store.load()
  assert.equal(store.getState().auth, 'required')
  calls.length = 0

  await store.login('sam@example.com', 'vedit-demo')
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['login', 'capabilities'],
  )
  assert.equal(store.getState().auth, 'ok')
  assert.equal(store.getState().capabilities.user.email, 'sam@example.com')

  await store.logout()
  assert.equal(store.getState().auth, 'required')
  assert.equal(store.getState().capabilities.user, null)
})

test('remote patches merge into every history entry', () => {
  const { store } = makeStore()
  store.update('a', { text: 'one' })
  store.setRecord('cards', 'r1', { title: 'Card' })
  store.update('a', { text: 'two' })
  store.undo()

  store.applyRemote({ nodes: { b: { text: 'theirs' } } })

  const { past, future } = store.getState()
  assert.equal(past.length, 2)
  assert.equal(future.length, 1)
  for (const entry of [...past, ...future]) {
    assert.equal(entry.doc.nodes.b.text, 'theirs')
  }
  // Their change is not an undo step and does not disturb the data in each entry.
  assert.deepEqual(future[0].data, { cards: { update: { r1: { title: 'Card' } } } })
  assert.deepEqual(past[1].data, {})
  store.undo()
  assert.equal(store.getOverride('b').text, 'theirs')
  assert.equal(store.getOverride('a').text, 'one')
  assert.deepEqual(store.getState().data, {})
})

test('two queries on one source each keep their own rows', async () => {
  const all = [
    { id: 'a', title: 'A', live: true },
    { id: 'b', title: 'B', live: false },
  ]
  const { client, calls } = fakeClient()
  client.list = async (source, query) => {
    calls.push(['list', source, query])
    return query.where?.live === undefined ? all : all.filter((row) => row.live === query.where.live)
  }
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter(), content: client })
  await store.refreshCapabilities()

  const [everything, live] = await Promise.all([
    store.loadRecords('cards'),
    store.loadRecords('cards', { where: { live: true } }),
  ])
  assert.deepEqual(everything.map((row) => row.id), ['a', 'b'])
  assert.deepEqual(live.map((row) => row.id), ['a'])

  const sets = store.getState().recordSets
  assert.deepEqual(store.recordSet('cards', {}).map((row) => row.id), ['a', 'b'])
  assert.deepEqual(store.recordSet('cards', { where: { live: true } }).map((row) => row.id), ['a'])
  assert.equal(Object.keys(sets).length, 2)
  // The source as a whole knows every row either query saw.
  assert.deepEqual(store.getState().records.cards.map((row) => row.id), ['a', 'b'])
})

test('a saved edit lands in every query set of the source', async () => {
  const all = [{ id: 'a', title: 'A', live: true }]
  const { client } = fakeClient()
  client.list = async () => all
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter(), content: client })
  await store.refreshCapabilities()
  await store.loadRecords('cards')
  await store.loadRecords('cards', { where: { live: true } })
  store.setRecord('cards', 'a', { title: 'AA' })
  await store.save()
  assert.equal(store.recordSet('cards', { where: { live: true } })[0].title, 'AA')
  assert.equal(store.recordSet('cards', {})[0].title, 'AA')
})

test('a row created in the editor starts from the schema defaults', async () => {
  // The server applies defaults on save; until then a bare `{ id }` row hides
  // behind every `status === true` filter and shows under no relation. Seed
  // what the schema declares, under whatever the caller passed.
  const schema = [
    {
      name: 'cards',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'live', type: 'boolean', default: true },
        { name: 'kind', type: 'select', default: 'basic' },
        { name: 'createdAt', type: 'date', default: 'now' },
      ],
    },
  ]
  const { store } = makeStore({ schema })
  await store.load()
  const id = store.createRecord('cards', { kind: 'pro' })
  const created = store.getState().data.cards.create.find((row) => row.id === id)
  assert.equal(created.live, true)
  assert.equal(created.kind, 'pro', 'what the caller passed wins')
  assert.equal(created.createdAt, undefined, "'now' is the server's stamp, not a value")
  assert.equal(created.title, undefined)
})
