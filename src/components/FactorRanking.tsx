// ─────────────────────────────────────────────────────────────
// P2 因子排行榜 + 相关性矩阵 — 替代卡片目录
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

interface FactorScore {
  id: string
  name: string
  category: string
  origin: string
  ic: number         // 方向化 IC
  icir: number       // ICIR
  coverage: number   // 0-1
  decay: number      // 半衰期（天）
  sharpe: number     // 多空Sharpe
  turnover: number   // 换手率估计
}

interface FactorCorrelation {
  id1: string
  id2: string
  correlation: number
}

interface FactorRankingProps {
  factors: FactorScore[]
  correlations?: FactorCorrelation[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
}

export function FactorRanking({ factors, correlations, selectedIds, onToggle }: FactorRankingProps) {
  const [sortBy, setSortBy] = useState<'ic'|'icir'|'coverage'|'decay'>('ic')
  const [category, setCategory] = useState('all')

  const categories = useMemo(() => ['all', ...new Set(factors.map(f => f.category))], [factors])
  const filtered = useMemo(() => {
    const list = category === 'all' ? factors : factors.filter(f => f.category === category)
    return [...list].sort((a,b) => Math.abs(b[sortBy]) - Math.abs(a[sortBy]))
  }, [factors, sortBy, category])

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <h3 className="text-sm font-semibold text-gray-900">因子排行榜</h3>
        <div className="flex items-center gap-2">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={cn('text-[10px] px-2 py-0.5 rounded', category === c ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-100')}>
              {c === 'all' ? '全部' : c}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-[10px] text-gray-400">
              <th className="px-3 py-1.5 text-left font-medium w-6">#</th>
              <th className="px-2 py-1.5 text-left font-medium">因子</th>
              <th className="px-2 py-1.5 text-right font-medium cursor-pointer hover:text-gray-700 w-14" onClick={() => setSortBy('ic')}>
                IC{sortBy==='ic'?' ▼':''}</th>
              <th className="px-2 py-1.5 text-right font-medium cursor-pointer hover:text-gray-700 w-12" onClick={() => setSortBy('icir')}>
                IR{sortBy==='icir'?' ▼':''}</th>
              <th className="px-2 py-1.5 text-right font-medium w-14">覆盖</th>
              <th className="px-2 py-1.5 text-right font-medium w-12">衰减</th>
              <th className="px-2 py-1.5 text-center font-medium w-12">选择</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((f, i) => (
              <tr key={f.id} className={cn('border-t border-gray-50 hover:bg-amber-50/20', selectedIds.has(f.id) && 'bg-amber-50/30')}>
                <td className="px-3 py-1 text-gray-300">{i + 1}</td>
                <td className="px-2 py-1">
                  <span className="font-medium text-gray-800">{f.name}</span>
                  <span className="ml-1 text-[10px] text-gray-400">{f.origin}</span>
                </td>
                <td className={cn('px-2 py-1 text-right font-mono tabular-nums', f.ic > 0 ? 'text-emerald-600' : f.ic < -0.03 ? 'text-rose-600' : 'text-gray-400')}>
                  {f.ic > 0 ? '+' : ''}{f.ic.toFixed(3)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-gray-600">{f.icir?.toFixed(1) ?? '-'}</td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">{(f.coverage*100).toFixed(0)}%</td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">{f.decay}d</td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => onToggle(f.id)}
                    className={cn('text-[10px] px-2 py-0.5 rounded border transition-colors',
                      selectedIds.has(f.id) ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-gray-200 text-gray-400 hover:border-amber-300')}>
                    {selectedIds.has(f.id) ? '已选' : '选择'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 相关性矩阵 — 仅已选因子 */}
      {correlations && selectedIds.size > 1 && (
        <div className="border-t border-gray-100 px-4 py-2">
          <h4 className="text-[11px] font-medium text-gray-700 mb-1">已选因子相关性</h4>
          <div className="flex flex-wrap gap-1">
            {correlations
              .filter(c => selectedIds.has(c.id1) && selectedIds.has(c.id2))
              .slice(0, 20)
              .map(c => {
                const absV = Math.abs(c.correlation)
                return (
                  <span key={`${c.id1}-${c.id2}`}
                    className={cn('text-[9px] px-1.5 py-0.5 rounded border font-mono',
                      absV > 0.7 ? 'border-rose-300 bg-rose-50 text-rose-600' :
                      absV > 0.5 ? 'border-amber-300 bg-amber-50 text-amber-600' :
                      'border-gray-200 text-gray-500')}>
                    {c.id1.slice(0,8)}↔{c.id2.slice(0,8)} {c.correlation > 0 ? '+' : ''}{c.correlation.toFixed(2)}
                  </span>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
