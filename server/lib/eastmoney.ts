import { buildAnnualDividends, buildDividendForecast, buildStockYieldBand, calculateCagr, average, classifyDividendSignal, countContinuousDividendYears, round, toNumber } from '~~/shared/utils/dividend'
import type { AnnualPriceRange, DividendDashboard, DividendRecord, StockQuote, TreasuryYieldPoint } from '~~/shared/types/stock'
import { loadStockSnapshot, saveStockSnapshot, saveTreasuryYields } from './db'

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

  if (!options.refresh) {
    const cached = loadStockSnapshot(normalizedQuery)
    if (cached && isUsableCachedDashboard(cached.payload)) {
      return {
        ...cached.payload,
        cache: {
          ...cached.payload.cache,
          fromCache: true
        }
      }
    }
  }

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
  const spreadToCn10yBp = latestAnnualYield !== null && cn10y !== null
    ? round((latestAnnualYield - cn10y) * 100, 0)
    : null
  const yieldBand = buildStockYieldBand(annual, latestAnnualYield)
  const riskPremiumTargetYield = cn10y !== null ? round(cn10y + 1, 2) : null
  const priceForFourPercentYield = latestAnnualCashPerShare ? round(latestAnnualCashPerShare / 0.04, 2) : null
  const priceForFourPointFivePercentYield = latestAnnualCashPerShare ? round(latestAnnualCashPerShare / 0.045, 2) : null

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
      fiveYearAverageCashPerShare,
      fiveYearAverageYield,
      fiveYearCashCagr: cagrBase,
      continuousDividendYears: countContinuousDividendYears(annual),
      nextDividendDate: dividendDates.nextDividendDate,
      lastDividendDate: dividendDates.lastDividendDate,
      spreadToCn10yBp,
      riskPremiumTargetYield,
      priceForFourPercentYield,
      priceForFourPointFivePercentYield,
      yieldBand,
      calculation: {
        dividendYield: '股息率 = 年度每股现金分红 / 当前股价 x 100%。',
        forecastDividendYield: '预测股息率 = 预测年度每股现金分红 / 当前股价 x 100%。',
        spreadToCn10y: '股债息差 = 股息率 - 中国10年期国债收益率；页面以 BP 显示，1% = 100BP。',
        annualYieldRange: '年度最高股息率 = 年度每股分红 / 年内最低股价；年度最低股息率 = 年度每股分红 / 年内最高股价。',
        signalRule: '4.5%+且息差250BP+为深度股息率区间；4%+且息差200BP+为攒股观察区间；高于10年国债100BP+为合理补偿。'
      },
      signal: classifyDividendSignal(latestAnnualYield, cn10y, spreadToCn10yBp, yieldBand)
    },
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

  saveStockSnapshot({
    code: dashboard.stock.code,
    name: dashboard.stock.name,
    secucode: dashboard.stock.secucode,
    query: normalizedQuery,
    fetchedAt: dashboard.cache.fetchedAt,
    json: dashboard
  })

  saveTreasuryYields(treasury.history, dashboard.cache.fetchedAt)

  return dashboard
}

function isUsableCachedDashboard(value: unknown): value is DividendDashboard {
  const maybe = value as Partial<DividendDashboard> | null

  return Boolean(
    maybe?.stock?.code &&
    maybe?.dividend?.calculation &&
    maybe.dividend.yieldBand &&
    'forecastFiscalYear' in maybe.dividend &&
    Array.isArray(maybe.dividend.annual) &&
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

async function fetchJson<T>(url: URL, referer: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Referer: referer,
      'User-Agent': 'Mozilla/5.0 trend-dashboard'
    }
  })

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: `数据源请求失败：${response.status}` })
  }

  return await response.json() as T
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return String(value)
}
