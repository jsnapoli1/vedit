import type { RecordChanges, RecordOperation, SourceChanges, VeditRecord } from './types'
import { newRecordId } from './ids'

/** A batch that could not be folded. The changes are left exactly as they were. */
export class RecordOperationError extends Error {
  constructor(
    message: string,
    /** Position of the failing operation in the batch. */
    readonly index: number,
    readonly operation: unknown,
  ) {
    super(message)
    this.name = 'RecordOperationError'
  }
}

/**
 * Fold a batch of operations into a set of pending changes and return a new
 * set. Pure and atomic: a malformed operation fails the whole batch before
 * anything is touched, so the editor's undo history and the server's commit
 * both see either all of it or none of it.
 *
 * The folding keeps the changes minimal. A record created and then edited is
 * one create; a record created and then deleted is nothing at all, because the
 * server never heard of it. A delete forgets any pending edit to the record.
 */
export function applyRecordOperations(changes: RecordChanges, operations: RecordOperation[]): RecordChanges {
  if (!Array.isArray(operations)) throw new RecordOperationError('Expected an array of operations', 0, operations)

  const next: RecordChanges = {}
  for (const [source, entry] of Object.entries(changes)) next[source] = cloneSource(entry)

  operations.forEach((operation, index) => {
    // Annotated, not inferred: TypeScript only narrows after a `never` call when
    // the target's type is written out.
    const fail: (message: string) => never = (message) => {
      throw new RecordOperationError(message, index, operation)
    }
    if (!operation || typeof operation !== 'object') fail('Not an operation')
    if (typeof operation.source !== 'string' || !operation.source) fail('An operation needs a source')
    const entry = (next[operation.source] ??= {})

    switch (operation.op) {
      case 'set-record': {
        const id = requireId(operation.id, fail)
        const data = requireData(operation.data, fail)
        const created = entry.create?.find((record) => record.id === id)
        if (created) {
          Object.assign(created, data)
          break
        }
        entry.update ??= {}
        entry.update[id] = { ...entry.update[id], ...data }
        break
      }
      case 'create-record': {
        const data = requireData(operation.data, fail)
        const id = operation.id === undefined ? newRecordId() : requireId(operation.id, fail)
        entry.create ??= []
        if (entry.create.some((record) => record.id === id)) fail(`Record ${id} is already being created`)
        entry.create.push({ ...data, id })
        break
      }
      case 'delete-record': {
        const id = requireId(operation.id, fail)
        const wasCreated = entry.create?.some((record) => record.id === id)
        if (entry.create) entry.create = entry.create.filter((record) => record.id !== id)
        if (entry.update) delete entry.update[id]
        if (entry.order) entry.order = entry.order.filter((other) => other !== id)
        if (!wasCreated) {
          entry.delete ??= []
          if (!entry.delete.includes(id)) entry.delete.push(id)
        }
        break
      }
      case 'reorder-records': {
        const order = operation.order
        if (!Array.isArray(order) || order.some((id) => typeof id !== 'string' || !id)) {
          fail('order must be a list of record ids')
        }
        entry.order = [...order]
        break
      }
      default:
        fail(`Unknown operation ${String((operation as { op?: unknown }).op)}`)
    }
  })

  for (const [source, entry] of Object.entries(next)) {
    if (entry.create?.length === 0) delete entry.create
    if (entry.update && Object.keys(entry.update).length === 0) delete entry.update
    if (entry.delete?.length === 0) delete entry.delete
    if (entry.order?.length === 0) delete entry.order
    if (Object.keys(entry).length === 0) delete next[source]
  }
  return next
}

function cloneSource(entry: SourceChanges): SourceChanges {
  const copy: SourceChanges = {}
  if (entry.create) copy.create = entry.create.map((record): VeditRecord => ({ ...record }))
  if (entry.update) {
    copy.update = {}
    for (const [id, patch] of Object.entries(entry.update)) copy.update[id] = { ...patch }
  }
  if (entry.delete) copy.delete = [...entry.delete]
  if (entry.order) copy.order = [...entry.order]
  return copy
}

function requireId(value: unknown, fail: (message: string) => never): string {
  if (typeof value !== 'string' || !value) fail('id must be a non-empty string')
  return value
}

function requireData(value: unknown, fail: (message: string) => never): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('data must be an object')
  const data = { ...(value as Record<string, unknown>) }
  // The id is the address of the record, not part of its data.
  delete data.id
  return data
}
