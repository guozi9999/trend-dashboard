import type { AnnualDividend, AnnualPriceRange, DividendRecord, DividendSignal, StockYieldBand } from '../types/stock'

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export function getFiscalYear(date: string | null): number | null {
  if (!date) {
    return null
  }

  const year = Number(date.slice(0, 4))
  return Number.isInteger(year) ? year : null
}

export function buildAnnualDividends(
  records: DividendRecord[],
  currentPrice: number | null,
  priceRanges = new Map<number, AnnualPriceRange>()
): AnnualDividend[] {
  const annualMap = new Map<number, AnnualDividend>()

  for (const record of records) {
    const fiscalYear = getFiscalYear(record.reportDate)
    if (!fiscalYear || record.cashPerShare === null) {
      continue
    }

    const current = annualMap.get(fiscalYear) ?? {
      fiscalYear,
      cashPerShare: 0,
      dividendCount: 0,
      implementedCount: 0,
      latestProgress: null,
      yieldAtCurrentPrice: null,
      highestPrice: null,
      highestPriceDate: null,
      lowestPrice: null,
      lowestPriceDate: null,
      highestDividendYield: null,
      lowestDividendYield: null
    }

    current.cashPerShare += record.cashPerShare
    current.dividendCount += 1
    current.latestProgress = record.assignProgress
    if (record.assignProgress?.includes('实施')) {
      current.implementedCount += 1
    }

    annualMap.set(fiscalYear, current)
  }

  return Array.from(annualMap.values())
    .sort((a, b) => b.fiscalYear - a.fiscalYear)
    .map((item) => {
      const cashPerShare = round(item.cashPerShare, 4)
      const priceRange = priceRanges.get(item.fiscalYear)
      const highestPrice = priceRange?.highestPrice ?? null
      const lowestPrice = priceRange?.lowestPrice ?? null

      return {
        ...item,
        cashPerShare,
        highestPrice,
        highestPriceDate: priceRange?.highestPriceDate ?? null,
        lowestPrice,
        lowestPriceDate: priceRange?.lowestPriceDate ?? null,
        yieldAtCurrentPrice: currentPrice ? round((cashPerShare / currentPrice) * 100, 2) : null,
        highestDividendYield: lowestPrice ? round((cashPerShare / lowestPrice) * 100, 2) : null,
        lowestDividendYield: highestPrice ? round((cashPerShare / highestPrice) * 100, 2) : null
      }
    })
}

export function average(values: number[]): number | null {
  if (!values.length) {
    return null
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4)
}

export function calculateCagr(newest: number | null, oldest: number | null, years: number): number | null {
  if (!newest || !oldest || newest <= 0 || oldest <= 0 || years <= 0) {
    return null
  }

  return round((Math.pow(newest / oldest, 1 / years) - 1) * 100, 2)
}

export function buildDividendForecast(
  latestAnnualCashPerShare: number | null,
  currentPrice: number | null,
  fiveYearCashCagr: number | null
) {
  if (!latestAnnualCashPerShare || !currentPrice) {
    return {
      forecastAnnualCashPerShare: null,
      forecastDividendYield: null,
      forecastGrowthRate: null,
      forecastBasis: '缺少最新年度每股分红或当前股价，无法预测。'
    }
  }

  const forecastGrowthRate = clamp(fiveYearCashCagr ?? 0, -5, 8)
  const forecastAnnualCashPerShare = round(latestAnnualCashPerShare * (1 + forecastGrowthRate / 100), 4)

  return {
    forecastAnnualCashPerShare,
    forecastDividendYield: round((forecastAnnualCashPerShare / currentPrice) * 100, 2),
    forecastGrowthRate: round(forecastGrowthRate, 2),
    forecastBasis: '预测每股分红 = 最新年度每股分红 x (1 + 近5年现金分红CAGR，保守限制在 -5% 到 8%)。'
  }
}

export function countContinuousDividendYears(annual: AnnualDividend[]): number {
  if (!annual.length) {
    return 0
  }

  let expectedYear = annual[0]!.fiscalYear
  let count = 0

  for (const item of annual) {
    if (item.fiscalYear !== expectedYear || item.cashPerShare <= 0) {
      break
    }

    count += 1
    expectedYear -= 1
  }

  return count
}

export function classifyDividendSignal(
  latestAnnualYield: number | null,
  cn10yYield: number | null,
  spreadBp: number | null,
  yieldBand?: StockYieldBand
): DividendSignal {
  if (latestAnnualYield === null || cn10yYield === null || spreadBp === null) {
    return {
      level: 'insufficient',
      label: '数据不足',
      tone: 'zinc',
      summary: '缺少当前价格、年度分红或国债收益率，暂时无法判断息差。'
    }
  }

  if (latestAnnualYield >= 4.5 && spreadBp >= 250) {
    return {
      level: 'deep_value',
      label: '深度股息率区间',
      tone: 'emerald',
      summary: withYieldBandSummary(yieldBand, '同时达到 4.5%+ 股息率和 250BP+ 股债息差，进入策略强吸引区间。')
    }
  }

  if (latestAnnualYield >= 4 && spreadBp >= 200) {
    return {
      level: 'accumulate',
      label: '攒股观察区间',
      tone: 'blue',
      summary: withYieldBandSummary(yieldBand, '同时达到 4%+ 股息率和 200BP+ 股债息差，进入攒股观察区间。')
    }
  }

  if (latestAnnualYield >= cn10yYield + 1) {
    const misses: string[] = []
    if (latestAnnualYield < 4) {
      misses.push(`股息率 ${latestAnnualYield.toFixed(2)}% 低于 4% 攒股线`)
    }
    if (spreadBp < 200) {
      misses.push(`息差 ${spreadBp.toFixed(0)}BP 低于 200BP 攒股线`)
    }

    return {
      level: 'fair',
      label: '合理风险补偿',
      tone: 'amber',
      summary: withYieldBandSummary(yieldBand, `股息率高于 10 年国债 100BP 以上，但尚未进入策略强吸引区间，因为${misses.join('，')}。`)
    }
  }

  return {
    level: 'wait',
    label: '等待更好价格',
    tone: 'zinc',
    summary: withYieldBandSummary(yieldBand, '当前股息率相对国债的补偿不足，按方法论更适合耐心等待。')
  }
}

export function buildStockYieldBand(
  annual: AnnualDividend[],
  currentYield: number | null
): StockYieldBand {
  const samples = annual
    .flatMap((item) => [item.lowestDividendYield, item.highestDividendYield])
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  const sampleYears = annual.filter((item) => item.lowestDividendYield !== null && item.highestDividendYield !== null).length

  if (!samples.length || currentYield === null) {
    return {
      sampleYears,
      minYield: null,
      q25Yield: null,
      medianYield: null,
      q75Yield: null,
      maxYield: null,
      currentPercentile: null,
      label: '历史区间不足',
      summary: '该股历史股价或分红样本不足，暂时无法按自身历史区间定位。'
    }
  }

  const minYield = round(samples[0]!, 2)
  const q25Yield = round(percentile(samples, 0.25), 2)
  const medianYield = round(percentile(samples, 0.5), 2)
  const q75Yield = round(percentile(samples, 0.75), 2)
  const maxYield = round(samples[samples.length - 1]!, 2)
  const currentPercentile = round((samples.filter((value) => value <= currentYield).length / samples.length) * 100, 0)
  const label = getYieldBandLabel(currentYield, q25Yield, medianYield, q75Yield)

  return {
    sampleYears,
    minYield,
    q25Yield,
    medianYield,
    q75Yield,
    maxYield,
    currentPercentile,
    label,
    summary: `按该股近 ${sampleYears} 年自身历史股息率样本，区间约 ${minYield.toFixed(2)}%-${maxYield.toFixed(2)}%，25/50/75 分位为 ${q25Yield.toFixed(2)}%/${medianYield.toFixed(2)}%/${q75Yield.toFixed(2)}%。当前 ${currentYield.toFixed(2)}% 位于约第 ${currentPercentile.toFixed(0)} 分位，属于${label}。`
  }
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 1) {
    return sortedValues[0]!
  }

  const position = (sortedValues.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower

  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight
}

function getYieldBandLabel(currentYield: number, q25Yield: number, medianYield: number, q75Yield: number) {
  if (currentYield < q25Yield) {
    return '历史低股息率区间'
  }

  if (currentYield < medianYield) {
    return '历史偏低股息率区间'
  }

  if (currentYield < q75Yield) {
    return '历史中性偏高股息率区间'
  }

  return '历史高股息率区间'
}

function withYieldBandSummary(yieldBand: StockYieldBand | undefined, strategySummary: string) {
  return yieldBand?.summary ? `${yieldBand.summary} ${strategySummary}` : strategySummary
}
