// P7 持仓诊股：持仓录入 / 持仓列表 / 技术分析诊断（非量化信号）
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import {
  AlertTriangle,
  Briefcase,
  Loader2,
  Plus,
  RefreshCw,
  Stethoscope,
  Trash2,
  Wallet,
  Waves,
  X,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import ChanChart from '@/components/ChanChart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDB, subscribeDB, uid, updateDB } from '@/lib/store'
import { analyzeChan, diagnoseHolding } from '@/lib/api'
import { loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import type { ChanAnalysis, DiagnosisAdvice, Holding } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PortfolioRisk, LazyLoader } from '@/components/LazyComponents'

function useDB() {
  return useSyncExternalStore(subscribeDB, getDB)
}

const adviceStyle: Record<DiagnosisAdvice, string> = {
  继续持有: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  卖出: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
  等待观察: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
}

const chanTrend: Record<ChanAnalysis['trend'], { label: string; cls: string }> = {
  up: { label: '上升趋势', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  down: { label: '下降趋势', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  consolidation: { label: '中枢震荡', cls: 'border-violet-500/40 bg-violet-500/10 text-violet-300' },
}

function HoldingCard({ h, stock }: { h: Holding; stock: UniverseStock | null }) {
  const [loading, setLoading] = useState(false)
  const [diagError, setDiagError] = useState('')
  const [chanLoading, setChanLoading] = useState(false)
  const [chanError, setChanError] = useState('')
  const price = stock?.price ?? 0
  const mktValue = price * h.shares
  const costValue = h.cost * h.shares
  const pnl = mktValue - costValue
  const pnlPct = costValue > 0 ? (pnl / costValue) * 100 : 0

  const onDiagnose = async () => {
    setLoading(true)
    setDiagError('')
    try {
      const d = await diagnoseHolding(h.code)
      updateDB((db) => {
        const target = db.holdings.find((x) => x.id === h.id)
        if (target) target.diagnosis = d
      })
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : '诊断失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const onChan = async () => {
    setChanLoading(true)
    setChanError('')
    try {
      const r = await analyzeChan(h.code)
      if (!r) {
        setChanError('K线数据正在升级，请稍后重试')
        return
      }
      updateDB((db) => {
        const target = db.holdings.find((x) => x.id === h.id)
        if (target) target.chanAnalysis = r
      })
    } finally {
      setChanLoading(false)
    }
  }

  const onRemove = () => {
    updateDB((db) => {
      db.holdings = db.holdings.filter((x) => x.id !== h.id)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-900">{h.name}</span>
            <span className="font-mono text-xs text-gray-400">{h.code}</span>
            {h.diagnosis && (
              <Badge variant="outline" className={adviceStyle[h.diagnosis.advice]}>
                {h.diagnosis.advice}
              </Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            添加于 {new Date(h.addedAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={onDiagnose}
            className="border-cyan-500/30 text-amber-500 hover:bg-amber-100 hover:text-amber-500"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : h.diagnosis ? (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Stethoscope className="mr-1.5 h-3.5 w-3.5" />
            )}
            {loading ? '诊断中…' : h.diagnosis ? '重新诊断' : '诊断'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={chanLoading}
            onClick={onChan}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
          >
            {chanLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Waves className="mr-1.5 h-3.5 w-3.5" />
            )}
            {chanLoading ? '分析中…' : h.chanAnalysis ? '重新分析' : '缠论分析'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            className="text-gray-400 hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {diagError && <p className="mt-2 text-xs text-rose-400">{diagError}</p>}
      {chanError && <p className="mt-2 text-xs text-violet-300">{chanError}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: '成本价', value: `¥ ${fmtNum(h.cost)}`, cls: 'text-gray-700' },
          { label: '现价', value: `¥ ${fmtNum(price)}`, cls: 'text-gray-900' },
          { label: '持仓股数', value: fmtNum(h.shares, 0), cls: 'text-gray-700' },
          { label: '市值', value: `¥ ${fmtNum(mktValue)}`, cls: 'text-gray-900' },
          { label: '浮动盈亏', value: `${pnl >= 0 ? '+' : ''}¥ ${fmtNum(pnl)}`, cls: pctColor(pnl) },
          { label: '盈亏比例', value: fmtPct(pnlPct), cls: pctColor(pnlPct) },
        ].map((it) => (
          <div key={it.label} className="rounded-lg border border-gray-200/60 bg-gray-50 px-3 py-2">
            <div className="text-[11px] text-gray-400">{it.label}</div>
            <div className={`mt-0.5 font-mono text-sm tabular-nums ${it.cls}`}>{it.value}</div>
          </div>
        ))}
      </div>

      {h.diagnosis && (
        <div className="mt-4 rounded-lg border border-gray-200/60 bg-gray-50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-500">诊断结论 · 技术分析辅助判断</span>
            <span className="font-mono text-[11px] text-gray-300">
              {new Date(h.diagnosis.updatedAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {h.diagnosis.reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/70" />
                {r}
              </li>
            ))}
          </ul>
          {h.diagnosis.factorSignals && h.diagnosis.factorSignals.length > 0 && (
            <div className="mt-3 border-t border-gray-200/60 pt-3">
              <span className="text-xs font-medium text-amber-500/80">
                量化信号 · 全市场截面百分位
              </span>
              <ul className="mt-1.5 space-y-1">
                {h.diagnosis.factorSignals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-cyan-200/80">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-300/60" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3 border-t border-gray-200/60 pt-3">
            <span className="text-xs text-gray-400">
              支撑位：
              <span className="ml-1 font-mono tabular-nums text-emerald-400">
                {fmtNum(h.diagnosis.keyLevels.support)}
              </span>
            </span>
            <span className="text-xs text-gray-400">
              阻力位：
              <span className="ml-1 font-mono tabular-nums text-rose-400">
                {fmtNum(h.diagnosis.keyLevels.resistance)}
              </span>
            </span>
          </div>
        </div>
      )}

      {h.chanAnalysis && (
        <div className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-violet-300">
              缠论分析 · 缠中说禅技术体系
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-gray-300">
                {new Date(h.chanAnalysis.updatedAt).toLocaleString('zh-CN')}
              </span>
              <button
                type="button"
                disabled={chanLoading}
                onClick={onChan}
                className="text-xs text-violet-400 transition-colors hover:text-violet-300 disabled:opacity-50"
              >
                {chanLoading ? '分析中…' : '重新分析'}
              </button>
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-violet-100">
            {h.chanAnalysis.conclusion}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Badge variant="outline" className={chanTrend[h.chanAnalysis.trend].cls}>
              {chanTrend[h.chanAnalysis.trend].label}
            </Badge>
            {h.chanAnalysis.zhongshu && (
              <Badge
                variant="outline"
                className="border-violet-500/40 bg-violet-500/10 font-mono tabular-nums text-violet-300"
              >
                中枢 {fmtNum(h.chanAnalysis.zhongshu.zd)} ~ {fmtNum(h.chanAnalysis.zhongshu.zg)}
              </Badge>
            )}
            {h.chanAnalysis.buySellPoint && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-300"
              >
                {h.chanAnalysis.buySellPoint}
              </Badge>
            )}
            {h.chanAnalysis.divergence && (
              <Badge
                variant="outline"
                className="border-rose-500/40 bg-rose-500/10 text-rose-300"
              >
                {h.chanAnalysis.divergence === 'top' ? '顶背驰' : '底背驰'}
              </Badge>
            )}
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {h.chanAnalysis.signals.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70" />
                {s}
              </li>
            ))}
          </ul>
          <ChanChart code={h.code} analysis={h.chanAnalysis} />
          <div className="mt-3 flex flex-wrap gap-3 border-t border-violet-500/20 pt-3">
            <span className="text-xs text-gray-400">
              支撑位：
              <span className="ml-1 font-mono tabular-nums text-emerald-400">
                {fmtNum(h.chanAnalysis.keyLevels.support)}
              </span>
            </span>
            <span className="text-xs text-gray-400">
              阻力位：
              <span className="ml-1 font-mono tabular-nums text-rose-400">
                {fmtNum(h.chanAnalysis.keyLevels.resistance)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

const MAX_OPTIONS = 30 // 下拉候选最多渲染条数（全 A 5000+ 只，避免 DOM 爆炸）

/**
 * 可搜索股票组合框：名称/代码模糊搜索（code 支持只输数字段），
 * 键盘 ↓/↑ 移动、Enter 选中、Esc 收起，失焦延迟收起以允许鼠标点击。
 */
function StockCombobox({
  universe,
  selected,
  onSelect,
}: {
  universe: UniverseStock[]
  selected: UniverseStock | null
  onSelect: (s: UniverseStock | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return universe.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    )
  }, [query, universe])
  const shown = matches.slice(0, MAX_OPTIONS)
  const active = Math.min(highlight, Math.max(shown.length - 1, 0))
  const expanded = open && !selected && query.trim().length > 0

  const choose = (s: UniverseStock) => {
    onSelect(s)
    setQuery('')
    setOpen(false)
    setHighlight(0)
  }

  const clear = () => {
    onSelect(null)
    setQuery('')
    setHighlight(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (selected) {
      // 已选中时输入可打印字符：清空选择并以该字符开始新搜索
      if (e.key.length === 1) {
        e.preventDefault()
        onSelect(null)
        setQuery(e.key)
        setOpen(true)
        setHighlight(0)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        clear()
      }
      return
    }
    if (e.key === 'ArrowDown' && shown.length > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlight((active + 1) % shown.length)
    } else if (e.key === 'ArrowUp' && shown.length > 0) {
      e.preventDefault()
      setHighlight((active - 1 + shown.length) % shown.length)
    } else if (e.key === 'Enter') {
      if (expanded && shown.length > 0) {
        e.preventDefault()
        choose(shown[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Input
        value={selected ? `${selected.name}（${selected.code}）` : query}
        onChange={(e) => {
          if (selected) return // 已选中时的改写在 onKeyDown 中处理
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="输入股票名称 / 代码搜索，如 茅台 或 600519"
        className="border-gray-300 bg-gray-100/50 pr-8 text-gray-800 placeholder:text-gray-300"
      />
      {(selected || query) && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          aria-label="清空选择"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {expanded && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-sm">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-gray-400">未找到匹配股票</p>
          ) : (
            <>
              <p className="border-b border-gray-200 px-3 py-1.5 text-[11px] text-gray-400">
                共 {matches.length} 只匹配
                {matches.length > MAX_OPTIONS ? `，显示前 ${MAX_OPTIONS}` : ''}
              </p>
              {shown.map((s, i) => (
                <button
                  key={s.code}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(s)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm',
                    i === active ? 'bg-amber-100 text-cyan-200' : 'text-gray-800',
                  )}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="font-mono text-xs text-gray-400">{s.code}</span>
                  <span className="ml-auto font-mono text-xs tabular-nums text-gray-500">
                    ¥ {fmtNum(s.price)}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function HoldingsPage() {  const db = useDB()
  const [code, setCode] = useState('')
  const [cost, setCost] = useState('')
  const [shares, setShares] = useState('')
  const [formError, setFormError] = useState('')
  const universeState = useAsync(loadUniverse)

  // 全 A 股票池按 code 索引，用于持仓现价与股票选择
  const universe = useMemo(() => universeState.data ?? [], [universeState.data])
  const stockMap = useMemo(() => {
    const m = new Map<string, UniverseStock>()
    for (const u of universe) m.set(u.code, u)
    return m
  }, [universe])
  const selectedStock = code ? (stockMap.get(code) ?? null) : null

  // 选中股票：记录代码并自动把现价填入成本价（用户可改）
  const onSelectStock = (s: UniverseStock | null) => {
    setCode(s?.code ?? '')
    if (s) setCost(String(s.price))
  }

  // 总览数值：updateDB 原地修改 holdings 数组（引用不变），不能用 useMemo 依赖数组引用，直接每次渲染重算
  const totals = (() => {
    let mkt = 0
    let pnl = 0
    for (const h of db.holdings) {
      const price = stockMap.get(h.code)?.price ?? 0
      mkt += price * h.shares
      pnl += (price - h.cost) * h.shares
    }
    return { mkt, pnl }
  })()

  const onAdd = () => {
    setFormError('')
    const stock = stockMap.get(code)
    const costNum = Number(cost)
    const sharesNum = Number(shares)
    if (!stock) return setFormError('请选择股票')
    if (!cost || costNum <= 0) return setFormError('请输入有效的成本价')
    if (!shares || sharesNum <= 0 || !Number.isInteger(sharesNum))
      return setFormError('请输入有效的持仓股数（正整数）')
    updateDB((d) => {
      d.holdings.push({
        id: uid(),
        code: stock.code,
        name: stock.name,
        cost: costNum,
        shares: sharesNum,
        addedAt: new Date().toISOString(),
      })
    })
    setCode('')
    setCost('')
    setShares('')
  }

  if (universeState.loading) {
    return (
      <div className="space-y-5">
        <LoadingBlock text="股票池数据加载中…" />
      </div>
    )
  }
  if (universeState.error) {
    return (
      <div className="space-y-5">
        <ErrorBlock error={universeState.error} onRetry={universeState.reload} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 免责声明横幅 */}
      <Alert className="border-amber-500/40 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <AlertTitle className="text-amber-300">免责声明</AlertTitle>
        <AlertDescription className="text-amber-200/80">
          本页建议属于技术分析辅助判断，非量化系统信号，最终决策由您自行做出。
        </AlertDescription>
      </Alert>

      {/* 持仓录入表单 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-800">
          <Plus className="h-4 w-4 text-amber-500" />
          添加持仓
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_auto]">
          <StockCombobox
            universe={universe}
            selected={selectedStock}
            onSelect={onSelectStock}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="成本价（元）"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="border-gray-300 bg-gray-100/50 font-mono text-gray-800"
          />
          <Input
            type="number"
            min="0"
            step="1"
            placeholder="持仓股数"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="border-gray-300 bg-gray-100/50 font-mono text-gray-800"
          />
          <Button onClick={onAdd} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
            <Plus className="mr-1 h-4 w-4" />
            添加持仓
          </Button>
        </div>
        {formError && <p className="mt-2 text-xs text-rose-400">{formError}</p>}
      </div>

      {/* 持仓总览条 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Briefcase className="h-3.5 w-3.5" />
            持仓数量
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-gray-900">
            {db.holdings.length} <span className="text-sm font-normal text-gray-400">只</span>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Wallet className="h-3.5 w-3.5" />
            总市值
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-gray-900">
            ¥ {fmtNum(totals.mkt)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">总浮动盈亏</div>
          <div className={`mt-1 font-mono text-xl font-semibold tabular-nums ${pctColor(totals.pnl)}`}>
            {totals.pnl >= 0 ? '+' : ''}¥ {fmtNum(totals.pnl)}
          </div>
        </div>
      </div>

      {/* 持仓列表 */}
      {db.holdings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/40 p-10 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">还没有持仓记录</p>
          <p className="mt-1 text-xs text-gray-400">通过上方表单录入您的持仓，即可进行技术诊断</p>
        </div>
      ) : (
        <div className="space-y-3">
          {db.holdings.map((h) => (
            <HoldingCard key={h.id} h={h} stock={stockMap.get(h.code) ?? null} />
          ))}
        </div>
      )}

      <LazyLoader><PortfolioRisk /></LazyLoader>
    </div>
  )
}
