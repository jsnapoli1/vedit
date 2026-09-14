import { segmentsAfterVersion } from '../content/query'
import { DEFAULT_ACCEPT, matchesAccept } from './kind'
import { isSafeId } from './ids'
import type { MediaAsset, VeditMediaStore } from './types'

/** What a request is trying to do, handed to `authorize` before anything happens. */
export type MediaAction = 'read' | 'upload' | 'delete'

export interface MediaHandlerOptions {
  store: VeditMediaStore
  /**
   * Decide whether a request may go ahead. Required, and deliberately so: an
   * open upload endpoint is free hosting for anyone who finds it. The shape is
   * the one `createAuth().authorize` has, so it plugs in unchanged.
   */
  authorize: (request: Request, context: { action: MediaAction }) => boolean | Promise<boolean>
  /** Mime allowlist for uploads; `type/*` wildcards work. Defaults to `DEFAULT_ACCEPT`. */
  accept?: string[]
  /** Largest upload, in bytes. Defaults to 25MB. */
  maxBytes?: number
  /**
   * Where a stored file is reachable when that isn't this handler — a CDN in
   * front of the bucket, say. Without it every url points back at
   * `<mount>/v1/media/<id>`.
   */
  publicUrl?: (id: string) => string
}

/**
 * A Fetch-standard handler for uploads, like `createVeditApi`. Mounts under any
 * prefix: it finds the `/v1` segment itself.
 *
 *     POST   /v1/media            multipart `file` (+ `alt`) → the asset
 *     GET    /v1/media?kind=&q=   { items }
 *     GET    /v1/media/{id}       the bytes; `?download=1` for an attachment
 *     DELETE /v1/media/{id}
 */
export function createMediaHandler(options: MediaHandlerOptions) {
  const { store, authorize, accept = DEFAULT_ACCEPT, maxBytes = 25 * 1024 * 1024, publicUrl } = options

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = segmentsAfterVersion(url.pathname)
    if (!segments || segments[0] !== 'media' || segments.length > 2) return notFound()

    const method = request.method.toUpperCase()
    const id = segments.length === 2 ? segments[1] : null
    const allowed = id === null ? ['GET', 'POST'] : ['GET', 'DELETE']
    if (!allowed.includes(method)) {
      return json({ error: 'Method not allowed on this route' }, 405, { allow: allowed.join(', ') })
    }

    // Authorization comes before the body is read: a refused upload should
    // cost nothing to refuse.
    const action: MediaAction = method === 'POST' ? 'upload' : method === 'DELETE' ? 'delete' : 'read'
    if (!(await authorize(request, { action }))) return json({ error: 'Not allowed' }, 403)

    const urlFor = (asset: MediaAsset): MediaAsset => ({
      ...asset,
      url: publicUrl ? publicUrl(asset.id) : `${mountPrefix(url.pathname)}/v1/media/${asset.id}`,
    })

    if (id === null) {
      if (method === 'POST') return upload(request, urlFor)
      const kind = url.searchParams.get('kind')
      if (kind !== null && kind !== 'image' && kind !== 'video' && kind !== 'file') {
        return json({ error: 'kind must be image, video or file' }, 400)
      }
      const query = url.searchParams.get('q')
      const items = await store.list({ ...(kind ? { kind } : {}), ...(query ? { query } : {}) })
      return json({ items: items.map(urlFor) })
    }

    // An id the stores would refuse is simply a file that does not exist.
    if (!isSafeId(id)) return notFound()

    if (method === 'DELETE') {
      await store.delete(id)
      return new Response(null, { status: 204 })
    }

    const found = await store.get(id)
    if (!found) return notFound()
    const { asset, body } = found
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const headers = new Headers({
      'content-type': asset.mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `${disposition}; filename="${quoteFilename(asset.name)}"`,
    })
    if (Number.isFinite(asset.size)) headers.set('content-length', String(asset.size))
    return new Response(body, { status: 200, headers })
  }

  async function upload(request: Request, urlFor: (asset: MediaAsset) => MediaAsset): Promise<Response> {
    let form: FormData
    try {
      form = await request.formData()
    } catch (error) {
      return json({ error: `Expected a multipart form: ${error instanceof Error ? error.message : String(error)}` }, 400)
    }
    const file = form.get('file')
    if (!(file instanceof File)) return json({ error: 'Send the upload as a `file` field' }, 400)
    const mime = file.type || 'application/octet-stream'
    if (!matchesAccept(mime, accept)) return json({ error: `Files of type ${mime} are not accepted` }, 400)
    if (file.size > maxBytes) return json({ error: `Files are limited to ${maxBytes} bytes` }, 413)
    const alt = form.get('alt')
    const asset = await store.put(file, {
      name: file.name,
      mime,
      size: file.size,
      ...(typeof alt === 'string' ? { alt } : {}),
    })
    return json(urlFor(asset))
  }
}

/** The part of the path before `/v1`, so a handler mounted at `/vedit` hands out `/vedit/v1/media/…`. */
function mountPrefix(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  const at = parts.lastIndexOf('v1')
  return at > 0 ? `/${parts.slice(0, at).join('/')}` : ''
}

/**
 * A name that is safe inside a quoted-string: quotes and backslashes escaped,
 * and no line breaks, which would otherwise end the header.
 */
function quoteFilename(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, '\\$&')
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

function notFound(): Response {
  return json({ error: 'Not found' }, 404)
}
