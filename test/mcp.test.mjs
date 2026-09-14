import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVeditMcpServer, createMcpHandler, serveStdio, notifyEditors } from '../dist/mcp.js'
import { RecordOperationError } from '../dist/content.js'

function testStore() {
  const stages = new Map()
  return {
    stages,
    async read(key, stage = 'published') {
      return stages.get(`${stage}:${key}`) ?? null
    },
    async write(doc, stage = 'published') {
      stages.set(`${stage}:${doc.key}`, doc)
    },
    async list() {
      return [{ key: 'home' }, { key: '/pricing' }]
    },
  }
}

const server = (options = {}) => createVeditMcpServer({ store: testStore(), defaultKey: 'home', ...options })

const rpc = (target, method, params, id = 1) => target.handle({ jsonrpc: '2.0', id, method, params })
const callTool = async (target, name, args) => {
  const response = await rpc(target, 'tools/call', { name, arguments: args })
  return response.result
}

test('initialize answers with the protocol the client asked for', async () => {
  const response = await rpc(server(), 'initialize', { protocolVersion: '2025-03-26' })
  assert.equal(response.result.protocolVersion, '2025-03-26')
  assert.equal(response.result.serverInfo.name, 'vedit')
  assert.ok(response.result.capabilities.tools)
  assert.match(response.result.instructions, /describe_document/)
})

test('every tool has a name, a description and a schema', async () => {
  const { tools } = (await rpc(server(), 'tools/list')).result
  assert.ok(tools.length >= 12)
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z_]+$/)
    assert.ok(tool.description.length > 20, `${tool.name} needs a description a model can act on`)
    assert.equal(tool.inputSchema.type, 'object')
  }
})

test('a notification gets no reply', async () => {
  assert.equal(await server().handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
})

test('an unknown method is a JSON-RPC error, an unknown tool is a tool error', async () => {
  const unknownMethod = await rpc(server(), 'resources/list')
  assert.equal(unknownMethod.error.code, -32601)

  const unknownTool = await callTool(server(), 'delete_site', {})
  assert.equal(unknownTool.isError, true)
  assert.match(unknownTool.content[0].text, /No such tool/)
})

test('a tool call reads, writes and reads back', async () => {
  const target = server()

  const before = await callTool(target, 'describe_document', { key: 'home' })
  assert.deepEqual(before.structuredContent.counts, { nodes: 0, inserted: 0, tokens: 0 })

  await callTool(target, 'set_content', { key: 'home', id: 'title', text: 'Designed by an agent' })
  await callTool(target, 'set_styles', { key: 'home', id: 'title', styles: { fontSize: '64px' }, breakpoint: 'lg' })

  const after = await callTool(target, 'describe_document', { key: 'home' })
  assert.deepEqual(after.structuredContent.nodes, [
    { id: 'title', overrides: ['text', 'lg'], inserted: false, text: 'Designed by an agent' },
  ])
})

test('writes go to the draft, and publishing is its own step', async () => {
  const store = testStore()
  const target = createVeditMcpServer({ store, defaultKey: 'home' })

  await callTool(target, 'set_content', { id: 'title', text: 'Draft' })
  assert.equal(store.stages.get('draft:home').nodes.title.text, 'Draft')
  assert.equal(store.stages.get('published:home'), undefined)

  await callTool(target, 'publish_document', {})
  assert.equal(store.stages.get('published:home').nodes.title.text, 'Draft')
})

test('render_css shows what the change produces', async () => {
  const target = server()
  await callTool(target, 'set_styles', { id: 'title', styles: { color: 'red' }, state: 'hover' })
  const { structuredContent } = await callTool(target, 'render_css', {})
  assert.match(structuredContent.css, /\[data-vedit-id="title"\].*:hover/)
})

test('a refused operation comes back as a readable tool error, not a crash', async () => {
  const result = await callTool(server(), 'apply_operations', { operations: [{ op: 'set-styles', id: 'a' }] })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Operation 0 was refused/)
})

test('a batch that fails leaves nothing behind', async () => {
  const store = testStore()
  const target = createVeditMcpServer({ store, defaultKey: 'home' })
  await callTool(target, 'apply_operations', {
    operations: [{ op: 'set-content', id: 'a', content: { text: 'one' } }, { op: 'nope' }],
  })
  assert.equal(store.stages.get('draft:home'), undefined)
})

test('insert_shape places a preset with the geometry that preset means', async () => {
  const store = testStore()
  const target = createVeditMcpServer({ store, defaultKey: 'home' })

  await callTool(target, 'insert_shape', { parentId: 'campaign.sections', shape: 'circle' })

  const doc = store.stages.get('draft:home')
  assert.equal(doc.inserted.length, 1)
  assert.equal(doc.inserted[0].kind, 'shape')
  assert.deepEqual(doc.nodes[doc.inserted[0].id].shape, { type: 'circle' })
})

test('insert_shape stores imported markup with the drawing and without the script', async () => {
  const store = testStore()
  const target = createVeditMcpServer({ store, defaultKey: 'home' })

  await callTool(target, 'insert_shape', {
    parentId: 'campaign.sections',
    svg: '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/><script>window.__pwned = 1</script></svg>',
  })

  const doc = store.stages.get('draft:home')
  const { shape } = doc.nodes[doc.inserted[0].id]
  assert.equal(shape.type, 'custom')
  assert.equal(shape.viewBox, '0 0 24 24')
  assert.match(shape.svg, /<path/)
  assert.doesNotMatch(shape.svg, /script|__pwned/)
})

test('insert_shape refuses both a preset and markup, and refuses neither', async () => {
  const target = server()

  const both = await callTool(target, 'insert_shape', {
    parentId: 'campaign.sections',
    shape: 'rect',
    svg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  })
  assert.equal(both.isError, true)
  assert.match(both.content[0].text, /`shape`.*`svg`/)

  const neither = await callTool(target, 'insert_shape', { parentId: 'campaign.sections' })
  assert.equal(neither.isError, true)
  assert.match(neither.content[0].text, /`shape`.*`svg`/)
})

test('read-only mode exposes no tool that writes', async () => {
  const target = server({ writable: false })
  const { tools } = (await rpc(target, 'tools/list')).result
  assert.deepEqual(
    tools.map((tool) => tool.name).filter((name) => name.startsWith('set_') || name.startsWith('publish')),
    [],
  )
  assert.match((await callTool(target, 'set_content', { id: 'a', text: 'x' })).content[0].text, /No such tool/)
})

test('allowKey keeps an agent inside the documents it was given', async () => {
  const target = server({ allowKey: (key) => key === 'home' })
  assert.equal((await callTool(target, 'describe_document', { key: 'home' })).isError, undefined)
  const refused = await callTool(target, 'describe_document', { key: '/pricing' })
  assert.equal(refused.isError, true)
  assert.match(refused.content[0].text, /not available/)
})

test('onChange reports what an agent touched, and notifyEditors posts it as a patch', async () => {
  const posted = []
  const target = server({
    onChange: notifyEditors({
      endpoint: 'https://site.test/api/vedit/realtime',
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) })
        return new Response('{}')
      },
    }),
  })

  await callTool(target, 'set_content', { id: 'title', text: 'Live' })

  assert.equal(posted.length, 1)
  assert.match(posted[0].url, /room=home/)
  assert.equal(posted[0].body.type, 'patch')
  assert.equal(posted[0].body.nodes.title.text, 'Live')
})

test('the stdio transport answers one JSON-RPC line with one line', async () => {
  const written = []
  const lines = ['{"jsonrpc":"2.0","id":1,"method":"ping"}', 'not json', '', '{"jsonrpc":"2.0","method":"ignored"}']

  await serveStdio(server(), {
    input: (async function* () {
      yield `${lines.join('\n')}\n`
    })(),
    output: { write: (chunk) => written.push(chunk) },
  })

  const responses = written.map((line) => JSON.parse(line))
  assert.deepEqual(responses[0], { jsonrpc: '2.0', id: 1, result: {} })
  assert.equal(responses[1].error.code, -32700, 'a bad line is reported, and the stream keeps going')
  assert.equal(responses.length, 2, 'notifications produce nothing')
})

test('the HTTP transport takes a batch and drops the notifications from the reply', async () => {
  const handle = createMcpHandler(server())
  const response = await handle(
    new Request('https://site.test/mcp', {
      method: 'POST',
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
    }),
  )

  assert.deepEqual(await response.json(), [{ jsonrpc: '2.0', id: 1, result: {} }])
  assert.equal((await handle(new Request('https://site.test/mcp'))).status, 405)
})

/* ----------------------------------------------------------- content tools */

const ALLOWED = { read: true, create: true, update: true, delete: true, publish: true }
const SOURCES = [
  {
    name: 'products',
    kind: 'collection',
    label: 'Products',
    fields: [
      { name: 'title', type: 'text', label: 'Title', required: true },
      { name: 'position', type: 'number', label: 'Position' },
    ],
    titleField: 'title',
    orderField: 'position',
    drafts: true,
    can: ALLOWED,
  },
  {
    name: 'site',
    kind: 'global',
    label: 'Site',
    fields: [{ name: 'tagline', type: 'text', label: 'Tagline' }],
    drafts: true,
    can: ALLOWED,
  },
]
const SOURCE_TOOLS = [
  'list_sources',
  'describe_source',
  'list_records',
  'get_record',
  'set_record',
  'create_record',
  'delete_record',
  'reorder_records',
  'publish_records',
]

/**
 * A content client over a Map. Creates get server ids unless the caller chose
 * one that is not a temp id, so both branches of create_record are reachable.
 */
function testContent({ publish = true, publishable = true, refuse } = {}) {
  const records = new Map([
    ['products:a', { id: 'a', title: 'Alpha', position: 0 }],
    ['products:b', { id: 'b', title: 'Beta', position: 1 }],
    ['site:global', { id: 'global', tagline: 'Hello' }],
  ])
  const calls = []
  let created = 0
  const client = {
    records,
    calls,
    async schema() {
      return SOURCES
    },
    async list(source, query = {}) {
      calls.push(['list', source, query])
      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${source}:`))
        .map(([, record]) => record)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    },
    async get(source, id, opts = {}) {
      calls.push(['get', source, id, opts])
      return records.get(`${source}:${id}`) ?? null
    },
    async commit(changes, opts) {
      calls.push(['commit', changes, opts])
      if (refuse) throw refuse
      const idMap = {}
      for (const [source, entry] of Object.entries(changes)) {
        for (const record of entry.create ?? []) {
          const id = record.id.startsWith('new-') ? `srv${++created}` : record.id
          idMap[record.id] = id
          records.set(`${source}:${id}`, { ...record, id })
        }
        for (const [id, data] of Object.entries(entry.update ?? {})) {
          records.set(`${source}:${id}`, { ...records.get(`${source}:${id}`), ...data, id })
        }
        for (const id of entry.delete ?? []) records.delete(`${source}:${id}`)
        ;(entry.order ?? []).forEach((id, index) => {
          records.get(`${source}:${id}`).position = index
        })
      }
      return { idMap, updatedAt: '2026-09-14T12:00:00.000Z' }
    },
    async capabilities() {
      calls.push(['capabilities'])
      return { user: null, login: false, can: { write: true, publish, upload: true, data: { write: true, delete: true } } }
    },
  }
  if (publishable) {
    client.publish = async (which) => {
      calls.push(['publish', which])
    }
  }
  return client
}

const names = async (target) => (await rpc(target, 'tools/list')).result.tools.map((tool) => tool.name)

test('without a content client no source tools are offered', async () => {
  const plain = await names(server())
  assert.deepEqual(
    plain.filter((name) => SOURCE_TOOLS.includes(name)),
    [],
  )
  assert.equal(plain.length, 20)
  assert.match((await callTool(server(), 'list_sources', {})).content[0].text, /No such tool/)
  assert.doesNotMatch((await rpc(server(), 'initialize', {})).result.instructions, /list_sources/)

  const withContent = await names(server({ content: testContent() }))
  assert.equal(withContent.length, 29)
  assert.deepEqual(
    withContent.filter((name) => SOURCE_TOOLS.includes(name)),
    SOURCE_TOOLS,
  )
})

test('list_sources and describe_source read the schema', async () => {
  const target = server({ content: testContent() })

  assert.match((await rpc(target, 'initialize', {})).result.instructions, /list_sources/)

  const sources = await callTool(target, 'list_sources', {})
  assert.deepEqual(sources.structuredContent.items, [
    { name: 'products', kind: 'collection', label: 'Products', can: ALLOWED },
    { name: 'site', kind: 'global', label: 'Site', can: ALLOWED },
  ])

  const described = await callTool(target, 'describe_source', { source: 'products' })
  assert.deepEqual(described.structuredContent, SOURCES[0])

  const missing = await callTool(target, 'describe_source', { source: 'orders' })
  assert.equal(missing.isError, true)
  assert.match(missing.content[0].text, /No source named `orders`.*products, site/)
})

test('set_record changes what list_records returns', async () => {
  const content = testContent()
  const target = server({ content })

  const before = await callTool(target, 'list_records', { source: 'products' })
  assert.deepEqual(
    before.structuredContent.items.map((record) => record.title),
    ['Alpha', 'Beta'],
  )

  const set = await callTool(target, 'set_record', { source: 'products', id: 'a', data: { title: 'Alpha, revised' } })
  assert.equal(set.isError, undefined, set.content[0].text)
  assert.deepEqual(set.structuredContent, {
    source: 'products',
    id: 'a',
    stage: 'draft',
    updatedAt: '2026-09-14T12:00:00.000Z',
  })
  // The client says publishing is allowed, so the edit is a draft.
  assert.deepEqual(
    content.calls.find(([kind]) => kind === 'commit'),
    ['commit', { products: { update: { a: { title: 'Alpha, revised' } } } }, { stage: 'draft' }],
  )

  const after = await callTool(target, 'list_records', { source: 'products' })
  assert.deepEqual(
    after.structuredContent.items.map((record) => record.title),
    ['Alpha, revised', 'Beta'],
  )

  const got = await callTool(target, 'get_record', { source: 'products', id: 'a' })
  assert.equal(got.structuredContent.title, 'Alpha, revised')
  assert.equal((await callTool(target, 'get_record', { source: 'products', id: 'zzz' })).isError, true)

  // Capabilities are asked once, not per call.
  assert.equal(content.calls.filter(([kind]) => kind === 'capabilities').length, 1)

  // Without permission to publish, the edit goes straight to the live copy.
  const live = testContent({ publish: false })
  await callTool(server({ content: live }), 'set_record', { source: 'site', id: 'global', data: { tagline: 'Hi' } })
  assert.deepEqual(
    live.calls.find(([kind]) => kind === 'commit'),
    ['commit', { site: { update: { global: { tagline: 'Hi' } } } }, { stage: 'published' }],
  )
})

test('create_record returns the real id from the idMap', async () => {
  const content = testContent()
  const target = server({ content })

  const created = await callTool(target, 'create_record', { source: 'products', data: { title: 'Gamma' } })
  assert.equal(created.isError, undefined, created.content[0].text)
  assert.equal(created.structuredContent.id, 'srv1')
  const [, changes] = content.calls.find(([kind]) => kind === 'commit')
  assert.equal(changes.products.create.length, 1)
  assert.match(changes.products.create[0].id, /^new-[a-z0-9]{8}$/)
  assert.equal(changes.products.create[0].title, 'Gamma')
  assert.equal(content.records.get('products:srv1').title, 'Gamma')

  // A caller-chosen id that the server keeps comes back as given.
  const chosen = await callTool(target, 'create_record', { source: 'products', id: 'delta', data: { title: 'Delta' } })
  assert.equal(chosen.structuredContent.id, 'delta')
  assert.equal(content.records.get('products:delta').title, 'Delta')
})

test('delete_record and reorder_records go through commit', async () => {
  const content = testContent()
  const target = server({ content })

  const deleted = await callTool(target, 'delete_record', { source: 'products', id: 'a' })
  assert.equal(deleted.isError, undefined, deleted.content[0].text)
  assert.equal(content.records.has('products:a'), false)

  await callTool(target, 'create_record', { source: 'products', id: 'c', data: { title: 'Gamma', position: 2 } })
  const reordered = await callTool(target, 'reorder_records', { source: 'products', order: ['c', 'b'] })
  assert.equal(reordered.isError, undefined, reordered.content[0].text)

  const commits = content.calls.filter(([kind]) => kind === 'commit').map(([, changes]) => changes)
  assert.deepEqual(commits[0], { products: { delete: ['a'] } })
  assert.deepEqual(commits[2], { products: { order: ['c', 'b'] } })

  const listed = await callTool(target, 'list_records', { source: 'products' })
  assert.deepEqual(
    listed.structuredContent.items.map((record) => record.id),
    ['c', 'b'],
  )
})

test('publish_records is a write tool and is hidden read-only', async () => {
  const content = testContent()
  const target = server({ content })
  const published = await callTool(target, 'publish_records', { records: { products: ['a', 'b'] } })
  assert.equal(published.isError, undefined, published.content[0].text)
  assert.deepEqual(content.calls.at(-1), ['publish', { products: ['a', 'b'] }])

  const readOnly = await names(server({ content: testContent(), writable: false }))
  assert.ok(readOnly.includes('list_sources'))
  assert.ok(readOnly.includes('list_records'))
  assert.ok(!readOnly.includes('publish_records'))
  assert.ok(!readOnly.includes('set_record'))
  assert.ok(!readOnly.includes('create_record'))
  assert.ok(!readOnly.includes('delete_record'))
  assert.ok(!readOnly.includes('reorder_records'))

  const cannot = await callTool(server({ content: testContent({ publishable: false }) }), 'publish_records', {
    records: { products: ['a'] },
  })
  assert.equal(cannot.isError, true)
  assert.match(cannot.content[0].text, /cannot publish/)
})

test('a refused record operation reports its index', async () => {
  const refuse = new RecordOperationError('data must be an object', 1, { op: 'set-record' })
  const target = server({ content: testContent({ refuse }) })

  const result = await callTool(target, 'set_record', { source: 'products', id: 'a', data: { title: 'x' } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /^Operation 1 was refused: data must be an object$/)

  // Malformed input is refused before the client hears of it.
  const malformed = await callTool(target, 'set_record', { source: 'products', id: '', data: { title: 'x' } })
  assert.equal(malformed.isError, true)
  assert.match(malformed.content[0].text, /Operation 0 was refused: id must be a non-empty string/)
})
