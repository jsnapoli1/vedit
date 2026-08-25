/**
 * The relay behind `sseRealtime`, as a plain Node server. `createRealtimeHandler`
 * speaks the Fetch API, so this file is only the ~20 lines that turn a Node
 * request into a `Request` and a `Response` back into a Node reply — on Next.js,
 * Deno, Bun or Workers you would export the handler directly and skip all of it.
 *
 *     node realtime-server.mjs
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createUnsafeLocalRealtimeHandler } from '../dist/server.js'

// The example relay is open on purpose: it is a local demo. A deployed one takes
// `createRealtimeHandler({ authorize })` instead.
const handle = createUnsafeLocalRealtimeHandler()
const port = Number(process.env.PORT ?? 5179)

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

  const response = await handle(request)
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) Readable.fromWeb(response.body).pipe(nodeResponse)
  else nodeResponse.end()
}).listen(port, () => console.log(`vedit realtime relay on :${port}`))
