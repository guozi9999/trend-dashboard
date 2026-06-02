import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { MarketTemperatureBoard, MarketTemperatureRow } from '~~/shared/types/stock'

let database: Database.Database | null = null
let supabase: SupabaseClient | null = null

function defaultDatabasePath() {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  return join(root, 'data', 'trend-dashboard.sqlite')
}

function getSupabase() {
  const config = useRuntimeConfig()
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return null
  }

  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  }

  return supabase
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

export async function loadStockSnapshot(query: string) {
  const normalizedQuery = query.trim()
  const client = getSupabase()

  if (client) {
    const { data, error } = await client
      .from('stock_snapshots')
      .select('fetched_at,payload')
      .or(`query.eq.${escapeFilterValue(normalizedQuery)},code.eq.${escapeFilterValue(normalizedQuery)},name.eq.${escapeFilterValue(normalizedQuery)},secucode.eq.${escapeFilterValue(normalizedQuery)},secucode.eq.${escapeFilterValue(normalizedQuery.toUpperCase())}`)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return {
      fetchedAt: data.fetched_at as string,
      payload: data.payload as unknown
    }
  }

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

export async function saveStockSnapshot(payload: {
  code: string
  name: string
  secucode: string
  query: string
  fetchedAt: string
  json: unknown
}) {
  const client = getSupabase()

  if (client) {
    const { error } = await client
      .from('stock_snapshots')
      .upsert({
        code: payload.code,
        name: payload.name,
        secucode: payload.secucode,
        query: payload.query,
        fetched_at: payload.fetchedAt,
        payload: payload.json
      }, { onConflict: 'code' })

    if (error) {
      console.warn(`Supabase 写入股票快照失败：${error.message}`)
    }

    return
  }

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

export async function saveTreasuryYields(rows: Array<{
  date: string
  cn2y: number | null
  cn5y: number | null
  cn10y: number | null
  cn30y: number | null
  us10y: number | null
}>, fetchedAt: string) {
  const client = getSupabase()

  if (client) {
    const { error } = await client
      .from('treasury_yields')
      .upsert(rows.map((row) => ({
        date: row.date,
        cn_2y: row.cn2y,
        cn_5y: row.cn5y,
        cn_10y: row.cn10y,
        cn_30y: row.cn30y,
        us_10y: row.us10y,
        fetched_at: fetchedAt
      })), { onConflict: 'date' })

    if (error) {
      console.warn(`Supabase 写入国债数据失败：${error.message}`)
    }

    return
  }

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

export async function loadMarketTemperatureBoards(): Promise<Record<string, MarketTemperatureBoard>> {
  const client = getSupabase()

  if (client) {
    const { data: latestRows, error: latestError } = await client
      .from('market_temperature_rows')
      .select('category,trade_date')
      .order('trade_date', { ascending: false })

    if (latestError || !latestRows?.length) {
      return {}
    }

    const latestByCategory = new Map<string, string>()
    for (const row of latestRows as Array<{ category: string, trade_date: string }>) {
      if (!latestByCategory.has(row.category)) {
        latestByCategory.set(row.category, row.trade_date)
      }
    }

    const boards: Record<string, MarketTemperatureBoard> = {}
    for (const [category, tradeDate] of latestByCategory.entries()) {
      const { data: rows, error } = await client
        .from('market_temperature_rows')
        .select('rank,code,name,quote_id,change_percent,close,ma20,deviation_percent,volume_ratio,state_change_date,interval_change_percent,rank_change')
        .eq('category', category)
        .eq('trade_date', tradeDate)
        .order('rank', { ascending: true })

      if (error) {
        continue
      }

      boards[category] = {
        category: category as MarketTemperatureBoard['category'],
        title: '',
        tradeDate,
        rows: (rows ?? []).map(mapMarketTemperatureRow)
      }
    }

    return boards
  }

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

export async function loadPreviousMarketTemperatureRanks(category: string, beforeTradeDate: string) {
  const client = getSupabase()

  if (client) {
    const { data: previous, error: previousError } = await client
      .from('market_temperature_rows')
      .select('trade_date')
      .eq('category', category)
      .lt('trade_date', beforeTradeDate)
      .order('trade_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (previousError || !previous?.trade_date) {
      return new Map<string, number>()
    }

    const { data: rows, error } = await client
      .from('market_temperature_rows')
      .select('code,rank')
      .eq('category', category)
      .eq('trade_date', previous.trade_date)

    if (error) {
      return new Map<string, number>()
    }

    return new Map((rows ?? []).map((row) => [String(row.code), Number(row.rank)]))
  }

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

export async function saveMarketTemperatureBoard(
  board: MarketTemperatureBoard,
  fetchedAt: string
) {
  if (!board.tradeDate) {
    return
  }

  const client = getSupabase()
  if (client) {
    const { error } = await client
      .from('market_temperature_rows')
      .upsert(board.rows.map((row) => ({
        category: board.category,
        trade_date: board.tradeDate,
        code: row.code,
        name: row.name,
        quote_id: row.quoteId,
        rank: row.rank,
        change_percent: row.changePercent,
        close: row.close,
        ma20: row.ma20,
        deviation_percent: row.deviationPercent,
        volume_ratio: row.volumeRatio,
        state_change_date: row.stateChangeDate,
        interval_change_percent: row.intervalChangePercent,
        rank_change: row.rankChange,
        fetched_at: fetchedAt
      })), { onConflict: 'category,trade_date,code' })

    if (error) {
      console.warn(`Supabase 写入市场温度失败：${error.message}`)
    }

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
    stateChangeDate: nullableString(row.state_change_date),
    intervalChangePercent: nullableNumber(row.interval_change_percent),
    rankChange: Number(row.rank_change ?? 0)
  }
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function escapeFilterValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll(')', '\\)')
}
