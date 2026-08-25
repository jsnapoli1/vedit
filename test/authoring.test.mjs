import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  VeditProvider,
  VeditSlot,
  applyOperations,
  componentManifest,
  defineComponents,
  describeDocument,
  emptyDocument,
  memoryAdapter,
} from '../dist/index.js'
import { createVeditMcpServer } from '../dist/mcp.js'

function Banner({ headline, tone = 'plain' }) {
  return createElement('section', { className: `banner tone-${tone}` }, headline)
}

function Split({ children }) {
  return createElement('section', { className: 'split' }, children)
}

const blocks = defineComponents({
  Banner: {
    component: Banner,
    group: 'Sections',
    description: 'A headline.',
    fields: [{ name: 'headline', type: 'text' }],
    defaults: { headline: 'Default headline' },
  },
  Split: { component: Split, group: 'Layout', container: true },
})

test('the manifest is the registry without the components', () => {
  assert.deepEqual(componentManifest(blocks), [
    { id: 'Split', name: 'Split', description: undefined, group: 'Layout', fields: undefined, container: true },
    {
      id: 'Banner',
      name: 'Banner',
      description: 'A headline.',
      group: 'Sections',
      fields: [{ name: 'headline', type: 'text' }],
      container: undefined,
    },
  ])
  assert.deepEqual(componentManifest(undefined), [])
})

test('placing a component records which one, and where', () => {
  const { doc, created } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'campaign.sections', kind: 'component', component: 'Banner' },
  ])

  assert.deepEqual(doc.inserted, [
    { id: created[0], parentId: 'campaign.sections', kind: 'component', component: 'Banner', index: 0 },
  ])
})

test('a component node without a name is refused', () => {
  assert.throws(
    () => applyOperations(emptyDocument('x'), [{ op: 'insert-node', parentId: 'slot', kind: 'component' }]),
    /`component` is required/,
  )
})

test('a placed component appears in the summary even with nothing overridden', () => {
  const { doc, created } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'campaign.sections', kind: 'component', component: 'Banner' },
  ])

  assert.deepEqual(describeDocument(doc).nodes, [
    {
      id: created[0],
      overrides: [],
      inserted: true,
      parentId: 'campaign.sections',
      index: 0,
      component: 'Banner',
    },
  ])
})

/** A page whose content is the document, rendered the way a server would render it. */
function renderPage(doc) {
  return renderToString(
    createElement(
      VeditProvider,
      { documentKey: doc.key, adapter: memoryAdapter(), components: blocks, initialDocument: doc, enabled: false },
      createElement(VeditSlot, { id: 'campaign.sections' }, createElement('p', null, 'Nothing here yet')),
    ),
  )
}

test('a slot renders its placed components on the server', () => {
  const { doc } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'campaign.sections', kind: 'component', component: 'Banner', id: 'a' },
    { op: 'set-props', id: 'a', props: { headline: 'Server rendered', tone: 'tint' } },
  ])

  const html = renderPage(doc)
  assert.match(html, /<section class="banner tone-tint"[^>]*>Server rendered<\/section>/)
  assert.match(html, /data-vedit-id="a"/)
  assert.doesNotMatch(html, /Nothing here yet/, 'the fallback is only for an empty slot')
})

test('an empty slot renders what the page put inside it', () => {
  assert.match(renderPage(emptyDocument('/campaign')), /Nothing here yet/)
})

test('a component the registry no longer has renders a placeholder, not a blank page', () => {
  const { doc } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'campaign.sections', kind: 'component', component: 'Carousel', id: 'a' },
  ])

  const html = renderPage(doc)
  assert.match(html, /Carousel/)
  assert.match(html, /data-vedit-missing/)
  assert.match(html, /Banner/, 'it says what is registered instead')
})

test('a layout component renders what was placed inside it', () => {
  const { doc } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'campaign.sections', kind: 'component', component: 'Split', id: 'split' },
    { op: 'insert-node', parentId: 'split', kind: 'component', component: 'Banner', id: 'inner' },
    { op: 'set-props', id: 'inner', props: { headline: 'Inside the split' } },
  ])

  assert.match(renderPage(doc), /<section class="split">.*Inside the split.*<\/section>/s)
})

/* ------------------------------------------------------------------- agents */

function mcp(options = {}) {
  const stages = new Map()
  const store = {
    stages,
    async read(key, stage = 'published') {
      return stages.get(`${stage}:${key}`) ?? null
    },
    async write(doc, stage = 'published') {
      stages.set(`${stage}:${doc.key}`, doc)
    },
  }
  return {
    store,
    server: createVeditMcpServer({
      store,
      defaultKey: '/campaign',
      components: componentManifest(blocks),
      ...options,
    }),
  }
}

const call = async (server, name, args = {}) =>
  (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result

test('an agent can read the component library and build a page from it', async () => {
  const { server, store } = mcp()

  const listed = await call(server, 'list_components')
  assert.deepEqual(
    listed.structuredContent.items.map((item) => item.id),
    ['Split', 'Banner'],
  )

  const placed = await call(server, 'place_component', {
    parentId: 'campaign.sections',
    component: 'Banner',
    props: { headline: 'Written by an agent' },
  })
  const id = placed.structuredContent.changed[0]

  const doc = store.stages.get('draft:/campaign')
  assert.equal(doc.inserted[0].component, 'Banner')
  assert.equal(doc.nodes[id].props.headline, 'Written by an agent')
})

test('an agent is refused a component the site does not have, by name', async () => {
  const result = await call(mcp().server, 'place_component', { parentId: 'slot', component: 'Carousel' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /No component named `Carousel`\. Available: Split, Banner/)
})

test('without a manifest, an agent is told composing is not available here', async () => {
  const server = createVeditMcpServer({ store: mcp().store, defaultKey: 'x' })
  const result = await call(server, 'list_components')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /No components are registered/)
})

test('an agent can re-order what it placed', async () => {
  const { server, store } = mcp()
  await call(server, 'place_component', { parentId: 'slot', component: 'Banner', index: 0 })
  const second = await call(server, 'place_component', { parentId: 'slot', component: 'Split' })
  const id = second.structuredContent.changed[0]

  await call(server, 'move_node', { id, index: 0 })

  const order = store.stages.get('draft:/campaign').inserted.sort((a, b) => a.index - b.index)
  assert.deepEqual(order.map((node) => node.component), ['Split', 'Banner'])
})

test('removing a container takes what was placed inside it', () => {
  const { doc } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'slot', kind: 'component', component: 'Split', id: 'split' },
    { op: 'insert-node', parentId: 'split', kind: 'component', component: 'Banner', id: 'inner' },
    { op: 'insert-node', parentId: 'inner', kind: 'text', id: 'deep' },
    { op: 'insert-node', parentId: 'slot', kind: 'component', component: 'Banner', id: 'sibling' },
    { op: 'set-props', id: 'inner', props: { headline: 'gone too' } },
  ])

  const after = applyOperations(doc, [{ op: 'remove-node', id: 'split' }]).doc
  assert.deepEqual(after.inserted.map((node) => node.id), ['sibling'])
  assert.equal(after.nodes.inner, undefined, 'its overrides go with it')
})

test('resetting a source container clears what the editor put inside it', () => {
  const { doc } = applyOperations(emptyDocument('/campaign'), [
    { op: 'insert-node', parentId: 'home.features', kind: 'component', component: 'Banner', id: 'placed' },
    { op: 'set-styles', id: 'home.features', styles: { gap: '40px' } },
  ])

  const after = applyOperations(doc, [{ op: 'reset-node', id: 'home.features' }]).doc
  assert.deepEqual(after.inserted, [])
  assert.deepEqual(after.nodes, {})
})
