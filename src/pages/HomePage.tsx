// V1.0 Investment Cockpit — minimal bootstrap
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { BrainCircuit, ChevronRight, Database, Gauge, LayoutList, LineChart, Newspaper, Search, Shield, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { loadIndices, loadMeta, loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { getDB } from '@/lib/store'
import { buildDataVersion } from '@/lib/versionMetadata'
import Sparkline from '@/components/Sparkline'

export default function HomePage() {
  const indicesState = useAsync(loadIndices)
  const metaState = useAsync(loadMeta)
  const universeState = useAsync(loadUniverse)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const loading = indicesState.loading || metaState.loading || universeState.loading
  const error = indicesState.error ?? metaState.error ?? universeState.error
  if (loading) return <LoadingBlock text="加载中…" />
  if (error) return <ErrorBlock error={error} onRetry={() => {}} />

  const indices = indicesState.data?.indices ?? []
  const universe = universeState.data ?? []
  const dataVersion = metaState.data ? buildDataVersion(metaState.data) : null

  const handleSearch = () => {
    if (!query.trim()) return
    const lower = query.toLowerCase()
    if (lower.includes('持仓')) navigate('/holdings')
    else if (lower.includes('策略') || lower.includes('回测')) navigate('/strategies')
    else if (lower.includes('因子')) navigate('/factors')
    else if (lower.includes('板块')) navigate('/market')
    else navigate('/research')
  }

  return (
    <div className="space-y-6">
      {/* AI 搜索栏 */}
      <div className="text-center">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">AlphaMind <span className="text-amber-500">量化投研</span></h1>
        <p className="mb-4 text-sm text-gray-400">用自然语言完成选股、诊股和研究</p>
        <div className="flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-white p-1 shadow-sm mx-auto max-w-2xl">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 ml-2">
            <BrainCircuit size={16} className="text-white" />
          </span>
          <Input className="flex-1 border-0 bg-transparent py-3 text-base shadow-none focus-visible:ring-0"
            placeholder="找低估值高ROE的股票 / 分析持仓风险 / 贵州茅台估值分析" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          <Button onClick={handleSearch} className="mr-1 bg-amber-500 px-5 py-2.5 text-white hover:bg-amber-600">
            <Sparkles className="h-4 w-4 mr-2" />搜索
          </Button>
        </div>
      </div>

      {/* 快速入口 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { to: '/market', icon: Gauge, label: '市场全览', color: 'text-blue-500 bg-blue-50' },
          { to: '/strategies', icon: LayoutList, label: '策略池', color: 'text-violet-500 bg-violet-50' },
          { to: '/factors', icon: Gauge, label: '因子实验室', color: 'text-emerald-500 bg-emerald-50' },
          { to: '/workbench', icon: TrendingUp, label: '组合工作台', color: 'text-amber-500 bg-amber-50' },
          { to: '/backtest', icon: LineChart, label: '回测分析', color: 'text-rose-500 bg-rose-50' },
          { to: '/research', icon: Newspaper, label: '个股投研', color: 'text-cyan-500 bg-cyan-50' },
        ].map((e) => (
          <button key={e.to} onClick={() => navigate(e.to)}
            className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 hover:border-amber-300">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${e.color}`}><e.icon className="h-5 w-5" /></div>
            <span className="text-sm font-semibold text-gray-900">{e.label}</span>
          </button>
        ))}
      </div>

      {/* 指数快照 */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">市场快照</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {indices.map((idx) => (
            <div key={idx.name} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
              <div className="text-[11px] font-medium text-gray-500">{idx.name.replace('指数', '')}</div>
              <div className="mt-1 font-mono text-sm font-bold tabular-nums text-gray-900">{fmtNum(idx.value)}</div>
              <div className={`mt-0.5 font-mono text-xs tabular-nums ${pctColor(idx.changePct)}`}>{fmtPct(idx.changePct)}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 数据健康 */}
      {dataVersion && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Database className="h-4 w-4 text-amber-500" />数据健康</h3>
            <Badge variant="outline" className={dataVersion.qualityGate.passed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'}>
              {dataVersion.qualityGate.summary}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
            {['批次', '股票池', 'K线天数', '数据源'].map((label, i) => (
              <div key={label} className="rounded bg-gray-50 p-2 text-center">
                <div className="text-gray-400">{label}</div>
                <div className="mt-0.5 font-mono font-semibold text-gray-800">
                  {[dataVersion.batchId, dataVersion.stockCount.toLocaleString(), dataVersion.klineDays, dataVersion.source][i]}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="text-[11px] text-amber-700 bg-amber-50 rounded p-3">
        <Shield className="inline h-3.5 w-3.5 mr-1" />
        行情为真实数据；评分、信号与回测为演示模型输出，不构成投资建议。
      </div>
    </div>
  )
}
