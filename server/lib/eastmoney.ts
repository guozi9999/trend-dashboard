import { buildAnnualDividends, buildDividendForecast, buildStockYieldBand, calculateCagr, average, calculateStrategyTargetYield, calculateYieldSpreadBp, chooseSignalDividendYield, classifyDividendSignal, countContinuousDividendYears, round, toNumber } from '~~/shared/utils/dividend'
import type { AnnualPriceRange, DividendDashboard, DividendRecord, StockQuote, TreasuryYieldPoint } from '~~/shared/types/stock'
import { loadStockSnapshot, saveStockSnapshot, saveTreasuryYields } from './db'
import { buildRotationStrategy } from './rotation'
import { buildMarketTemperature } from './marketTemperature'
import { fetchJsonWithRetry } from './http'

const EASTMONEY_SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8'
const EASTMONEY_TREASURY_TOKEN = '894050c76af8597a853f5b408b759f5d'

interface EastmoneyResponse<T> {
  result?: {
    data?: T[]
    count?: number
  } | null
  success?: boolean
  message?: string
}

interface SearchResponse {
  QuotationCodeTable?: {
    Data?: Array<{
      Code: string
      Name: string
      QuoteID: string
      Classify: string
      SecurityTypeName: string
    }>
  }
}

export async function buildDividendDashboard(
  query: string,
  options: { refresh?: boolean } = {}
): Promise<DividendDashboard> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    throw createError({ statusCode: 400, statusMessage: '请输入股票名称或代码' })
  }

  const cached = await loadStockSnapshot(normalizedQuery)
  const cachedPayload = cached && isUsableCachedDashboard(cached.payload) ? cached.payload : null

  if (!options.refresh) {
    if (cachedPayload) {
      return await buildCachedDashboard(cachedPayload)
    }
  }

  try {
    const [resolvedStock, treasury] = await Promise.all([
      resolveStock(normalizedQuery),
      fetchTreasuryYields()
    ])

  const [quote, records] = await Promise.all([
    fetchQuote(resolvedStock.code),
    fetchDividends(resolvedStock.code)
  ])
  const [paymentDates, priceRanges] = await Promise.all([
    fetchDividendPaymentDates(resolvedStock.secucode).catch(() => []),
    fetchAnnualPriceRanges(resolvedStock.quoteId).catch(() => new Map<number, AnnualPriceRange>())
  ])
  const recordsWithPaymentDates = mergePaymentDates(records, paymentDates)

  const stock = {
    ...quote,
    code: resolvedStock.code,
    name: quote.name || resolvedStock.name,
    secucode: quote.secucode || resolvedStock.secucode
  }

  const annual = buildAnnualDividends(recordsWithPaymentDates, stock.closePrice, priceRanges)
  const latestAnnual = annual[0] ?? null
  const latestAnnualYield = latestAnnual?.yieldAtCurrentPrice ?? null
  const latestAnnualCashPerShare = latestAnnual?.cashPerShare ?? null
  const latestFiveAnnual = annual.slice(0, 5)
  const fiveYearAverageCashPerShare = average(latestFiveAnnual.map((item) => item.cashPerShare))
  const fiveYearAverageYield = stock.closePrice && fiveYearAverageCashPerShare
    ? round((fiveYearAverageCashPerShare / stock.closePrice) * 100, 2)
    : null
  const cagrBase = latestFiveAnnual.length >= 2
    ? calculateCagr(latestFiveAnnual[0]!.cashPerShare, latestFiveAnnual[latestFiveAnnual.length - 1]!.cashPerShare, latestFiveAnnual.length - 1)
    : null
  const forecast = buildDividendForecast(latestAnnualCashPerShare, stock.closePrice, cagrBase)
  const forecastFiscalYear = latestAnnual?.fiscalYear ? latestAnnual.fiscalYear + 1 : null
  const dividendDates = getDividendDateSummary(recordsWithPaymentDates)
  const cn10y = treasury.latest.cn10y
  const signalDividendYield = chooseSignalDividendYield(latestAnnualYield, forecast.forecastDividendYield)
  const spreadToCn10yBp = calculateYieldSpreadBp(latestAnnualYield, cn10y)
  const signalSpreadToCn10yBp = calculateYieldSpreadBp(signalDividendYield, cn10y)
  const yieldBand = buildStockYieldBand(annual, latestAnnualYield)
  const riskPremiumTargetYield = calculateStrategyTargetYield(cn10y, 0, 100)
  const accumulateTargetYield = calculateStrategyTargetYield(cn10y, 4, 200)
  const deepValueTargetYield = calculateStrategyTargetYield(cn10y, 4.5, 250)
  const priceForFourPercentYield = latestAnnualCashPerShare ? round(latestAnnualCashPerShare / 0.04, 2) : null
  const priceForFourPointFivePercentYield = latestAnnualCashPerShare ? round(latestAnnualCashPerShare / 0.045, 2) : null
  const priceForAccumulateTargetYield = latestAnnualCashPerShare && accumulateTargetYield
    ? round(latestAnnualCashPerShare / (accumulateTargetYield / 100), 2)
    : null
  const priceForDeepValueTargetYield = latestAnnualCashPerShare && deepValueTargetYield
    ? round(latestAnnualCashPerShare / (deepValueTargetYield / 100), 2)
    : null
    const [rotationResult, marketTemperatureResult] = await Promise.allSettled([
      buildRotationStrategy(),
      buildMarketTemperature({ refresh: options.refresh })
    ])
    const rotation = rotationResult.status === 'fulfilled'
      ? rotationResult.value
      : cachedPayload?.rotation ?? buildUnavailableRotation()
    const marketTemperature = marketTemperatureResult.status === 'fulfilled'
      ? marketTemperatureResult.value
      : cachedPayload?.marketTemperature ?? buildUnavailableMarketTemperature()

  const dashboard: DividendDashboard = {
    stock,
    treasury: {
      ...treasury,
      source: '东方财富数据中心 / 中美国债收益率'
    },
    dividend: {
      annual,
      records: recordsWithPaymentDates,
      latestFiscalYear: latestAnnual?.fiscalYear ?? null,
      latestAnnualCashPerShare,
      latestAnnualYield,
      forecastFiscalYear,
      ...forecast,
      signalDividendYield,
      fiveYearAverageCashPerShare,
      fiveYearAverageYield,
      fiveYearCashCagr: cagrBase,
      continuousDividendYears: countContinuousDividendYears(annual),
      nextDividendDate: dividendDates.nextDividendDate,
      lastDividendDate: dividendDates.lastDividendDate,
      spreadToCn10yBp,
      signalSpreadToCn10yBp,
      riskPremiumTargetYield,
      accumulateTargetYield,
      deepValueTargetYield,
      priceForFourPercentYield,
      priceForFourPointFivePercentYield,
      priceForAccumulateTargetYield,
      priceForDeepValueTargetYield,
      yieldBand,
      calculation: {
        dividendYield: '股息率 = 年度每股现金分红 / 当前股价 x 100%。',
        forecastDividendYield: '预测股息率 = 预测年度每股现金分红 / 当前股价 x 100%。',
        spreadToCn10y: '股债息差 = 股息率百分数 - 中国10年期国债收益率百分数，再 x 100 转成 BP；策略信号使用最新年度股息率与预测股息率中更保守的一个。',
        annualYieldRange: '年度最高股息率 = 年度每股分红 / 年内最低股价；年度最低股息率 = 年度每股分红 / 年内最高股价。',
        signalRule: '深度区间需同时满足股息率4.5%+和息差250BP+；攒股观察需同时满足股息率4%+和息差200BP+；高于10年国债100BP+为基础风险补偿。'
      },
      signal: classifyDividendSignal(signalDividendYield, cn10y, signalSpreadToCn10yBp, yieldBand)
    },
    rotation,
    marketTemperature,
    cache: {
      fetchedAt: new Date().toISOString(),
      fromCache: false
    },
    sources: [
      {
        label: '东方财富分红送配',
        url: 'https://data.eastmoney.com/yjfp/'
      },
      {
        label: '东方财富中美国债收益率',
        url: 'https://data.eastmoney.com/cjsj/zmgzsyl.html'
      }
    ]
  }

  await saveStockSnapshot({
    code: dashboard.stock.code,
    name: dashboard.stock.name,
    secucode: dashboard.stock.secucode,
    query: normalizedQuery,
    fetchedAt: dashboard.cache.fetchedAt,
    json: dashboard
  })

  await saveTreasuryYields(treasury.history, dashboard.cache.fetchedAt)

    return dashboard
  } catch (error) {
    if (cachedPayload) {
      return await buildCachedDashboard(cachedPayload)
    }

    throw error
  }
}

async function buildCachedDashboard(payload: DividendDashboard): Promise<DividendDashboard> {
  const [rotationResult, marketTemperatureResult] = await Promise.allSettled([
    buildRotationStrategy(),
    buildMarketTemperature()
  ])
  const rotation = rotationResult.status === 'fulfilled'
    ? rotationResult.value
    : payload.rotation ?? buildUnavailableRotation()
  const marketTemperature = marketTemperatureResult.status === 'fulfilled'
    ? marketTemperatureResult.value
    : payload.marketTemperature ?? buildUnavailableMarketTemperature()

  return {
    ...payload,
    rotation,
    marketTemperature,
    cache: {
      ...payload.cache,
      fromCache: true
    }
  }
}

function buildUnavailableRotation(): DividendDashboard['rotation'] {
  return {
    lookbackDays: 20,
    winner: null,
    action: 'insufficient',
    actionLabel: '数据不足',
    summary: '轮动策略数据源暂时不可用，本次个股查询不受影响。',
    assets: [],
    calculation: 'ROC(20) = (最新收盘价 - 20 个交易日前收盘价) / 20 个交易日前收盘价 x 100；数据源恢复后自动显示轮动排序。',
    fetchedAt: new Date().toISOString()
  }
}

function buildUnavailableMarketTemperature(): DividendDashboard['marketTemperature'] {
  const fetchedAt = new Date().toISOString()
  return {
    fetchedAt,
    source: '东方财富日线行情，本地 SQLite 快照表',
    summary: '市场温度数据暂时不可用，本次个股查询不受影响。',
    calculation: '20日均线为最近20个交易日收盘价均值；数据源恢复或本地快照可用后自动显示。',
    trend: {
      category: 'trend',
      title: '趋势模型',
      tradeDate: null,
      rows: []
    },
    sector: {
      category: 'sector',
      title: '板块轮动',
      tradeDate: null,
      rows: []
    }
  }
}

function isUsableCachedDashboard(value: unknown): value is DividendDashboard {
  const maybe = value as Partial<DividendDashboard> | null

  return Boolean(
    maybe?.stock?.code &&
    maybe?.dividend?.calculation &&
    maybe.dividend.yieldBand &&
    'forecastFiscalYear' in maybe.dividend &&
    'signalDividendYield' in maybe.dividend &&
    'signalSpreadToCn10yBp' in maybe.dividend &&
    'accumulateTargetYield' in maybe.dividend &&
    'priceForAccumulateTargetYield' in maybe.dividend &&
    maybe.rotation &&
    maybe.marketTemperature &&
    Array.isArray(maybe.dividend.annual) &&
    maybe.dividend.annual.length > 0 &&
    Array.isArray(maybe.dividend.records) &&
    maybe.dividend.records.length > 0 &&
    maybe.dividend.annual.every((item) => 'highestDividendYield' in item && 'lowestDividendYield' in item)
  )
}

async function resolveStock(query: string) {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get')
  url.searchParams.set('input', query)
  url.searchParams.set('type', '14')
  url.searchParams.set('token', EASTMONEY_SEARCH_TOKEN)

  const response = await fetchJson<SearchResponse>(url, 'https://www.eastmoney.com/')
  const candidates = response.QuotationCodeTable?.Data ?? []
  const stock = candidates.find((item) => item.Classify === 'AStock') ?? candidates[0]

  if (!stock) {
    throw createError({ statusCode: 404, statusMessage: `没有找到股票：${query}` })
  }

  return {
    code: stock.Code,
    name: stock.Name,
    quoteId: stock.QuoteID,
    secucode: stock.QuoteID.startsWith('1.') ? `${stock.Code}.SH` : `${stock.Code}.SZ`
  }
}

async function fetchQuote(code: string): Promise<StockQuote> {
  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get')
  url.searchParams.set('reportName', 'RPT_VALUEANALYSIS_DET')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('filter', `(SECURITY_CODE="${code}")`)
  url.searchParams.set('pageNumber', '1')
  url.searchParams.set('pageSize', '1')
  url.searchParams.set('sortColumns', 'TRADE_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')

  const response = await fetchJson<EastmoneyResponse<Record<string, unknown>>>(url, 'https://data.eastmoney.com/')
  const row = response.result?.data?.[0]

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: `没有找到 ${code} 的行情估值数据` })
  }

  return {
    code: String(row.SECURITY_CODE ?? code),
    name: String(row.SECURITY_NAME_ABBR ?? ''),
    secucode: String(row.SECUCODE ?? ''),
    boardName: nullableString(row.BOARD_NAME),
    closePrice: toNumber(row.CLOSE_PRICE),
    tradeDate: nullableString(row.TRADE_DATE),
    peTtm: toNumber(row.PE_TTM),
    pbMrq: toNumber(row.PB_MRQ),
    totalMarketCap: toNumber(row.TOTAL_MARKET_CAP)
  }
}

async function fetchDividends(code: string): Promise<DividendRecord[]> {
  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get')
  url.searchParams.set('reportName', 'RPT_SHAREBONUS_DET')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('filter', `(SECURITY_CODE="${code}")`)
  url.searchParams.set('pageNumber', '1')
  url.searchParams.set('pageSize', '200')
  url.searchParams.set('sortColumns', 'REPORT_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')

  const response = await fetchJson<EastmoneyResponse<Record<string, unknown>>>(url, 'https://data.eastmoney.com/yjfp/')
  const rows = response.result?.data ?? []

  return rows.map((row) => {
    const pretaxBonusRmbPer10 = toNumber(row.PRETAX_BONUS_RMB)
    return {
      securityCode: String(row.SECURITY_CODE ?? code),
      securityName: String(row.SECURITY_NAME_ABBR ?? ''),
      secucode: String(row.SECUCODE ?? ''),
      reportDate: nullableString(row.REPORT_DATE),
      noticeDate: nullableString(row.NOTICE_DATE),
      planNoticeDate: nullableString(row.PLAN_NOTICE_DATE),
      equityRecordDate: nullableString(row.EQUITY_RECORD_DATE),
      exDividendDate: nullableString(row.EX_DIVIDEND_DATE),
      payCashDate: null,
      assignProgress: nullableString(row.ASSIGN_PROGRESS),
      planProfile: nullableString(row.IMPL_PLAN_PROFILE),
      pretaxBonusRmbPer10,
      cashPerShare: pretaxBonusRmbPer10 !== null ? round(pretaxBonusRmbPer10 / 10, 4) : null,
      dividendYieldAtAnnouncement: toNumber(row.DIVIDENT_RATIO) !== null ? round(toNumber(row.DIVIDENT_RATIO)! * 100, 2) : null,
      eps: toNumber(row.BASIC_EPS),
      bvps: toNumber(row.BVPS),
      netProfitYoY: toNumber(row.PNP_YOY_RATIO)
    }
  })
}

async function fetchDividendPaymentDates(secucode: string): Promise<Array<{
  noticeDate: string | null
  payCashDate: string | null
  equityRecordDate: string | null
  exDividendDate: string | null
  assignProgress: string | null
}>> {
  const url = new URL('https://emweb.eastmoney.com/PC_HSF10/BonusFinancing/PageAjax')
  url.searchParams.set('code', toF10Code(secucode))

  const response = await fetchJson<{
    fhyx?: Array<Record<string, unknown>>
  }>(url, 'https://emweb.eastmoney.com/PC_HSF10/BonusFinancing/Index')

  return (response.fhyx ?? []).map((row) => ({
    noticeDate: nullableString(row.NOTICE_DATE),
    payCashDate: nullableString(row.PAY_CASH_DATE),
    equityRecordDate: nullableString(row.EQUITY_RECORD_DATE),
    exDividendDate: nullableString(row.EX_DIVIDEND_DATE),
    assignProgress: nullableString(row.ASSIGN_PROGRESS)
  }))
}

async function fetchAnnualPriceRanges(quoteId: string): Promise<Map<number, AnnualPriceRange>> {
  const eastmoneyRanges = await fetchEastmoneyAnnualPriceRanges(quoteId).catch(() => new Map<number, AnnualPriceRange>())
  if (eastmoneyRanges.size) {
    return eastmoneyRanges
  }

  return await fetchYahooAnnualPriceRanges(quoteId)
}

async function fetchEastmoneyAnnualPriceRanges(quoteId: string): Promise<Map<number, AnnualPriceRange>> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
  url.searchParams.set('klt', '101')
  url.searchParams.set('fqt', '0')
  url.searchParams.set('beg', '20000101')
  url.searchParams.set('end', formatYmd(new Date()))

  const response = await fetchJson<{
    data?: {
      klines?: string[]
    } | null
  }>(url, 'https://quote.eastmoney.com/')

  const ranges = new Map<number, AnnualPriceRange>()
  for (const line of response.data?.klines ?? []) {
    const [date, , , highRaw, lowRaw] = line.split(',')
    const fiscalYear = Number(date?.slice(0, 4))
    const highestPrice = toNumber(highRaw)
    const lowestPrice = toNumber(lowRaw)

    if (!date || !Number.isInteger(fiscalYear) || highestPrice === null || lowestPrice === null) {
      continue
    }

    const current = ranges.get(fiscalYear) ?? {
      fiscalYear,
      highestPrice: null,
      highestPriceDate: null,
      lowestPrice: null,
      lowestPriceDate: null
    }

    if (current.highestPrice === null || highestPrice > current.highestPrice) {
      current.highestPrice = highestPrice
      current.highestPriceDate = date
    }

    if (current.lowestPrice === null || lowestPrice < current.lowestPrice) {
      current.lowestPrice = lowestPrice
      current.lowestPriceDate = date
    }

    ranges.set(fiscalYear, current)
  }

  return ranges
}

async function fetchYahooAnnualPriceRanges(quoteId: string): Promise<Map<number, AnnualPriceRange>> {
  const symbol = toYahooSymbol(quoteId)
  if (!symbol) {
    return new Map<number, AnnualPriceRange>()
  }

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`)
  url.searchParams.set('period1', String(Math.floor(Date.UTC(2000, 0, 1) / 1000)))
  url.searchParams.set('period2', String(Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)))
  url.searchParams.set('interval', '1d')
  url.searchParams.set('events', 'history')

  const response = await fetchJson<{
    chart?: {
      result?: Array<{
        timestamp?: number[]
        indicators?: {
          quote?: Array<{
            high?: Array<number | null>
            low?: Array<number | null>
          }>
        }
      }>
    }
  }>(url, 'https://finance.yahoo.com/')
  const result = response.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const highs = result?.indicators?.quote?.[0]?.high ?? []
  const lows = result?.indicators?.quote?.[0]?.low ?? []
  const ranges = new Map<number, AnnualPriceRange>()

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    const date = timestamp ? formatDateInShanghai(new Date(timestamp * 1000)) : null
    const fiscalYear = date ? Number(date.slice(0, 4)) : null
    const highestPrice = toNumber(highs[index])
    const lowestPrice = toNumber(lows[index])

    if (!date || !Number.isInteger(fiscalYear) || highestPrice === null || lowestPrice === null) {
      continue
    }

    const year = fiscalYear as number
    const current = ranges.get(year) ?? {
      fiscalYear: year,
      highestPrice: null,
      highestPriceDate: null,
      lowestPrice: null,
      lowestPriceDate: null
    }

    if (current.highestPrice === null || highestPrice > current.highestPrice) {
      current.highestPrice = round(highestPrice, 2)
      current.highestPriceDate = date
    }

    if (current.lowestPrice === null || lowestPrice < current.lowestPrice) {
      current.lowestPrice = round(lowestPrice, 2)
      current.lowestPriceDate = date
    }

    ranges.set(year, current)
  }

  return ranges
}

function toYahooSymbol(quoteId: string) {
  const [market, code] = quoteId.split('.')
  if (!code) {
    return null
  }

  if (market === '1') {
    return `${code}.SS`
  }

  if (market === '0') {
    return `${code}.SZ`
  }

  return null
}

async function fetchTreasuryYields(): Promise<{ latest: TreasuryYieldPoint, history: TreasuryYieldPoint[] }> {
  const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get')
  url.searchParams.set('reportName', 'RPTA_WEB_TREASURYYIELD')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('sortColumns', 'SOLAR_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageNumber', '1')
  url.searchParams.set('pageSize', '90')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('token', EASTMONEY_TREASURY_TOKEN)

  const response = await fetchJson<EastmoneyResponse<Record<string, unknown>>>(url, 'https://data.eastmoney.com/cjsj/zmgzsyl.html')
  const history = (response.result?.data ?? []).map((row) => ({
    date: String(row.SOLAR_DATE ?? '').slice(0, 10),
    cn2y: toNumber(row.EMM00588704),
    cn5y: toNumber(row.EMM00166462),
    cn10y: toNumber(row.EMM00166466),
    cn30y: toNumber(row.EMM00166469),
    us10y: toNumber(row.EMG00001310)
  }))

  const latest = history.find((item) => item.cn10y !== null)
  if (!latest) {
    throw createError({ statusCode: 502, statusMessage: '没有获取到国债收益率数据' })
  }

  return { latest, history }
}

function mergePaymentDates(
  records: DividendRecord[],
  paymentDates: Awaited<ReturnType<typeof fetchDividendPaymentDates>>
): DividendRecord[] {
  const paymentByNoticeDate = new Map(paymentDates.map((item) => [normalizeDate(item.noticeDate), item]))

  return records.map((record) => {
    const payment = paymentByNoticeDate.get(normalizeDate(record.noticeDate))

    return {
      ...record,
      payCashDate: payment?.payCashDate ?? record.payCashDate,
      equityRecordDate: record.equityRecordDate ?? payment?.equityRecordDate ?? null,
      exDividendDate: record.exDividendDate ?? payment?.exDividendDate ?? null,
      assignProgress: record.assignProgress ?? payment?.assignProgress ?? null
    }
  })
}

function getDividendDateSummary(records: DividendRecord[]) {
  const today = new Date().toISOString().slice(0, 10)
  const dividendDates = records
    .map((record) => normalizeDate(record.payCashDate ?? record.exDividendDate))
    .filter(Boolean)
    .sort()

  const nextDividendDate = dividendDates.find((date) => date >= today) ?? null
  const lastDividendDate = dividendDates.filter((date) => date < today).at(-1) ?? null

  return { nextDividendDate, lastDividendDate }
}

function toF10Code(secucode: string) {
  const [code, market] = secucode.split('.')
  return `${market?.toUpperCase() ?? 'SH'}${code}`
}

function normalizeDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function formatDateInShanghai(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10)
}

async function fetchJson<T>(url: URL, referer: string): Promise<T> {
  return await fetchJsonWithRetry<T>(url, referer, '数据源')
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return String(value)
}
