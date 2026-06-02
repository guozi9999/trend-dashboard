import { round } from './dividend'

export interface ClosePoint {
  date: string
  close: number
}

export function calculateRoc(points: ClosePoint[], lookbackDays: number) {
  if (lookbackDays <= 0 || points.length <= lookbackDays) {
    return {
      roc: null,
      latest: points.at(-1) ?? null,
      base: null
    }
  }

  const latest = points.at(-1)!
  const base = points[points.length - lookbackDays - 1]!
  if (base.close <= 0) {
    return {
      roc: null,
      latest,
      base
    }
  }

  return {
    roc: round(((latest.close - base.close) / base.close) * 100, 2),
    latest,
    base
  }
}

export function getRotationAction(roc: number | null): 'hold' | 'cash' | 'insufficient' {
  if (roc === null) {
    return 'insufficient'
  }

  return roc > 0 ? 'hold' : 'cash'
}
