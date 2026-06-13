<script setup lang="ts">
import type { DividendDashboard } from '~~/shared/types/stock'

const route = useRoute()
const router = useRouter()

const searchText = ref(typeof route.query.q === 'string' ? route.query.q : '长江电力')
const activeQuery = ref(searchText.value)
const forceRemoteRefresh = ref(false)
const isManualUpdating = ref(false)
const weakCycleDividendGroups = [
  {
    label: '电力',
    names: ['长江电力', '国投电力', '川投能源', '华能水电', '桂冠电力', '中国核电', '中国广核', '申能股份', '浙能电力', '粤电力A', '深圳能源', '湖北能源']
  },
  {
    label: '交通',
    names: ['宁沪高速', '山东高速', '皖通高速', '粤高速A', '招商公路', '深高速', '赣粤高速', '福建高速', '四川成渝', '大秦铁路']
  },
  {
    label: '通信',
    names: ['中国移动', '中国电信', '中国联通']
  },
  {
    label: '银行',
    names: ['工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行', '招商银行', '兴业银行']
  },
  {
    label: '能源',
    names: ['中国神华', '陕西煤业']
  }
]

const { data, pending, error, refresh } = await useAsyncData(
  'stock-dashboard',
  () => $fetch<DividendDashboard>('/api/stock', {
    query: {
      query: activeQuery.value,
      refresh: forceRemoteRefresh.value ? '1' : undefined
    }
  }),
  { watch: [] }
)

const dashboard = computed(() => data.value)
const annualRows = computed(() => dashboard.value?.dividend.annual ?? [])
const dividendRows = computed(() => dashboard.value?.dividend.records ?? [])
const rotationRows = computed(() => dashboard.value?.rotation.assets ?? [])
const marketTrendRows = computed(() => dashboard.value?.marketTemperature.trend.rows ?? [])
const marketSectorRows = computed(() => dashboard.value?.marketTemperature.sector.rows ?? [])
const maxAnnualCash = computed(() => Math.max(...annualRows.value.map((item) => item.cashPerShare), 0))
const latestYield = computed(() => dashboard.value?.dividend.latestAnnualYield ?? null)
const cn10y = computed(() => dashboard.value?.treasury.latest.cn10y ?? null)
const signalTone = computed(() => {
  const tone = dashboard.value?.dividend.signal.tone ?? 'zinc'
  const colorMap = {
    emerald: 'emerald',
    blue: 'blue',
    amber: 'amber',
    zinc: 'gray'
  } as const

  return colorMap[tone]
})

async function runSearch(value = searchText.value, refreshRemote = false) {
  const next = value.trim()
  if (!next) {
    return
  }

  searchText.value = next
  activeQuery.value = next
  forceRemoteRefresh.value = refreshRemote
  isManualUpdating.value = refreshRemote
  await router.replace({ query: { q: next } })

  try {
    await refresh()
  } finally {
    forceRemoteRefresh.value = false
    isManualUpdating.value = false
  }
}

function setExample(example: string) {
  void runSearch(example)
}

function formatPercent(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? '-' : `${value.toFixed(digits)}%`
}

function formatBp(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value.toFixed(0)}BP`
}

function formatNumber(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? '-' : value.toFixed(digits)
}

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '-'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  // Convert to China timezone (UTC+8)
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return chinaTime.toISOString().replace('T', ' ').slice(0, 19)
}

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `¥${value.toFixed(2)}`
}

function formatMarketCap(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-'
  }

  return `${(value / 100_000_000).toFixed(0)}亿`
}

function formatTurnover(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-'
  }

  return `${(value / 100_000_000).toFixed(2)}亿`
}

function formatRankChange(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-'
  }

  return value > 0 ? `+${value}` : `${value}`
}

function annualBarWidth(value: number) {
  if (!maxAnnualCash.value) {
    return '0%'
  }

  return `${Math.max((value / maxAnnualCash.value) * 100, 4)}%`
}
</script>

<template>
  <div>
    <UContainer class="py-4 sm:py-8">
      <UAlert
        v-if="error"
        color="red"
        variant="soft"
        icon="i-heroicons-exclamation-triangle"
        title="查询失败"
        :description="error.statusMessage || error.message"
        class="mb-4 sm:mb-6"
      />

      <div v-if="dashboard" class="space-y-4 sm:space-y-6">
        <!-- 轮动策略 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                <h3 class="text-base sm:text-lg font-semibold text-zinc-950">轮动策略</h3>
                <UBadge color="gray" variant="soft" size="sm">ROC({{ dashboard.rotation.lookbackDays }})</UBadge>
              </div>
              <p class="mt-2 max-w-4xl text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600">
                {{ dashboard.rotation.summary }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge
                :color="dashboard.rotation.action === 'hold' ? 'emerald' : dashboard.rotation.action === 'cash' ? 'amber' : 'gray'"
                size="lg"
                variant="soft"
              >
                {{ dashboard.rotation.actionLabel }}
              </UBadge>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
            <span class="text-xs text-zinc-500">更新时间：{{ formatDateTime(dashboard.cache.fetchedAt) }}</span>
            <UButton
              size="xs"
              color="gray"
              variant="soft"
              icon="i-heroicons-arrow-path"
              :loading="pending"
              @click="runSearch(searchText, true)"
            >
              刷新数据
            </UButton>
          </div>

          <div class="mt-4 sm:mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div class="rounded-md border border-zinc-100 bg-zinc-50 p-3 sm:p-4">
              <p class="text-xs sm:text-sm text-zinc-500">当前最强</p>
              <p class="mt-2 text-xl sm:text-2xl font-semibold text-zinc-950">{{ dashboard.rotation.winner?.name || '-' }}</p>
              <p class="mt-2 text-xs text-zinc-500">
                {{ dashboard.rotation.winner?.code || '-' }} · {{ formatPercent(dashboard.rotation.winner?.roc20) }}
              </p>
            </div>
            <div class="rounded-md border border-zinc-100 bg-zinc-50 p-3 sm:p-4">
              <p class="text-xs sm:text-sm text-zinc-500">操作标的</p>
              <p class="mt-2 text-xl sm:text-2xl font-semibold text-zinc-950">{{ dashboard.rotation.winner?.tradeName || '-' }}</p>
              <p class="mt-2 text-xs text-zinc-500">
                {{ dashboard.rotation.winner?.tradeCode || '-' }} · 成交额 {{ formatTurnover(dashboard.rotation.winner?.tradeTurnover) }}
              </p>
            </div>
            <div class="rounded-md border border-zinc-100 bg-zinc-50 p-3 sm:p-4">
              <p class="text-xs sm:text-sm text-zinc-500">计算日期</p>
              <p class="mt-2 text-xl sm:text-2xl font-semibold text-zinc-950">{{ formatDate(dashboard.rotation.winner?.latestDate) }}</p>
              <p class="mt-2 text-xs text-zinc-500">
                基准 {{ formatDate(dashboard.rotation.winner?.baseDate) }} · {{ dashboard.rotation.action === 'hold' ? '为正持有' : dashboard.rotation.action === 'cash' ? '为负空仓' : '等待数据' }}
              </p>
            </div>
          </div>

          <div class="mt-4 sm:mt-5 overflow-x-auto market-table-scroll rounded-md border border-zinc-100">
            <table class="min-w-[600px] w-full divide-y divide-zinc-200 text-left text-xs sm:text-sm">
              <thead class="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                <tr>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">排名</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">轮动品种</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">20日ROC</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">最新收盘</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">20日前收盘</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">操作标的</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">ETF成交额</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr
                  v-for="item in rotationRows"
                  :key="item.code"
                  class="hover:bg-zinc-50"
                >
                  <td class="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900">{{ item.rank }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-900">{{ item.name }} {{ item.code }}</td>
                  <td
                    class="whitespace-nowrap px-3 py-2.5 font-semibold"
                    :class="(item.roc20 ?? 0) > 0 ? 'text-emerald-700' : 'text-zinc-700'"
                  >
                    {{ formatPercent(item.roc20) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.latestClose, 2) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.baseClose, 2) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ item.tradeName }} {{ item.tradeCode }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatTurnover(item.tradeTurnover) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="mt-3 sm:mt-4 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-500">
            {{ dashboard.rotation.calculation }}
          </p>
        </section>

        <!-- 市场温度 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                <h3 class="text-base sm:text-lg font-semibold text-zinc-950">市场温度</h3>
                <UBadge color="gray" variant="soft" size="sm">本地快照</UBadge>
              </div>
              <p class="mt-2 max-w-4xl text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600">
                {{ dashboard.marketTemperature.summary }}
              </p>
            </div>
            <div class="text-xs sm:text-sm text-zinc-500">
              {{ formatDate(dashboard.marketTemperature.trend.tradeDate || dashboard.marketTemperature.sector.tradeDate) }}
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
            <span class="text-xs text-zinc-500">更新时间：{{ formatDateTime(dashboard.cache.fetchedAt) }}</span>
            <UButton
              size="xs"
              color="gray"
              variant="soft"
              icon="i-heroicons-arrow-path"
              :loading="pending"
              @click="runSearch(searchText, true)"
            >
              刷新数据
            </UButton>
          </div>

          <div class="mt-4 sm:mt-5 space-y-6">
            <!-- 趋势模型 -->
            <div>
              <div class="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <h4 class="font-semibold text-zinc-950 text-sm sm:text-base">{{ dashboard.marketTemperature.trend.title }}</h4>
                <UBadge color="gray" variant="soft" size="sm">{{ marketTrendRows.length }} 项</UBadge>
              </div>
              <div class="mt-3 overflow-x-auto market-table-scroll rounded-md border border-zinc-100">
                <table class="min-w-[900px] w-full divide-y divide-zinc-200 text-left text-xs sm:text-sm">
                  <thead class="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                    <tr>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">排名</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">代码</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">名称</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">涨幅</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">现价</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">20日均线</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">偏离率</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">量比</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">状态转变</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">区间涨幅</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">排名变化</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-100">
                    <tr v-for="item in marketTrendRows" :key="`trend-${item.code}`" class="hover:bg-zinc-50">
                      <td class="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900">{{ item.rank }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ item.code }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-cyan-700">{{ item.name }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5" :class="(item.changePercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.changePercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.close, item.close && item.close < 100 ? 3 : 0) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.ma20, item.ma20 && item.ma20 < 100 ? 3 : 0) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-medium" :class="(item.deviationPercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.deviationPercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.volumeRatio, 2) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(item.stateChangeDate) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5" :class="(item.intervalChangePercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.intervalChangePercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatRankChange(item.rankChange) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 板块轮动 -->
            <div>
              <div class="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <h4 class="font-semibold text-zinc-950 text-sm sm:text-base">{{ dashboard.marketTemperature.sector.title }}</h4>
                <UBadge color="gray" variant="soft" size="sm">{{ marketSectorRows.length }} 项</UBadge>
              </div>
              <div class="mt-3 overflow-x-auto market-table-scroll rounded-md border border-zinc-100">
                <table class="min-w-[900px] w-full divide-y divide-zinc-200 text-left text-xs sm:text-sm">
                  <thead class="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                    <tr>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">排名</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">代码</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">名称</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">涨幅</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">现价</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">20日均线</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">偏离率</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">量比</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">状态转变</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">区间涨幅</th>
                      <th class="whitespace-nowrap px-3 py-3 font-medium">排名变化</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-100">
                    <tr v-for="item in marketSectorRows" :key="`sector-${item.code}`" class="hover:bg-zinc-50">
                      <td class="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900">{{ item.rank }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ item.code }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-cyan-700">{{ item.name }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5" :class="(item.changePercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.changePercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.close, item.close && item.close < 100 ? 3 : 0) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.ma20, item.ma20 && item.ma20 < 100 ? 3 : 0) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-medium" :class="(item.deviationPercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.deviationPercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.volumeRatio, 2) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(item.stateChangeDate) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5" :class="(item.intervalChangePercent ?? 0) >= 0 ? 'text-red-700' : 'text-emerald-700'">{{ formatPercent(item.intervalChangePercent) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatRankChange(item.rankChange) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p class="mt-3 sm:mt-4 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-500">
            {{ dashboard.marketTemperature.calculation }}
          </p>
        </section>

        <!-- 搜索表单 -->
        <section>
          <form class="w-full rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm" @submit.prevent="runSearch()">
            <label class="text-xs sm:text-sm font-medium text-zinc-700" for="stock-search">股票</label>
            <div class="mt-2 flex flex-col sm:grid sm:grid-cols-[minmax(180px,1fr)_86px_128px] gap-2">
              <div class="relative min-w-0">
                <UIcon
                  name="i-heroicons-magnifying-glass"
                  class="pointer-events-none absolute left-3 top-1/2 z-10 size-5 -translate-y-1/2 text-zinc-400"
                />
                <UInput
                  id="stock-search"
                  v-model="searchText"
                  class="w-full"
                  placeholder="长江电力 / 600900"
                  size="lg"
                  :ui="{ padding: { lg: 'pl-10 pr-3' } }"
                />
              </div>
              <div class="flex gap-2">
                <UButton
                  type="submit"
                  size="lg"
                  icon="i-heroicons-magnifying-glass"
                  :loading="pending && !isManualUpdating"
                  class="flex-1 sm:flex-none h-10 justify-center whitespace-nowrap"
                >
                  查询
                </UButton>
                <UButton
                  type="button"
                  size="lg"
                  color="gray"
                  variant="soft"
                  icon="i-heroicons-arrow-path"
                  :loading="isManualUpdating"
                  class="flex-1 sm:flex-none h-10 justify-center whitespace-nowrap"
                  @click="runSearch(searchText, true)"
                >
                  更新数据
                </UButton>
              </div>
            </div>
            <div class="mt-3 space-y-2">
              <div
                v-for="group in weakCycleDividendGroups"
                :key="group.label"
                class="flex flex-wrap items-start gap-2"
              >
                <span class="w-10 flex-shrink-0 pt-1 text-xs font-medium text-zinc-500">{{ group.label }}</span>
                <div class="flex min-w-0 flex-1 flex-wrap gap-1.5 sm:gap-2">
                  <UButton
                    v-for="example in group.names"
                    :key="example"
                    type="button"
                    color="gray"
                    variant="soft"
                    size="xs"
                    @click="setExample(example)"
                  >
                    {{ example }}
                  </UButton>
                </div>
              </div>
            </div>
          </form>
        </section>

        <!-- 股票信息头 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                <h2 class="text-xl sm:text-2xl font-semibold text-zinc-950">
                  {{ dashboard.stock.name }}
                </h2>
                <UBadge color="gray" variant="soft">{{ dashboard.stock.code }}</UBadge>
                <UBadge v-if="dashboard.stock.boardName" color="emerald" variant="soft">
                  {{ dashboard.stock.boardName }}
                </UBadge>
              </div>
              <p class="mt-2 text-xs sm:text-sm text-zinc-500">
                行情日期 {{ formatDate(dashboard.stock.tradeDate) }} · 国债日期 {{ dashboard.treasury.latest.date }}
                · 最近派息 {{ formatDate(dashboard.dividend.lastDividendDate) }}
                · 下次派息 {{ formatDate(dashboard.dividend.nextDividendDate) }}
                · {{ dashboard.cache.fromCache ? '读取本地缓存' : '已更新远端数据' }}
              </p>
            </div>

            <UBadge :color="signalTone" size="lg" variant="soft" class="self-start">
              {{ dashboard.dividend.signal.label }}
            </UBadge>
          </div>

          <p class="mt-3 sm:mt-4 max-w-4xl text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600">
            {{ dashboard.dividend.signal.summary }}
          </p>
        </section>

        <!-- 指标卡片 -->
        <section class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">最新价</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-zinc-950">{{ formatMoney(dashboard.stock.closePrice) }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">市值 {{ formatMarketCap(dashboard.stock.totalMarketCap) }}</p>
          </div>

          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">最新年度股息率</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-emerald-700">{{ formatPercent(latestYield) }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">
              {{ dashboard.dividend.latestFiscalYear || '-' }} 年每股 {{ formatNumber(dashboard.dividend.latestAnnualCashPerShare, 4) }} 元
            </p>
          </div>

          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">{{ dashboard.dividend.forecastFiscalYear || '-' }}E 预测股息率</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-emerald-700">{{ formatPercent(dashboard.dividend.forecastDividendYield) }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">
              预测 {{ dashboard.dividend.forecastFiscalYear || '-' }} 年每股 {{ formatNumber(dashboard.dividend.forecastAnnualCashPerShare, 4) }} 元 · 增速 {{ formatPercent(dashboard.dividend.forecastGrowthRate) }}
            </p>
          </div>

          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">中国 10Y 国债</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-zinc-950">{{ formatPercent(cn10y) }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">风险补偿线 {{ formatPercent(dashboard.dividend.riskPremiumTargetYield) }}</p>
          </div>

          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">策略股债息差</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-blue-700">{{ formatBp(dashboard.dividend.signalSpreadToCn10yBp) }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">
              最新 {{ formatBp(dashboard.dividend.spreadToCn10yBp) }} · 保守 {{ formatBp(dashboard.dividend.signalSpreadToCn10yBp) }}
            </p>
          </div>

          <div class="metric-tile rounded-md border border-zinc-200 bg-white p-3 sm:p-4 shadow-sm">
            <p class="text-xs sm:text-sm text-zinc-500">连续分红年数</p>
            <p class="mt-2 sm:mt-3 text-xl sm:text-3xl font-semibold text-zinc-950">{{ dashboard.dividend.continuousDividendYears }}</p>
            <p class="mt-1 sm:mt-2 text-xs text-zinc-500">近 5 年 CAGR {{ formatPercent(dashboard.dividend.fiveYearCashCagr) }}</p>
          </div>
        </section>

        <!-- 年度分红 + 价格倒推 -->
        <section class="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
              <div>
                <h3 class="text-base sm:text-lg font-semibold text-zinc-950">年度现金分红</h3>
                <p class="mt-1 text-xs sm:text-sm text-zinc-500">按报告期归集，含年报、中报、三季报等现金分红。</p>
              </div>
              <UBadge color="gray" variant="soft" size="sm">近 {{ annualRows.length }} 年</UBadge>
            </div>

            <div class="mt-4 sm:mt-5 space-y-2 sm:space-y-3">
              <div
                v-for="item in annualRows.slice(0, 12)"
                :key="item.fiscalYear"
                class="grid gap-2 sm:gap-3 grid-cols-[56px_minmax(0,1fr)_80px] sm:grid-cols-[72px_minmax(0,1fr)_96px_96px]"
              >
                <span class="text-xs sm:text-sm font-medium text-zinc-700">{{ item.fiscalYear }}</span>
                <div class="h-6 sm:h-7 overflow-hidden rounded-md bg-zinc-100">
                  <div
                    class="h-full rounded-md bg-emerald-500"
                    :style="{ width: annualBarWidth(item.cashPerShare) }"
                  />
                </div>
                <span class="text-xs sm:text-sm text-zinc-700">{{ formatNumber(item.cashPerShare, 4) }} 元/股</span>
                <span class="hidden sm:block text-xs sm:text-sm text-zinc-500">{{ formatPercent(item.yieldAtCurrentPrice) }}</span>
              </div>
            </div>
          </div>

          <div class="space-y-3 sm:space-y-4">
            <div class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">价格倒推</h3>
              <div class="mt-3 sm:mt-4 space-y-2 sm:space-y-3">
                <div class="flex items-center justify-between gap-3 sm:gap-4">
                  <span class="text-xs sm:text-sm text-zinc-500">攒股目标 {{ formatPercent(dashboard.dividend.accumulateTargetYield) }}</span>
                  <span class="text-base sm:text-lg font-semibold text-zinc-950">{{ formatMoney(dashboard.dividend.priceForAccumulateTargetYield) }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 sm:gap-4">
                  <span class="text-xs sm:text-sm text-zinc-500">深度目标 {{ formatPercent(dashboard.dividend.deepValueTargetYield) }}</span>
                  <span class="text-base sm:text-lg font-semibold text-zinc-950">{{ formatMoney(dashboard.dividend.priceForDeepValueTargetYield) }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 sm:gap-4">
                  <span class="text-xs sm:text-sm text-zinc-500">达到 4% 股息率</span>
                  <span class="text-base sm:text-lg font-semibold text-zinc-950">{{ formatMoney(dashboard.dividend.priceForFourPercentYield) }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 sm:gap-4">
                  <span class="text-xs sm:text-sm text-zinc-500">达到 4.5% 股息率</span>
                  <span class="text-base sm:text-lg font-semibold text-zinc-950">{{ formatMoney(dashboard.dividend.priceForFourPointFivePercentYield) }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 sm:gap-4">
                  <span class="text-xs sm:text-sm text-zinc-500">近 5 年平均股息率</span>
                  <span class="text-base sm:text-lg font-semibold text-zinc-950">{{ formatPercent(dashboard.dividend.fiveYearAverageYield) }}</span>
                </div>
              </div>
            </div>

            <div class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">国债对比</h3>
              <div class="mt-3 sm:mt-4 divide-y divide-zinc-100">
                <div class="flex items-center justify-between py-2">
                  <span class="text-xs sm:text-sm text-zinc-500">中国 2Y</span>
                  <span class="font-medium text-zinc-900">{{ formatPercent(dashboard.treasury.latest.cn2y) }}</span>
                </div>
                <div class="flex items-center justify-between py-2">
                  <span class="text-xs sm:text-sm text-zinc-500">中国 5Y</span>
                  <span class="font-medium text-zinc-900">{{ formatPercent(dashboard.treasury.latest.cn5y) }}</span>
                </div>
                <div class="flex items-center justify-between py-2">
                  <span class="text-xs sm:text-sm text-zinc-500">中国 10Y</span>
                  <span class="font-medium text-zinc-900">{{ formatPercent(dashboard.treasury.latest.cn10y) }}</span>
                </div>
                <div class="flex items-center justify-between py-2">
                  <span class="text-xs sm:text-sm text-zinc-500">中国 30Y</span>
                  <span class="font-medium text-zinc-900">{{ formatPercent(dashboard.treasury.latest.cn30y) }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 年度股价与股息率区间 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">年度股价与股息率区间</h3>
              <p class="mt-1 text-xs sm:text-sm text-zinc-500">按文章原文的股息率表思路：用年度分红除以当年最高价/最低价，得到每年的最低/最高股息率。</p>
            </div>
            <UBadge color="gray" variant="soft" size="sm">{{ annualRows.length }} 年</UBadge>
          </div>

          <div class="mt-4 sm:mt-5 overflow-x-auto market-table-scroll rounded-md border border-zinc-100">
            <table class="min-w-[700px] w-full divide-y divide-zinc-200 text-left text-xs sm:text-sm">
              <thead class="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                <tr>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">年度</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">每股分红</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">年内最低价</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">最低价日期</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">最高股息率</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">年内最高价</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">最高价日期</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">最低股息率</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="item in annualRows" :key="`range-${item.fiscalYear}`" class="hover:bg-zinc-50">
                  <td class="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900">{{ item.fiscalYear }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(item.cashPerShare, 4) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatMoney(item.lowestPrice) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(item.lowestPriceDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 font-medium text-emerald-700">{{ formatPercent(item.highestDividendYield) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatMoney(item.highestPrice) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(item.highestPriceDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatPercent(item.lowestDividendYield) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 全部分红记录 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">全部分红记录</h3>
              <p class="mt-1 text-xs sm:text-sm text-zinc-500">展示现金分红方案，以及公告日、股权登记日、除权除息日和派息日。</p>
            </div>
            <UBadge color="gray" variant="soft" size="sm">{{ dividendRows.length }} 条</UBadge>
          </div>

          <div class="mt-4 sm:mt-5 overflow-x-auto market-table-scroll rounded-md border border-zinc-100">
            <table class="min-w-[800px] w-full divide-y divide-zinc-200 text-left text-xs sm:text-sm">
              <thead class="bg-zinc-50 text-xs uppercase text-zinc-500 sticky top-0">
                <tr>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">报告期</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">方案</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">现金/10股</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">每股现金</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">股息率</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">公告日</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">登记日</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">除息日</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">派息日</th>
                  <th class="whitespace-nowrap px-3 py-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="row in dividendRows" :key="`${row.reportDate}-${row.planProfile}`" class="hover:bg-zinc-50">
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatDate(row.reportDate) }}</td>
                  <td class="min-w-48 px-3 py-2.5 text-zinc-900">{{ row.planProfile || '-' }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(row.pretaxBonusRmbPer10, 3) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatNumber(row.cashPerShare, 4) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ formatPercent(row.dividendYieldAtAnnouncement) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(row.noticeDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(row.equityRecordDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(row.exDividendDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-500">{{ formatDate(row.payCashDate) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-zinc-700">{{ row.assignProgress || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 方法阈值 + 计算说明 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="grid gap-4 sm:gap-6 md:grid-cols-2">
            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">方法阈值</h3>
              <div class="mt-3 sm:mt-4 grid gap-2 sm:gap-3">
                <div class="rounded-md border border-emerald-100 bg-emerald-50 p-2.5 sm:p-3">
                  <p class="font-medium text-emerald-900 text-sm sm:text-base">4.5%+ 且息差 250BP+</p>
                  <p class="mt-1 text-xs sm:text-sm text-emerald-800">深度股息率区间。</p>
                </div>
                <div class="rounded-md border border-blue-100 bg-blue-50 p-2.5 sm:p-3">
                  <p class="font-medium text-blue-900 text-sm sm:text-base">4%+ 且息差 200BP+</p>
                  <p class="mt-1 text-xs sm:text-sm text-blue-800">进入攒股观察区间。</p>
                </div>
                <div class="rounded-md border border-amber-100 bg-amber-50 p-2.5 sm:p-3">
                  <p class="font-medium text-amber-900 text-sm sm:text-base">高于 10Y 国债 100BP+</p>
                  <p class="mt-1 text-xs sm:text-sm text-amber-800">具备基础风险补偿。</p>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">计算说明</h3>
              <div class="mt-3 sm:mt-4 space-y-2 sm:space-y-3 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600">
                <p>{{ dashboard.dividend.calculation.dividendYield }}</p>
                <p>{{ dashboard.dividend.calculation.forecastDividendYield }}</p>
                <p>{{ dashboard.dividend.calculation.spreadToCn10y }}</p>
                <p>{{ dashboard.dividend.calculation.annualYieldRange }}</p>
                <p>{{ dashboard.dividend.forecastBasis }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 数据来源 -->
        <section class="rounded-md border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
          <div class="grid gap-4 sm:gap-6 md:grid-cols-2">
            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">数据来源</h3>
              <div class="mt-3 sm:mt-4 space-y-2 sm:space-y-3 text-xs sm:text-sm text-zinc-600">
                <p>数据状态：{{ dashboard.cache.fromCache ? '本地缓存' : '刚刚从远端更新' }}</p>
                <p>缓存时间：{{ formatDateTime(dashboard.cache.fetchedAt) }}</p>
                <p>数据仅用于方法看板和学习研究，不构成投资建议。</p>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="source in dashboard.sources"
                    :key="source.url"
                    :to="source.url"
                    target="_blank"
                    color="gray"
                    variant="soft"
                    size="xs"
                    icon="i-heroicons-arrow-top-right-on-square"
                  >
                    {{ source.label }}
                  </UButton>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-base sm:text-lg font-semibold text-zinc-950">分红日期口径</h3>
              <div class="mt-3 sm:mt-4 space-y-2 sm:space-y-3 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600">
                <p>公告日：公司披露分红方案的日期。</p>
                <p>股权登记日：当天收盘仍持有股票的投资者享有本次分红。</p>
                <p>除权除息日：股价按分红因素调整的交易日。</p>
                <p>派息日：现金红利发放日期；若预案未实施，页面会显示为空。</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="pending" class="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3">
        <USkeleton v-for="item in 6" :key="item" class="h-28 sm:h-32 rounded-md" />
      </div>
    </UContainer>
  </div>
</template>
