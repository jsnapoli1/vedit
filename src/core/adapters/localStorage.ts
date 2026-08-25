import { type VeditAdapter, type VeditDocument } from '../types'

/**
 * Zero-config adapter: overrides live in the browser only. Great for trying the
 * editor out, not for publishing changes to real visitors.
 */
export function localStorageAdapter(namespace = 'vedit'): VeditAdapter {
  const storageKey = (key: string) => `${namespace}:${key}`
  return {
    async load(key) {
      if (typeof localStorage === 'undefined') return null
      const raw = localStorage.getItem(storageKey(key))
      return raw ? (JSON.parse(raw) as VeditDocument) : null
    },
    async save(doc) {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(storageKey(doc.key), JSON.stringify(doc))
    },
  }
}
