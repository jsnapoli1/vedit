import { itemId, parseItemId } from '../runtime/repeat'
import type { InsertedNode, NodeOverride, VeditDocument } from '../core/types'
import type { RecordChanges, SourceChanges, VeditRecord } from './types'

const TEMP_PREFIX = 'new-'

/**
 * An id for a record the server has not seen yet. Base36 only, with a dash:
 * the id becomes a repeat key when a bound row is edited on the page, and the
 * repeat's `sanitizeKey` rewrites `~ : > # [ ]` — an id that changed on the way
 * into the document could never be remapped on the way out.
 */
export function newRecordId(): string {
  let id = ''
  while (id.length < 8) id += Math.random().toString(36).slice(2)
  return `${TEMP_PREFIX}${id.slice(0, 8)}`
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX)
}

/**
 * Rewrite temp ids to the ones the server chose after a commit. Accepts either
 * the pending changes (create ids, update keys, delete and order entries) or a
 * document, where a temp id shows up as the repeat key of a node override or of
 * an inserted node's parent. Always returns a new object; the input is untouched.
 */
export function remapIds<T extends RecordChanges | VeditDocument>(target: T, idMap: Record<string, string>): T {
  return (isDocument(target) ? remapDocument(target, idMap) : remapChanges(target, idMap)) as T
}

function isDocument(target: RecordChanges | VeditDocument): target is VeditDocument {
  return typeof target.version === 'number' && typeof target.nodes === 'object' && target.nodes !== null
}

function remapChanges(changes: RecordChanges, idMap: Record<string, string>): RecordChanges {
  const rename = (id: string) => idMap[id] ?? id
  const next: RecordChanges = {}
  for (const [source, entry] of Object.entries(changes)) {
    const mapped: SourceChanges = {}
    if (entry.create) mapped.create = entry.create.map((record): VeditRecord => ({ ...record, id: rename(record.id) }))
    if (entry.update) {
      mapped.update = {}
      for (const [id, patch] of Object.entries(entry.update)) mapped.update[rename(id)] = patch
    }
    if (entry.delete) mapped.delete = entry.delete.map(rename)
    if (entry.order) mapped.order = entry.order.map(rename)
    next[source] = mapped
  }
  return next
}

function remapDocument(doc: VeditDocument, idMap: Record<string, string>): VeditDocument {
  const renameItem = (id: string) => {
    const parsed = parseItemId(id)
    const real = parsed ? idMap[parsed.key] : undefined
    return parsed && real !== undefined ? itemId(parsed.templateId, real) : id
  }
  const nodes: Record<string, NodeOverride> = {}
  for (const [id, override] of Object.entries(doc.nodes)) nodes[renameItem(id)] = override
  const inserted = doc.inserted.map((node): InsertedNode => {
    const parentId = renameItem(node.parentId)
    return parentId === node.parentId ? node : { ...node, parentId }
  })
  return { ...doc, nodes, inserted }
}
