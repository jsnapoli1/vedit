import type { DocumentStage } from '../core/types'
import type {
  CollectionSpec,
  CommitResult,
  GlobalSpec,
  RecordChanges,
  RecordQuery,
  RecordVersion,
  VeditRecord,
} from '../content/types'

/** The collections and globals a store was built for. */
export interface ContentSpec {
  collections: Record<string, CollectionSpec>
  globals: Record<string, GlobalSpec>
}

/**
 * Where the server keeps records. Implement this against your own database, or
 * use `sqlContentStore` over one of the drivers. The semantics — drafts,
 * publishing, versions — live above this in `contentStore`, so a store only has
 * to move rows.
 */
export interface VeditContentStore {
  /** Create tables or check the schema version. Called once before anything else. */
  init(): Promise<void>
  /** The spec this store answers for. Configuration, so it needs no await. */
  sources(): ContentSpec
  list(source: string, query?: RecordQuery, stage?: DocumentStage): Promise<VeditRecord[]>
  get(source: string, id: string, stage?: DocumentStage): Promise<VeditRecord | null>
  commit(changes: RecordChanges, opts: { stage: DocumentStage }): Promise<CommitResult>
  /** Copy the draft of each listed record over the live one. */
  publish(records: Record<string, string[]>): Promise<void>
  versions(source: string, id: string): Promise<RecordVersion[]>
  restoreVersion(source: string, id: string, versionId: string): Promise<void>
}

/**
 * One stored copy of a record. `data` is the record as JSON; `null` is a
 * tombstone — a draft row saying "deleted, but not yet published as such".
 */
export interface Row {
  source: string
  id: string
  stage: DocumentStage
  data: string | null
  updated_at: string
}

export interface VersionRow {
  source: string
  id: string
  stage: DocumentStage
  data: string
  saved_at: string
}

export type RowOperation =
  | { kind: 'put'; row: Row }
  | { kind: 'delete'; source: string; id: string; stage: DocumentStage }
  | { kind: 'version'; source: string; id: string; stage: DocumentStage; data: string; saved_at: string }
  | { kind: 'trimVersions'; source: string; id: string; keep: number }

/**
 * The smallest thing a database has to offer. `batch` is the one promise that
 * matters: every operation lands or none does, which is what makes a commit
 * across several sources safe.
 */
export interface RowStore {
  init(): Promise<void>
  select(source: string, stage: DocumentStage): Promise<Row[]>
  selectOne(source: string, id: string, stage: DocumentStage): Promise<Row | null>
  batch(ops: RowOperation[]): Promise<void>
  versions(source: string, id: string): Promise<VersionRow[]>
  meta(): Promise<{ version: number }>
}

/** A SQL connection the way `sqlContentStore` needs it: parameterised queries and an atomic batch. */
export interface SqlDriver {
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>
  batch(statements: Array<{ sql: string; params: unknown[] }>): Promise<void>
}
