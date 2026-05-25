export interface StockQuote {
  code: string
  name: string
  secucode: string
  boardName: string | null
  closePrice: number | null
  tradeDate: string | null
  peTtm: number | null
  pbMrq: number | null
  totalMarketCap: number | null
}

export interface DividendRecord {
  securityCode: string
  securityName: string
  secucode: string
  reportDate: string | null
  noticeDate: string | null
  planNoticeDate: string | null
  equityRecordDate: string | null
  exDividendDate: string | null
  payCashDate: string | null
  assignProgress: string | null
  planProfile: string | null
  pretaxBonusRmbPer10: number | null
  cashPerShare: number | null
  dividendYieldAtAnnouncement: number | null
  eps: number | null
  bvps: number | null
  netProfitYoY: number | null
}

export interface AnnualPriceRange {
  fiscalYear: number
  highestPrice: number | null
  highestPriceDate: string | null
  lowestPrice: number | null
  lowestPriceDate: string | null
}

export interface AnnualDividend {
  fiscalYear: number
  cashPerShare: number
  dividendCount: number
  implementedCount: number
  latestProgress: string | null
  yieldAtCurrentPrice: number | null
  highestPrice: number | null
  highestPriceDate: string | null
  lowestPrice: number | null
  lowestPriceDate: string | null
  highestDividendYield: number | null
  lowestDividendYield: number | null
}

export interface TreasuryYieldPoint {
  date: string
  cn2y: number | null
  cn5y: number | null
  cn10y: number | null
  cn30y: number | null
  us10y: number | null
}

export interface DividendSignal {
  level: 'deep_value' | 'accumulate' | 'fair' | 'wait' | 'insufficient'
  label: string
  tone: 'emerald' | 'blue' | 'amber' | 'zinc'
  summary: string
}

export interface StockYieldBand {
  sampleYears: number
  minYield: number | null
  q25Yield: number | null
  medianYield: number | null
  q75Yield: number | null
  maxYield: number | null
  currentPercentile: number | null
  label: string
  summary: string
}

export interface DividendDashboard {
  stock: StockQuote
  treasury: {
    latest: TreasuryYieldPoint
    history: TreasuryYieldPoint[]
    source: string
  }
  dividend: {
    annual: AnnualDividend[]
    records: DividendRecord[]
    latestFiscalYear: number | null
    latestAnnualCashPerShare: number | null
    latestAnnualYield: number | null
    forecastFiscalYear: number | null
    forecastAnnualCashPerShare: number | null
    forecastDividendYield: number | null
    forecastGrowthRate: number | null
    forecastBasis: string
    fiveYearAverageCashPerShare: number | null
    fiveYearAverageYield: number | null
    fiveYearCashCagr: number | null
    continuousDividendYears: number
    nextDividendDate: string | null
    lastDividendDate: string | null
    spreadToCn10yBp: number | null
    riskPremiumTargetYield: number | null
    priceForFourPercentYield: number | null
    priceForFourPointFivePercentYield: number | null
    yieldBand: StockYieldBand
    calculation: {
      dividendYield: string
      forecastDividendYield: string
      spreadToCn10y: string
      annualYieldRange: string
      signalRule: string
    }
    signal: DividendSignal
  }
  cache: {
    fetchedAt: string
    fromCache: boolean
  }
  sources: Array<{
    label: string
    url: string
  }>
}
