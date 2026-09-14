import { assetFrom, idFor, isSafeId, matchesList } from './ids'
import type { MediaAsset, VeditMediaStore } from './types'

/**
 * A `VeditMediaStore` on disk: the bytes at `<dir>/<id>` and the asset as a
 * JSON sidecar at `<dir>/<id>.json`. Node only, but every `node:` module is
 * imported inside the functions that need it — like `fileStore` in
 * `vedit/server` — so the `vedit/media` bundle still loads on Workers, where
 * only the R2 store would ever be called.
 */
export function fsMediaStore(directory: string): VeditMediaStore {
  let prepared: Promise<void> | null = null
  // mkdir -p once, on the first write, so pointing at a fresh path just works.
  const prepare = () => {
    prepared ??= (async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(directory, { recursive: true })
    })()
    return prepared
  }

  const pathFor = async (id: string) => {
    const { join } = await import('node:path')
    return join(directory, id)
  }

  const readSidecar = async (path: string): Promise<MediaAsset | null> => {
    const { readFile } = await import('node:fs/promises')
    try {
      return JSON.parse(await readFile(`${path}.json`, 'utf8')) as MediaAsset
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  return {
    async put(file, meta) {
      const id = idFor(meta)
      await prepare()
      const { open, writeFile } = await import('node:fs/promises')
      const path = await pathFor(id)

      // Written chunk by chunk rather than buffered: a 25MB video should not
      // have to sit in memory to reach the disk.
      const reader = (file instanceof Blob ? file.stream() : file).getReader()
      const handle = await open(path, 'w')
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await handle.write(value)
          size += value.byteLength
        }
      } finally {
        await handle.close()
      }

      const asset = assetFrom(id, meta, size)
      await writeFile(`${path}.json`, JSON.stringify(asset, null, 2), 'utf8')
      return asset
    },

    async get(id) {
      // Checked before the path is even built: a bad id never reaches the disk.
      if (!isSafeId(id)) return null
      const path = await pathFor(id)
      const asset = await readSidecar(path)
      if (!asset) return null
      const { createReadStream } = await import('node:fs')
      const { Readable } = await import('node:stream')
      // Node types `toWeb` as its own `stream/web` stream; at runtime it is the
      // same global `ReadableStream` the store's contract names.
      return { asset, body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array> }
    },

    async delete(id) {
      if (!isSafeId(id)) return
      const { rm } = await import('node:fs/promises')
      const path = await pathFor(id)
      await rm(path, { force: true })
      await rm(`${path}.json`, { force: true })
    },

    async list(opts) {
      const { readdir, stat } = await import('node:fs/promises')
      let names: string[] = []
      try {
        names = await readdir(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      const found: Array<{ asset: MediaAsset; at: number }> = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const id = name.slice(0, -'.json'.length)
        // Only sidecars this store could have written count as assets.
        if (!isSafeId(id)) continue
        const path = await pathFor(id)
        const asset = await readSidecar(path)
        if (!asset || asset.id !== id || !matchesList(asset, opts)) continue
        found.push({ asset, at: (await stat(`${path}.json`)).mtimeMs })
      }
      // Ids start with a timestamp, so they break a tie between equal mtimes.
      return found
        .sort((a, b) => b.at - a.at || b.asset.id.localeCompare(a.asset.id))
        .map((item) => item.asset)
    },
  }
}
