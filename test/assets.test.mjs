import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VeditStore, httpAdapter, memoryAdapter } from '../dist/index.js'

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'datasheet.pdf', { type: 'application/pdf' })
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' })

const makeStore = (adapter) => new VeditStore({ key: 'home', adapter: { ...memoryAdapter(), ...adapter } })

test('uploadAsset prefers the adapter\'s uploadAsset and passes the accept list', async () => {
  const calls = []
  const store = makeStore({
    async uploadAsset(file, opts) {
      calls.push({ name: file.name, opts })
      return { url: `/media/${file.name}`, kind: 'file', name: file.name, size: file.size }
    },
    async uploadImage() {
      throw new Error('uploadImage should not be used when uploadAsset exists')
    },
  })

  const file = await store.uploadAsset(pdf(), { kind: 'file' })
  assert.equal(file.url, '/media/datasheet.pdf')
  assert.equal(file.name, 'datasheet.pdf')

  const image = await store.uploadAsset(png(), { kind: 'image' })
  assert.equal(image.url, '/media/photo.png')

  assert.deepEqual(calls, [
    { name: 'datasheet.pdf', opts: { accept: undefined } },
    { name: 'photo.png', opts: { accept: ['image/*'] } },
  ])
  // The old entry point still answers with a url, through the same path.
  assert.equal(await store.uploadImage(png()), '/media/photo.png')
  assert.equal(store.canUpload('file'), true)
  assert.equal(store.canUpload('image'), true)
})

test('without uploadAsset an image still goes through uploadImage', async () => {
  const seen = []
  const store = makeStore({
    async uploadImage(file) {
      seen.push(file.name)
      return `/uploads/${file.name}`
    },
  })
  const asset = await store.uploadAsset(png(), { kind: 'image' })
  assert.deepEqual(asset, { url: '/uploads/photo.png', kind: 'image', name: 'photo.png', mime: 'image/png', size: 4 })
  assert.deepEqual(seen, ['photo.png'])
  assert.equal(await store.uploadImage(png()), '/uploads/photo.png')
  assert.equal(store.canUpload('image'), true)
})

test('without uploadAsset a non-image is refused with a notice, not a data url', async () => {
  const store = makeStore({
    async uploadImage() {
      throw new Error('a pdf must not reach uploadImage')
    },
  })
  const asset = await store.uploadAsset(pdf(), { kind: 'file' })
  assert.equal(asset, null)
  assert.equal(store.getState().notice, 'This site cannot store files')
  assert.equal(store.canUpload('file'), false)
  assert.equal(store.canUpload('video'), false)
})

test('listAssets forwards the kind filter and the old zero-argument adapter still works', async () => {
  const received = []
  const filtered = makeStore({
    async listAssets(opts) {
      received.push(opts)
      return [{ url: '/media/a.pdf', kind: 'file', name: 'a.pdf' }]
    },
  })
  const files = await filtered.listAssets({ kind: 'file' })
  assert.equal(files[0].name, 'a.pdf')
  assert.deepEqual(received, [{ kind: 'file' }])

  // An adapter written before the filter existed ignores what it is handed.
  const legacy = makeStore({
    async listAssets() {
      return [{ url: '/images/one.png', name: 'one.png' }]
    },
  })
  assert.deepEqual(await legacy.listAssets({ kind: 'image' }), [{ url: '/images/one.png', name: 'one.png' }])
  assert.deepEqual(await legacy.listAssets(), [{ url: '/images/one.png', name: 'one.png' }])
  assert.equal(legacy.canListAssets, true)

  const none = makeStore({})
  assert.deepEqual(await none.listAssets({ kind: 'file' }), [])
  assert.equal(none.canListAssets, false)
})

test('httpAdapter with mediaEndpoint posts multipart and lists with kind', async () => {
  const requests = []
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? 'GET', body: init.body, credentials: init.credentials })
    if (init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'abc', url: '/vedit/v1/media/abc.pdf', kind: 'file', name: 'datasheet.pdf', mime: 'application/pdf', size: 4 }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: 'abc', url: '/vedit/v1/media/abc.pdf', kind: 'file', name: 'datasheet.pdf' }] }),
    }
  }
  const adapter = httpAdapter({ endpoint: '/vedit/v1/overrides', mediaEndpoint: '/vedit/v1/media', fetch })

  const asset = await adapter.uploadAsset(pdf(), { accept: undefined })
  assert.equal(asset.url, '/vedit/v1/media/abc.pdf')
  assert.equal(asset.kind, 'file')

  const listed = await adapter.listAssets({ kind: 'file', query: 'data' })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'datasheet.pdf')

  assert.equal(requests.length, 2)
  const [upload, list] = requests
  assert.equal(upload.url, '/vedit/v1/media')
  assert.equal(upload.method, 'POST')
  assert.ok(upload.body instanceof FormData)
  assert.equal(upload.body.get('file').name, 'datasheet.pdf')
  assert.equal(upload.credentials, 'same-origin')
  assert.equal(list.method, 'GET')
  assert.equal(list.url, '/vedit/v1/media?kind=file&q=data')
  assert.equal(list.credentials, 'same-origin')

  // Without the option, the adapter offers neither — exactly as before.
  const plain = httpAdapter({ endpoint: '/vedit/v1/overrides', fetch })
  assert.equal(plain.uploadAsset, undefined)
  assert.equal(plain.listAssets, undefined)
})

test('a refused upload tells the person why, in plain words', async () => {
  const store = makeStore({
    async uploadAsset(file) {
      if (file.size > 3) throw new Error('"big.png" is 25.1 MB; files are limited to 25 MB')
      throw new Error('Upload failed (500)')
    },
  })
  await assert.rejects(() => store.uploadAsset(png(), { kind: 'image' }), /25 MB/)
  assert.equal(store.getState().notice, '"big.png" is 25.1 MB; files are limited to 25 MB')
})

test('the http adapter turns the server\'s refusal into a message about the file', async () => {
  const responses = {
    413: { error: 'Files are limited to 26214400 bytes' },
    400: { error: 'Files of type application/x-msdownload are not accepted' },
  }
  let status = 413
  const adapter = httpAdapter({
    endpoint: '/vedit',
    mediaEndpoint: '/vedit/v1/media',
    fetch: async () => new Response(JSON.stringify(responses[status]), { status, headers: { 'content-type': 'application/json' } }),
  })
  const big = new File([new Uint8Array(30 * 1024 * 1024)], 'photo.png', { type: 'image/png' })
  await assert.rejects(() => adapter.uploadAsset(big, { accept: ['image/*'] }), /"photo\.png" is 30 MB; files are limited to 25 MB/)
  status = 400
  const exe = new File([new Uint8Array(2048)], 'notes.exe', { type: 'application/x-msdownload' })
  await assert.rejects(() => adapter.uploadAsset(exe, { accept: ['image/*'] }), /"notes\.exe" is not an image/)
  await assert.rejects(() => adapter.uploadAsset(exe), /"notes\.exe" is not a kind of file this site accepts/)
})
