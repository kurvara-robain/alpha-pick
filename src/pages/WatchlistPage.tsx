// ─────────────────────────────────────────────────────────────
// P5 备选清单：查看由「组合工作台」生成的选股清单
// 展示入选原因（策略条件 × 因子命中）与个股近 60 日行情
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCandlestick, ChevronDown, ListChecks, Trash2 } from 'lucide-react'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fmtNum, fmtPct, pctBg, pctColor } from '@/lib/format'
import { loadKline, loadUniverse, universeToStock } from '@/lib/marketData'
import type { Stock } from '@/lib/mockData'
import { useAsync } from '@/lib/useAsync'
import { useAutoRefresh } from '@/lib/autoRefresh'
import { getDB, subscribeDB, updateDB } from '@/lib/store'
import type { DB } from '@/lib/store'
import type { WatchItem, WatchList } from '@/lib/types'

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
} as const

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

/** 个股近 60 日收盘价走势图（红涨绿跌），日线异步加载 */
function StockKline({ stock }: { stock: Stock }) {
  const {
    data: closes,
    loading,
    error,
    reload,
  } = useAsync(() => loadKline(stock.code).then((k) => k.closes.slice(-60)), [stock.code])
  const up = stock.changePct >= 0
  const color = up ? '#fb7185' : '#34d399' // rose-400 / emerald-400
  const gradId = `grad-${stock.code.replace(/[^a-zA-Z0-9]/g, '')}`
  const data = (closes ?? []).map((close, i) => ({ day: i + 1, close }))
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>
          现价{' '}
          <span className="font-mono tabular-nums text-gray-900">{fmtNum(stock.price)}</span>
        </span>
        <span>
          涨跌幅{' '}
          <span className={`font-mono tabular-nums ${pctColor(stock.changePct)}`}>
            {fmtPct(stock.changePct)}
          </span>
        </span>
        <span>
          所属行业 <span className="text-gray-900">{stock.industry}</span>
        </span>
        <span className="text-gray-400">近 60 日收盘价</span>
      </div>
      {loading ? (
        <div className="flex h-44 w-full items-center justify-center gap-2 text-xs text-gray-400">
          <Spinner className="size-4 text-amber-500" />
          日线数据加载中…
        </div>
      ) : error ? (
        <div className="flex h-44 w-full flex-col items-center justify-center gap-2 text-xs text-rose-300">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="h-7 border-rose-500/40 px-2 text-xs text-rose-300 hover:bg-rose-500/10"
          >
            重试
          </Button>
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
                interval={14}
              />
              <YAxis
                domain={['dataMin', 'dataMax']}
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => fmtNum(v, v >= 100 ? 0 : 1)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value) => [fmtNum(Number(value)), '收盘价']}
                labelFormatter={(label) => `第 ${label} 个交易日`}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={color}
                strokeWidth={1.8}
                fill={`url(#${gradId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/** 清单中的单只股票卡片：入选原因 + 可展开 K 线 */
function WatchItemCard({ item, stock }: { item: WatchItem; stock: Stock | null }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{item.name}</span>
          <span className="font-mono text-xs tabular-nums text-gray-400">{item.code}</span>
          {stock && (
            <>
              <Badge variant="outline" className="border-gray-300 text-gray-500">
                {stock.industry}
              </Badge>
              <span className="ml-auto font-mono text-sm tabular-nums text-gray-900">
                {fmtNum(stock.price)}
              </span>
              <Badge variant="outline" className={`font-mono tabular-nums ${pctBg(stock.changePct)}`}>
                {fmtPct(stock.changePct)}
              </Badge>
            </>
          )}
        </div>

        {/* 入选原因：触发的策略条件与因子（逐条展示） */}
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-gray-400">入选原因</div>
          <ul className="space-y-1.5">
            {item.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 h-7 px-2 text-xs text-amber-500 hover:text-amber-500"
          >
            <ChartCandlestick className="size-3.5" />
            {open ? '收起行情' : '查看 K 线'}
            <ChevronDown
              className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {stock ? (
            <StockKline stock={stock} />
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-gray-300 py-6 text-center text-xs text-gray-400">
              暂无行情数据（该股票不在样本池内）
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <ListChecks className="size-5 text-amber-500" />
      <div>
        <h1 className="text-lg font-semibold text-gray-900">备选清单</h1>
        <p className="text-xs text-gray-400">
          由「组合工作台」策略 × 因子筛选生成的股票观察池，含入选原因与行情快照
        </p>
      </div>
    </div>
  )
}

export default function WatchlistPage() {
  const [db, setDb] = useState<DB>(() => getDB())
  const [selectedId, setSelectedId] = useState<string>('')
  const { data: universeData, lastUpdated, refresh: refreshUniverse } = useAutoRefresh(loadUniverse, 30_000)

  useEffect(() => subscribeDB(() => setDb(getDB())), [])

  // 全 A 股票池按 code 索引（映射为 UI 消费的 Stock 形状）
  const stockMap = useMemo(() => {
    const m = new Map<string, Stock>()
    for (const u of universeData ?? []) m.set(u.code, universeToStock(u))
    return m
  }, [universeData])

  const lists = db.watchlists
  const selected: WatchList | null = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null

  const strategyNames = (ids: string[]) =>
    ids.map((id) => db.strategies.find((s) => s.id === id)?.name ?? id)
  const factorNames = (ids: string[]) => ids.map((id) => db.factors.find((f) => f.id === id)?.name ?? id)

  const removeList = (id: string) => {
    updateDB((d) => {
      d.watchlists = d.watchlists.filter((l) => l.id !== id)
    })
    if (selectedId === id) setSelectedId('')
  }

  // 行情数据加载 / 错误态
  if (universeState.loading) {
    return (
      <div className="space-y-5 p-6">
        <PageHeader />
        <LoadingBlock text="股票池数据加载中…" />
      </div>
    )
  }
  if (universeState.error) {
    return (
      <div className="space-y-5 p-6">
        <PageHeader />
        <ErrorBlock error={universeState.error} onRetry={universeState.reload} />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-6">
      {/* 页头 */}
      <PageHeader />

      {lists.length === 0 ? (
        /* 空状态：引导去组合工作台 */
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 bg-white py-16">
          <ListChecks className="size-10 text-gray-300" />
          <div className="text-center">
            <p className="text-sm text-gray-700">还没有任何备选清单</p>
            <p className="mt-1 text-xs text-gray-400">
              前往「组合工作台」选择策略与因子，运行筛选后即可生成清单
            </p>
          </div>
          <Button asChild className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
            <Link to="/workbench">前往组合工作台</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* 清单选择器 */}
          <Tabs value={selected?.id ?? ''} onValueChange={setSelectedId}>
            <div className="overflow-x-auto">
              <TabsList className="w-max">
                {lists.map((l) => (
                  <TabsTrigger key={l.id} value={l.id} className="gap-1.5">
                    {l.name}
                    <span className="font-mono text-[10px] tabular-nums text-gray-400">
                      {l.items.length}只
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          {selected && (
            <>
              {/* 清单信息头：来源标注 + 删除 */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{selected.name}</div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      创建于 {fmtTime(selected.createdAt)} · 共 {selected.items.length} 只股票
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => removeList(selected.id)}
                  >
                    <Trash2 className="size-3.5" />
                    删除清单
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-gray-400">清单来源：</span>
                  {strategyNames(selected.strategyIds).map((n) => (
                    <Badge
                      key={`s-${n}`}
                      variant="outline"
                      className="border-cyan-500/30 bg-amber-100 text-amber-500"
                    >
                      策略 · {n}
                    </Badge>
                  ))}
                  {factorNames(selected.factorIds).map((n) => (
                    <Badge
                      key={`f-${n}`}
                      variant="outline"
                      className="border-violet-500/30 bg-violet-500/10 text-violet-300"
                    >
                      因子 · {n}
                    </Badge>
                  ))}
                  {selected.strategyIds.length === 0 && selected.factorIds.length === 0 && (
                    <span className="text-gray-400">未记录来源</span>
                  )}
                </div>
              </div>

              {/* 股票列表 */}
              {selected.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-xs text-gray-400">
                  该清单暂无股票
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {selected.items.map((item) => (
                    <WatchItemCard key={item.code} item={item} stock={stockMap.get(item.code) ?? null} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
