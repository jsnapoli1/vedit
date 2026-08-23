import { emptyDocument, type VeditDocument } from './core/types'
import { documentToCss } from './runtime/css'
import { DEFAULT_BREAKPOINTS, type BreakpointWidths } from './core/types'

export { documentToCss, emptyDocument }
export type { VeditDocument }

/** Where the server keeps documents. Implement this against your own database. */
export interface VeditServerStore {
  read(key: string): Promise<VeditDocument | null>
  write(doc: VeditDocument): Promise<void>
}

/** A `VeditServerStore` backed by JSON files on disk — fine for small sites. */
export function fileStore(directory: string): VeditServerStore {
  const safeName = (key: string) => `${key.replace(/[^a-z0-9._-]+/gi, '_') || 'default'}.json`
  return {
    async read(key) {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      try {
        return JSON.parse(await readFile(join(directory, safeName(key)), 'utf8')) as VeditDocument
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async write(doc) {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, safeName(doc.key)), JSON.stringify(doc, null, 2), 'utf8')
    },
  }
}

export interface HandlerOptions {
  store: VeditServerStore
  /**
   * Decide whether a request may write. Without this, every request can save —
   * fine for local development, never for production.
   */
  authorize?: (request: Request) => boolean | Promise<boolean>
}

/**
 * A Web-standard `Request -> Response` handler that pairs with `httpAdapter`.
 * Works anywhere the Fetch API does: Next.js route handlers, Remix, Hono,
 * Cloudflare Workers, Deno, Bun.
 */
export function createVeditHandler({ store, authorize }: HandlerOptions) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const key = url.searchParams.get('key') ?? 'default'
      const doc = await store.read(key)
      return json(doc ?? emptyDocument(key))
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      if (authorize && !(await authorize(request))) {
        return json({ error: 'Not allowed' }, 403)
      }
      const body = (await request.json()) as VeditDocument
      if (!body || typeof body !== 'object' || typeof body.key !== 'string' || !body.nodes) {
        return json({ error: 'Malformed document' }, 400)
      }
      await store.write({ ...emptyDocument(body.key), ...body })
      return json({ ok: true })
    }

    return json({ error: 'Method not allowed' }, 405)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Renders overrides as a `<style>` tag for server-side rendering, so the first
 * paint already carries the edits instead of flashing the original design.
 */
export function veditStyleTag(
  doc: VeditDocument | null,
  breakpoints: BreakpointWidths = DEFAULT_BREAKPOINTS,
): string {
  if (!doc) return ''
  const css = documentToCss(doc, breakpoints)
  return css ? `<style data-vedit-overrides>${css}</style>` : ''
}
