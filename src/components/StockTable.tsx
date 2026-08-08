import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Star, StarOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Signal, Stock } from '@/lib/mockData'
import { fmtPct, pctBg, pctColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import Sparkline from './Sparkline'

type SortKey = 'aiScore' | 'changePct'

interface StockTableProps {
  stocks: Stock[]
  watchlist: Set<string>
  onToggleWatch: (code: string) => void
  onSelect: (stock: Stock) => void
  scanning: boolean
}

const SIGNAL_STYLE: Record<Signal, string> = {
  强烈买入: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  买入: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
  持有: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  观望: 'border-gray-400 bg-slate-700/30 text-gray-500',
}

function scoreColor(score: number): string {
  if (score >= 85) return 'from-rose-500 to-orange-400'
  if (score >= 70) return 'from-amber-500 to-yellow-400'
  return 'from-slate-500 to-slate-400'
}

export default function StockTable({ stocks, watchlist, onToggleWatch, onSelect, scanning }: StockTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('aiScore')
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = [...stocks].sort((a, b) => {
    const d = a[sortKey] - b[sortKey]
    return sortDesc ? -d : d
  })

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc(!sortDesc)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const SortIcon = ({ col }: { col: SortKey }) =>
    col !== sortKey ? (
      <ChevronsUpDown className="ml-1 inline h-3 w-3 text-gray-300" />
    ) : sortDesc ? (
      <ArrowDown className="ml-1 inline h-3 w-3 text-amber-500" />
    ) : (
      <ArrowUp className="ml-1 inline h-3 w-3 text-amber-500" />
    )

  return (
    <section id="ranking" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-12 sm:px-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">AI 选股榜单</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            共 <span className="font-mono text-amber-500">{sorted.length}</span> 只候选股 · 点击任意行查看 AI 深度解读
          </p>
        </div>
      </div>

      <div
        className={cn(
          'overflow-x-auto rounded-2xl border border-gray-200 bg-white transition-opacity',
          scanning && 'pointer-events-none opacity-40',
        )}
      >
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">股票</th>
              <th className="cursor-pointer select-none px-4 py-3 font-medium hover:text-gray-700" onClick={() => toggleSort('changePct')}>
                现价 / 涨跌幅 <SortIcon col="changePct" />
              </th>
              <th className="cursor-pointer select-none px-4 py-3 font-medium hover:text-gray-700" onClick={() => toggleSort('aiScore')}>
                AI 评分 <SortIcon col="aiScore" />
              </th>
              <th className="px-4 py-3 font-medium">信号</th>
              <th className="px-4 py-3 font-medium">命中因子</th>
              <th className="px-4 py-3 font-medium">预期胜率</th>
              <th className="px-4 py-3 font-medium">近 20 日</th>
              <th className="px-4 py-3 text-right font-medium">自选</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  当前筛选条件下没有命中的股票，试试放宽条件后重新运行
                </td>
              </tr>
            )}
            {sorted.map((s, i) => (
              <tr
                key={s.code}
                onClick={() => onSelect(s)}
                className="cursor-pointer border-b border-gray-200/60 transition-colors last:border-0 hover:bg-gray-200/40"
              >
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-900">{s.name}</div>
                  <div className="font-mono text-xs text-gray-400">
                    {s.code} · {s.industry}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono tabular-nums text-gray-800">{s.price.toFixed(2)}</div>
                  <div className={`font-mono text-xs tabular-nums ${pctColor(s.changePct)}`}>{fmtPct(s.changePct)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 font-mono text-sm font-bold tabular-nums text-gray-900">{s.aiScore}</span>
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={cn('h-full rounded-full bg-gradient-to-r', scoreColor(s.aiScore))}
                        style={{ width: `${s.aiScore}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={SIGNAL_STYLE[s.signal]}>
                    {s.signal}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.factors.length === 0 && <span className="text-xs text-gray-300">—</span>}
                    {s.factors.map((f) => (
                      <span key={f} className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                        {f}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-gray-700">{s.winRate}%</td>
                <td className="px-4 py-3">
                  <Sparkline data={s.series.slice(-20)} positive={s.changePct >= 0} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    aria-label="加自选"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleWatch(s.code)
                    }}
                    className="rounded-md p-1.5 transition-colors hover:bg-slate-700/60"
                  >
                    {watchlist.has(s.code) ? (
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ) : (
                      <StarOff className="h-4 w-4 text-gray-300" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['强烈买入', '买入', '持有', '观望'] as Signal[]).map((sig) => {
            const n = sorted.filter((s) => s.signal === sig).length
            return n > 0 ? (
              <span key={sig} className={cn('rounded-full border px-2 py-0.5 text-[11px]', pctBg(sig === '观望' ? 0 : 1), 'border-gray-300 bg-gray-200/50 text-gray-500')}>
                {sig} {n} 只
              </span>
            ) : null
          })}
        </div>
      )}
    </section>
  )
}
