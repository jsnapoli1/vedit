import type { DocumentStage } from '../core/types'
import type { CollectionSpec, FieldSpec, GlobalSpec, RecordVersion, SourceChanges, VeditRecord } from '../content/types'
import { normalizeFields } from '../content/schema'
import { isTempId } from '../content/ids'
import { matchWhere, sortRows } from '../content/query'
import type { ContentSpec, Row, RowOperation, RowStore, VeditContentStore, VersionRow } from './types'

/** The layout of the tables `sqlContentStore` creates. Read from `vedit_meta` on init. */
export const STORE_SCHEMA_VERSION = 1

const DEFAULT_VERSIONS = 20
const GLOBAL_ID = 'global'
const SERVER_ID_LENGTH = 10

type RecordStatus = 'draft' | 'changed' | 'published'

/** What the semantics layer needs to know about one source, collection or global alike. */
interface SourceInfo {
  name: string
  kind: 'collection' | 'global'
  fields: Record<string, FieldSpec>
  drafts: boolean
  versions: number
  orderField?: string
}

/** Both copies of one record, either of which may be missing. */
interface Pair {
  draft: Row | null
  published: Row | null
}

/**
 * The draft/publish/version rules, written once over a `RowStore` so the memory
 * and SQL stores only move rows. A draft row is the working copy, a published
 * row is what visitors see, and a draft row whose data is null is a tombstone:
 * "deleted, but not yet published as such". Everything a commit touches lands
 * in one `rows.batch()`, which is what keeps a save across several sources
 * atomic.
 */
export function contentStore(rows: RowStore, spec: ContentSpec): VeditContentStore {
  const sources = new Map<string, SourceInfo>()
  for (const [name, collection] of Object.entries(spec.collections)) sources.set(name, describeCollection(name, collection))
  for (const [name, global] of Object.entries(spec.globals ?? {})) sources.set(name, describeGlobal(name, global))

  const sourceInfo = (name: string): SourceInfo => {
    const info = sources.get(name)
    if (!info) throw new Error(`Unknown source "${name}"`)
    return info
  }

  // Commits in the same millisecond would share a version key, and the
  // versions list is ordered by that key. Never hand out the same stamp twice.
  let lastStamp = 0
  const stamp = () => {
    let now = Date.now()
    if (now <= lastStamp) now = lastStamp + 1
    lastStamp = now
    return new Date(now).toISOString()
  }

  const pairFor = async (source: string, id: string): Promise<Pair> => ({
    draft: await rows.selectOne(source, id, 'draft'),
    published: await rows.selectOne(source, id, 'published'),
  })

  const pairsFor = async (source: string): Promise<Map<string, Pair>> => {
    const pairs = new Map<string, Pair>()
    for (const row of await rows.select(source, 'published')) pairs.set(row.id, { draft: null, published: row })
    for (const row of await rows.select(source, 'draft')) {
      const pair = pairs.get(row.id)
      if (pair) pair.draft = row
      else pairs.set(row.id, { draft: row, published: null })
    }
    return pairs
  }

  /** The empty record a global starts from: its id and whatever the fields default to. */
  const emptyGlobal = (info: SourceInfo): VeditRecord => ({ id: GLOBAL_ID, ...fieldDefaults(info.fields) })

  /**
   * A global is read before anything ever wrote it, so the first read writes
   * the empty record. The row goes in as published: there is nothing to publish
   * and nothing to hide.
   */
  const ensureGlobal = async (info: SourceInfo, pair: Pair): Promise<Pair> => {
    if (pair.draft || pair.published) return pair
    const row: Row = {
      source: info.name,
      id: GLOBAL_ID,
      stage: 'published',
      data: JSON.stringify(emptyGlobal(info)),
      updated_at: stamp(),
    }
    await rows.batch([{ kind: 'put', row }])
    return { draft: null, published: row }
  }

  const readAll = async (info: SourceInfo, stage: DocumentStage): Promise<VeditRecord[]> => {
    if (info.kind === 'global') {
      const record = readOne(info, await ensureGlobal(info, await pairFor(info.name, GLOBAL_ID)), stage)
      return record ? [record] : []
    }
    const records: VeditRecord[] = []
    for (const pair of (await pairsFor(info.name)).values()) {
      const record = readOne(info, pair, stage)
      if (record) records.push(record)
    }
    return records
  }

  const readById = async (info: SourceInfo, id: string, stage: DocumentStage): Promise<VeditRecord | null> => {
    let pair = await pairFor(info.name, id)
    if (info.kind === 'global' && id === GLOBAL_ID) pair = await ensureGlobal(info, pair)
    return readOne(info, pair, stage)
  }

  /**
   * Resolve relation fields into the records they point at, read from the same
   * stage, so a draft list shows draft categories. One read per referenced
   * source, however many rows point into it.
   */
  const populate = async (info: SourceInfo, records: VeditRecord[], fields: string[], stage: DocumentStage) => {
    for (const field of fields) {
      const relation = info.fields[field]
      if (!relation || relation.type !== 'relation' || !relation.to) continue
      const target = sources.get(relation.to)
      if (!target) continue
      const referenced = new Map((await readAll(target, stage)).map((record) => [record.id, record]))
      for (const record of records) {
        const value = record[field]
        if (Array.isArray(value)) {
          record[field] = value.flatMap((id) => (typeof id === 'string' && referenced.has(id) ? [referenced.get(id)] : []))
        } else if (typeof value === 'string') {
          record[field] = referenced.get(value) ?? null
        }
      }
    }
  }

  const list: VeditContentStore['list'] = async (source, query = {}, stage) => {
    const info = sourceInfo(source)
    const at = stage ?? query.stage ?? 'published'
    const { id: wantedId, ...where } = query.where ?? {}

    let records: VeditRecord[]
    if (wantedId !== undefined) {
      // The one filter the row store can answer directly.
      const ids = (Array.isArray(wantedId) ? wantedId : [wantedId]).filter((id): id is string => typeof id === 'string')
      records = []
      for (const id of ids) {
        const record = await readById(info, id, at)
        if (record) records.push(record)
      }
    } else {
      records = await readAll(info, at)
    }

    records = sortRows(
      records.filter((record) => matchWhere(record, where)),
      query.orderBy,
    )
    if (query.limit !== undefined && query.limit >= 0) records = records.slice(0, query.limit)
    if (query.populate?.length) await populate(info, records, query.populate, at)
    return records
  }

  const get: VeditContentStore['get'] = async (source, id, stage = 'published') => readById(sourceInfo(source), id, stage)

  const commit: VeditContentStore['commit'] = async (changes, { stage }) => {
    // Every source is checked before any row is written, so a typo in the
    // second source does not half-apply the first.
    const entries = Object.entries(changes).map(([source, entry]): [SourceInfo, SourceChanges] => [sourceInfo(source), entry])
    const updatedAt = stamp()
    const idMap: Record<string, string> = {}
    const ops: RowOperation[] = []

    for (const [info, entry] of entries) {
      const writeStage: DocumentStage = info.drafts ? stage : 'published'
      const rename = (id: string) => idMap[id] ?? id

      // A record's final shape for this commit, keyed by its real id. A create
      // and an update (or an order slot) on the same record fold into one row.
      const pending = new Map<string, VeditRecord>()

      for (const record of entry.create ?? []) {
        const id = !record.id || isTempId(record.id) ? serverId() : record.id
        if (record.id && id !== record.id) idMap[record.id] = id
        pending.set(id, { ...fieldDefaults(info.fields), ...record, id })
      }

      for (const [key, patch] of Object.entries(entry.update ?? {})) {
        const id = rename(key)
        const current = pending.get(id) ?? (await currentRecord(info, id, writeStage))
        pending.set(id, { ...current, ...patch, id })
      }

      if (entry.order && info.orderField) {
        const field = info.orderField
        for (const [index, key] of entry.order.entries()) {
          const id = rename(key)
          const current = pending.get(id) ?? (await currentRecord(info, id, writeStage))
          pending.set(id, { ...current, [field]: index, id })
        }
      }

      const deleted = new Set((entry.delete ?? []).map(rename))
      for (const id of deleted) pending.delete(id)

      for (const [id, record] of pending) {
        const data = JSON.stringify(stored(record))
        ops.push(...putOps(info.name, id, writeStage, data, updatedAt))
        ops.push({ kind: 'version', source: info.name, id, stage: writeStage, data, saved_at: updatedAt })
        ops.push({ kind: 'trimVersions', source: info.name, id, keep: info.versions })
      }

      for (const id of deleted) {
        if (writeStage === 'draft') {
          ops.push({ kind: 'put', row: { source: info.name, id, stage: 'draft', data: null, updated_at: updatedAt } })
        } else {
          ops.push({ kind: 'delete', source: info.name, id, stage: 'draft' })
          ops.push({ kind: 'delete', source: info.name, id, stage: 'published' })
        }
      }
    }

    await rows.batch(ops)
    return { idMap, updatedAt }
  }

  /** The record an update patches over: the copy in the stage being written, else the live one, else nothing. */
  const currentRecord = async (info: SourceInfo, id: string, stage: DocumentStage): Promise<VeditRecord> => {
    const pair = await pairFor(info.name, id)
    // A tombstone is not a copy to patch over; an edit after a draft delete
    // picks the live record back up.
    const row = stage === 'draft' && pair.draft?.data ? pair.draft : pair.published
    if (row?.data) return parse(row)
    return info.kind === 'global' ? emptyGlobal(info) : { id }
  }

  const publish: VeditContentStore['publish'] = async (records) => {
    const ops: RowOperation[] = []
    for (const [source, ids] of Object.entries(records)) {
      const info = sourceInfo(source)
      for (const id of ids) {
        const draft = await rows.selectOne(info.name, id, 'draft')
        if (!draft) continue
        if (draft.data === null) {
          ops.push({ kind: 'delete', source: info.name, id, stage: 'published' })
        } else {
          ops.push({ kind: 'put', row: { ...draft, stage: 'published' } })
        }
        // Once the draft is live there is nothing pending, so the row goes away
        // and the record reads as published again.
        ops.push({ kind: 'delete', source: info.name, id, stage: 'draft' })
      }
    }
    if (ops.length > 0) await rows.batch(ops)
  }

  const versions: VeditContentStore['versions'] = async (source, id) => {
    sourceInfo(source)
    return (await rows.versions(source, id))
      .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
      .map((row): RecordVersion => ({ id: versionId(row.saved_at), savedAt: row.saved_at, stage: row.stage }))
  }

  const restoreVersion: VeditContentStore['restoreVersion'] = async (source, id, versionId) => {
    const info = sourceInfo(source)
    const version = (await rows.versions(source, id)).find((row) => matchesVersion(row, versionId))
    if (!version) throw new Error(`No such version "${versionId}"`)
    // Back into the draft, where it can be looked at before it goes live; a
    // source without drafts has nowhere else to put it.
    const writeStage: DocumentStage = info.drafts ? 'draft' : 'published'
    const savedAt = stamp()
    const data = JSON.stringify({ ...JSON.parse(version.data), id })
    await rows.batch([
      ...putOps(source, id, writeStage, data, savedAt),
      { kind: 'version', source, id, stage: writeStage, data, saved_at: savedAt },
      { kind: 'trimVersions', source, id, keep: info.versions },
    ])
  }

  return {
    async init() {
      await rows.init()
      const { version } = await rows.meta()
      if (version !== STORE_SCHEMA_VERSION) {
        throw new Error(
          `This content store has schema version ${version}; this build of vedit reads version ${STORE_SCHEMA_VERSION}`,
        )
      }
    },
    sources: () => spec,
    list,
    get,
    commit,
    publish,
    versions,
    restoreVersion,
  }
}

/* ------------------------------------------------------------------ helpers */

function describeCollection(name: string, spec: CollectionSpec): SourceInfo {
  const info: SourceInfo = {
    name,
    kind: 'collection',
    fields: normalizeFields(spec.fields),
    drafts: spec.drafts ?? true,
    versions: spec.versions ?? DEFAULT_VERSIONS,
  }
  if (spec.orderField) info.orderField = spec.orderField
  return info
}

function describeGlobal(name: string, spec: GlobalSpec): SourceInfo {
  return { name, kind: 'global', fields: normalizeFields(spec.fields), drafts: true, versions: DEFAULT_VERSIONS }
}

function fieldDefaults(fields: Record<string, FieldSpec>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(fields)) {
    if (field.default !== undefined) defaults[name] = field.default
  }
  return defaults
}

/**
 * The rows a write produces. A published write lands in both stages so a draft
 * read sees it too and nothing older lingers as a pending change.
 */
function putOps(source: string, id: string, stage: DocumentStage, data: string, updatedAt: string): RowOperation[] {
  const row = (at: DocumentStage): RowOperation => ({ kind: 'put', row: { source, id, stage: at, data, updated_at: updatedAt } })
  return stage === 'draft' ? [row('draft')] : [row('draft'), row('published')]
}

/**
 * A record as it goes into a row. `_updatedAt` and `_status` are added on
 * read, and an editor that sends a record straight back would otherwise
 * freeze them into the data.
 */
function stored(record: VeditRecord): VeditRecord {
  const clean: VeditRecord = { id: record.id }
  for (const [key, value] of Object.entries(record)) {
    if (key !== '_updatedAt' && key !== '_status') clean[key] = value
  }
  return clean
}

function parse(row: Row): VeditRecord {
  const data = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {}
  return { ...data, id: row.id }
}

/**
 * The record one stage shows for a pair of rows, or null when that stage has
 * nothing to show: no live copy yet, or a tombstone waiting to be published.
 */
function readOne(info: SourceInfo, pair: Pair, stage: DocumentStage): VeditRecord | null {
  const row = stage === 'draft' ? (pair.draft ?? pair.published) : pair.published
  if (!row || row.data === null) return null
  return { ...parse(row), _updatedAt: row.updated_at, _status: statusOf(pair) }
}

function statusOf(pair: Pair): RecordStatus {
  if (!pair.draft) return 'published'
  if (!pair.published) return 'draft'
  return pair.draft.data === pair.published.data ? 'published' : 'changed'
}

/** Ten base36 characters. Without a dash it can never look like a temp id. */
function serverId(): string {
  let id = ''
  while (id.length < SERVER_ID_LENGTH) id += Math.random().toString(36).slice(2)
  return id.slice(0, SERVER_ID_LENGTH)
}

/** `2026-08-23T12:00:00.000Z` as an id that survives a URL segment untouched. */
function versionId(savedAt: string): string {
  return savedAt.replace(/[:.]/g, '-')
}

function matchesVersion(row: VersionRow, id: string): boolean {
  return row.saved_at === id || versionId(row.saved_at) === id
}
