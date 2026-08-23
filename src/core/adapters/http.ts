import { type VeditAdapter, type VeditDocument } from '../types'

export interface HttpAdapterOptions {
  /** Endpoint that answers `GET ?key=…` with a document and accepts `PUT` of one. */
  endpoint: string
  /** Extra headers, e.g. an auth token. Re-evaluated on every request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  /** Endpoint that accepts a `multipart/form-data` `file` field and returns `{ url }`. */
  uploadEndpoint?: string
  fetch?: typeof fetch
}

/** Talks to your own backend. Pair it with `createVeditHandler` from `vedit/server`. */
export function httpAdapter(options: HttpAdapterOptions): VeditAdapter {
  const doFetch = options.fetch ?? globalThis.fetch
  const resolveHeaders = async () =>
    typeof options.headers === 'function' ? await options.headers() : options.headers ?? {}

  return {
    async load(key) {
      const url = `${options.endpoint}${options.endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`
      const response = await doFetch(url, { headers: await resolveHeaders() })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Could not load overrides (${response.status})`)
      const body = (await response.json()) as VeditDocument | null
      return body && typeof body === 'object' && 'nodes' in body ? body : null
    },
    async save(doc) {
      const response = await doFetch(options.endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(await resolveHeaders()) },
        body: JSON.stringify(doc),
      })
      if (!response.ok) throw new Error(`Could not save overrides (${response.status})`)
    },
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
