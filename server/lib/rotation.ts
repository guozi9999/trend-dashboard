import { calculateRoc, getRotationAction, type ClosePoint } from '~~/shared/utils/rotation'
import type { RotationAsset, RotationEtfCandidate, RotationStrategy } from '~~/shared/types/stock'
import { toNumber } from '~~/shared/utils/dividend'
import { fetchJsonWithRetry } from './http'

const ROTATION_LOOKBACK_DAYS = 20

interface RotationAssetConfig {
  code: string
  name: string
  quoteId: string
  kind: 'index' | 'fund'
  etfCandidates: Array<{ code: string, quoteId: string }>
}

const ROTATION_ASSETS: RotationAssetConfig[] = [
  {
    code: '000300',
    name: '沪深300',
    quoteId: '1.000300',
    kind: 'index',
    etfCandidates: [
      { code: '510300', quoteId: '1.510300' },
      { code: '510310', quoteId: '1.510310' },
      { code: '159919', quoteId: '0.159919' }
    ]
  },
  {
    code: '399296',
    name: '创成长',
    quoteId: '0.399296',
    kind: 'index',
    etfCandidates: [
      { code: '159967', quoteId: '0.159967' }
    ]
  },
  {
    code: '932000',
    name: '中证2000',
    quoteId: '2.932000',
    kind: 'index',
    etfCandidates: [
      { code: '563300', quoteId: '1.563300' },
      { code: '159531', quoteId: '0.159531' },
      { code: '562660', quoteId: '1.562660' },
      { code: '159532', quoteId: '0.159532' }
    ]
  },
  {
    code: '518880',
    name: '黄金ETF',
    quoteId: '1.518880',
    kind: 'fund',
    etfCandidates: []
  },
  {
    code: '513100',
    name: '纳指ETF',
    quoteId: '1.513100',
    kind: 'fund',
    etfCandidates: []
  }
]

export async function buildRotationStrategy(): Promise<RotationStrategy> {
  const etfCandidates = await fetchEtfCandidates(
    ROTATION_ASSETS.flatMap((asset) => [
      ...asset.etfCandidates,
      ...(asset.kind === 'fund' ? [{ code: asset.code, quoteId: asset.quoteId }] : [])
    ])
  )
  const assetRows = await Promise.all(
    ROTATION_ASSETS.map(async (asset) => {
      const closes = await fetchDailyCloses(asset.quoteId, ROTATION_LOOKBACK_DAYS + 5)
      const { roc, latest, base } = calculateRoc(closes, ROTATION_LOOKBACK_DAYS)
      const candidates = asset.kind === 'index'
        ? asset.etfCandidates
            .map((candidate) => etfCandidates.get(candidate.quoteId) ?? {
              ...candidate,
              name: candidate.code,
              turnover: null
            })
            .sort(compareEtfCandidates)
        : []
      const directFund = asset.kind === 'fund' ? etfCandidates.get(asset.quoteId) : null
      const tradeTarget = candidates[0] ?? directFund ?? {
        code: asset.code,
        name: asset.name,
        quoteId: asset.quoteId,
        turnover: null
      }

      return {
        code: asset.code,
        name: asset.name,
        quoteId: asset.quoteId,
        kind: asset.kind,
        roc20: roc,
        latestClose: latest?.close ?? null,
        latestDate: latest?.date ?? null,
        baseClose: base?.close ?? null,
        baseDate: base?.date ?? null,
        rank: 0,
        tradeCode: tradeTarget.code,
        tradeName: tradeTarget.name,
        tradeQuoteId: tradeTarget.quoteId,
        tradeTurnover: tradeTarget.turnover,
        etfCandidates: candidates
      } satisfies RotationAsset
    })
  )

  const assets = assetRows
    .sort((a, b) => (b.roc20 ?? Number.NEGATIVE_INFINITY) - (a.roc20 ?? Number.NEGATIVE_INFINITY))
    .map((asset, index) => ({ ...asset, rank: index + 1 }))
  const winner = assets.find((asset) => asset.roc20 !== null) ?? null
  const action = getRotationAction(winner?.roc20 ?? null)

  return {
    lookbackDays: ROTATION_LOOKBACK_DAYS,
    winner,
    action,
    actionLabel: getActionLabel(action),
    summary: buildSummary(winner, action),
    assets,
    calculation: 'ROC(20) = (最新收盘价 - 20 个交易日前收盘价) / 20 个交易日前收盘价 x 100；五个品种按 ROC(20) 从高到低排序，第一名为正则持有对应品种，为负则空仓。',
    fetchedAt: new Date().toISOString()
  }
}

async function fetchDailyCloses(quoteId: string, extraDays: number): Promise<ClosePoint[]> {
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
  const klines = response.data?.klines ?? []

  return klines
    .slice(-Math.max(ROTATION_LOOKBACK_DAYS + 1, extraDays))
    .map((line) => {
      const [date, , closeRaw] = line.split(',')
      const close = toNumber(closeRaw)

      return date && close !== null ? { date, close } : null
    })
    .filter((point): point is ClosePoint => point !== null)
}

async function fetchEtfCandidates(
  candidates: Array<{ code: string, quoteId: string }>
): Promise<Map<string, RotationEtfCandidate>> {
  if (!candidates.length) {
    return new Map()
  }

  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get')
  url.searchParams.set('secids', candidates.map((item) => item.quoteId).join(','))
  url.searchParams.set('fields', 'f12,f14,f6')

  const response = await fetchJson<{
    data?: {
      diff?: Array<Record<string, unknown>>
    } | null
  }>(url, 'https://quote.eastmoney.com/')
  const byCode = new Map(candidates.map((item) => [item.code, item]))

  const entries: Array<[string, RotationEtfCandidate]> = (response.data?.diff ?? []).map((row) => {
    const code = String(row.f12 ?? '')
    const fallback = byCode.get(code)
    const candidate = {
      code,
      name: String(row.f14 ?? code),
      quoteId: fallback?.quoteId ?? '',
      turnover: toNumber(row.f6)
    }

    return [candidate.quoteId, candidate] as [string, RotationEtfCandidate]
  }).filter(([quoteId]) => quoteId)

  return new Map(entries)
}

function compareEtfCandidates(a: RotationEtfCandidate, b: RotationEtfCandidate) {
  return (b.turnover ?? Number.NEGATIVE_INFINITY) - (a.turnover ?? Number.NEGATIVE_INFINITY)
}

function getActionLabel(action: RotationStrategy['action']) {
  if (action === 'hold') {
    return '持有 / 买入'
  }

  if (action === 'cash') {
    return '空仓 / 卖出'
  }

  return '数据不足'
}

function buildSummary(winner: RotationAsset | null, action: RotationStrategy['action']) {
  if (!winner || winner.roc20 === null) {
    return '轮动品种数据不足，暂时无法给出持仓动作。'
  }

  if (action === 'hold') {
    return `${winner.name} ROC(20) 为 ${winner.roc20.toFixed(2)}%，五个品种中最强且为正，策略动作是持有或买入 ${winner.tradeName}（${winner.tradeCode}）。`
  }

  return `${winner.name} ROC(20) 为 ${winner.roc20.toFixed(2)}%，虽然排名第一但为负，策略动作是空仓；若已持有则卖出。`
}

async function fetchJson<T>(url: URL, referer: string): Promise<T> {
  return await fetchJsonWithRetry<T>(url, referer, '轮动数据源')
}

function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
