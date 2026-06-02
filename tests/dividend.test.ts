import { describe, expect, it } from 'vitest'
import { buildAnnualDividends, buildDividendForecast, buildStockYieldBand, calculateCagr, calculateStrategyTargetYield, calculateYieldSpreadBp, chooseSignalDividendYield, classifyDividendSignal, countContinuousDividendYears } from '../shared/utils/dividend'
import { calculateRoc, getRotationAction } from '../shared/utils/rotation'
import type { DividendRecord } from '../shared/types/stock'

function dividend(reportDate: string, cashPerShare: number, progress = '实施分配'): DividendRecord {
  return {
    securityCode: '600900',
    securityName: '长江电力',
    secucode: '600900.SH',
    reportDate,
    noticeDate: null,
    planNoticeDate: null,
    equityRecordDate: null,
    exDividendDate: null,
    payCashDate: null,
    assignProgress: progress,
    planProfile: null,
    pretaxBonusRmbPer10: cashPerShare * 10,
    cashPerShare,
    dividendYieldAtAnnouncement: null,
    eps: null,
    bvps: null,
    netProfitYoY: null
  }
}

describe('dividend calculations', () => {
  it('groups multiple dividend records into fiscal-year cash per share', () => {
    const priceRanges = new Map([
      [2025, {
        fiscalYear: 2025,
        highestPrice: 30,
        highestPriceDate: '2025-08-01',
        lowestPrice: 20,
        lowestPriceDate: '2025-01-10'
      }]
    ])
    const annual = buildAnnualDividends([
      dividend('2025-12-31 00:00:00', 0.79, '股东大会决议通过'),
      dividend('2025-09-30 00:00:00', 0.21),
      dividend('2024-12-31 00:00:00', 0.733)
    ], 25, priceRanges)

    expect(annual[0]).toMatchObject({
      fiscalYear: 2025,
      cashPerShare: 1,
      dividendCount: 2,
      implementedCount: 1,
      yieldAtCurrentPrice: 4,
      highestDividendYield: 5,
      lowestDividendYield: 3.33
    })
    expect(annual[1]).toMatchObject({
      fiscalYear: 2024,
      cashPerShare: 0.733,
      yieldAtCurrentPrice: 2.93
    })
  })

  it('classifies dividend yield by yield level and bond spread', () => {
    expect(classifyDividendSignal(4.6, 1.75).level).toBe('deep_value')
    expect(classifyDividendSignal(4.1, 1.75).level).toBe('accumulate')
    expect(classifyDividendSignal(3.1, 1.75).level).toBe('fair')
    expect(classifyDividendSignal(2.3, 1.75).level).toBe('wait')
    expect(classifyDividendSignal(3.75, 1.75).summary).toContain('低于 4% 攒股线')
  })

  it('calculates BP spread from percent yields and strategy target yields', () => {
    expect(calculateYieldSpreadBp(4.23, 1.7009)).toBe(253)
    expect(calculateYieldSpreadBp(null, 1.7)).toBeNull()
    expect(calculateStrategyTargetYield(1.7, 4, 200)).toBe(4)
    expect(calculateStrategyTargetYield(2.3, 4, 200)).toBe(4.3)
    expect(calculateStrategyTargetYield(2.3, 4.5, 250)).toBe(4.8)
  })

  it('uses the lower current or forecast yield for strategy signal', () => {
    expect(chooseSignalDividendYield(4.6, 3.9)).toBe(3.9)
    expect(chooseSignalDividendYield(4.6, null)).toBe(4.6)
    expect(classifyDividendSignal(chooseSignalDividendYield(4.6, 3.9), 1.75).level).toBe('fair')
  })

  it('builds stock-specific historical yield bands', () => {
    const annual = buildAnnualDividends([
      dividend('2025-12-31 00:00:00', 1),
      dividend('2024-12-31 00:00:00', 0.9),
      dividend('2023-12-31 00:00:00', 0.8)
    ], 24, new Map([
      [2025, { fiscalYear: 2025, highestPrice: 30, highestPriceDate: '2025-12-01', lowestPrice: 20, lowestPriceDate: '2025-02-01' }],
      [2024, { fiscalYear: 2024, highestPrice: 25, highestPriceDate: '2024-12-01', lowestPrice: 15, lowestPriceDate: '2024-02-01' }],
      [2023, { fiscalYear: 2023, highestPrice: 20, highestPriceDate: '2023-12-01', lowestPrice: 10, lowestPriceDate: '2023-02-01' }]
    ]))
    const yieldBand = buildStockYieldBand(annual, 5.2)

    expect(yieldBand.sampleYears).toBe(3)
    expect(yieldBand.label).toBe('历史中性偏高股息率区间')
    expect(yieldBand.summary).toContain('该股近 3 年自身历史股息率样本')
  })

  it('calculates dividend continuity and cash dividend CAGR', () => {
    const annual = buildAnnualDividends([
      dividend('2025-12-31 00:00:00', 1),
      dividend('2024-12-31 00:00:00', 0.9),
      dividend('2023-12-31 00:00:00', 0.8)
    ], 20)

    expect(countContinuousDividendYears(annual)).toBe(3)
    expect(calculateCagr(1, 0.8, 2)).toBe(11.8)
  })

  it('builds a conservative forecast dividend yield', () => {
    expect(buildDividendForecast(1, 25, 12)).toMatchObject({
      forecastAnnualCashPerShare: 1.08,
      forecastDividendYield: 4.32,
      forecastGrowthRate: 8
    })
  })

  it('calculates 20-day ROC from latest close and close 20 trading days ago', () => {
    const points = Array.from({ length: 21 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, '0')}`,
      close: index === 0 ? 100 : 100 + index
    }))
    const result = calculateRoc(points, 20)

    expect(result.base?.close).toBe(100)
    expect(result.latest?.close).toBe(120)
    expect(result.roc).toBe(20)
    expect(getRotationAction(result.roc)).toBe('hold')
    expect(getRotationAction(-0.01)).toBe('cash')
  })
})
