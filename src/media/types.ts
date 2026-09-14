import type { VeditAsset } from '../core/types'

export interface MediaMeta {
  name: string
  mime: string
  size?: number
  alt?: string
  /** Supplied to replace an asset in place; otherwise the store mints one. */
  id?: string
}

/**
 * What a media store hands back: a `VeditAsset` where everything the store
 * knows is filled in. `alt` rides along so a picker can show it without a
 * second lookup.
 */
export interface MediaAsset extends VeditAsset {
  id: string
  kind: NonNullable<VeditAsset['kind']>
  name: string
  mime: string
  size: number
  alt?: string
}

export interface MediaListOptions {
  kind?: NonNullable<VeditAsset['kind']>
  /** Case-insensitive substring of the name or alt text. */
  query?: string
}

/**
 * Where uploaded files live. A store owns the bytes and the metadata together,
 * so a listing never has to join two places that could disagree.
 */
export interface VeditMediaStore {
  put(file: Blob | ReadableStream<Uint8Array>, meta: MediaMeta): Promise<MediaAsset>
  /** `null` for a missing asset, and for any id that isn't one a store minted. */
  get(id: string): Promise<{ asset: MediaAsset; body: ReadableStream<Uint8Array> } | null>
  delete(id: string): Promise<void>
  /** Newest first. */
  list(opts?: MediaListOptions): Promise<MediaAsset[]>
}
