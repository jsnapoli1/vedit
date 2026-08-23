import { emptyDocument, type VeditAdapter, type VeditDocument } from '../types'

/** In-memory adapter, useful for tests, Storybook and previews. */
export function memoryAdapter(initial?: Partial<VeditDocument>): VeditAdapter {
  let doc: VeditDocument | null = initial ? { ...emptyDocument(initial.key ?? 'default'), ...initial } : null
  return {
    async load() {
      return doc
    },
    async save(next) {
      doc = next
    },
  }
}
