import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight, Database, Flame, Scale } from 'lucide-react'
import { loadIndices, loadMeta, loadUniverse, invalidateMarketCaches } from '../lib/marketData'
import type { UniverseStock } from '../lib/marketData'
import { useAsync } from '../lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '../lib/format'
import { ErrorBlock, LoadingBlock } from '../components/AsyncStatus'
import RefreshBar from '../components/RefreshBar'
import Sparkline from '../components/Sparkline'

// ── 类型与聚合 ──────────────────────────────────────────────
type BarPoint = { date: string; close: number; vol: number }
type Period = 'day' | 'week' | 'month'

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'day', label: '日 K' },
  { key: 'week', label: '周 K' },
  { key: 'month', label: '月 K' },
]

// 周/月由日 K 客户端聚合：每周（周一至周日）/每月取最后一个交易日收盘，成交量求和
function aggregate(series: BarPoint[], period: Period): BarPoint[] {
  if (period === 'day') return series
  const buckets = new Map<string, BarPoint>()
  for (const bar of series) {
    let key: string
    if (period === 'month') {
      key = bar.date.slice(0, 7) // YYYY-MM
    } else {
      const d = new Date(`${bar.date}T00:00:00`)
      const dow = d.getDay() || 7 // 周日视为 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - dow + 1)
      key = monday.toISOString().slice(0, 10) // 以周一日期作桶键
    }
    const prev = buckets.get(key)
    buckets.set(key, { date: bar.date, close: bar.close, vol: (prev?.vol ?? 0) + bar.vol })
  }
  return [...buckets.values()]
}

// ── 板块热度（按 industry 分组）────────────────────────────
interface IndustryRow {
  industry: string
  avgPct: number
  count: number
  leaderName: string
  leaderPct: number
}

function buildIndustryRows(universe: UniverseStock[]): IndustryRow[] {
  const groups = new Map<string, UniverseStock[]>()
  for (const s of universe) {
    const list = groups.get(s.industry) ?? []
    list.push(s)
    groups.set(s.industry, list)
  }
  const rows: IndustryRow[] = [...groups.entries()].map(([industry, list]) => {
    const avgPct = list.reduce((sum, s) => sum + s.changePct, 0) / list.length
    const leader = list.reduce((a, b) => (b.changePct > a.changePct ? b : a))
    return { industry, avgPct, count: list.length, leaderName: leader.name, leaderPct: leader.changePct }
  })
  rows.sort((a, b) => b.avgPct - a.avgPct)
  return rows.slice(0, 10)
}

// ── 图表 Tooltip ───────────────────────────────────────────
function ChartTooltip({
  active,
  payload,
  label,
  period,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ value?: number | string; payload?: BarPoint }>
  label?: string
  period?: Period
}) {
  if (!active || !payload?.length) return null
  const bar = payload[0]?.payload
  if (!bar) return null
  return (
    <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 text-gray-500">
        {period === 'month' ? label?.slice(0, 7) : label}
        {period === 'week' && <span className="ml-1 text-gray-400">(当周最后交易日)</span>}
      </div>
      <div className="font-mono tabular-nums text-gray-900">
        收盘 <span className="text-amber-500">{fmtNum(bar.close)}</span>
      </div>
      <div className="font-mono tabular-nums text-gray-500">
        成交量 {fmtNum(bar.vol / 1e8)} 亿手
      </div>
    </div>
  )
}

// ── 页面 ───────────────────────────────────────────────────
export default function MarketPage() {
  const indicesState = useAsync(loadIndices)
  const metaState = useAsync(loadMeta)
  const universeState = useAsync(loadUniverse)
  const [selectedName, setSelectedName] = useState('')
  const [period, setPeriod] = useState<Period>('day')

  const loading = indicesState.loading || metaState.loading || universeState.loading
  const error = indicesState.error ?? metaState.error ?? universeState.error
  const retryAll = () => {
    indicesState.reload()
    metaState.reload()
    universeState.reload()
  }
  // 实时拉通成功后：失效模块级缓存再触发三路 reload，拉取刚刷新的 JSON
  const handleRefreshed = () => {
    invalidateMarketCaches()
    retryAll()
  }

  const indices = indicesState.data?.indices ?? []
  const indexSeries = useMemo(() => indicesState.data?.series ?? [], [indicesState.data])
  const meta = metaState.data
  const universe = useMemo(() => universeState.data ?? [], [universeState.data])

  const selectedIndex = indices.find((i) => i.name === selectedName) ?? indices[0]
  const rawSeries = useMemo(
    () => indexSeries.find((s) => s.name === selectedIndex?.name)?.series ?? [],
    [indexSeries, selectedIndex?.name],
  )
  const chartData = useMemo(() => aggregate(rawSeries, period), [rawSeries, period])

  // 区间涨跌决定图表红/绿
  const periodChangePct = useMemo(() => {
    if (chartData.length < 2) return 0
    const first = chartData[0].close
    const last = chartData[chartData.length - 1].close
    return ((last - first) / first) * 100
  }, [chartData])
  const chartUp = periodChangePct >= 0
  const chartColor = chartUp ? '#fb7185' : '#34d399' // 红涨绿跌

  const industryRows = useMemo(() => buildIndustryRows(universe), [universe])
  const maxAbsPct = useMemo(
    () => Math.max(...industryRows.map((r) => Math.abs(r.avgPct)), 0.01),
    [industryRows],
  )

  const upCount = meta?.upCount ?? 0
  const downCount = meta?.downCount ?? 0
  const turnover = meta?.turnoverYi ?? 0
  const totalCount = upCount + downCount
  const upRatio = totalCount > 0 ? (upCount / totalCount) * 100 : 0

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-gray-900">市场全览</h1>
        <LoadingBlock text="行情数据加载中…" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-gray-900">市场全览</h1>
        <ErrorBlock error={error} onRetry={retryAll} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">市场全览</h1>
        <p className="mt-1 text-sm text-gray-500">
          六大指数实时快照、板块热度与市场宽度，一屏掌握 A 股全景脉搏。
        </p>
      </div>

      {/* 实时数据拉通 */}
      <RefreshBar fetchedAt={meta?.fetchedAt} onRefreshed={handleRefreshed} />

      {/* 指数卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {indices.map((idx) => {
          const active = idx.name === selectedIndex?.name
          const series = indexSeries.find((s) => s.name === idx.name)?.series ?? []
          const spark = series.slice(-60).map((b) => b.close)
          const Up = idx.changePct >= 0
          return (
            <button
              key={idx.name}
              onClick={() => setSelectedName(idx.name)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${active ? 'text-amber-500' : 'text-gray-500'}`}>
                  {idx.name}
                </span>
                {Up ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-emerald-400" />
                )}
              </div>
              <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-gray-900">
                {fmtNum(idx.value)}
              </div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <span className={`font-mono text-xs tabular-nums ${pctColor(idx.changePct)}`}>
                  {fmtPct(idx.changePct)}
                </span>
                <Sparkline data={spark} width={64} height={22} positive={Up} />
              </div>
            </button>
          )
        })}
      </div>

      {/* 指数走势图 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-gray-800">{selectedIndex?.name ?? '指数'} 走势</h2>
            <span className={`font-mono text-xs tabular-nums ${pctColor(periodChangePct)}`}>
              区间 {fmtPct(periodChangePct)}
            </span>
          </div>
          <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-0.5">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  period === tab.key
                    ? 'bg-amber-100 text-amber-500'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="indexArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
                minTickGap={40}
                tickFormatter={(d: string) => (period === 'month' ? d.slice(0, 7) : d.slice(5))}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                domain={[(min: number) => min * 0.995, (max: number) => max * 1.005]}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => fmtNum(v, 0)}
                width={64}
              />
              <YAxis yAxisId="vol" hide domain={[0, (max: number) => max * 4]} />
              <Tooltip content={<ChartTooltip period={period} />} />
              <Bar yAxisId="vol" dataKey="vol" barSize={period === 'day' ? 3 : 8} radius={[1, 1, 0, 0]}>
                {chartData.map((b, i) => {
                  const prev = i > 0 ? chartData[i - 1].close : b.close
                  return (
                    <Cell
                      key={b.date}
                      fill={b.close >= prev ? 'rgba(251,113,133,0.35)' : 'rgba(52,211,153,0.35)'}
                    />
                  )
                })}
              </Bar>
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={1.8}
                fill="url(#indexArea)"
                dot={false}
                activeDot={{ r: 3, fill: chartColor, stroke: '#0f172a' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 板块热度 + 市场宽度 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 热力板块排行 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <Flame className="h-4 w-4 text-amber-500" />
              热力板块排行 · 前十
            </h2>
            <span className="text-xs text-gray-400">按板块内个股平均涨跌幅（同花顺口径）</span>
          </div>
          <div className="space-y-2.5">
            {industryRows.map((row, i) => {
              const up = row.avgPct >= 0
              const widthPct = Math.max((Math.abs(row.avgPct) / maxAbsPct) * 100, 4)
              return (
                <div key={row.industry} className="flex items-center gap-3">
                  <span
                    className={`w-5 shrink-0 text-right font-mono text-xs tabular-nums ${
                      i < 3 ? 'text-amber-500' : 'text-gray-400'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="w-20 shrink-0 truncate text-sm text-gray-800">
                    {row.industry}
                  </span>
                  <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
                    <div
                      className={`h-full rounded ${
                        up
                          ? 'bg-gradient-to-r from-rose-500/50 to-rose-400/80'
                          : 'bg-gradient-to-r from-emerald-500/50 to-emerald-400/80'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span
                    className={`w-16 shrink-0 text-right font-mono text-xs tabular-nums ${pctColor(row.avgPct)}`}
                  >
                    {fmtPct(row.avgPct)}
                  </span>
                  <span className="hidden w-32 shrink-0 truncate text-right text-xs text-gray-400 sm:block">
                    领涨 <span className="text-gray-700">{row.leaderName}</span>{' '}
                    <span className={`font-mono tabular-nums ${pctColor(row.leaderPct)}`}>
                      {fmtPct(row.leaderPct)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 市场宽度 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Scale className="h-4 w-4 text-amber-500" />
            市场宽度
          </h2>

          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              上涨 <span className="font-mono tabular-nums text-rose-400">{upCount}</span> 家
            </span>
            <span className="text-gray-500">
              下跌 <span className="font-mono tabular-nums text-emerald-400">{downCount}</span> 家
            </span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
            <div className="bg-gradient-to-r from-rose-500/70 to-rose-400" style={{ width: `${upRatio}%` }} />
            <div
              className="bg-gradient-to-r from-emerald-400 to-emerald-500/70"
              style={{ width: `${100 - upRatio}%` }}
            />
          </div>
          <div className="mt-2 text-center font-mono text-xs tabular-nums text-gray-400">
            涨跌比 {upCount} : {downCount}
          </div>

          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-400">两市成交额合计</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-gray-900">
              {fmtNum(turnover, 0)}
              <span className="ml-1 text-sm font-normal text-gray-500">亿元</span>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-1.5 text-xs leading-relaxed text-gray-400">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
            <span>
              数据源：{meta?.source ?? '—'} · 快照时间 {meta?.fetchedAt ?? '—'} · 全市场{' '}
              {meta ? meta.stockCount.toLocaleString('zh-CN') : '—'} 只
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
