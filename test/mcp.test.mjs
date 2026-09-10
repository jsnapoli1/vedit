import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVeditMcpServer, createMcpHandler, serveStdio, notifyEditors } from '../dist/mcp.js'

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
