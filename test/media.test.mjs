import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_ACCEPT,
  assetKind,
  createMediaHandler,
  fsMediaStore,
  isSafeId,
  matchesAccept,
  memoryMediaStore,
  newAssetId,
  r2MediaStore,
} from '../dist/media.js'

const bytesOf = async (body) => new Uint8Array(await new Response(body).arrayBuffer())
const text = (value) => new TextEncoder().encode(value)

async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vedit-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A multipart upload the way a browser would send it. */
const upload = (name, type, content, alt) => {
  const form = new FormData()
  form.append('file', new File([content], name, { type }))
  if (alt !== undefined) form.append('alt', alt)
  return new Request('https://site.test/vedit/v1/media', { method: 'POST', body: form })
}

const handlerWith = (options = {}) =>
  createMediaHandler({ store: memoryMediaStore(), authorize: () => true, ...options })

test('assetKind sorts mimes into image, video and file', () => {
  assert.equal(assetKind('image/png'), 'image')
  assert.equal(assetKind('image/svg+xml'), 'image')
  assert.equal(assetKind('video/mp4'), 'video')
  assert.equal(assetKind('application/pdf'), 'file')
  assert.equal(assetKind(''), 'file')

  assert.ok(DEFAULT_ACCEPT.includes('image/*'))
  assert.ok(DEFAULT_ACCEPT.includes('application/pdf'))
  assert.equal(matchesAccept('image/webp', DEFAULT_ACCEPT), true)
  assert.equal(matchesAccept('application/pdf', DEFAULT_ACCEPT), true)
  assert.equal(matchesAccept('text/html', DEFAULT_ACCEPT), false)
  assert.equal(matchesAccept('IMAGE/PNG', ['image/*']), true)

  assert.match(newAssetId('Data Sheet.PDF'), /^[a-z0-9]+-[a-z0-9]{8}\.pdf$/)
  assert.match(newAssetId('noext'), /^[a-z0-9]+-[a-z0-9]{8}$/)
  assert.match(newAssetId('weird.t@r.gz!'), /\.gz$/)
  assert.equal(isSafeId('m1x2y3-ab12cd34.pdf'), true)
  assert.equal(isSafeId('../x'), false)
  assert.equal(isSafeId('a/b'), false)
  assert.equal(isSafeId('a.b.c'), false)
})

test('the memory store keeps bytes and metadata and lists by kind and query', async () => {
  const store = memoryMediaStore()
  const sheet = await store.put(new Blob([text('%PDF-1.4')], { type: 'application/pdf' }), {
    name: 'sheet.pdf',
    mime: 'application/pdf',
    alt: 'The spec sheet',
  })
  assert.equal(sheet.kind, 'file')
  assert.equal(sheet.name, 'sheet.pdf')
  assert.equal(sheet.mime, 'application/pdf')
  assert.equal(sheet.size, 8)
  assert.equal(sheet.alt, 'The spec sheet')
  assert.equal(sheet.url, `/v1/media/${sheet.id}`)
  assert.match(sheet.id, /\.pdf$/)

  // A stream is accepted too, and the size comes from what was actually read.
  const stream = new Blob([text('GIF89a')]).stream()
  const logo = await store.put(stream, { name: 'logo.gif', mime: 'image/gif' })
  assert.equal(logo.kind, 'image')
  assert.equal(logo.size, 6)
  assert.equal('alt' in logo, false)

  const got = await store.get(sheet.id)
  assert.deepEqual(got.asset, sheet)
  assert.deepEqual(await bytesOf(got.body), text('%PDF-1.4'))

  const all = await store.list()
  assert.deepEqual(
    all.map((a) => a.id),
    [logo.id, sheet.id],
  )
  assert.deepEqual((await store.list({ kind: 'image' })).map((a) => a.id), [logo.id])
  assert.deepEqual((await store.list({ query: 'SPEC' })).map((a) => a.id), [sheet.id])
  assert.deepEqual((await store.list({ kind: 'image', query: 'sheet' })).map((a) => a.id), [])

  await store.delete(sheet.id)
  assert.equal(await store.get(sheet.id), null)
  assert.equal(await store.get('../x'), null)
})

test('the fs store writes the bytes and a sidecar and reads them back as a stream', async () => {
  await withDir(async (dir) => {
    const store = fsMediaStore(join(dir, 'media'))
    const asset = await store.put(new Blob([text('hello')], { type: 'text/plain' }), {
      name: 'hello.txt',
      mime: 'text/plain',
      alt: 'greeting',
    })
    assert.equal(asset.size, 5)
    assert.deepEqual(await readFile(join(dir, 'media', asset.id)), Buffer.from('hello'))
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'media', `${asset.id}.json`), 'utf8')), asset)

    const got = await store.get(asset.id)
    assert.ok(got.body instanceof ReadableStream)
    assert.deepEqual(got.asset, asset)
    assert.deepEqual(await bytesOf(got.body), text('hello'))

    const second = await store.put(new Blob([text('GIF89a')]).stream(), { name: 'a.gif', mime: 'image/gif' })
    const listed = await store.list()
    assert.deepEqual(listed.map((a) => a.id), [second.id, asset.id])
    assert.deepEqual((await store.list({ kind: 'file', query: 'GREET' })).map((a) => a.id), [asset.id])

    await store.delete(asset.id)
    assert.equal(await store.get(asset.id), null)
    await assert.rejects(stat(join(dir, 'media', asset.id)), { code: 'ENOENT' })
    await assert.rejects(stat(join(dir, 'media', `${asset.id}.json`)), { code: 'ENOENT' })
  })
})

test('an id never walks out of the directory', async () => {
  await withDir(async (dir) => {
    await mkdir(join(dir, 'media'))
    // A sibling of the store directory that a crafted id would otherwise reach.
    await writeFile(join(dir, 'secret'), 'top')
    await writeFile(join(dir, 'secret.json'), JSON.stringify({ id: 'secret', name: 'secret' }))
    const store = fsMediaStore(join(dir, 'media'))

    assert.equal(await store.get('../secret'), null)
    assert.equal(await store.get('..%2Fsecret'), null)
    assert.equal(await store.get('/etc/passwd'), null)
    await store.delete('../secret')
    await store.delete('..%2Fsecret')
    assert.equal(await readFile(join(dir, 'secret'), 'utf8'), 'top')
    assert.equal((await stat(join(dir, 'secret.json'))).isFile(), true)
    await assert.rejects(store.put(new Blob([text('x')]), { name: 'x', mime: 'text/plain', id: '../secret' }), TypeError)
    assert.equal(await readFile(join(dir, 'secret'), 'utf8'), 'top')
  })
})

test('the handler refuses an upload the caller may not make', async () => {
  const seen = []
  const handle = handlerWith({
    authorize: (request, { action }) => {
      seen.push(action)
      return action === 'read'
    },
  })

  const refused = await handle(upload('sheet.pdf', 'application/pdf', '%PDF-1.4'))
  assert.equal(refused.status, 403)
  assert.deepEqual(await refused.json(), { error: 'Not allowed' })

  const removed = await handle(new Request('https://site.test/vedit/v1/media/some-id.pdf', { method: 'DELETE' }))
  assert.equal(removed.status, 403)

  const listed = await handle(new Request('https://site.test/vedit/v1/media'))
  assert.equal(listed.status, 200)
  assert.deepEqual(await listed.json(), { items: [] })
  assert.deepEqual(seen, ['upload', 'delete', 'read'])
})

test('the handler accepts a multipart upload, returns the asset and serves it back with cache and disposition headers', async () => {
  const handle = handlerWith()
  const response = await handle(upload('sheet.pdf', 'application/pdf', '%PDF-1.4', 'The sheet'))
  assert.equal(response.status, 200)
  const asset = await response.json()
  assert.match(asset.id, /\.pdf$/)
  assert.equal(asset.url, `/vedit/v1/media/${asset.id}`)
  assert.equal(asset.kind, 'file')
  assert.equal(asset.name, 'sheet.pdf')
  assert.equal(asset.mime, 'application/pdf')
  assert.equal(asset.size, 8)
  assert.equal(asset.alt, 'The sheet')

  const served = await handle(new Request(`https://site.test/vedit${asset.url.slice('/vedit'.length)}`))
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'application/pdf')
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(served.headers.get('content-disposition'), 'inline; filename="sheet.pdf"')
  assert.equal(served.headers.get('content-length'), '8')
  assert.equal(await served.text(), '%PDF-1.4')

  const list = await (await handle(new Request('https://site.test/vedit/v1/media?kind=file&q=sheet'))).json()
  assert.deepEqual(list.items, [asset])
  const none = await (await handle(new Request('https://site.test/vedit/v1/media?kind=image'))).json()
  assert.deepEqual(none.items, [])

  // A host that serves files from somewhere else rewrites every url it hands out.
  const cdn = handlerWith({ publicUrl: (id) => `https://cdn.test/${id}` })
  const remote = await (await cdn(upload('a.png', 'image/png', 'png'))).json()
  assert.equal(remote.url, `https://cdn.test/${remote.id}`)

  const missing = await handle(new Request('https://site.test/vedit/v1/media/nope.pdf'))
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: 'Not found' })
  assert.equal((await handle(new Request('https://site.test/vedit/v1/media/..%2Fx'))).status, 404)
  assert.equal((await handle(new Request('https://site.test/vedit/v1/other'))).status, 404)
  assert.equal((await handle(new Request('https://site.test/vedit/nothing'))).status, 404)

  const wrong = await handle(new Request('https://site.test/vedit/v1/media', { method: 'PUT' }))
  assert.equal(wrong.status, 405)
  assert.equal(wrong.headers.get('allow'), 'GET, POST')
  const wrongItem = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}`, { method: 'POST' }))
  assert.equal(wrongItem.status, 405)
  assert.equal(wrongItem.headers.get('allow'), 'GET, HEAD, DELETE')

  const quoted = await (await handle(upload('a "quoted" name.txt', 'text/plain', 'x'))).json()
  const servedQuoted = await handle(new Request(`https://site.test/vedit/v1/media/${quoted.id}`))
  assert.equal(servedQuoted.headers.get('content-disposition'), 'inline; filename="a \\"quoted\\" name.txt"')
})

test('a mime outside the allowlist is 400 and a body over maxBytes is 413', async () => {
  const handle = handlerWith({ maxBytes: 4 })
  const html = await handle(upload('page.html', 'text/html', '<p>'))
  assert.equal(html.status, 400)
  assert.equal(typeof (await html.json()).error, 'string')

  const big = await handle(upload('big.txt', 'text/plain', 'hello'))
  assert.equal(big.status, 413)
  assert.equal(typeof (await big.json()).error, 'string')

  const ok = await handle(upload('small.txt', 'text/plain', 'hey'))
  assert.equal(ok.status, 200)

  const noFile = await handle(new Request('https://site.test/vedit/v1/media', { method: 'POST', body: new FormData() }))
  assert.equal(noFile.status, 400)
  const notAForm = await handle(
    new Request('https://site.test/vedit/v1/media', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
  )
  assert.equal(notAForm.status, 400)

  const custom = handlerWith({ accept: ['text/html'] })
  assert.equal((await custom(upload('page.html', 'text/html', '<p>'))).status, 200)
  assert.equal((await custom(upload('a.png', 'image/png', 'png'))).status, 400)
})

test('download=1 switches the disposition to attachment', async () => {
  const handle = handlerWith()
  const asset = await (await handle(upload('sheet.pdf', 'application/pdf', '%PDF-1.4'))).json()
  const response = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}?download=1`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="sheet.pdf"')
  const inline = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}?download=0`))
  assert.equal(inline.headers.get('content-disposition'), 'inline; filename="sheet.pdf"')
})

test('a HEAD on an asset answers the headers without the body', async () => {
  const seen = []
  const handle = handlerWith({
    authorize: (request, { action }) => {
      seen.push(action)
      return true
    },
  })
  const asset = await (await handle(upload('sheet.pdf', 'application/pdf', '%PDF-1.4'))).json()
  seen.length = 0

  const head = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}`, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-type'), 'application/pdf')
  assert.equal(head.headers.get('content-length'), '8')
  assert.equal(head.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(head.headers.get('content-disposition'), 'inline; filename="sheet.pdf"')
  assert.equal(head.body, null)
  assert.deepEqual(seen, ['read'], 'a HEAD is a read')

  const missing = await handle(new Request('https://site.test/vedit/v1/media/nope.pdf', { method: 'HEAD' }))
  assert.equal(missing.status, 404)

  // The Allow list says so; the collection is a listing, which stays GET and POST.
  const wrongItem = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}`, { method: 'POST' }))
  assert.equal(wrongItem.headers.get('allow'), 'GET, HEAD, DELETE')
  const collection = await handle(new Request('https://site.test/vedit/v1/media', { method: 'HEAD' }))
  assert.equal(collection.status, 405)
})

test('delete removes the asset and a later get is 404', async () => {
  const handle = handlerWith()
  const asset = await (await handle(upload('sheet.pdf', 'application/pdf', '%PDF-1.4'))).json()
  const removed = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}`, { method: 'DELETE' }))
  assert.equal(removed.status, 204)
  assert.equal(await removed.text(), '')
  const gone = await handle(new Request(`https://site.test/vedit/v1/media/${asset.id}`))
  assert.equal(gone.status, 404)
  assert.deepEqual((await (await handle(new Request('https://site.test/vedit/v1/media'))).json()).items, [])
  assert.equal((await handle(new Request('https://site.test/vedit/v1/media/..%2Fx', { method: 'DELETE' }))).status, 404)
})

/** Enough of an R2 bucket to prove the store speaks its dialect, including paging. */
function fakeBucket() {
  const objects = new Map()
  const calls = []
  return {
    objects,
    calls,
    async put(key, value, opts) {
      calls.push(['put', key, opts])
      const bytes = await bytesOf(value)
      objects.set(key, {
        bytes,
        httpMetadata: opts?.httpMetadata,
        customMetadata: opts?.customMetadata,
        uploaded: new Date(2026, 0, objects.size + 1),
      })
    },
    async get(key) {
      calls.push(['get', key])
      const object = objects.get(key)
      if (!object) return null
      return {
        body: new Blob([object.bytes]).stream(),
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        size: object.bytes.byteLength,
      }
    },
    async delete(key) {
      calls.push(['delete', key])
      objects.delete(key)
    },
    async list(opts) {
      calls.push(['list', opts])
      const keys = [...objects.keys()].filter((key) => !opts?.prefix || key.startsWith(opts.prefix))
      const start = opts?.cursor ? Number(opts.cursor) : 0
      const page = keys.slice(start, start + 2)
      const withMeta = opts?.include?.includes('customMetadata')
      return {
        objects: page.map((key) => {
          const object = objects.get(key)
          return {
            key,
            size: object.bytes.byteLength,
            uploaded: object.uploaded,
            ...(withMeta ? { customMetadata: object.customMetadata } : {}),
          }
        }),
        truncated: start + 2 < keys.length,
        cursor: start + 2 < keys.length ? String(start + 2) : undefined,
      }
    },
  }
}

test('r2MediaStore maps put, get, list and delete onto the bucket', async () => {
  const bucket = fakeBucket()
  const store = r2MediaStore(bucket)

  const sheet = await store.put(new Blob([text('%PDF-1.4')]), { name: 'sheet.pdf', mime: 'application/pdf', alt: 'Sheet' })
  const logo = await store.put(new Blob([text('GIF89a')]).stream(), { name: 'logo.gif', mime: 'image/gif' })
  const clip = await store.put(new Blob([text('webm')]), { name: 'clip.webm', mime: 'video/webm' })

  const put = bucket.calls.find(([op, key]) => op === 'put' && key === sheet.id)
  assert.equal(put[2].httpMetadata.contentType, 'application/pdf')
  assert.equal(put[2].customMetadata.name, 'sheet.pdf')
  assert.equal(put[2].customMetadata.alt, 'Sheet')
  assert.equal(put[2].customMetadata.kind, 'file')
  assert.equal(put[2].customMetadata.mime, 'application/pdf')
  assert.equal(sheet.size, 8)
  assert.equal(logo.size, 6)
  assert.equal(sheet.url, `/v1/media/${sheet.id}`)

  const got = await store.get(sheet.id)
  assert.deepEqual(got.asset, sheet)
  assert.deepEqual(await bytesOf(got.body), text('%PDF-1.4'))

  bucket.calls.length = 0
  const all = await store.list()
  assert.deepEqual(all.map((a) => a.id), [clip.id, logo.id, sheet.id])
  assert.deepEqual(all[2], sheet)
  const lists = bucket.calls.filter(([op]) => op === 'list')
  assert.equal(lists.length, 2)
  assert.deepEqual(lists[0][1].include, ['customMetadata'])
  assert.equal(lists[1][1].cursor, '2')
  assert.deepEqual((await store.list({ kind: 'video' })).map((a) => a.id), [clip.id])
  assert.deepEqual((await store.list({ query: 'sheet' })).map((a) => a.id), [sheet.id])

  await store.delete(sheet.id)
  assert.equal(bucket.objects.has(sheet.id), false)
  assert.equal(await store.get(sheet.id), null)

  bucket.calls.length = 0
  assert.equal(await store.get('../x'), null)
  await store.delete('../x')
  assert.deepEqual(bucket.calls, [])
})
