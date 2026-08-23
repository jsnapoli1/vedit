import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileStore, emptyDocument } from '../dist/server.js'

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vedit-'))
  try {
    await run(fileStore(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a draft that was never saved falls back to the live document', async () => {
  await withStore(async (store) => {
    const live = { ...emptyDocument('home'), nodes: { a: { text: 'live' } } }
    await store.write(live, 'published')
    const draft = await store.read('home', 'draft')
    assert.equal(draft.nodes.a.text, 'live')
  })
})

test('each write becomes a version, newest first', async () => {
  await withStore(async (store) => {
    await store.write({ ...emptyDocument('home'), updatedAt: '2026-08-23T10:00:00.000Z' }, 'draft')
    await store.write({ ...emptyDocument('home'), updatedAt: '2026-08-23T11:00:00.000Z' }, 'published')
    const versions = await store.listVersions('home')
    assert.equal(versions.length, 2)
    assert.equal(versions[0].savedAt, '2026-08-23T11:00:00.000Z')
    assert.equal(versions[0].published, true)
    assert.equal(versions[1].published, false)

    const restored = await store.readVersion('home', versions[1].id)
    assert.equal(restored.key, 'home')
  })
})

test('version ids cannot escape the versions directory', async () => {
  await withStore(async (store) => {
    assert.equal(await store.readVersion('home', '../../etc/passwd'), null)
  })
})

test('keys with path separators are flattened', async () => {
  await withStore(async (store) => {
    await store.write({ ...emptyDocument('site/pricing'), nodes: { a: { text: 'x' } } }, 'published')
    const doc = await store.read('site/pricing')
    assert.equal(doc.nodes.a.text, 'x')
  })
})
