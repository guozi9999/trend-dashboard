import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

let database: Database.Database | null = null

function defaultDatabasePath() {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  return join(root, 'data', 'trend-dashboard.sqlite')
}

export function getDb() {
  if (database) {
    return database
  }

  const configuredPath = useRuntimeConfig().databasePath
  const databasePath = configuredPath || defaultDatabasePath()
  mkdirSync(dirname(databasePath), { recursive: true })

  database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  migrate(database)

  return database
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_snapshots (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secucode TEXT NOT NULL,
      query TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_yields (
      date TEXT PRIMARY KEY,
      cn_2y REAL,
      cn_5y REAL,
      cn_10y REAL,
      cn_30y REAL,
      us_10y REAL,
      fetched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_query ON stock_snapshots(query);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_name ON stock_snapshots(name);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_secucode ON stock_snapshots(secucode);
  `)
}

export function loadStockSnapshot(query: string) {
  const normalizedQuery = query.trim()
  const row = getDb()
    .prepare(`
      SELECT fetched_at AS fetchedAt, payload
      FROM stock_snapshots
      WHERE query = @query
        OR code = @query
        OR name = @query
        OR secucode = @query
        OR secucode = @upperQuery
      ORDER BY fetched_at DESC
      LIMIT 1
    `)
    .get({
      query: normalizedQuery,
      upperQuery: normalizedQuery.toUpperCase()
    }) as { fetchedAt: string, payload: string } | undefined

  if (!row) {
    return null
  }

  try {
    return {
      fetchedAt: row.fetchedAt,
      payload: JSON.parse(row.payload) as unknown
    }
  } catch {
    return null
  }
}

export function saveStockSnapshot(payload: {
  code: string
  name: string
  secucode: string
  query: string
  fetchedAt: string
  json: unknown
}) {
  getDb()
    .prepare(`
      INSERT INTO stock_snapshots (code, name, secucode, query, fetched_at, payload)
      VALUES (@code, @name, @secucode, @query, @fetchedAt, @payload)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        secucode = excluded.secucode,
        query = excluded.query,
        fetched_at = excluded.fetched_at,
        payload = excluded.payload
    `)
    .run({
      ...payload,
      payload: JSON.stringify(payload.json)
    })
}

export function saveTreasuryYields(rows: Array<{
  date: string
  cn2y: number | null
  cn5y: number | null
  cn10y: number | null
  cn30y: number | null
  us10y: number | null
}>, fetchedAt: string) {
  const statement = getDb().prepare(`
    INSERT INTO treasury_yields (date, cn_2y, cn_5y, cn_10y, cn_30y, us_10y, fetched_at)
    VALUES (@date, @cn2y, @cn5y, @cn10y, @cn30y, @us10y, @fetchedAt)
    ON CONFLICT(date) DO UPDATE SET
      cn_2y = excluded.cn_2y,
      cn_5y = excluded.cn_5y,
      cn_10y = excluded.cn_10y,
      cn_30y = excluded.cn_30y,
      us_10y = excluded.us_10y,
      fetched_at = excluded.fetched_at
  `)

  const insertMany = getDb().transaction((items: typeof rows) => {
    for (const item of items) {
      statement.run({ ...item, fetchedAt })
    }
  })

  insertMany(rows)
}
