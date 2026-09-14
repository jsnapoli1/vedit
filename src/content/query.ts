import type { RecordQuery, VeditRecord } from './types'

/** Equality per field. An array in `where` matches any of its values. */
export function matchWhere(row: VeditRecord, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [field, expected] of Object.entries(where)) {
    const value = row[field]
    if (Array.isArray(expected) ? !expected.includes(value) : value !== expected) return false
  }
  return true
}

/** A new list sorted by `'field'` ascending or `'-field'` descending. */
export function sortRows<T extends VeditRecord>(rows: T[], orderBy: string | undefined): T[] {
  if (!orderBy) return rows
  const descending = orderBy.startsWith('-')
  const field = descending ? orderBy.slice(1) : orderBy
  const direction = descending ? -1 : 1
  return [...rows].sort((a, b) => compare(a[field], b[field]) * direction)
}

function compare(a: unknown, b: unknown): number {
  // Missing values sort last whichever way the list runs, so a field that
  // only some rows have does not put the blanks first when descending.
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

/**
 * The query a list route carries: `stage`, `where[field]=value`, `orderBy`,
 * `limit` and `populate=a,b`. Anything malformed is left out rather than
 * refused — a bad limit means no limit, not an error page.
 */
export function parseRecordQuery(searchParams: URLSearchParams): RecordQuery {
  const query: RecordQuery = {}
  const stage = searchParams.get('stage')
  if (stage === 'draft' || stage === 'published') query.stage = stage

  const where: Record<string, unknown> = {}
  for (const [name, value] of searchParams) {
    const match = /^where\[([^\]]+)\]$/.exec(name)
    if (!match) continue
    const field = match[1]
    const existing = where[field]
    // Repeating a field means "any of these".
    where[field] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  if (Object.keys(where).length > 0) query.where = where

  const orderBy = searchParams.get('orderBy')
  if (orderBy) query.orderBy = orderBy

  const limit = Number(searchParams.get('limit'))
  if (searchParams.has('limit') && Number.isInteger(limit) && limit > 0) query.limit = limit

  const populate = (searchParams.get('populate') ?? '').split(',').map((field) => field.trim()).filter(Boolean)
  if (populate.length > 0) query.populate = populate

  return query
}

/**
 * Everything after the `/v1` segment, decoded, or `null` when the path has
 * none. The same rule `vedit/api` uses, so the content, media and auth handlers
 * mount under any prefix a host puts them behind.
 */
export function segmentsAfterVersion(pathname: string): string[] | null {
  const parts = pathname.split('/').filter(Boolean)
  const at = parts.lastIndexOf('v1')
  if (at === -1) return null
  return parts.slice(at + 1).map((part) => decodeURIComponent(part))
}
