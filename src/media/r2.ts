import { assetKind } from './kind'
import { assetFrom, idFor, isSafeId, matchesList, readBytes, storeUrl } from './ids'
import type { MediaAsset, VeditMediaStore } from './types'

/**
 * The slice of a Cloudflare R2 bucket binding the store uses, spelled out
 * structurally so `vedit/media` needs no Workers types to compile — the real
 * `R2Bucket` satisfies it as-is.
 */
export interface R2Like {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Blob,
    opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>
  get(key: string): Promise<{
    body: ReadableStream<Uint8Array>
    httpMetadata?: { contentType?: string }
    customMetadata?: Record<string, string>
    size: number
  } | null>
  delete(key: string): Promise<unknown>
  list(opts?: { include?: string[]; prefix?: string; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number; customMetadata?: Record<string, string>; uploaded?: Date }>
    truncated: boolean
    cursor?: string
  }>
}

/**
 * A `VeditMediaStore` over an R2 bucket. The object is the bytes and its
 * `customMetadata` is the asset, so one `list({ include: ['customMetadata'] })`
 * is a complete listing.
 */
export function r2MediaStore(bucket: R2Like): VeditMediaStore {
  return {
    async put(file, meta) {
      const id = idFor(meta)
      // R2 refuses a stream whose length it cannot know up front, so anything
      // that isn't a Blob is buffered first; a Blob carries its own size.
      const value = file instanceof Blob ? file : new Blob([await readBytes(file)])
      const asset = assetFrom(id, meta, value.size)
      await bucket.put(id, value, {
        httpMetadata: { contentType: meta.mime },
        customMetadata: customMetadataFor(asset),
      })
      return asset
    },

    async get(id) {
      if (!isSafeId(id)) return null
      const object = await bucket.get(id)
      if (!object) return null
      const mime = object.customMetadata?.mime ?? object.httpMetadata?.contentType ?? 'application/octet-stream'
      return { asset: assetFromMeta(id, object.customMetadata, object.size, mime), body: object.body }
    },

    async delete(id) {
      if (!isSafeId(id)) return
      await bucket.delete(id)
    },

    async list(opts) {
      const found: Array<{ asset: MediaAsset; at: number }> = []
      let cursor: string | undefined
      // A page is at most 1000 objects; keep going until the bucket says it is done.
      for (;;) {
        const page = await bucket.list({ include: ['customMetadata'], cursor })
        for (const object of page.objects) {
          if (!isSafeId(object.key)) continue
          const mime = object.customMetadata?.mime ?? 'application/octet-stream'
          const asset = assetFromMeta(object.key, object.customMetadata, object.size, mime)
          if (matchesList(asset, opts)) found.push({ asset, at: object.uploaded?.getTime() ?? 0 })
        }
        if (!page.truncated || !page.cursor) break
        cursor = page.cursor
      }
      return found
        .sort((a, b) => b.at - a.at || b.asset.id.localeCompare(a.asset.id))
        .map((item) => item.asset)
    },
  }
}

/** The asset, rebuilt from what an object carries; `size` and `mime` come from the object itself. */
function assetFromMeta(id: string, meta: Record<string, string> | undefined, size: number, mime: string): MediaAsset {
  const asset: MediaAsset = {
    id,
    url: storeUrl(id),
    kind: assetKind(mime),
    name: meta?.name ?? id,
    mime,
    size,
  }
  if (meta?.alt !== undefined) asset.alt = meta.alt
  const width = Number(meta?.width)
  const height = Number(meta?.height)
  if (Number.isFinite(width) && width > 0) asset.width = width
  if (Number.isFinite(height) && height > 0) asset.height = height
  return asset
}

/** `customMetadata` holds strings only, so numbers are stringified on the way in. */
function customMetadataFor(asset: MediaAsset): Record<string, string> {
  const meta: Record<string, string> = { name: asset.name, mime: asset.mime, kind: asset.kind, size: String(asset.size) }
  if (asset.alt !== undefined) meta.alt = asset.alt
  if (asset.width !== undefined) meta.width = String(asset.width)
  if (asset.height !== undefined) meta.height = String(asset.height)
  return meta
}
