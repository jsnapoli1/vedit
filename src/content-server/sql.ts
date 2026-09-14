import type { DocumentStage } from '../core/types'
import type { CollectionSpec, GlobalSpec } from '../content/types'
import { STORE_SCHEMA_VERSION, contentStore } from './store'
import type { Row, RowStore, SqlDriver, VeditContentStore, VersionRow } from './types'

export type SqlDialect = 'sqlite' | 'postgres'

export interface SqlRowStoreOptions {
  /**
   * Which database the driver speaks to. The statements below are portable
   * across both today; the option is here so a difference can be handled
   * without changing the call.
   */
  dialect: SqlDialect
}

export interface SqlContentStoreOptions extends SqlRowStoreOptions {
  collections: Record<string, CollectionSpec>
  globals?: Record<string, GlobalSpec>
}

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS vedit_records (
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    stage TEXT NOT NULL,
    data TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source, id, stage)
  )`,
  `CREATE TABLE IF NOT EXISTS vedit_versions (
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    stage TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (source, id, saved_at)
  )`,
  `CREATE TABLE IF NOT EXISTS vedit_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
]

const RECORD_COLUMNS = 'source, id, stage, data, updated_at'
const VERSION_COLUMNS = 'source, id, saved_at, stage, data'

/**
 * Rows in three tables, reached through whichever driver fits the database.
 * Every statement uses `?` placeholders and `INSERT … ON CONFLICT`, which
 * SQLite (3.24+), D1 and Postgres all take as written.
 */
export function sqlRowStore(driver: SqlDriver, _options: SqlRowStoreOptions): RowStore {
  return {
    async init() {
      for (const sql of CREATE_TABLES) await driver.query(sql, [])
      await driver.query('INSERT INTO vedit_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [
        'schema_version',
        String(STORE_SCHEMA_VERSION),
      ])
    },

    async select(source, stage) {
      const found = await driver.query(`SELECT ${RECORD_COLUMNS} FROM vedit_records WHERE source = ? AND stage = ?`, [
        source,
        stage,
      ])
      return found.map(toRow)
    },

    async selectOne(source, id, stage) {
      const found = await driver.query(
        `SELECT ${RECORD_COLUMNS} FROM vedit_records WHERE source = ? AND id = ? AND stage = ?`,
        [source, id, stage],
      )
      return found.length > 0 ? toRow(found[0]) : null
    },

    async batch(ops) {
      if (ops.length === 0) return
      await driver.batch(
        ops.map((op) => {
          switch (op.kind) {
            case 'put':
              return {
                sql:
                  `INSERT INTO vedit_records (${RECORD_COLUMNS}) VALUES (?, ?, ?, ?, ?) ` +
                  'ON CONFLICT (source, id, stage) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
                params: [op.row.source, op.row.id, op.row.stage, op.row.data, op.row.updated_at],
              }
            case 'delete':
              return {
                sql: 'DELETE FROM vedit_records WHERE source = ? AND id = ? AND stage = ?',
                params: [op.source, op.id, op.stage],
              }
            case 'version':
              return {
                sql:
                  `INSERT INTO vedit_versions (${VERSION_COLUMNS}) VALUES (?, ?, ?, ?, ?) ` +
                  'ON CONFLICT (source, id, saved_at) DO UPDATE SET stage = excluded.stage, data = excluded.data',
                params: [op.source, op.id, op.saved_at, op.stage, op.data],
              }
            case 'trimVersions':
              return {
                sql:
                  'DELETE FROM vedit_versions WHERE source = ? AND id = ? AND saved_at NOT IN ' +
                  '(SELECT saved_at FROM vedit_versions WHERE source = ? AND id = ? ORDER BY saved_at DESC LIMIT ?)',
                params: [op.source, op.id, op.source, op.id, op.keep],
              }
          }
        }),
      )
    },

    async versions(source, id) {
      const found = await driver.query(
        `SELECT ${VERSION_COLUMNS} FROM vedit_versions WHERE source = ? AND id = ? ORDER BY saved_at DESC`,
        [source, id],
      )
      return found.map(toVersionRow)
    },

    async meta() {
      const found = await driver.query('SELECT value FROM vedit_meta WHERE key = ?', ['schema_version'])
      const value = found.length > 0 ? Number(found[0].value) : 0
      return { version: Number.isFinite(value) ? value : 0 }
    },
  }
}

/** A `VeditContentStore` over any SQL database one of the drivers can reach. */
export function sqlContentStore(driver: SqlDriver, { dialect, collections, globals }: SqlContentStoreOptions): VeditContentStore {
  return contentStore(sqlRowStore(driver, { dialect }), { collections, globals: globals ?? {} })
}

function toRow(raw: Record<string, unknown>): Row {
  return {
    source: String(raw.source),
    id: String(raw.id),
    stage: stageOf(raw.stage),
    data: raw.data === null || raw.data === undefined ? null : String(raw.data),
    updated_at: String(raw.updated_at),
  }
}

function toVersionRow(raw: Record<string, unknown>): VersionRow {
  return {
    source: String(raw.source),
    id: String(raw.id),
    stage: stageOf(raw.stage),
    data: String(raw.data),
    saved_at: String(raw.saved_at),
  }
}

function stageOf(value: unknown): DocumentStage {
  return value === 'draft' ? 'draft' : 'published'
}
