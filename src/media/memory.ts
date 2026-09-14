import { assetFrom, idFor, isSafeId, matchesList, readBytes } from './ids'
import type { MediaAsset, VeditMediaStore } from './types'

/** A `VeditMediaStore` that forgets everything on restart — tests and demos. */
export function memoryMediaStore(): VeditMediaStore {
  const items = new Map<string, { asset: MediaAsset; bytes: Uint8Array<ArrayBuffer> }>()

  return {
    async put(file, meta) {
      const id = idFor(meta)
      const bytes = await readBytes(file)
      const asset = assetFrom(id, meta, bytes.byteLength)
      // Re-inserting moves a replaced asset to the newest end of the map.
      items.delete(id)
      items.set(id, { asset, bytes })
      return asset
    },

    async get(id) {
      if (!isSafeId(id)) return null
      const item = items.get(id)
      if (!item) return null
      return { asset: item.asset, body: new Blob([item.bytes]).stream() }
    },

    async delete(id) {
      if (!isSafeId(id)) return
      items.delete(id)
    },

    async list(opts) {
      return [...items.values()]
        .map((item) => item.asset)
        .filter((asset) => matchesList(asset, opts))
        .reverse()
    },
  }
}
