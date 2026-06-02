import type { MarketTemperature, MarketTemperatureBoard, MarketTemperatureRow } from '~~/shared/types/stock'
import { average, round, toNumber } from '~~/shared/utils/dividend'
import { loadMarketTemperatureBoards, loadPreviousMarketTemperatureRanks, saveMarketTemperatureBoard } from './db'
import { fetchJsonWithRetry } from './http'

const LOOKBACK_DAYS = 20

interface TemperatureAssetConfig {
  code: string
  name: string
  quoteId: string
}

interface KlinePoint {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

const TREND_ASSETS: TemperatureAssetConfig[] = [
  { code: 'KS11', name: '韩国综合', quoteId: '100.KS11' },
  { code: 'TWII', name: '台湾加权', quoteId: '100.TWII' },
  { code: 'N225', name: '日经225', quoteId: '100.N225' },
  { code: 'QQQ', name: '纳指100', quoteId: '105.QQQ' },
  { code: 'SPY', name: '标普500', quoteId: '107.SPY' },
  { code: '399006', name: '创业板指', quoteId: '0.399006' },
  { code: 'HS2083', name: '恒生科技', quoteId: '124.HSTECH' },
  { code: '399300', name: '沪深300', quoteId: '1.000300' },
  { code: 'HSI', name: '恒生指数', quoteId: '100.HSI' },
  { code: '000510', name: '中证A500', quoteId: '1.000510' },
  { code: 'HSCEI', name: '国企指数', quoteId: '100.HSCEI' },
  { code: 'GLD', name: '黄金ETF', quoteId: '107.GLD' },
  { code: '1B0016', name: '上证50', quoteId: '1.000016' },
  { code: '399905', name: '中证500', quoteId: '1.000905' },
  { code: '1B0852', name: '中证1000', quoteId: '1.000852' },
  { code: '883418', name: '微盘股', quoteId: '90.BK1158' },
  { code: 'SLV', name: '白银ETF', quoteId: '107.SLV' },
  { code: '932000', name: '中证2000', quoteId: '2.932000' },
  { code: '1B0688', name: '科创50', quoteId: '1.000688' },
  { code: '899050', name: '北证50', quoteId: '0.899050' }
]

const SECTOR_ASSETS: TemperatureAssetConfig[] = [
  { code: '399998', name: '中证煤炭', quoteId: '0.399998' },
  { code: '000922', name: '中证红利', quoteId: '1.000922' },
  { code: '1B0932', name: '中证消费', quoteId: '1.000932' },
  { code: '399975', name: '证券公司', quoteId: '0.399975' },
  { code: '881278', name: '电网设备', quoteId: '90.BK0457' },
  { code: '000941', name: '新能源', quoteId: '1.000941' },
  { code: 'H30590', name: '机器人', quoteId: '2.H30590' },
  { code: '881121', name: '半导体', quoteId: '90.BK1036' },
  { code: '931775', name: '房地产', quoteId: '2.931775' },
  { code: '399989', name: '中证医疗', quoteId: '0.399989' },
  { code: '886078', name: '商业航天', quoteId: '90.BK0963' },
  { code: '1B0819', name: '有色金属', quoteId: '1.000819' },
  { code: '000813', name: '细分化工', quoteId: '1.000813' },
  { code: '881279', name: '光伏设备', quoteId: '90.BK1031' }
]

export async function buildMarketTemperature(options: { refresh?: boolean } = {}): Promise<MarketTemperature> {
  const cached = await buildFromCachedBoards()
  if (!options.refresh) {
    if (cached) {
      return cached
    }
  }

  const fetchedAt = new Date().toISOString()
  let trend: MarketTemperatureBoard
  let sector: MarketTemperatureBoard

  try {
    [trend, sector] = await Promise.all([
      buildBoard('trend', '鱼盆趋势模型', TREND_ASSETS),
      buildBoard('sector', '板块轮动', SECTOR_ASSETS)
    ])
  } catch (error) {
    if (cached) {
      return cached
    }

    throw error
  }

  if (!trend.rows.length || !sector.rows.length) {
    if (cached) {
      return cached
    }

    throw createError({ statusCode: 502, statusMessage: '市场温度刷新结果为空' })
  }

  await saveMarketTemperatureBoard(trend, fetchedAt)
  await saveMarketTemperatureBoard(sector, fetchedAt)

  return assembleMarketTemperature(trend, sector, fetchedAt)
}

async function buildFromCachedBoards(): Promise<MarketTemperature | null> {
  const boards = await loadMarketTemperatureBoards()
  const trend = withTitle(boards.trend, '鱼盆趋势模型')
  const sector = withTitle(boards.sector, '板块轮动')

  if (!trend || !sector) {
    return null
  }

  return assembleMarketTemperature(trend, sector, new Date().toISOString())
}

async function buildBoard(
  category: MarketTemperatureBoard['category'],
  title: string,
  assets: TemperatureAssetConfig[]
): Promise<MarketTemperatureBoard> {
  const rows = (await Promise.all(assets.map(buildRow)))
    .filter((row): row is MarketTemperatureRow => row !== null)
    .sort((a, b) => (b.deviationPercent ?? Number.NEGATIVE_INFINITY) - (a.deviationPercent ?? Number.NEGATIVE_INFINITY))
    .map((row, index) => ({ ...row, rank: index + 1 }))
  const tradeDate = rows.find((row) => row.stateChangeDate)?.stateChangeDate
    ? rows.map((row) => row.stateChangeDate).sort().at(-1) ?? null
    : null
  const latestTradeDate = rows
    .map((row) => row.close === null ? null : row)
    .filter(Boolean).length
    ? await inferLatestTradeDate(assets)
    : null
  const boardTradeDate = latestTradeDate ?? tradeDate
  const previousRanks = boardTradeDate ? await loadPreviousMarketTemperatureRanks(category, boardTradeDate) : new Map<string, number>()

  return {
    category,
    title,
    tradeDate: boardTradeDate,
    rows: rows.map((row) => ({
      ...row,
      rankChange: previousRanks.has(row.code) ? previousRanks.get(row.code)! - row.rank : 0
    }))
  }
}

async function buildRow(asset: TemperatureAssetConfig): Promise<MarketTemperatureRow | null> {
  const points = await fetchDailyKlines(asset.quoteId).catch(() => [])
  if (points.length < LOOKBACK_DAYS + 1) {
    return null
  }

  const latest = points.at(-1)!
  const previous = points.at(-2)!
  const latestMa20 = calculateMa(points, points.length - 1)
  const deviationPercent = latestMa20 ? round(((latest.close - latestMa20) / latestMa20) * 100, 2) : null
  const stateChange = findLatestStateChange(points)
  const intervalChangePercent = stateChange
    ? round(((latest.close - stateChange.close) / stateChange.close) * 100, 2)
    : null
  const volumeBase = average(points.slice(-21, -1).map((point) => point.volume).filter((value) => value > 0))
  const volumeRatio = volumeBase ? round(latest.volume / volumeBase, 2) : null

  return {
    rank: 0,
    code: asset.code,
    name: asset.name,
    quoteId: asset.quoteId,
    changePercent: previous.close > 0 ? round(((latest.close - previous.close) / previous.close) * 100, 2) : null,
    close: round(latest.close, latest.close < 100 ? 3 : 0),
    ma20: latestMa20 ? round(latestMa20, latestMa20 < 100 ? 3 : 0) : null,
    deviationPercent,
    volumeRatio,
    stateChangeDate: stateChange?.date ?? null,
    intervalChangePercent,
    rankChange: 0
  }
}

function findLatestStateChange(points: KlinePoint[]) {
  let previousSign: number | null = null
  let latestChange: KlinePoint | null = null

  for (let index = LOOKBACK_DAYS - 1; index < points.length; index += 1) {
    const ma20 = calculateMa(points, index)
    if (!ma20) {
      continue
    }

    const deviation = points[index]!.close - ma20
    const sign = deviation >= 0 ? 1 : -1
    if (previousSign !== null && sign !== previousSign) {
      latestChange = points[index]!
    }
    previousSign = sign
  }

  return latestChange ?? points[LOOKBACK_DAYS - 1] ?? null
}

function calculateMa(points: KlinePoint[], index: number) {
  if (index < LOOKBACK_DAYS - 1) {
    return null
  }

  return average(points.slice(index - LOOKBACK_DAYS + 1, index + 1).map((point) => point.close))
}

async function inferLatestTradeDate(assets: TemperatureAssetConfig[]) {
  for (const asset of assets) {
    const points = await fetchDailyKlines(asset.quoteId, LOOKBACK_DAYS + 1).catch(() => [])
    const latest = points.at(-1)
    if (latest?.date) {
      return latest.date
    }
  }

  return null
}

async function fetchDailyKlines(quoteId: string, count = 90): Promise<KlinePoint[]> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
  url.searchParams.set('klt', '101')
  url.searchParams.set('fqt', '1')
  url.searchParams.set('beg', '20200101')
  url.searchParams.set('end', formatYmd(new Date()))

  const response = await fetchJson<{
    data?: {
      klines?: string[]
    } | null
  }>(url, 'https://quote.eastmoney.com/')

  return (response.data?.klines ?? [])
    .slice(-count)
    .map((line) => {
      const [date, openRaw, closeRaw, highRaw, lowRaw, volumeRaw] = line.split(',')
      const open = toNumber(openRaw)
      const close = toNumber(closeRaw)
      const high = toNumber(highRaw)
      const low = toNumber(lowRaw)
      const volume = toNumber(volumeRaw)

      if (!date || open === null || close === null || high === null || low === null || volume === null) {
        return null
      }

      return { date, open, close, high, low, volume }
    })
    .filter((point): point is KlinePoint => point !== null)
}

function withTitle(board: MarketTemperatureBoard | undefined, title: string) {
  return board ? { ...board, title } : null
}

function assembleMarketTemperature(
  trend: MarketTemperatureBoard,
  sector: MarketTemperatureBoard,
  fetchedAt: string
): MarketTemperature {
  return {
    fetchedAt,
    source: '东方财富日线行情，本地 SQLite 快照表',
    summary: '市场温度按 20 日均线偏离率排序，用于观察市场历史风格趋势，不构成投资建议。',
    calculation: '20日均线为最近20个交易日收盘价均值；偏离率 = (现价 - 20日均线) / 20日均线 x 100%；量比 = 最新成交量 / 前20个交易日平均成交量；状态转变时间为价格相对20日均线最近一次多空切换日期。',
    trend,
    sector
  }
}

async function fetchJson<T>(url: URL, referer: string): Promise<T> {
  return await fetchJsonWithRetry<T>(url, referer, '市场温度数据源')
}

function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
