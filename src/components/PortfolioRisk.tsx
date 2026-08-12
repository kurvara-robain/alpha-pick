// ─────────────────────────────────────────────────────────────
// V1.5 组合风险与容量面板
// 展示当前组合的行业暴露、风险贡献、容量估算
// ─────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { AlertTriangle, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { getDB } from '@/lib/store'

interface RiskProfile {
  industryExposure: { industry: string; weight: number; count: number }[]
  topConcentration: number // 前 3 行业占比
  avgTurnover: number
  avgMktCap: number
  avgVolatility: number
  capacityEstimate: number // 亿元（基于换手率和市值的容量估算）
  riskScore: 'low' | 'medium' | 'high'
  warnings: string[]
}

function computeRiskProfile(stocks: UniverseStock[]): RiskProfile {
  if (stocks.length === 0) {
    return {
      industryExposure: [], topConcentration: 0, avgTurnover: 0, avgMktCap: 0,
      avgVolatility: 0, capacityEstimate: 0, riskScore: 'low', warnings: ['无持仓数据']
    }
  }

  // 行业暴露
  const industryMap = new Map<string, number>()
  for (const s of stocks) {
    industryMap.set(s.industry, (industryMap.get(s.industry) ?? 0) + 1)
  }
  const industryExposure = [...industryMap.entries()]
    .map(([industry, count]) => ({ industry, count, weight: count / stocks.length }))
    .sort((a, b) => b.count - a.count)

  const topConcentration = industryExposure.slice(0, 3).reduce((s, i) => s + i.weight, 0)
  const avgTurnover = stocks.reduce((s, x) => s + x.turnover, 0) / stocks.length
  const avgMktCap = stocks.reduce((s, x) => s + x.mktCap, 0) / stocks.length
  const avgVolatility = stocks.reduce((s, x) => s + (x.vol60 ?? 0), 0) / stocks.length

  // 容量估算：单票日成交额 * 持仓比例上限
  const dailyVolume = avgMktCap * (avgTurnover / 100) // 亿元
  const capacityEstimate = dailyVolume * 0.1 * stocks.length // 成交额的10%

  const warnings: string[] = []
  if (topConcentration > 0.6) warnings.push('行业集中度偏高（>60%），分散度不足')
  if (avgTurnover < 0.5) warnings.push('组合平均换手率过低（<0.5%），流动性风险')
  if (avgVolatility > 40) warnings.push('平均波动率偏高（>40%），组合回撤风险较大')

  const riskScore = warnings.length >= 2 ? 'high' : warnings.length === 1 ? 'medium' : 'low'

  return { industryExposure, topConcentration, avgTurnover, avgMktCap, avgVolatility, capacityEstimate, riskScore, warnings }
}

export default function PortfolioRisk() {
  const universeState = useAsync(loadUniverse)
  const db = getDB()

  const portfolioStocks = useMemo(() => {
    if (!universeState.data) return []
    // 使用持仓诊断中的股票，或用备选清单中的前 N 只
    const holdings = db.holdings ?? []
    const codes = new Set(holdings.map((h) => h.code))
    if (codes.size > 0) {
      return universeState.data.filter((s) => codes.has(s.code))
    }
    // Fallback: 取 watchlist 第一组
    const watchlist = db.watchlists?.[0]
    if (watchlist) {
      const wlCodes = new Set(watchlist.items.map((i) => i.code))
      return universeState.data.filter((s) => wlCodes.has(s.code))
    }
    return []
  }, [universeState.data, db])

  const risk = useMemo(() => computeRiskProfile(portfolioStocks), [portfolioStocks])

  if (portfolioStocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
        <Shield className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        暂无持仓数据 — 添加持仓后可查看组合风险分析
      </div>
    )
  }

  const riskColors = {
    low: 'border-emerald-400 bg-emerald-50 text-emerald-700',
    medium: 'border-amber-400 bg-amber-50 text-amber-700',
    high: 'border-rose-400 bg-rose-50 text-rose-700',
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Shield className="h-4 w-4 text-amber-500" />组合风险分析
        </h3>
        <Badge variant="outline" className={riskColors[risk.riskScore]}>
          {risk.riskScore === 'low' ? '低风险' : risk.riskScore === 'medium' ? '中风险' : '高风险'}
        </Badge>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-4">
        <div className="rounded bg-gray-50 p-2.5 text-center">
          <div className="text-[10px] text-gray-400">组合规模</div>
          <div className="mt-1 font-mono text-sm font-bold text-gray-800">{portfolioStocks.length}只</div>
        </div>
        <div className="rounded bg-gray-50 p-2.5 text-center">
          <div className="text-[10px] text-gray-400">行业集中度</div>
          <div className={`mt-1 font-mono text-sm font-bold ${risk.topConcentration > 0.6 ? 'text-rose-600' : 'text-gray-800'}`}>{(risk.topConcentration * 100).toFixed(0)}%</div>
        </div>
        <div className="rounded bg-gray-50 p-2.5 text-center">
          <div className="text-[10px] text-gray-400">平均波动率</div>
          <div className="mt-1 font-mono text-sm font-bold text-gray-800">{risk.avgVolatility.toFixed(0)}%</div>
        </div>
        <div className="rounded bg-gray-50 p-2.5 text-center">
          <div className="text-[10px] text-gray-400">容量估算</div>
          <div className="mt-1 font-mono text-sm font-bold text-gray-800">¥{risk.capacityEstimate.toFixed(0)}亿</div>
        </div>
      </div>

      {/* 行业暴露柱状图 */}
      {risk.industryExposure.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-gray-400 uppercase mb-1">行业暴露</div>
          {risk.industryExposure.slice(0, 8).map((ind) => (
            <div key={ind.industry} className="flex items-center gap-2 text-[11px]">
              <span className="w-16 truncate text-gray-600">{ind.industry}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${ind.weight * 100}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono tabular-nums text-gray-500">{(ind.weight * 100).toFixed(0)}%</span>
              <span className="text-gray-400">{ind.count}只</span>
            </div>
          ))}
        </div>
      )}

      {/* 警告 */}
      {risk.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {risk.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
