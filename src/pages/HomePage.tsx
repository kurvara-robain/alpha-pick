// V1.0 Investment Cockpit — minimal bootstrap
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BrainCircuit, Database, Gauge, LayoutList, LineChart, Newspaper, Shield, Sparkles, TrendingUp, Bell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { loadIndices, loadMeta, loadUniverse } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { createDraftRun } from '@/lib/experimentRun'
import { seedRunFromNL } from '@/lib/api'
import { searchRoute, todayAsOfDate } from '@/lib/nlRouting'
import { buildDataVersion } from '@/lib/versionMetadata'
import { getPitContext, getActiveSnapshot } from '@/lib/dataSnapshotStore'
import { getAlerts, checkSignalChanges, requestNotificationPermission, markAlertsRead } from '@/lib/alerts'
import { useEffect } from 'react'

export default function HomePage() {
  const indicesState = useAsync(loadIndices)
  const metaState = useAsync(loadMeta)
  const universeState = useAsync(loadUniverse)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [alerts, setAlerts] = useState(getAlerts())
  const [showAlerts, setShowAlerts] = useState(false)

  useEffect(() => {
    requestNotificationPermission()
    const added = checkSignalChanges()
    if (added > 0) setAlerts(getAlerts())
  }, [])

  const loading = indicesState.loading || metaState.loading || universeState.loading
  const error = indicesState.error ?? metaState.error ?? universeState.error
  if (loading) return <LoadingBlock text="加载中…" />
  if (error) return <ErrorBlock error={error} onRetry={() => {}} />

  const indices = indicesState.data?.indices ?? []
  const dataVersion = metaState.data ? buildDataVersion(metaState.data) : null
  // 规则8/10：全局 PIT 基准 + 活动数据快照（新鲜度/覆盖率/失败数/同步状态/来源/快照ID）
  const pit = getPitContext()
  const snap = getActiveSnapshot()

  const handleSearch = () => {
    if (!query.trim()) return
    const route = searchRoute(query)
    // 持仓/板块等非筛选类查询：原路由直达，不创建 Run（legacy 行为）
    if (route === '/holdings' || route === '/market') {
      navigate(route)
      return
    }
    // V2 主链接线：NL → createDraftRun（搜索词完整落入 originalQuery）→ 携带 runId 跳转
    // 规则8：优先使用活动 PIT 基准日期（pit.active && pit.asOfDate），否则今日
    const asOfDate = pit.active && pit.asOfDate ? pit.asOfDate : todayAsOfDate()
    const run = createDraftRun({ raw: query }, asOfDate)
    // 规则3：NL 立即转成可执行配置（策略/因子快照），而非 0/0 空配置
    void seedRunFromNL(run.id, query, run.asOfDate)
    navigate(`${route}?runId=${run.id}`)
  }

  return (
    <div className="space-y-6">
      {/* AI 搜索栏 */}
      <div className="text-center">
        <div className="flex items-center justify-end mb-1">
          {alerts.length > 0 && (
            <button onClick={() => { setShowAlerts(!showAlerts); if (!showAlerts) markAlertsRead(alerts.filter(a => !a.read).map(a => a.id)) }}
              className="relative rounded-full p-1.5 hover:bg-gray-100">
              <Bell className="h-5 w-5 text-gray-500" />
              {alerts.filter(a => !a.read).length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                  {alerts.filter(a => !a.read).length}
                </span>
              )}
            </button>
          )}
        </div>
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

      {/* 提醒面板 */}
      {showAlerts && alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 shadow-lg max-w-md mx-auto">
          {alerts.slice(0, 5).map((a) => (
            <div key={a.id} className={`flex items-start gap-2 py-1.5 text-xs ${a.read ? 'text-gray-400' : 'text-gray-900 font-medium'}`}>
              <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${a.severity === 'critical' ? 'bg-rose-500' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
              <div className="flex-1">{a.message}</div>
              {a.action && <a href={a.action.url} className="text-amber-500 hover:underline">{a.action.label}</a>}
            </div>
          ))}
        </div>
      )}
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

      {/* 数据健康（规则10：新鲜度/覆盖率/失败数/同步状态/来源/快照ID） */}
      {(snap || dataVersion) && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Database className="h-4 w-4 text-amber-500" />数据健康</h3>
            <Badge variant="outline" className={snap ? (snap.syncStatus === 'synced' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700') : (dataVersion?.qualityGate.passed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700')}>
              {snap ? `同步 ${snap.syncStatus} · 失败 ${snap.failureCount}` : (dataVersion?.qualityGate.summary ?? '未知')}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
            {[
              { label: '批次', value: snap?.batchId ?? dataVersion?.batchId ?? '—' },
              { label: '快照ID', value: snap?.id ?? '无' },
              { label: '覆盖', value: (snap?.stockCount ?? dataVersion?.stockCount ?? 0).toLocaleString('zh-CN') },
              { label: 'K线天数', value: snap?.klineDays ?? dataVersion?.klineDays ?? '—' },
              { label: '数据源', value: snap?.source ?? dataVersion?.source ?? '—' },
              { label: '同步状态', value: snap?.syncStatus ?? (dataVersion?.qualityGate.passed ? 'synced' : 'unknown') },
              { label: '失败数', value: snap?.failureCount ?? '—' },
              { label: 'PIT 基准', value: pit.active ? (pit.asOfDate ?? '—') : '实时' },
            ].map((m) => (
              <div key={m.label} className="rounded bg-gray-50 p-2 text-center">
                <div className="text-gray-400">{m.label}</div>
                <div className={`mt-0.5 font-mono font-semibold ${m.label === 'PIT 基准' && pit.active && !pit.pitCapable ? 'text-amber-600' : 'text-gray-800'}`}>{m.value}</div>
              </div>
            ))}
          </div>
          {snap && (
            <div className="mt-2 text-[10px] text-gray-400">
              数据日期 {snap.dataDate} · 发布 {snap.publishDate} · PIT 能力 {pit.pitCapable ? '可用（无前视）' : pit.active ? '不足（近似）' : '未启用'}
            </div>
          )}
        </Card>
      )}

      <div className="text-[11px] text-amber-700 bg-amber-50 rounded p-3">
        <Shield className="inline h-3.5 w-3.5 mr-1" />
        行情为真实数据；评分、信号与回测为演示模型输出，不构成投资建议。
      </div>
    </div>
  )
}
