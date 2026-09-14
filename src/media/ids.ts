import { assetKind } from './kind'
import type { MediaAsset, MediaListOptions, MediaMeta } from './types'

/**
 * The only shape an id can have: base36 and dashes, with at most one extension.
 * Every store checks this before touching its backend, so a crafted id can
 * never name a path outside the store — there is no separator to climb with.
 */
export function isSafeId(id: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9]+)?$/i.test(id)
}

/**
 * `m1x2y3-ab12cd34.pdf`: a timestamp so ids sort by age, randomness so two
 * uploads in the same millisecond don't collide, and the original extension so
 * a browser that ignores `Content-Type` still opens the file with the right app.
 */
export function newAssetId(name: string): string {
  let random = ''
  while (random.length < 8) random += Math.random().toString(36).slice(2)
  const ext = extensionOf(name)
  return `${Date.now().toString(36)}-${random.slice(0, 8)}${ext ? `.${ext}` : ''}`
}

/** The extension of `name`, lowercased and stripped to what an id may carry. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
}

/**
 * The id an upload gets: the one the caller asked for (a replace), or a fresh
 * one. A supplied id that fails the check is a bug in the caller, not a file
 * to silently rename.
 */
export function idFor(meta: MediaMeta): string {
  if (meta.id === undefined) return newAssetId(meta.name)
  if (!isSafeId(meta.id)) throw new TypeError(`Not a media id: ${meta.id}`)
  return meta.id
}

/** The relative url a store hands out; the handler rewrites it for its mount point. */
export function storeUrl(id: string): string {
  return `/v1/media/${id}`
}

/** Build the asset a store returns, leaving `alt` out rather than `undefined`. */
export function assetFrom(id: string, meta: MediaMeta, size: number): MediaAsset {
  const asset: MediaAsset = {
    id,
    url: storeUrl(id),
    kind: assetKind(meta.mime),
    name: meta.name,
    mime: meta.mime,
    size,
  }
  if (meta.alt !== undefined) asset.alt = meta.alt
  return asset
}

/** The `kind` and `query` filters every store applies the same way. */
export function matchesList(asset: MediaAsset, opts?: MediaListOptions): boolean {
  if (opts?.kind && asset.kind !== opts.kind) return false
  if (opts?.query) {
    const needle = opts.query.toLowerCase()
    const haystack = `${asset.name}\n${asset.alt ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

/** Everything in a Blob or a stream, in one buffer. */
export async function readBytes(file: Blob | ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(file).arrayBuffer())
}
