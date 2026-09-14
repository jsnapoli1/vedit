/**
 * `vedit/content-server` — records on the server: the store, the SQL drivers
 * and the Fetch handler that serves them. Deliberately without `'use client'`.
 */

/** The layout of the tables `sqlContentStore` creates. Read from `vedit_meta` on init. */
export const STORE_SCHEMA_VERSION = 1

export type {
  ContentSpec,
  Row,
  RowOperation,
  RowStore,
  SqlDriver,
  VeditContentStore,
  VersionRow,
} from './content-server/types'
export type {
  CollectionSpec,
  CommitResult,
  GlobalSpec,
  RecordChanges,
  RecordQuery,
  RecordVersion,
  SourceSchema,
  VeditRecord,
} from './content/types'
export type { DocumentStage } from './core/types'
