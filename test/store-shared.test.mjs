import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, emptyDocument } from '../dist/index.js'

/** An adapter that keeps one document per key and records what it saved. */
function keyedAdapter(docs = {}) {
  const saves = []
  const adapter = {
    async load(key) {
      return docs[key] ?? null
    },
    async save(doc) {
      saves.push(doc.key)
      docs[doc.key] = doc
    },
  }
  return { adapter, saves, docs }
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

const makeStore = (docs) => {
  const keyed = keyedAdapter(docs)
  const store = new VeditStore({ key: 'home', adapter: keyed.adapter, shared: ['site'] })
  return { store, ...keyed }
}

test('a node registered with a scope writes to that shared document', () => {
  const { store } = makeStore()
  store.register(node('nav.link', { scope: 'site' }))
  store.register(node('hero'))

  store.update('nav.link', { text: 'About' })
  store.update('hero', { text: 'Welcome' })

  assert.equal(store.getState().shared.site.nodes['nav.link'].text, 'About')
  assert.equal(store.getState().doc.nodes['nav.link'], undefined)
  assert.equal(store.getState().doc.nodes.hero.text, 'Welcome')
  assert.equal(store.getOverride('nav.link').text, 'About', 'reads follow the same routing')
  assert.equal(store.docOf('nav.link').key, 'site')
  assert.equal(store.docOf('hero').key, 'home')

  // Styles route the same way, and undo walks both documents together.
  store.setStyle('nav.link', { color: 'red' })
  assert.deepEqual(store.getState().shared.site.nodes['nav.link'].style, { color: 'red' })
  assert.equal(store.styleValue('nav.link', 'color'), 'red')
  store.undo()
  assert.equal(store.getState().shared.site.nodes['nav.link'].style, undefined)
  store.undo()
  assert.equal(store.getState().doc.nodes.hero, undefined)
  assert.equal(store.getState().shared.site.nodes['nav.link'].text, 'About')
  store.undo()
  assert.deepEqual(store.getState().shared.site.nodes, {})
})

test('saving writes every dirty document', async () => {
  const { store, saves, docs } = makeStore()
  store.register(node('nav.link', { scope: 'site' }))
  assert.equal(store.dirty, false)

  store.update('nav.link', { text: 'About' })
  assert.equal(store.dirty, true, 'a shared edit alone is dirty')
  store.update('hero', { text: 'Welcome' })

  await store.save()
  assert.deepEqual(saves, ['home', 'site'])
  assert.equal(docs.site.key, 'site')
  assert.equal(docs.site.nodes['nav.link'].text, 'About')
  assert.equal(store.dirty, false)
  assert.equal(store.getState().sharedSaved.site, store.getState().shared.site)

  // Only what changed goes back out.
  store.update('nav.link', { text: 'Team' })
  await store.save()
  assert.deepEqual(saves, ['home', 'site', 'site'])
})

test('inserting into a scoped container puts the node in the shared document', () => {
  const { store } = makeStore()
  store.register(node('nav', { scope: 'site', container: true, kind: 'box' }))

  const id = store.insert('nav', 'link')
  const { doc, shared } = store.getState()
  assert.deepEqual(doc.inserted, [])
  assert.equal(shared.site.inserted[0].id, id)
  assert.equal(shared.site.inserted[0].parentId, 'nav')
  assert.equal(shared.site.nodes[id].text, 'Link')
  assert.equal(store.insertedFor('nav').length, 1)
  assert.equal(store.kindOf(id), 'link')
  assert.equal(store.docOf(id).key, 'site')

  // Later edits to the placed node find it in the shared document too.
  store.update(id, { text: 'Blog' })
  assert.equal(store.getState().shared.site.nodes[id].text, 'Blog')
  assert.equal(store.getState().doc.nodes[id], undefined)

  const copy = store.duplicateInserted(id)
  assert.equal(store.insertedFor('nav').length, 2)
  assert.equal(store.getState().shared.site.nodes[copy].text, 'Blog')

  store.removeInserted(copy)
  store.removeInserted(id)
  assert.deepEqual(store.getState().shared.site.inserted, [])
  assert.deepEqual(store.getState().shared.site.nodes, {})
})

test('documents lists the main document and every shared one', async () => {
  const { store } = makeStore({
    home: { ...emptyDocument('home'), nodes: { hero: { text: 'Stored' } } },
    site: { ...emptyDocument('site'), nodes: { 'nav.link': { text: 'Stored nav' } } },
  })
  await store.load()

  const documents = store.documents()
  assert.deepEqual(
    documents.map(({ key, doc }) => [key, doc.key]),
    [
      ['home', 'home'],
      ['site', 'site'],
    ],
  )
  assert.equal(documents[0].doc.nodes.hero.text, 'Stored')
  assert.equal(documents[1].doc.nodes['nav.link'].text, 'Stored nav')
  assert.equal(store.dirty, false)

  // A shared document nobody has saved yet is simply empty.
  const fresh = new VeditStore({ key: 'home', adapter: keyedAdapter().adapter, shared: ['site', 'footer'] })
  await fresh.load()
  assert.deepEqual(
    fresh.documents().map(({ key }) => key),
    ['home', 'site', 'footer'],
  )
  assert.deepEqual(fresh.getState().shared.footer.nodes, {})
})
