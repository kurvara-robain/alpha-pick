// ─────────────────────────────────────────────────────────────
// 自选股面板 — Bloomberg 紧凑表格风格
// 嵌入 Zettaranc 页面顶部，支持增删 + 行情追踪
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Star, ChevronDown, ChevronUp, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import {
  getWatchlist, addToWatchlist, removeFromWatchlist, computeSnapshots,
  type TrackedStock, type TrackedStockSnapshot,
} from '@/lib/watchlistStore'

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

interface WatchlistPanelProps {
  universe?: { code: string; name?: string; price: number; changePct: number }[]
  onSelectForScan?: (codes: string[]) => void
  selectedForScan?: string[]
}

const EMPTY_UNIVERSE: { code: string; name?: string; price: number; changePct: number }[] = []

export default function WatchlistPanel({ universe = EMPTY_UNIVERSE, onSelectForScan, selectedForScan = [] }: WatchlistPanelProps) {
  const [expanded, setExpanded] = useState(true)
  const [stocks, setStocks] = useState<TrackedStock[]>([])
  const [snapshots, setSnapshots] = useState<TrackedStockSnapshot[]>([])
  const [addCode, setAddCode] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [adding, setAdding] = useState(false)

  // 加载自选股
  const refresh = useCallback(() => {
    const list = getWatchlist()
    setStocks(list)
    if (universe.length > 0) {
      setSnapshots(computeSnapshots(list, universe))
    } else {
      setSnapshots(list.map(s => ({
        ...s, currentPrice: null, dailyChange: null, totalReturn: null, holdingDays: Math.floor((Date.now() - new Date(s.addedAt).getTime()) / 86400000),
      })))
    }
  }, [universe])

  useEffect(() => { refresh() }, [refresh])

  // 添加
  const handleAdd = () => {
    const code = addCode.trim().toUpperCase()
    if (!code || code.length < 6) return
    const price = parseFloat(addPrice) || 0
    // 尝试从 universe 匹配名称
    const match = universe.find(u => u.code === code || u.code.includes(code))
    const name = match?.name ?? code
    addToWatchlist(code, name, price)
    setAddCode('')
    setAddPrice('')
    setAdding(false)
    refresh()
  }

  // 全选/取消全选 扫描
  const allCodes = snapshots.map(s => s.code)
  const allSelected = allCodes.length > 0 && allCodes.every(c => selectedForScan.includes(c))
  const toggleSelectAll = () => {
    if (allSelected) onSelectForScan?.([])
    else onSelectForScan?.(allCodes)
  }

  if (stocks.length === 0 && !adding) {
    return (
      <div className="rounded border border-dashed border-gray-300 bg-gray-50/50 p-3">
        <button
          className="flex w-full items-center gap-2 text-xs text-gray-400 hover:text-amber-600 transition-colors"
          onClick={() => setAdding(true)}
        >
          <Star size={14} />
          <span>添加自选股 — 输入股票代码即可追踪</span>
          <Plus size={12} className="ml-auto" />
        </button>
      </div>
    )
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <button className="flex items-center gap-2" onClick={() => setExpanded(!expanded)}>
          <ListChecks size={14} className="text-amber-500" />
          <span className="text-xs font-semibold text-gray-600">我的自选</span>
          <Badge variant="outline" className="text-[10px]">{stocks.length} 只</Badge>
          {expanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </button>
        <div className="flex items-center gap-2">
          {onSelectForScan && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={toggleSelectAll}>
              {allSelected ? '取消全选' : '全选扫描'}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setAdding(!adding)}>
            <Plus size={12} className="mr-0.5" />添加
          </Button>
        </div>
      </div>

      {/* 添加表单 */}
      {adding && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-amber-50/30">
          <Input
            className="h-7 w-28 text-xs font-mono"
            placeholder="000001.SZ"
            value={addCode}
            onChange={e => setAddCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <Input
            className="h-7 w-20 text-xs"
            placeholder="价格"
            value={addPrice}
            onChange={e => setAddPrice(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>确认</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>取消</Button>
        </div>
      )}

      {/* 表格 */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400">
                {onSelectForScan && <th className="pb-1.5 px-1 w-6 text-center font-medium">扫</th>}
                <th className="pb-1.5 px-2 text-left font-medium">代码</th>
                <th className="pb-1.5 px-2 text-left font-medium">名称</th>
                <th className="pb-1.5 px-2 text-right font-medium">添加价</th>
                <th className="pb-1.5 px-2 text-right font-medium">现价</th>
                <th className="pb-1.5 px-2 text-right font-medium">日涨跌</th>
                <th className="pb-1.5 px-2 text-right font-medium">累计收益</th>
                <th className="pb-1.5 px-2 text-right font-medium">持有</th>
                <th className="pb-1.5 px-1 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.code} className="border-b border-gray-50 hover:bg-amber-50/20 transition-colors">
                  {onSelectForScan && (
                    <td className="py-1.5 px-1 text-center">
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-amber-500"
                        checked={selectedForScan.includes(s.code)}
                        onChange={() => {
                          const next = selectedForScan.includes(s.code)
                            ? selectedForScan.filter(c => c !== s.code)
                            : [...selectedForScan, s.code]
                          onSelectForScan(next)
                        }}
                      />
                    </td>
                  )}
                  <td className="py-1.5 px-2 font-mono tabular-nums text-gray-700">{s.code}</td>
                  <td className="py-1.5 px-2 text-gray-600">{s.name}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-gray-500">{s.addedPrice ? fmtNum(s.addedPrice) : '-'}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">{s.currentPrice ? fmtNum(s.currentPrice) : '—'}</td>
                  <td className={cn('py-1.5 px-2 text-right font-mono tabular-nums', pctColor(s.dailyChange ?? 0))}>
                    {s.dailyChange != null ? fmtPct(s.dailyChange) : '—'}
                  </td>
                  <td className={cn('py-1.5 px-2 text-right font-mono tabular-nums font-semibold', pctColor(s.totalReturn ?? 0))}>
                    {s.totalReturn != null ? fmtPct(s.totalReturn) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right text-gray-400">{s.holdingDays}天</td>
                  <td className="py-1.5 px-1 text-center">
                    <button onClick={() => { removeFromWatchlist(s.code); refresh() }} className="text-gray-300 hover:text-rose-500">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
