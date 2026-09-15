/**
 * The server behind the `/catalog` pages: records, files, sign-in and the
 * catalog's own documents, all under one `/vedit` prefix that Vite proxies here.
 * `createContentHandler` and `createVeditHandler` both speak the Fetch API, so
 * this file is the same ~20-line Node bridge as `realtime-server.mjs` plus one
 * line that decides which of the two answers.
 *
 *     npm run build && node content-server.mjs
 *
 * Everything lives in memory or a temp directory and is seeded afresh on every
 * start. Sign in as sam@example.com / vedit-demo.
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createAuth, usersCollection } from '../dist/auth.js'
import { createContentHandler, memoryContentStore } from '../dist/content-server.js'
import { fsMediaStore } from '../dist/media.js'
import { createVeditHandler, fileStore } from '../dist/server.js'
import { collections, globals } from './schema.mjs'

const seed = {
  categories: [
    { id: 'cat-power', name: 'Power' },
    { id: 'cat-sensing', name: 'Sensing' },
  ],
  products: [
    {
      id: 'p-relay',
      title: 'Relay Module',
      blurb: '<p>Four <strong>isolated</strong> channels, screw terminals, 10A per contact.</p>',
      category: 'cat-power',
      price: 24,
      position: 0,
    },
    {
      id: 'p-meter',
      title: 'Power Meter',
      blurb: '<p>Voltage, current and energy over <em>Modbus</em>, DIN-rail mounted.</p>',
      category: 'cat-power',
      price: 89,
      position: 1,
    },
    {
      id: 'p-sensor',
      title: 'Temperature Sensor',
      blurb: '<p>Sealed probe, two-metre lead, accurate to half a degree.</p>',
      category: 'cat-sensing',
      price: 15,
      position: 2,
    },
  ],
  site: [{ id: 'global', tagline: 'Parts that ship the day you order.', contact: 'sales@example.com' }],
}

// The store knows every source it will be asked about, `_users` included; the
// handler adds `_users` to what it serves by itself when `auth` is given.
const store = memoryContentStore({ collections: { ...collections, _users: usersCollection }, globals }, { seed })
const media = fsMediaStore(mkdtempSync(join(tmpdir(), 'vedit-media-')))
const auth = createAuth({
  store,
  // A demo secret. A deployed server reads its own from the environment.
  secret: 'vedit-demo-secret-not-for-production',
  bootstrap: { email: 'sam@example.com', password: 'vedit-demo', name: 'Sam' },
})
await store.init()

const content = createContentHandler({ collections, globals, store, media, auth })
// The catalog pages' overrides — what `httpAdapter` saves — go to the plain
// document handler, gated by the same sessions.
const documents = createVeditHandler({
  store: fileStore(mkdtempSync(join(tmpdir(), 'vedit-documents-'))),
  authorize: (request) => auth.authorize(request),
})

const port = Number(process.env.PORT ?? 5180)

createServer(async (nodeRequest, nodeResponse) => {
  const url = new URL(nodeRequest.url ?? '/', `http://${nodeRequest.headers.host ?? 'localhost'}`)
  const controller = new AbortController()
  nodeResponse.on('close', () => controller.abort())

  const request = new Request(url, {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body: ['GET', 'HEAD'].includes(nodeRequest.method ?? 'GET') ? undefined : Readable.toWeb(nodeRequest),
    duplex: 'half',
    signal: controller.signal,
  })

  // Every content, media and auth route carries a `/v1` segment; the document
  // handler is the query-string API and has none.
  const handle = /\/v1(\/|$)/.test(url.pathname) ? content : documents
  const response = await handle(request)
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) Readable.fromWeb(response.body).pipe(nodeResponse)
  else nodeResponse.end()
}).listen(port, () => console.log(`vedit content server on :${port} — sign in as sam@example.com / vedit-demo`))
