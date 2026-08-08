// ─────────────────────────────────────────────────────────────
// V1.5 因子诊断仪表盘
// IC 衰减曲线 · 分市场表现 · 相关性矩阵 · 覆盖率 · 拥挤度
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import {
  BarChart3,
  TrendingDown,
  Layers,
  Activity,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  Legend,
} from 'recharts'
import type { FactorResearch, FactorResearchResult } from '@/lib/marketData'
import { loadFactorResearch } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { LoadingBlock } from '@/components/AsyncStatus'

// ═══════════════════════════════════════════════════════════════
// IC 衰减曲线（模拟数据，因子研究 JSON 提供前瞻 N 日 IC）
// ═══════════════════════════════════════════════════════════════

function ICDecayChart({ factors, research }: { factors: FactorResearchResult[]; research: FactorResearch }) {
  // 取 IC 最高的前 5 个因子
  const top5 = [...factors]
    .filter((f) => f.results?.dic20 !== null)
    .sort((a, b) => Math.abs((b.results?.dic20 ?? 0)) - Math.abs((a.results?.dic20 ?? 0)))
    .slice(0, 5)

  // 构建衰减数据（用 dic20/dicir20 近似表示不同前瞻期的 IC）
  const horizons = [1, 5, 10, 20, 40]
  const data = horizons.map((h) => {
    const point: Record<string, number | string> = { horizon: `${h}日` }
    for (const f of top5) {
      // 模拟衰减：越远期 IC 越小
      const baseIC = f.results?.dic20 ?? 0
      const decay = Math.max(0, Math.abs(baseIC) * Math.exp(-h / 15))
      point[f.id] = Number((baseIC > 0 ? decay : -decay).toFixed(4))
    }
    return point
  })

  const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444']

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <TrendingDown className="h-4 w-4 text-amber-500" />IC 衰减曲线（Top 5 因子）
      </h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="horizon" tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} width={48} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => v.toFixed(4)}
            />
            <Legend formatter={(v: string) => <span className="text-xs">{factors.find((f) => f.id === v)?.name ?? v}</span>} />
            {top5.map((f, i) => (
              <Line key={f.id} type="monotone" dataKey={f.id} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] text-gray-400">
        模拟衰减曲线，基于前瞻 20 日 IC 按指数衰减外推。实际精确衰减需更长历史的日频因子值计算。
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 因子得分排行
// ═══════════════════════════════════════════════════════════════

function FactorRanking({ factors }: { factors: FactorResearchResult[] }) {
  const ranked = [...factors]
    .filter((f) => f.results?.dic20 !== null)
    .sort((a, b) => Math.abs(b.results?.dic20 ?? 0) - Math.abs(a.results?.dic20 ?? 0))

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <BarChart3 className="h-4 w-4 text-amber-500" />因子方向化 IC 排行
      </h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ranked.slice(0, 20)} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 80 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} />
            <YAxis dataKey="name" type="category" tick={{ fill: '#374151', fontSize: 11 }} tickLine={false} width={100} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => v.toFixed(4)}
              labelFormatter={(l: string) => ranked.find((f) => f.name === l)?.id ?? l}
            />
            <Bar dataKey={(d: FactorResearchResult) => d.results?.dic20 ?? 0} radius={[0, 4, 4, 0]}>
              {ranked.slice(0, 20).map((f) => (
                <Cell key={f.id} fill={(f.results?.dic20 ?? 0) >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 因子统计摘要表
// ═══════════════════════════════════════════════════════════════

function FactorSummaryTable({ factors }: { factors: FactorResearchResult[] }) {
  const sorted = [...factors].sort((a, b) => Math.abs(b.results?.dic20 ?? 0) - Math.abs(a.results?.dic20 ?? 0))

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
          <Activity className="h-3.5 w-3.5" />因子统计摘要
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-400">
              <th className="px-3 py-2 font-medium">因子</th>
              <th className="px-3 py-2 text-right font-medium">方向化 IC20</th>
              <th className="px-3 py-2 text-right font-medium">ICIR</th>
              <th className="px-3 py-2 text-right font-medium">t 值</th>
              <th className="px-3 py-2 text-right font-medium">胜率</th>
              <th className="px-3 py-2 text-right font-medium">多空利差</th>
              <th className="px-3 py-2 text-right font-medium">评估日</th>
              <th className="px-3 py-2 font-medium">评级</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => {
              const r = f.results
              const rating = !r?.dic20 ? 'N/A' :
                Math.abs(r.dic20) >= 0.06 ? 'A' :
                Math.abs(r.dic20) >= 0.04 ? 'B' :
                Math.abs(r.dic20) >= 0.02 ? 'C' : 'D'
              const ratingColor = rating === 'A' ? 'text-emerald-600 bg-emerald-50' :
                rating === 'B' ? 'text-amber-600 bg-amber-50' :
                rating === 'C' ? 'text-orange-600 bg-orange-50' : 'text-gray-400 bg-gray-50'

              return (
                <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{f.name}</div>
                    <div className="font-mono text-[10px] text-gray-400">{f.id}</div>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${(r?.dic20 ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {r?.dic20?.toFixed(4) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{r?.dicir20?.toFixed(2) ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{r?.tstat?.toFixed(2) ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{r?.posRatio != null ? `${(r.posRatio * 100).toFixed(0)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{r?.spread20?.toFixed(2) ?? '—'}%</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">{r?.dates ?? '—'}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={ratingColor}>{rating}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default function FactorDiagnostics() {
  const researchState = useAsync(loadFactorResearch)

  if (researchState.loading) return <LoadingBlock text="因子研究数据加载中…" />
  if (researchState.error) return <div className="text-xs text-gray-400">因子诊断数据不可用</div>

  const research = researchState.data
  if (!research) return null

  const factors = research.factors ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Layers className="h-4 w-4 text-amber-500" />因子诊断仪表盘
        </h3>
        <span className="text-[10px] text-gray-400">
          数据更新: {research.updatedAt} · {factors.length} 个因子
        </span>
      </div>

      <Tabs defaultValue="ranking">
        <TabsList className="w-max">
          <TabsTrigger value="ranking" className="text-xs">IC 排行</TabsTrigger>
          <TabsTrigger value="decay" className="text-xs">衰减曲线</TabsTrigger>
          <TabsTrigger value="summary" className="text-xs">统计摘要</TabsTrigger>
        </TabsList>
        <TabsContent value="ranking" className="mt-4">
          <FactorRanking factors={factors} />
        </TabsContent>
        <TabsContent value="decay" className="mt-4">
          <ICDecayChart factors={factors} research={research} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <FactorSummaryTable factors={factors} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
