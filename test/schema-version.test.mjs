import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateProps, defineComponents } from '../dist/index.js'

/**
 * A component's schema ages independently of the document format: a prop gets
 * renamed while every saved page still carries the old name. These pin the
 * behaviour that keeps those pages rendering.
 */
const hero = {
  component: () => null,
  version: 2,
  fields: [{ name: 'title', type: 'text' }],
  migrate: (props, from) => (from < 2 ? { title: props.headline, ...strip(props, 'headline') } : props),
}

function strip(props, name) {
  const rest = { ...props }
  delete rest[name]
  return rest
}

test('props written before the schema moved are brought forward', () => {
  const result = migrateProps(hero, { headline: 'Old copy' }, undefined)
  assert.deepEqual(result.props, { title: 'Old copy' })
  assert.equal(result.version, 2)
  assert.equal(result.changed, true)
})

test('props already at the current version are left exactly alone', () => {
  const props = { title: 'Current copy' }
  const result = migrateProps(hero, props, 2)
  assert.equal(result.props, props, 'the same object, so React sees no change')
  assert.equal(result.changed, false)
})

test('a component with no version declared never migrates', () => {
  const plain = { component: () => null, fields: [] }
  const props = { anything: 1 }
  const result = migrateProps(plain, props, undefined)
  assert.equal(result.props, props)
  assert.equal(result.changed, false)
})

test('a missing version is treated as 1, not as up to date', () => {
  // The case that matters: every document written before this existed.
  assert.equal(migrateProps(hero, { headline: 'x' }, undefined).changed, true)
})

test('a version ahead of the code is left alone rather than downgraded', () => {
  // Someone deployed a newer schema, then rolled the code back. Refuse to guess.
  const props = { title: 'From the future' }
  const result = migrateProps(hero, props, 5)
  assert.equal(result.props, props)
  assert.equal(result.changed, false)
})

test('a migration that throws does not take the page down', () => {
  const broken = { component: () => null, version: 2, migrate: () => { throw new Error('bad migration') } }
  const props = { headline: 'x' }
  const result = migrateProps(broken, props, 1)
  assert.equal(result.props, props, 'falls back to what was stored')
  assert.equal(result.changed, false)
})

test('a version bump with no migrate function just restamps', () => {
  const renamedOnly = { component: () => null, version: 3 }
  const result = migrateProps(renamedOnly, { a: 1 }, 1)
  assert.deepEqual(result.props, { a: 1 })
  assert.equal(result.version, 3)
})

test('defineComponents keeps version and migrate through the pass-through', () => {
  const registry = defineComponents({ Hero: hero })
  assert.equal(registry.Hero.version, 2)
  assert.equal(typeof registry.Hero.migrate, 'function')
})

/* ------------------------------------------- the whole path, through a store */

test('a page saved against an old schema renders with the new props', async () => {
  const { VeditStore, memoryAdapter } = await import('../dist/index.js')
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter() })

  store.hydrate({
    key: 'home',
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: { 'home.body::added-1': { props: { headline: 'Written last year' } } },
    inserted: [{ id: 'home.body::added-1', parentId: 'home.body', kind: 'component', component: 'Hero', index: 0 }],
    tokens: [],
  })

  const before = store.getOverride('home.body::added-1')
  const migrated = migrateProps(hero, before.props, before.propsVersion)
  store.stageMigratedProps('home.body::added-1', migrated.props, migrated.version)

  const after = store.getOverride('home.body::added-1')
  assert.deepEqual(after.props, { title: 'Written last year' })
  assert.equal(after.propsVersion, 2)
})

test('migrating on open does not make the document look edited', async () => {
  const { VeditStore, memoryAdapter } = await import('../dist/index.js')
  const store = new VeditStore({ key: 'home', adapter: memoryAdapter() })
  store.hydrate({
    key: 'home',
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: { 'a': { props: { headline: 'x' } } },
    inserted: [],
    tokens: [],
  })
  assert.equal(store.dirty, false, 'precondition: a freshly loaded document is clean')

  store.stageMigratedProps('a', { title: 'x' }, 2)

  // The whole point: opening a page must not turn into an unsaved change, or a
  // deploy would show every editor a dirty document they never touched.
  assert.equal(store.dirty, false)
  assert.equal(store.getState().past.length, 0, 'and it is not an undo step')
})
