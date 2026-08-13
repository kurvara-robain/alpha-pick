// ─────────────────────────────────────────────────────────────
// V1.5 策略条件单步调试器
// 对指定股票和日期，逐条显示每个条件的通过/失败状态
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { CheckCircle2, Search, XCircle, Bug } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { getDB } from '@/lib/store'
import type { StrategyCondition } from '@/lib/types'

interface ConditionResult {
  condition: StrategyCondition
  passed: boolean
  actualValue: string
  detail: string
}

function debugCondition(s: UniverseStock, c: StrategyCondition): ConditionResult {
  const range = Array.isArray(c.value) ? (c.value as [number, number]) : null

  switch (c.field) {
    case 'pe': {
      const v = s.pe
      const passed = range
        ? v > range[0] && v < range[1]
        : c.op === '<' ? v < Number(c.value) : v > Number(c.value)
      return { condition: c, passed, actualValue: v > 0 ? v.toFixed(1) : '亏损', detail: `PE(TTM) = ${v > 0 ? v.toFixed(1) : '亏损'}` }
    }
    case 'pb': {
      const v = s.pb
      const passed = c.op === '<' ? v < Number(c.value) : v > Number(c.value)
      return { condition: c, passed, actualValue: v.toFixed(2), detail: `PB = ${v.toFixed(2)}` }
    }
    case 'mktCap': {
      const v = s.mktCap
      const passed = range
        ? v > range[0] && v < range[1]
        : c.op === '>' ? v > Number(c.value) : v < Number(c.value)
      return { condition: c, passed, actualValue: `${v.toLocaleString()}亿`, detail: `总市值 = ${v.toLocaleString()}亿元` }
    }
    case 'turnover': {
      const v = s.turnover
      const passed = c.op === '>' ? v > Number(c.value) : v < Number(c.value)
      return { condition: c, passed, actualValue: `${v}%`, detail: `换手率 = ${v}%` }
    }
    case 'exclude_st': {
      const passed = !s.name.includes('ST')
      return { condition: c, passed, actualValue: passed ? '非ST' : 'ST股', detail: `名称: ${s.name}` }
    }
    case 'exclude_subnew': {
      const t = new Date(`${s.listDate}T00:00:00`).getTime()
      const days = Number.isNaN(t) ? Infinity : (Date.now() - t) / (24 * 3600 * 1000)
      const passed = days >= 365
      return { condition: c, passed, actualValue: `上市${Math.floor(days)}天`, detail: `上市 ${Math.floor(days)} 天` }
    }
    case 'above_ma': {
      const passed = s.aboveMa20
      return { condition: c, passed, actualValue: passed ? '站上' : '跌破', detail: `现价${passed ? '站上' : '跌破'}20日均线` }
    }
    case 'mom_rank': {
      const w = c.window ?? 20
      const mom = w <= 30 ? s.mom20 : s.mom60
      const pct = c.value as number
      // 近似：如果动量 > 正阈值，则大概率在前 pct%
      const passed = mom > 0 && mom > (30 - pct / 3.3)
      return { condition: c, passed, actualValue: `${mom.toFixed(1)}%`, detail: `近${w}日动量 = ${mom.toFixed(1)}%` }
    }
    case 'mom_range': {
      const w = c.window ?? 20
      const mom = w <= 30 ? s.mom20 : s.mom60
      const passed = range ? mom > range[0] && mom < range[1] : true
      return { condition: c, passed, actualValue: `${mom.toFixed(1)}%`, detail: `近${w}日涨幅 = ${mom.toFixed(1)}%` }
    }
    case 'list_years': {
      const t = new Date(`${s.listDate}T00:00:00`).getTime()
      const years = Number.isNaN(t) ? Infinity : (Date.now() - t) / (365.25 * 24 * 3600 * 1000)
      const passed = years > Number(c.value)
      return { condition: c, passed, actualValue: `${years.toFixed(1)}年`, detail: `上市 ${years.toFixed(1)} 年` }
    }
    case 'aiScore': {
      const passed = s.aiScore > Number(c.value)
      return { condition: c, passed, actualValue: `${s.aiScore}`, detail: `AI评分 = ${s.aiScore}` }
    }
    case '__sort':
      return { condition: c, passed: true, actualValue: '排序指令', detail: '不参与过滤' }
    default:
      return { condition: c, passed: true, actualValue: '—', detail: `未知字段 ${c.field}` }
  }
}

export default function StrategyDebugger() {
  const universeState = useAsync(loadUniverse)
  const [stockQuery, setStockQuery] = useState('')
  const [selectedStock, setSelectedStock] = useState<UniverseStock | null>(null)
  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [open, setOpen] = useState(false)

  const db = getDB()
  const strategies = db.strategies.filter((s) => s.enabled)
  const universe = universeState.data ?? []

  const stockMatches = useMemo(() => {
    if (stockQuery.length < 1) return []
    const q = stockQuery.toLowerCase()
    return universe.filter((s) => s.code.includes(q) || s.name.toLowerCase().includes(q)).slice(0, 10)
  }, [stockQuery, universe])

  const strategy = strategies.find((s) => s.id === selectedStrategyId)
  const results = useMemo(() => {
    if (!selectedStock || !strategy) return []
    return strategy.conditions.map((c) => debugCondition(selectedStock, c))
  }, [selectedStock, strategy])

  const allPassed = results.length > 0 && results.every((r) => r.passed)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs">
        <Bug className="h-3.5 w-3.5" />调试条件
      </Button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Bug className="h-4 w-4 text-amber-500" />策略条件调试器
        </h3>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">收起</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="relative">
          <div className="flex items-center gap-2 rounded border border-gray-300 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-gray-400" />
            <Input
              className="border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
              placeholder="股票代码或名称…"
              value={selectedStock ? `${selectedStock.name} (${selectedStock.code})` : stockQuery}
              onChange={(e) => { setStockQuery(e.target.value); setSelectedStock(null); setShowResults(true) }}
              onFocus={() => setShowResults(true)}
            />
          </div>
          {showResults && stockMatches.length > 0 && !selectedStock && (
            <div className="absolute z-50 mt-1 max-h-40 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
              {stockMatches.map((s) => (
                <button key={s.code} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-amber-50"
                  onClick={() => { setSelectedStock(s); setShowResults(false) }}>
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="font-mono text-gray-400">{s.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <select
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
          value={selectedStrategyId}
          onChange={(e) => setSelectedStrategyId(e.target.value)}
        >
          <option value="">选择策略…</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* 结果表格 */}
      {selectedStock && strategy && results.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className={allPassed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'}>
              {allPassed ? '✓ 全部通过' : '✗ 未入选'}
            </Badge>
            <span className="text-xs text-gray-400">
              {selectedStock.name} · 策略「{strategy.name}」· {results.filter((r) => r.passed).length}/{results.length} 通过
            </span>
          </div>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">条件</th>
                  <th className="px-3 py-2 font-medium w-16 text-center">状态</th>
                  <th className="px-3 py-2 font-medium">实际值</th>
                  <th className="px-3 py-2 font-medium">详情</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${r.passed ? 'hover:bg-emerald-50/50' : 'bg-rose-50/30 hover:bg-rose-50/50'}`}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.condition.raw}</td>
                    <td className="px-3 py-2 text-center">
                      {r.passed ? (
                        <CheckCircle2 className="inline h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="inline h-4 w-4 text-rose-500" />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-gray-700">{r.actualValue}</td>
                    <td className="px-3 py-2 text-gray-500">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!selectedStock && (
        <div className="mt-4 rounded border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
          选择股票和策略后，查看每条条件的通过/失败详情
        </div>
      )}
    </div>
  )
}
