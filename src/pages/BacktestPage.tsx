// ─────────────────────────────────────────────────────────────
// P6 回测分析：配置策略 × 因子组合 → 运行模拟回测 → 查看绩效 / 净值曲线 / 各期选股池回放
// 结果可保存到 db.backtests，支持回看与删除
// V2：携带 runId 时从 Run 派生冻结配置（prepareBacktest → startBacktest → completeBacktest），
//     无 runId 时保留手动 legacy 流程（UI 标注「历史模式」）。
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Eye, FlaskConical, History, Info, Loader2, Play, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { runBacktest, runBacktestForRun } from '@/lib/api'
import { submitBacktest, pollTask } from '@/lib/taskClient'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { getDB, subscribeDB, updateDB } from '@/lib/store'
import type { DB } from '@/lib/store'
import {
  completeBacktest,
  deriveBacktestExecution,
  failBacktest,
  factorFromSnapshot,
  getBacktestRunRecord,
  getRun,
  prepareBacktest,
  retryFromFailed,
  startBacktest,
  strategyFromSnapshot,
} from '@/lib/experimentRun'
import type { BacktestConfig, BacktestResult, BacktestRunRecord, ExperimentRun, RebalanceFreq } from '@/lib/types'

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
} as const

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

/** 绩效指标卡 */
function MetricCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}

/** 回测结果展示区（绩效 + 净值曲线 + 各期选股池回放） */
function ResultView({ result }: { result: BacktestResult }) {
  const m = result.metrics
  const metrics = [
    { label: '累计收益', value: fmtPct(m.totalReturn), cls: pctColor(m.totalReturn) },
    { label: '年化收益', value: fmtPct(m.annualReturn), cls: pctColor(m.annualReturn) },
    { label: '最大回撤', value: fmtPct(m.maxDrawdown), cls: pctColor(m.maxDrawdown) },
    { label: '夏普比率', value: m.sharpe.toFixed(2), cls: 'text-amber-500' },
    { label: '胜率', value: `${m.winRate.toFixed(1)}%`, cls: 'text-gray-900' },
    { label: '换手率', value: `${m.turnover}%`, cls: 'text-gray-900' },
  ]
  return (
    <div className="space-y-4">
      {/* 可信度标记 */}
      <div className="flex items-center gap-2">
        {result.credibility === 'research' ? (
          <Badge variant="outline" className="border-blue-400 bg-blue-50 text-blue-700 gap-1">
            <span className="text-[10px]">🔬</span> 研究级回测
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700 gap-1">
            <span className="text-[10px]">⚡</span> 快速模拟
          </Badge>
        )}
        {result.dataVersion && (
          <span className="text-[10px] text-gray-400">数据版本: {result.dataVersion}</span>
        )}
      </div>

      {/* 口径说明 */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
        <Info className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
        <span>
          回测口径：回测在历史区间内逐期滚动执行选股规则，每期仅使用当期可得数据（防前视偏差演示口径，模拟数据）。
          区间 {result.config.startDate} ~ {result.config.endDate} ·{' '}
          {result.config.rebalance === 'weekly' ? '每周' : '每月'}调仓 · 初始资金{' '}
          {fmtNum(result.config.capital, 0)} 元
        </span>
      </div>

      {/* 绩效指标 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map((x) => (
          <MetricCard key={x.label} {...x} />
        ))}
      </div>

      {/* 净值曲线：策略 vs 沪深300 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">净值曲线</span>
          <span className="text-xs text-gray-400">策略组合 vs 沪深300 基准（期初净值 = 1）</span>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value, name) => [
                  Number(value).toFixed(4),
                  name === 'strategy' ? '策略净值' : '沪深300',
                ]}
              />
              <Legend
                formatter={(v: string) => (
                  <span className="text-xs text-gray-500">
                    {v === 'strategy' ? '策略净值' : '沪深300 基准'}
                  </span>
                )}
              />
              <Line
                type="monotone"
                dataKey="strategy"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 历史各期选股池回放 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="size-4 text-amber-500" />
          <span className="text-sm font-medium text-gray-800">历史各期选股池回放</span>
          <span className="text-xs text-gray-400">每个调仓期实际选出的股票</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.periods.map((p) => (
            <div key={p.period} className="rounded-lg border border-gray-200 bg-gray-100/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">{p.period}</span>
                <span className="font-mono text-[10px] tabular-nums text-gray-400">
                  {p.picks.length} 只
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.picks.map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className="border-cyan-500/25 bg-amber-100 text-amber-500"
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 页面入口：有 runId → V2 Run 回测流程；无 runId → legacy 手动流程（标注「历史模式」）。
 */
export default function BacktestPage() {
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  if (runId) return <RunBacktest runId={runId} />
  return <LegacyBacktest />
}

const RUN_STATUS_LABEL: Record<string, string> = {
  draft: '草稿', ready: '已就绪', running_screen: '筛选中', screened: '已筛选',
  running_backtest: '回测中', completed: '已完成', failed: '失败',
}

/**
 * V2：回测配置只从 Run 派生（规则6）。
 * 阶段1 prepareBacktest(runId, settings) 冻结 BacktestRunRecord（rebalance 强制取
 * run.screeningSpec.rebalance）；阶段2 startBacktest 启动；完成后 completeBacktest 归档。
 * 执行引擎的股票池/策略/因子全部来自 Run 快照，禁止从 db.strategies/db.factorPool 重新拼装。
 */
function RunBacktest({ runId }: { runId: string }) {
  const navigate = useNavigate()
  const [, setVersion] = useState(0)
  const [run, setRun] = useState<ExperimentRun | null>(() => getRun(runId))
  const [record, setRecord] = useState<BacktestRunRecord | null>(() => getBacktestRunRecord(runId))
  const [capital, setCapital] = useState('1000000')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [completedResult, setCompletedResult] = useState<BacktestResult | null>(null)

  useEffect(
    () =>
      subscribeDB(() => {
        setVersion((v) => v + 1)
        setRun(getRun(runId))
        setRecord(getBacktestRunRecord(runId))
      }),
    [runId],
  )

  // completed 回看：从 db.backtests 找回带 runId 关联的结果
  useEffect(() => {
    if (run?.status !== 'completed') {
      setCompletedResult(null)
      return
    }
    const found = getDB().backtests.find((b) => (b as BacktestResult & { runId?: string }).runId === runId)
    setCompletedResult(found ?? null)
  }, [run, runId])

  // 执行层设置：从 Run 派生（研究配置/rebalance 不由调用方提供）
  const settings = useMemo(() => (run ? deriveBacktestExecution(run) : null), [run])

  const strategies = (run?.strategySnapshots ?? []).map(strategyFromSnapshot)
  const factors = (run?.factorSnapshots ?? []).map(factorFromSnapshot)
  const moduleName = useMemo(() => {
    const sPart = strategies.length > 0 ? strategies.map((s) => s.name).join(' + ') : '未选择策略'
    const fPart = factors.length === 0 ? '未选择因子' : factors.length === 1 ? factors[0].name : `${factors[0].name} 等${factors.length}因子`
    return `${sPart} × ${fPart}`
  }, [strategies, factors])

  const handleRun = async () => {
    if (!run || !settings || run.status !== 'screened') return
    setRunning(true)
    setRunError('')
    setResult(null)
    try {
      // 阶段1：从 Run 派生执行设置并冻结（spec 内 rebalance 强制取 Run.screeningSpec.rebalance）
      const rec = prepareBacktest(runId, settings)
      setRecord(rec)
      // 阶段2：启动回测记录（再次校验 configHash 完整性）
      startBacktest(runId, rec.id)
      // 执行真实回测：策略/因子/股票池全部来自 Run 快照（规则6）
      const config: BacktestConfig = {
        moduleName,
        strategyIds: run.strategySnapshots.map((s) => s.strategyId),
        factorIds: run.factorSnapshots.map((f) => f.factorId),
        startDate: settings.startDate,
        endDate: settings.endDate,
        rebalance: run.screeningSpec.rebalance,
        capital: Number(capital) || 0,
      }
      const res = await runBacktestForRun(config, strategies, factors)
      // 完成：写回 BacktestRunRecord + Run 状态，失败则 failBacktest 写入 attempts
      completeBacktest(runId, res.id)
      // 归档结果（带 runId 关联，便于 completed 回看）
      updateDB((d) => {
        if (!d.backtests.some((b) => b.id === res.id)) {
          d.backtests.unshift({ ...res, runId } as BacktestResult)
        }
      })
      setResult(res)
      setRun(getRun(runId))
      setRecord(getBacktestRunRecord(runId))
    } catch (e) {
      const msg = e instanceof Error ? e.message : '回测运行失败，请稍后重试'
      if (getRun(runId)?.status === 'running_backtest') {
        try {
          failBacktest(runId, msg)
          setRun(getRun(runId))
          setRecord(getBacktestRunRecord(runId))
        } catch {
          // 状态已变化则跳过
        }
      }
      setRunError(msg)
    } finally {
      setRunning(false)
    }
  }

  const handleRetryScreening = () => {
    try {
      retryFromFailed(runId) // attempt+1，保留配置快照 → draft
      navigate(`/workbench?runId=${runId}`)
    } catch {
      setRunError('重试失败：Run 状态不允许回退，请新建 Run')
    }
  }

  const displayResult = result ?? completedResult

  return (
    <div className="space-y-5 p-6">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <FlaskConical className="size-5 text-amber-500" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">回测分析</h1>
          <p className="text-xs text-gray-400">
            Run「{run?.originalQuery.raw ?? '…'}」· asOfDate {run?.asOfDate ?? '—'} · rebalance{' '}
            {run ? (run.screeningSpec.rebalance === 'weekly' ? '每周' : '每月') : '—'}（来自 Run，不可覆盖）
          </p>
        </div>
        <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700">
          V2 Run #{runId.slice(-6)}
        </Badge>
        {run && (
          <Badge
            variant="outline"
            className={
              run.status === 'failed'
                ? 'border-rose-400 bg-rose-50 text-rose-600'
                : run.status === 'completed'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-600'
                  : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600'
            }
          >
            {RUN_STATUS_LABEL[run.status] ?? run.status}
          </Badge>
        )}
      </div>

      {!run && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
          Run 不存在（{runId}），请回到首页重新发起搜索。
        </div>
      )}

      {run && run.status !== 'screened' && run.status !== 'running_backtest' && run.status !== 'completed' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
          {run.status === 'draft' && <p className="text-sm text-gray-400">Run 仍在草稿：请先完成策略/因子快照并在「组合工作台」生成候选。</p>}
          {run.status === 'ready' && <p className="text-sm text-gray-400">Run 已就绪：请前往「组合工作台」运行筛选生成候选。</p>}
          {run.status === 'running_screen' && <p className="text-sm text-gray-400">Run 正在筛选中，完成后即可回测。</p>}
          {run.status === 'failed' && (
            <p className="text-sm text-rose-400">Run 失败：{run.failureReason ?? '未知原因'}</p>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate(`/workbench?runId=${runId}`)} className="border-cyan-500/40 text-amber-500 hover:bg-amber-100">
            前往组合工作台
          </Button>
          {run.status === 'failed' && (
            <Button variant="outline" size="sm" onClick={handleRetryScreening} className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
              重新筛选（attempt+1，保留快照）
            </Button>
          )}
        </div>
      )}

      {run && (run.status === 'screened' || run.status === 'running_backtest' || run.status === 'completed') && settings && (
        <>
          {/* 只读配置面板：全部来自 Run 快照 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">回测配置（从 Run 派生，只读）</span>
              <span className="text-[10px] text-gray-400">configHash {run.configHash.slice(0, 12)}…</span>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              {strategies.map((s) => (
                <Badge key={s.id} variant="outline" className="border-cyan-500/30 bg-amber-100 text-amber-500">
                  策略 · {s.name}
                </Badge>
              ))}
              {factors.map((f) => (
                <Badge key={f.id} variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-300">
                  因子 · {f.name}
                </Badge>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <span className="text-xs text-gray-500">开始日期（派生）</span>
                <div className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-mono text-sm tabular-nums text-gray-800">
                  {settings.startDate}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-gray-500">结束日期（派生）</span>
                <div className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-mono text-sm tabular-nums text-gray-800">
                  {settings.endDate}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-gray-500">调仓频率（来自 Run）</span>
                <div className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-800">
                  {run.screeningSpec.rebalance === 'weekly' ? '每周调仓' : '每月调仓'}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-gray-500">初始资金（元）</span>
                <Input
                  type="number"
                  min={0}
                  step={10000}
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                  className="border-gray-300 bg-gray-100 font-mono tabular-nums"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
              <div className="min-w-0">
                <div className="text-xs text-gray-400">组合名称（Run 派生）</div>
                <div className="truncate text-sm font-medium text-amber-500">{moduleName}</div>
              </div>
              <Button
                onClick={handleRun}
                disabled={running || run.status === 'completed' || run.status === 'running_backtest'}
                className="ml-auto bg-cyan-500 text-slate-950 hover:bg-cyan-400"
              >
                {running || run.status === 'running_backtest' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {running || run.status === 'running_backtest'
                  ? '回测引擎逐期滚动计算中…'
                  : run.status === 'completed'
                    ? '已完成'
                    : '运行回测'}
              </Button>
            </div>
            {record && record.status !== 'pending' && (
              <p className="mt-2 text-xs text-gray-400">
                最近回测记录 #{record.id.slice(-6)} · {record.status}
                {record.status === 'completed' && record.backtestResultId && ` · result ${record.backtestResultId.slice(-6)}`}
                {record.status === 'failed' && record.failureReason && ` · ${record.failureReason}`}
              </p>
            )}
          </div>

          {runError && !running && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
              <p className="text-sm text-rose-300">{runError}</p>
              <Button variant="outline" size="sm" onClick={handleRun} className="shrink-0 border-rose-500/40 text-rose-300 hover:bg-rose-500/10">
                重试
              </Button>
            </div>
          )}

          {running && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-sm text-gray-500">
              <Loader2 className="size-4 animate-spin text-amber-500" />
              回测引擎逐期滚动计算中…
            </div>
          )}

          {!running && displayResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  回测结果：<span className="text-amber-500">{displayResult.config.moduleName}</span>
                </h2>
                <span className="text-xs text-gray-400">生成于 {fmtTime(displayResult.createdAt)}</span>
              </div>
              <ResultView result={displayResult} />
            </div>
          )}

          {!running && !displayResult && !runError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center text-xs text-gray-400">
              Run 已通过筛选（候选快照就绪），点击「运行回测」执行两阶段回测流程。
            </div>
          )}
        </>
      )}

      {run?.status === 'running_backtest' && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin text-amber-500" />
          回测进行中（页面刷新后可在「组合工作台」查看状态）…
        </div>
      )}

      {run?.status === 'completed' && !displayResult && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center text-xs text-gray-400">
          Run 已完成回测，但结果记录未归档（历史记录可能已被删除）。
        </div>
      )}
    </div>
  )
}

/** legacy：无 runId 的手动回测流程（行为不变，UI 标注「历史模式」） */
function LegacyBacktest() {
  const [db, setDb] = useState<DB>(() => getDB())
  useEffect(() => subscribeDB(() => setDb(getDB())), [])

  const enabledStrategies = db.strategies.filter((s) => s.enabled)
  const poolFactors = db.factors.filter((f) => db.factorPool.includes(f.id))

  // ── 回测配置表单状态 ──────────────────────────────────────
  const [strategyIds, setStrategyIds] = useState<string[]>(() =>
    getDB()
      .strategies.filter((s) => s.enabled)
      .map((s) => s.id),
  )
  const [factorIds, setFactorIds] = useState<string[]>(() => getDB().factorPool)
  const [startDate, setStartDate] = useState('2025-07-01')
  const [endDate, setEndDate] = useState('2026-07-01')
  const [rebalance, setRebalance] = useState<RebalanceFreq>('monthly')
  const [capital, setCapital] = useState('1000000')

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState<BacktestResult | null>(null)

  // 研究级回测
  const [, setResearchTaskId] = useState('')
  const [researchProgress, setResearchProgress] = useState(0)
  const [researchStatus, setResearchStatus] = useState('')
  const [researchRunning, setResearchRunning] = useState(false)

  // 组合名自动生成：如「低估值价值策略 × ROC-20动量 等3因子」
  const moduleName = useMemo(() => {
    const sns = db.strategies.filter((s) => strategyIds.includes(s.id)).map((s) => s.name)
    const fns = db.factors.filter((f) => factorIds.includes(f.id)).map((f) => f.name)
    const sPart = sns.length > 0 ? sns.join(' + ') : '未选择策略'
    const fPart =
      fns.length === 0 ? '未选择因子' : fns.length === 1 ? fns[0] : `${fns[0]} 等${fns.length}因子`
    return `${sPart} × ${fPart}`
  }, [db, strategyIds, factorIds])

  const alreadySaved = result !== null && db.backtests.some((b) => b.id === result.id)

  const handleRun = async () => {
    setRunning(true)
    setRunError('')
    try {
      const res = await runBacktest({
        moduleName,
        strategyIds,
        factorIds,
        startDate,
        endDate,
        rebalance,
        capital: Number(capital) || 0,
      })
      setResult(res)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : '回测运行失败，请稍后重试')
    } finally {
      setRunning(false)
    }
  }

  const handleResearchRun = async () => {
    setResearchRunning(true)
    setResearchProgress(0)
    setResearchStatus('提交中…')
    try {
      const { taskId } = await submitBacktest({
        strategyIds, factorIds, startDate, endDate,
        rebalance, topN: 25,
      })
      setResearchTaskId(taskId)
      pollTask(taskId,
        (task) => { setResearchProgress(task.progress); setResearchStatus(task.message) },
        (task) => {
          setResearchRunning(false)
          if (task.status === 'completed') {
            setResearchStatus('✓ 研究级回测完成')
            // 尝试加载产物
            fetch(`/data/research-backtest-${taskId}.json`)
              .then((r) => r.json())
              .then((data) => {
                setResult({ ...data, credibility: 'research', id: taskId, config: { moduleName, strategyIds, factorIds, startDate, endDate, rebalance, capital: Number(capital) || 0 } } as BacktestResult)
              })
              .catch(() => setResearchStatus('产物加载失败'))
          } else {
            setResearchStatus('✗ 回测失败: ' + (task.error ?? '未知错误'))
          }
        },
      )
    } catch (e) {
      setResearchRunning(false)
      setResearchStatus('提交失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleSave = () => {
    if (!result || alreadySaved) return
    updateDB((d) => {
      d.backtests.unshift(result)
    })
  }

  const removeBacktest = (id: string) => {
    updateDB((d) => {
      d.backtests = d.backtests.filter((b) => b.id !== id)
    })
  }

  return (
    <div className="space-y-5 p-6">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <FlaskConical className="size-5 text-amber-500" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">回测分析</h1>
          <p className="text-xs text-gray-400">
            对策略 × 因子组合进行历史区间模拟回测，评估绩效并回放各期选股池
          </p>
        </div>
        <Badge variant="outline" className="ml-auto border-gray-300 text-gray-500">
          历史模式（无 Run 关联）
        </Badge>
      </div>

      {/* ── 回测配置区 ─────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* 策略多选 */}
          <div>
            <Label className="mb-2 text-xs text-gray-500">策略多选（已启用策略）</Label>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-100/50 p-3">
              {enabledStrategies.length === 0 && (
                <p className="text-xs text-gray-400">暂无已启用策略，请先在「策略管理」启用。</p>
              )}
              {enabledStrategies.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={strategyIds.includes(s.id)}
                    onCheckedChange={() => setStrategyIds((prev) => toggleId(prev, s.id))}
                  />
                  <span className="text-sm text-gray-800">{s.name}</span>
                  <span className="ml-auto hidden text-xs text-gray-400 sm:inline">
                    {s.conditions.length} 条条件
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 因子多选 */}
          <div>
            <Label className="mb-2 text-xs text-gray-500">因子多选（因子选择池）</Label>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-100/50 p-3">
              {poolFactors.length === 0 && (
                <p className="text-xs text-gray-400">因子池为空，请先在「因子库」加入因子。</p>
              )}
              {poolFactors.map((f) => (
                <label key={f.id} className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={factorIds.includes(f.id)}
                    onCheckedChange={() => setFactorIds((prev) => toggleId(prev, f.id))}
                  />
                  <span className="text-sm text-gray-800">{f.name}</span>
                  <Badge
                    variant="outline"
                    className="ml-auto border-gray-300 text-[10px] text-gray-400"
                  >
                    {f.category}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* 区间 / 频率 / 资金 */}
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">开始日期</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border-gray-300 bg-gray-100 font-mono tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">结束日期</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border-gray-300 bg-gray-100 font-mono tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">调仓频率</Label>
            <Select value={rebalance} onValueChange={(v) => setRebalance(v as RebalanceFreq)}>
              <SelectTrigger className="w-full border-gray-300 bg-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">每周调仓</SelectItem>
                <SelectItem value="monthly">每月调仓</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">初始资金（元）</Label>
            <Input
              type="number"
              min={0}
              step={10000}
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="border-gray-300 bg-gray-100 font-mono tabular-nums"
            />
          </div>
        </div>

        {/* 组合名 + 运行按钮 */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-400">组合名称（自动生成）</div>
            <div className="truncate text-sm font-medium text-amber-500">{moduleName}</div>
          </div>
          <Button
            onClick={handleRun}
            disabled={running || (strategyIds.length === 0 && factorIds.length === 0)}
            className="ml-auto bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? '回测引擎逐期滚动计算中…' : '运行回测'}
          </Button>
          <Button
            onClick={handleResearchRun}
            disabled={researchRunning || (strategyIds.length === 0 && factorIds.length === 0)}
            className="bg-blue-600 text-white hover:bg-blue-700"
            title="提交到 Python 后端执行事件驱动回测（含 T+1/涨跌停/费用）"
          >
            {researchRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {researchRunning ? `${researchStatus} ${researchProgress}%` : '🔬 研究级回测'}
          </Button>
        </div>
      </div>

      {/* ── 结果区 ────────────────────────────────────────── */}
      {runError && !running && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm text-rose-300">{runError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRun}
            className="shrink-0 border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
          >
            重试
          </Button>
        </div>
      )}

      {running && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin text-amber-500" />
          回测引擎逐期滚动计算中…
        </div>
      )}

      {!running && result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900">
              回测结果：<span className="text-amber-500">{result.config.moduleName}</span>
            </h2>
            <span className="text-xs text-gray-400">生成于 {fmtTime(result.createdAt)}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={alreadySaved}
              className="ml-auto border-cyan-500/40 text-amber-500 hover:bg-amber-100 hover:text-amber-500"
            >
              <Save className="size-3.5" />
              {alreadySaved ? '已保存' : '保存回测结果'}
            </Button>
          </div>
          <ResultView result={result} />
        </div>
      )}

      {!running && !result && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center text-xs text-gray-400">
          配置策略与因子后点击「运行回测」，结果将在此展示
        </div>
      )}

      {/* ── 已保存的回测记录 ──────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="size-4 text-amber-500" />
          <span className="text-sm font-medium text-gray-800">已保存的回测记录</span>
          <span className="font-mono text-xs tabular-nums text-gray-400">
            {db.backtests.length} 条
          </span>
        </div>
        {db.backtests.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">
            暂无保存记录，运行回测后点击「保存回测结果」即可归档
          </p>
        ) : (
          <div className="space-y-2">
            {db.backtests.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-100/50 px-3 py-2.5"
              >
                <span className="text-sm text-gray-800">{b.config.moduleName}</span>
                <span className="font-mono text-xs tabular-nums text-gray-400">
                  {b.config.startDate} ~ {b.config.endDate}
                </span>
                <span className={`font-mono text-xs tabular-nums ${pctColor(b.metrics.totalReturn)}`}>
                  累计 {fmtPct(b.metrics.totalReturn)}
                </span>
                <span className="font-mono text-xs tabular-nums text-gray-500">
                  夏普 {b.metrics.sharpe.toFixed(2)}
                </span>
                <span className="hidden text-xs text-gray-300 lg:inline">
                  保存于 {fmtTime(b.createdAt)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-amber-500 hover:text-amber-500"
                    onClick={() => setResult(b)}
                  >
                    <Eye className="size-3.5" />
                    查看详情
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => removeBacktest(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
