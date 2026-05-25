import { z } from 'zod'
import { buildDividendDashboard } from '../lib/eastmoney'

const querySchema = z.object({
  query: z.string().min(1).max(32)
})

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '请输入股票名称或代码' })
  }

  const refresh = query.refresh === '1' || query.refresh === 'true'
  return await buildDividendDashboard(parsed.data.query, { refresh })
})
