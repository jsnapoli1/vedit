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
 * Where uploaded files live. A store owns the bytes and the metadata together,
 * so a listing never has to join two places that could disagree.
 */
export interface VeditMediaStore {
  put(file: Blob | ReadableStream<Uint8Array>, meta: MediaMeta): Promise<VeditAsset>
  get(id: string): Promise<{ asset: VeditAsset; body: ReadableStream<Uint8Array> } | null>
  delete(id: string): Promise<void>
  list(opts?: { kind?: NonNullable<VeditAsset['kind']>; query?: string }): Promise<VeditAsset[]>
}
