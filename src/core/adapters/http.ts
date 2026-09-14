import {
  type VeditAdapter,
  type VeditAsset,
  type VeditDocument,
  type VeditVersion,
} from '../types'

export interface HttpAdapterOptions {
  /** Endpoint that answers `GET ?key=…` with a document and accepts `PUT` of one. */
  endpoint: string
  /** Extra headers, e.g. an auth token. Re-evaluated on every request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  /** Endpoint that accepts a `multipart/form-data` `file` field and returns `{ url }`. */
  uploadEndpoint?: string
  /** Endpoint returning `{ items: [{ url, name }] }` for the image library. */
  assetsEndpoint?: string
  /**
   * The media route of `createMediaHandler` (e.g. `/vedit/v1/media`). One
   * endpoint for any kind of file: `POST` multipart uploads, `GET ?kind=&q=`
   * lists. Takes over from `uploadEndpoint` and `assetsEndpoint` when set.
   */
  mediaEndpoint?: string
  /**
   * The endpoint keeps a draft separate from what visitors see — which
   * `createVeditHandler` does. Switches on the Publish button and History panel.
   */
  staged?: boolean
  fetch?: typeof fetch
}

/** Talks to your own backend. Pair it with `createVeditHandler` from `vedit/server`. */
export function httpAdapter(options: HttpAdapterOptions): VeditAdapter {
  const doFetch = options.fetch ?? globalThis.fetch
  const resolveHeaders = async () =>
    typeof options.headers === 'function' ? await options.headers() : options.headers ?? {}

  const withQuery = (params: Record<string, string>) => {
    const url = new URL(options.endpoint, globalThis.location?.href ?? 'http://localhost')
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
    return options.endpoint.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`
  }

  const getDocument = async (params: Record<string, string>): Promise<VeditDocument | null> => {
    const response = await doFetch(withQuery(params), { headers: await resolveHeaders() })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Could not load overrides (${response.status})`)
    const body = (await response.json()) as VeditDocument | null
    return body && typeof body === 'object' && 'nodes' in body ? body : null
  }

  const put = async (doc: VeditDocument, params: Record<string, string> = {}) => {
    const response = await doFetch(withQuery(params), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(await resolveHeaders()) },
      body: JSON.stringify(doc),
    })
    if (!response.ok) throw new Error(`Could not save overrides (${response.status})`)
  }

  return {
    async load(key, loadOptions) {
      const stage = options.staged ? loadOptions?.stage ?? 'published' : undefined
      return getDocument({ key, ...(stage ? { stage } : {}) })
    },
    async save(doc) {
      await put(doc, { key: doc.key })
    },
    ...(options.staged
      ? {
          async publish(doc: VeditDocument) {
            await put(doc, { key: doc.key, action: 'publish' })
          },
          async listVersions(key: string) {
            const response = await doFetch(withQuery({ key, versions: '1' }), {
              headers: await resolveHeaders(),
            })
            if (!response.ok) throw new Error(`Could not list versions (${response.status})`)
            const body = (await response.json()) as { items?: VeditVersion[] }
            return body.items ?? []
          },
          async loadVersion(key: string, versionId: string) {
            return getDocument({ key, version: versionId })
          },
        }
      : {}),
    ...(options.assetsEndpoint && !options.mediaEndpoint
      ? {
          async listAssets() {
            const response = await doFetch(options.assetsEndpoint!, { headers: await resolveHeaders() })
            if (!response.ok) throw new Error(`Could not list assets (${response.status})`)
            const body = (await response.json()) as { items?: VeditAsset[] } | VeditAsset[]
            return Array.isArray(body) ? body : body.items ?? []
          },
        }
      : {}),
    ...(options.mediaEndpoint
      ? {
          async listAssets(listOptions?: { kind?: 'image' | 'file' | 'video'; query?: string }) {
            const query = new URLSearchParams()
            if (listOptions?.kind) query.set('kind', listOptions.kind)
            if (listOptions?.query) query.set('q', listOptions.query)
            const search = query.toString()
            const suffix = search ? `?${search}` : ''
            const response = await doFetch(`${options.mediaEndpoint}${suffix}`, {
              headers: await resolveHeaders(),
              credentials: 'same-origin',
            })
            if (!response.ok) throw new Error(`Could not list assets (${response.status})`)
            const body = (await response.json()) as { items?: VeditAsset[] } | VeditAsset[]
            return Array.isArray(body) ? body : body.items ?? []
          },
          async uploadAsset(file: File, uploadOptions?: { accept?: string[] }) {
            const form = new FormData()
            form.append('file', file)
            const response = await doFetch(options.mediaEndpoint!, {
              method: 'POST',
              headers: await resolveHeaders(),
              body: form,
              credentials: 'same-origin',
            })
            if (response.status === 400 && uploadOptions?.accept) {
              throw new Error(`Upload refused: expected ${uploadOptions.accept.join(', ')}`)
            }
            if (!response.ok) throw new Error(`Upload failed (${response.status})`)
            const body = (await response.json()) as Partial<VeditAsset>
            if (!body.url) throw new Error('Media endpoint did not return a url')
            return { ...body, url: body.url }
          },
        }
      : {}),
    ...(options.uploadEndpoint
      ? {
          async uploadImage(file: File) {
            const form = new FormData()
            form.append('file', file)
            const response = await doFetch(options.uploadEndpoint!, {
              method: 'POST',
              headers: await resolveHeaders(),
              body: form,
            })
            if (!response.ok) throw new Error(`Upload failed (${response.status})`)
            const body = (await response.json()) as { url?: string }
            if (!body.url) throw new Error('Upload endpoint did not return a url')
            return body.url
          },
        }
      : {}),
  }
}
