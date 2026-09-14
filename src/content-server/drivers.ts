import type { SqlDriver } from './types'

/**
 * The drivers are typed against what they call rather than against the
 * libraries they wrap, so `vedit/content-server` typechecks without the type
 * packages for Node, Workers or Postgres, and a host installs only the one
 * database library it uses.
 */

/** What Node's built-in `DatabaseSync` and the popular synchronous SQLite binding have in common. */
export interface SqliteLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }
  exec(sql: string): unknown
}

/** A Cloudflare D1 binding. */
export interface D1Like {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      all(): Promise<{ results?: unknown[] }>
      run(): Promise<unknown>
    }
  }
  batch(statements: unknown[]): Promise<unknown>
}

/** A `pg` client or pool, or anything else that answers `query(text, values)`. */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

/** `sqlContentStore` over Node's built-in SQLite (22.13+): pass a `DatabaseSync`. */
export function nodeSqliteDriver(db: SqliteLike): SqlDriver {
  return sqliteDriver(db)
}

/** `sqlContentStore` over the synchronous SQLite npm binding: pass its `Database`. */
export function betterSqliteDriver(db: SqliteLike): SqlDriver {
  return sqliteDriver(db)
}

function sqliteDriver(db: SqliteLike): SqlDriver {
  return {
    async query(sql, params) {
      return db.prepare(sql).all(...params).map(asRecord)
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        for (const { sql, params } of statements) db.prepare(sql).run(...params)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      db.exec('COMMIT')
    },
  }
}

/** `sqlContentStore` over a D1 binding. `batch` is D1's own, which runs as one transaction. */
export function d1Driver(db: D1Like): SqlDriver {
  return {
    async query(sql, params) {
      const { results } = await db.prepare(sql).bind(...params).all()
      return (results ?? []).map(asRecord)
    },
    async batch(statements) {
      if (statements.length === 0) return
      await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)))
    },
  }
}

/** `sqlContentStore` over `pg`. Postgres numbers its placeholders, so `?` becomes `$1`, `$2`, … */
export function postgresDriver(client: PgLike): SqlDriver {
  return {
    async query(sql, params) {
      const { rows } = await client.query(numberPlaceholders(sql), params)
      return rows.map(asRecord)
    },
    async batch(statements) {
      await client.query('BEGIN')
      try {
        for (const { sql, params } of statements) await client.query(numberPlaceholders(sql), params)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      await client.query('COMMIT')
    },
  }
}

/**
 * `?` → `$n`, skipping any `?` inside a quoted string or identifier. A doubled
 * quote inside a string closes and reopens it, which leaves the state where it
 * was, so it needs no special case.
 */
export function numberPlaceholders(sql: string): string {
  let out = ''
  let n = 0
  let quote: string | null = null
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null
      out += char
    } else if (char === "'" || char === '"') {
      quote = char
      out += char
    } else if (char === '?') {
      n += 1
      out += `$${n}`
    } else {
      out += char
    }
  }
  return out
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
}
