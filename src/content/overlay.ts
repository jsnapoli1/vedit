import type { RecordChanges, VeditRecord } from './types'

/**
 * The rows a source would have once the pending changes land: edits applied,
 * deleted rows gone, new rows on the end, and the editor's order honoured. This
 * is what a bound repeat renders while the changes are still local, so the page
 * shows the same thing before and after Save.
 */
export function overlayChanges(
  source: string,
  rows: VeditRecord[],
  changes: RecordChanges,
  schema?: { orderField?: string },
): VeditRecord[] {
  const entry = changes[source]
  if (!entry) return rows

  const deleted = new Set(entry.delete ?? [])
  let next = rows
    .filter((row) => !deleted.has(row.id))
    .map((row) => (entry.update?.[row.id] ? { ...row, ...entry.update[row.id], id: row.id } : row))
  for (const record of entry.create ?? []) next.push({ ...record })

  const order = entry.order
  if (order) {
    const position = new Map(order.map((id, index) => [id, index]))
    // Rows the order does not mention stay behind the ones it does, in the
    // order they already had.
    const rank = (row: VeditRecord, index: number) => position.get(row.id) ?? order.length + index
    next = next
      .map((row, index) => ({ row, index }))
      .sort((a, b) => rank(a.row, a.index) - rank(b.row, b.index))
      .map(({ row }) => row)
    if (schema?.orderField) {
      const field = schema.orderField
      next = next.map((row, index) => (row[field] === index ? row : { ...row, [field]: index }))
    }
  }
  return next
}
