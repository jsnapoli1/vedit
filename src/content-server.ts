/**
 * `vedit/content-server` — records on the server: the store, the SQL drivers
 * and the Fetch handler that serves them. Deliberately without `'use client'`.
 */

export { STORE_SCHEMA_VERSION, contentStore } from './content-server/store'
export { memoryContentStore, memoryRowStore } from './content-server/memory'
export { sqlContentStore, sqlRowStore } from './content-server/sql'
export { betterSqliteDriver, d1Driver, nodeSqliteDriver, numberPlaceholders, postgresDriver } from './content-server/drivers'
export { contentClientFromStore } from './content-server/client'
export { createContentHandler, createUnsafeLocalContentHandler } from './content-server/handler'

export type { ContentHandlerHooks, ContentHandlerOptions, ContentRequestContext } from './content-server/handler'
export type { MemoryContentStoreOptions } from './content-server/memory'
export type { SqlContentStoreOptions, SqlDialect, SqlRowStoreOptions } from './content-server/sql'
export type { D1Like, PgLike, SqliteLike } from './content-server/drivers'
export type { ContentClientFromStoreOptions } from './content-server/client'
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
  VeditCapabilities,
  VeditContentClient,
  VeditRecord,
  VeditUser,
} from './content/types'
export type { DocumentStage } from './core/types'
