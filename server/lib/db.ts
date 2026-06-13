import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import type { MarketTemperatureBoard, MarketTemperatureRow } from '~~/shared/types/stock'

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

    CREATE TABLE IF NOT EXISTS market_temperature_rows (
      category TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      change_percent REAL,
      close REAL,
      ma20 REAL,
      deviation_percent REAL,
      volume_ratio REAL,
      state_change_date TEXT,
      interval_change_percent REAL,
      rank_change INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (category, trade_date, code)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_query ON stock_snapshots(query);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_name ON stock_snapshots(name);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_secucode ON stock_snapshots(secucode);
    CREATE INDEX IF NOT EXISTS idx_market_temperature_latest ON market_temperature_rows(category, trade_date DESC, rank);
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

export function loadMarketTemperatureBoards(): Record<string, MarketTemperatureBoard> {
  const latestRows = getDb()
    .prepare(`
      SELECT category, MAX(trade_date) AS tradeDate
      FROM market_temperature_rows
      GROUP BY category
    `)
    .all() as Array<{ category: string, tradeDate: string }>
  const boards: Record<string, MarketTemperatureBoard> = {}

  for (const latest of latestRows) {
    const rows = getDb()
      .prepare(`
        SELECT
          rank,
          code,
          name,
          quote_id AS quoteId,
          change_percent AS changePercent,
          close,
          ma20,
          deviation_percent AS deviationPercent,
          volume_ratio AS volumeRatio,
          state_change_date AS stateChangeDate,
          interval_change_percent AS intervalChangePercent,
          rank_change AS rankChange
        FROM market_temperature_rows
        WHERE category = @category
          AND trade_date = @tradeDate
        ORDER BY rank ASC
      `)
      .all(latest) as MarketTemperatureRow[]

    boards[latest.category] = {
      category: latest.category as MarketTemperatureBoard['category'],
      title: '',
      tradeDate: latest.tradeDate,
      rows
    }
  }

  return boards
}

export function loadPreviousMarketTemperatureRanks(category: string, beforeTradeDate: string) {
  const previous = getDb()
    .prepare(`
      SELECT MAX(trade_date) AS tradeDate
      FROM market_temperature_rows
      WHERE category = @category
        AND trade_date < @beforeTradeDate
    `)
    .get({ category, beforeTradeDate }) as { tradeDate: string | null } | undefined

  if (!previous?.tradeDate) {
    return new Map<string, number>()
  }

  const rows = getDb()
    .prepare(`
      SELECT code, rank
      FROM market_temperature_rows
      WHERE category = @category
        AND trade_date = @tradeDate
    `)
    .all({ category, tradeDate: previous.tradeDate }) as Array<{ code: string, rank: number }>

  return new Map(rows.map((row) => [row.code, row.rank]))
}

export function saveMarketTemperatureBoard(
  board: MarketTemperatureBoard,
  fetchedAt: string
) {
  if (!board.tradeDate) {
    return
  }

  const statement = getDb().prepare(`
    INSERT INTO market_temperature_rows (
      category,
      trade_date,
      code,
      name,
      quote_id,
      rank,
      change_percent,
      close,
      ma20,
      deviation_percent,
      volume_ratio,
      state_change_date,
      interval_change_percent,
      rank_change,
      fetched_at
    )
    VALUES (
      @category,
      @tradeDate,
      @code,
      @name,
      @quoteId,
      @rank,
      @changePercent,
      @close,
      @ma20,
      @deviationPercent,
      @volumeRatio,
      @stateChangeDate,
      @intervalChangePercent,
      @rankChange,
      @fetchedAt
    )
    ON CONFLICT(category, trade_date, code) DO UPDATE SET
      name = excluded.name,
      quote_id = excluded.quote_id,
      rank = excluded.rank,
      change_percent = excluded.change_percent,
      close = excluded.close,
      ma20 = excluded.ma20,
      deviation_percent = excluded.deviation_percent,
      volume_ratio = excluded.volume_ratio,
      state_change_date = excluded.state_change_date,
      interval_change_percent = excluded.interval_change_percent,
      rank_change = excluded.rank_change,
      fetched_at = excluded.fetched_at
  `)

  const insertMany = getDb().transaction((rows: MarketTemperatureRow[]) => {
    for (const row of rows) {
      statement.run({
        category: board.category,
        tradeDate: board.tradeDate,
        ...row,
        fetchedAt
      })
    }
  })

  insertMany(board.rows)
}

function mapMarketTemperatureRow(row: Record<string, unknown>): MarketTemperatureRow {
  return {
    rank: Number(row.rank),
    code: String(row.code),
    name: String(row.name),
    quoteId: String(row.quote_id),
    changePercent: nullableNumber(row.change_percent),
    close: nullableNumber(row.close),
    ma20: nullableNumber(row.ma20),
    deviationPercent: nullableNumber(row.deviation_percent),
    volumeRatio: nullableNumber(row.volume_ratio),
    stateChangeDate: row.state_change_date ? String(row.state_change_date) : null,
    intervalChangePercent: nullableNumber(row.interval_change_percent),
    rankChange: Number(row.rank_change ?? 0)
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function escapeFilterValue(value: string): string {
  return value.replace(/[,().]/g, (char) => encodeURIComponent(char))
}
