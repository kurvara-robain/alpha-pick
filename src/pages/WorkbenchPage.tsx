// ─────────────────────────────────────────────────────────────
// P4 组合工作台：策略 × 因子组合筛选，生成并保存备选清单
// V2：携带 runId 时驱动 ExperimentRun 流程（快照配置 → ready → 筛选 → 候选快照），
//     无 runId 时保留 legacy 手动流程（LegacyWorkbench）。
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  ListChecks,
  Play,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { runScreening, runScreeningForRun } from '@/lib/api'
import { getDB, subscribeDB, uid, updateDB } from '@/lib/store'
import {
  completeScreening,
  failScreening,
  factorFromSnapshot,
  getCandidateSnapshot,
  getRun,
  markRunReady,
  retryFromFailed,
  startScreening,
  strategyFromSnapshot,
} from '@/lib/experimentRun'
import type { ExperimentRun, StrategyCondition, WatchItem, WatchList } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PortfolioRisk, LazyLoader } from '@/components/LazyComponents'

/** 有方向语义的因子字段：asc = 反转型（值小好，买跌），desc = 动量型（值大好，追涨） */
const DIRECTIONAL_FACTOR_FIELDS = new Set(['mom20', 'mom60', 'ret5', 'sharpe20', 'pos60'])

/** 策略条件是否为动量/趋势方向（涨幅下限 ≥ 0、涨幅排名前 N%、站上均线） */
function isMomentumCondition(c: StrategyCondition): boolean {
  if (c.field === 'above_ma' || c.field === 'mom_rank') return true
  if (c.field === 'mom_range' && Array.isArray(c.value)) return c.value[0] >= 0
  return false
}

/** 策略条件是否为反转方向（涨幅区间上限 ≤ 0） */
function isReversalCondition(c: StrategyCondition): boolean {
  return c.field === 'mom_range' && Array.isArray(c.value) && c.value[1] <= 0
}

/**
 * 页面入口：有 runId → V2 Run 流程；无 runId → legacy 手动流程（行为不变）。
 */
export default function WorkbenchPage() {
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  if (runId) return <RunWorkbench runId={runId} />
  return <LegacyWorkbench />
}

/** V2：从 Run 快照还原策略/因子选择列表（禁止从 db 重新拼装，规则1/4/6） */
function RunWorkbench({ runId }: { runId: string }) {
  const navigate = useNavigate()
  const [, setVersion] = useState(0)
  const [run, setRun] = useState<ExperimentRun | null>(() => getRun(runId))
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([])
  const [selectedFactorIds, setSelectedFactorIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [runError, setRunError] = useState('')
  const [savedName, setSavedName] = useState<string | null>(null)
  const [listName, setListName] = useState('')

  // db 事件（服务落盘）驱动刷新
  useEffect(
    () =>
      subscribeDB(() => {
        setVersion((v) => v + 1)
        setRun(getRun(runId))
      }),
    [runId],
  )

  // draft 且快照非空 → markRunReady（快照在 Strategies/Factors 页固化，
  // 或 HomePage NL→seedRunFromNL 异步写入后快照从 0→N，此处重跑就绪）
  useEffect(() => {
    const current = getRun(runId)
    if (current && current.status === 'draft' && current.strategySnapshots.length > 0) {
      try {
        setRun(markRunReady(runId))
      } catch {
        // 配置不完整（如策略快照为空）时保持 draft，等待补齐
      }
    }
  }, [runId, run?.status, run?.strategySnapshots.length])

  // 从 Run 快照还原可执行对象；选择项默认全选，失效项自动修剪
  const strategies = (run?.strategySnapshots ?? []).map(strategyFromSnapshot)
  const factors = (run?.factorSnapshots ?? []).map(factorFromSnapshot)

  useEffect(() => {
    if (!run) return
    const sIds = run.strategySnapshots.map((s) => s.strategyId)
    const fIds = run.factorSnapshots.map((f) => f.factorId)
    setSelectedStrategyIds((prev) => (prev.length === 0 ? sIds : prev.filter((id) => sIds.includes(id))))
    setSelectedFactorIds((prev) => (prev.length === 0 ? fIds : prev.filter((id) => fIds.includes(id))))
  }, [run])

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const snapshot = getCandidateSnapshot(runId)
  const results: WatchItem[] = (snapshot?.candidates ?? []).map((c) => ({
    code: c.stockCode,
    name: c.stockName,
    reasons: c.inclusionReasons ?? c.strategyMatches ?? [],
  }))
  const canRun = run !== null && selectedStrategyIds.length >= 1 && !loading

  const handleRun = async () => {
    if (!run || selectedStrategyIds.length === 0) return
    setLoading(true)
    setSavedName(null)
    setRunError('')
    try {
      // 状态就绪：failed → retryFromFailed(attempt+1, 保留快照) → draft → markRunReady
      let current = getRun(runId)
      if (current?.status === 'failed') current = retryFromFailed(runId)
      current = getRun(runId)
      if (current?.status === 'draft' && current.strategySnapshots.length > 0) current = markRunReady(runId)
      if (!current || current.status !== 'ready') {
        throw new Error(
          `Run 状态「${current?.status ?? '未知'}」无法开始筛选：请先在「策略池」/「因子实验室」完成快照`,
        )
      }
      startScreening(runId)
      // 筛选配置必须来自 Run 快照（规则1/4/6）：从快照还原策略/因子对象，绝不从 db 拼装
      const snapRun = getRun(runId) as ExperimentRun
      const chosenStrategies = snapRun.strategySnapshots
        .filter((s) => selectedStrategyIds.includes(s.strategyId))
        .map(strategyFromSnapshot)
      const chosenFactors = snapRun.factorSnapshots
        .filter((f) => selectedFactorIds.includes(f.factorId))
        .map(factorFromSnapshot)
      const candidates = await runScreeningForRun(chosenStrategies, chosenFactors)
      // 完成筛选：创建独立 CandidateSnapshot（深拷贝 candidate 数组，不依赖 WatchList）
      completeScreening(runId, candidates)
      setRun(getRun(runId))
    } catch (e) {
      const msg = e instanceof Error ? e.message : '筛选引擎运行失败，请稍后重试'
      // 失败必须写入 attempts 并保留可诊断原因（服务 failScreening 完成）
      if (getRun(runId)?.status === 'running_screen') {
        try {
          failScreening(runId, msg)
          setRun(getRun(runId))
        } catch {
          // 状态已变化（如并发重试）则跳过
        }
      }
      setRunError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    const name = listName.trim()
    if (!name || !run?.candidateSnapshotId) return
    const snap = getCandidateSnapshot(runId)
    if (!snap) return
    updateDB((db) => {
      db.watchlists.push({
        id: uid(),
        name,
        strategyIds: run.strategySnapshots.map((s) => s.strategyId),
        factorIds: run.factorSnapshots.map((f) => f.factorId),
        items: snap.candidates.map((c) => ({
          code: c.stockCode,
          name: c.stockName,
          reasons: c.inclusionReasons ?? [],
        })),
        createdAt: new Date().toISOString(),
        runId, // V2 溯源：清单 → Run → CandidateSnapshot
        candidateSnapshotId: snap.id, // 保留 candidateSnapshotId 关联
      } as WatchList)
    })
    setSavedName(name)
    setListName('')
  }

  const statusLabel: Record<string, string> = {
    draft: '草稿', ready: '已就绪', running_screen: '筛选中', screened: '已筛选',
    running_backtest: '回测中', completed: '已完成', failed: '失败',
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 页头 */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <SlidersHorizontal className="size-6 text-amber-500" />
          组合工作台
          <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700">
            V2 Run #{runId.slice(-6)}
          </Badge>
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Run「{run?.originalQuery.raw ?? '…'}」· asOfDate {run?.asOfDate ?? '—'} · configHash{' '}
          <span className="font-mono">{run?.configHash ? run.configHash.slice(0, 12) : '—'}</span> ·
          尝试 {run?.attempt ?? 0} 次
        </p>
        {run?.status && (
          <p className="mt-2 text-sm text-gray-600">
            当前状态：<Badge className="border-cyan-500/40 bg-cyan-500/10 text-cyan-300">{statusLabel[run.status]}</Badge>
            {run.status === 'failed' && run.failureReason && (
              <span className="ml-2 text-rose-400">失败原因：{run.failureReason}</span>
            )}
          </p>
        )}
        {!run && (
          <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">
            Run 不存在（{runId}），请回到首页重新发起搜索。
          </p>
        )}
      </div>

      {run && (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* 左栏：Run 快照中的策略 + 因子 */}
          <div className="flex flex-col gap-6">
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <ListChecks className="size-4 text-amber-500" />
                  策略选择池（Run 快照）
                </h2>
                <span className="font-mono tabular-nums text-xs text-gray-400">
                  {selectedStrategyIds.length}/{strategies.length}
                </span>
              </div>
              {strategies.length === 0 ? (
                <p className="text-sm text-gray-400">
                  快照中暂无策略，请先到「策略池」页面创建/启用策略（Run 处于 draft 时自动固化）。
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {strategies.map((s) => {
                    const checked = selectedStrategyIds.includes(s.id)
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                          checked ? 'border-cyan-400/50 bg-cyan-500/5' : 'border-gray-200 hover:border-gray-300',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(selectedStrategyIds, s.id, setSelectedStrategyIds)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="text-sm font-medium text-gray-800">{s.name}</span>
                          <span className="mt-1 block text-xs text-gray-400">
                            {s.conditions.length} 个条件（快照固化）
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Layers className="size-4 text-amber-500" />
                  因子选择池（Run 快照）
                </h2>
                <span className="font-mono tabular-nums text-xs text-gray-400">
                  {selectedFactorIds.length}/{factors.length}
                </span>
              </div>
              {factors.length === 0 ? (
                <p className="text-sm text-gray-400">
                  快照中暂无因子，请先到「因子实验室」将因子加入选择池（Run 处于 draft 时自动固化）。
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {factors.map((f) => {
                    const checked = selectedFactorIds.includes(f.id)
                    return (
                      <label
                        key={f.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                          checked ? 'border-cyan-400/50 bg-cyan-500/5' : 'border-gray-200 hover:border-gray-300',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(selectedFactorIds, f.id, setSelectedFactorIds)}
                        />
                        <span className="flex-1 text-sm font-medium text-gray-800">{f.name}</span>
                        <Badge variant="outline" className="border-cyan-500/30 bg-amber-100 text-amber-500">
                          {f.category}
                        </Badge>
                      </label>
                    )
                  })}
                </div>
              )}
            </section>

            <Button
              onClick={handleRun}
              disabled={!canRun || run.status === 'screened' || run.status === 'running_screen' || run.status === 'running_backtest'}
              className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              <Play className="size-4" />
              {loading
                ? '筛选引擎运行中…'
                : run.status === 'failed'
                  ? '重试筛选（attempt+1）'
                  : run.status === 'screened'
                    ? '已完成筛选'
                    : run.status === 'completed'
                      ? '已完成'
                      : '生成备选清单'}
            </Button>
            {selectedStrategyIds.length === 0 && (
              <p className="mt-2 text-center text-xs text-amber-400/90">请至少选择 1 个策略后再运行筛选</p>
            )}
          </div>

          {/* 右栏：结果区 */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-800">筛选结果（Run 候选快照）</h2>
              {results.length > 0 && (
                <span className="font-mono tabular-nums text-xs text-gray-400">共 {results.length} 只股票</span>
              )}
            </div>

            {run.status === 'screened' && snapshot && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>
                  候选快照 {snapshot.id.slice(-6)} 已创建（独立于备选清单），configHash 与 Run 一致。
                </span>
                <Button
                  size="sm"
                  onClick={() => navigate(`/backtest?runId=${runId}`)}
                  className="ml-auto shrink-0 border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                >
                  下一步：回测
                </Button>
              </div>
            )}

            {runError && !loading && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
                <p className="text-sm text-rose-300">{runError}</p>
                {run.status === 'failed' && (
                  <Button variant="outline" size="sm" onClick={handleRun} className="shrink-0 border-rose-500/40 text-rose-300 hover:bg-rose-500/10">
                    重试
                  </Button>
                )}
              </div>
            )}

            {savedName && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>清单「{savedName}」已保存（关联 CandidateSnapshot {snapshot?.id.slice(-6)}），可前往「备选清单」页查看。</span>
              </div>
            )}

            {run.status === 'draft' && strategies.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/40 p-16 text-center">
                <Play className="size-8 text-gray-300" />
                <p className="text-sm text-gray-400">
                  Run 尚无策略快照：请先到「策略池」创建/启用策略，快照将自动固化到本 Run。
                </p>
              </div>
            )}

            {run.status === 'running_screen' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-16">
                <div className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-cyan-400" />
                <p className="text-sm text-gray-500">筛选引擎运行中…</p>
              </div>
            )}

            {run.status === 'screened' && results.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/40 p-16 text-center">
                <p className="text-sm text-gray-400">当前组合未筛出股票，试试调整策略或因子。</p>
              </div>
            )}

            {run.status === 'screened' && results.length > 0 && (
              <>
                <div className="flex flex-col gap-3">
                  {results.map((item, i) => (
                    <div key={item.code} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-gray-400">#{i + 1}</span>
                        <span className="text-base font-semibold text-gray-900">{item.name}</span>
                        <span className="font-mono tabular-nums text-sm text-gray-400">{item.code}</span>
                        <Badge variant="outline" className="ml-auto border-cyan-500/30 bg-amber-100 font-mono tabular-nums text-amber-500">
                          {item.reasons.length} 条原因
                        </Badge>
                      </div>
                      <ul className="mt-3 flex flex-col gap-1.5 border-t border-gray-200/80 pt-3">
                        {item.reasons.map((r, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-400" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* 保存清单（保留 candidateSnapshotId 关联） */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <Save className="size-4 text-amber-500" />
                    保存为备选清单（关联 Run #{runId.slice(-6)}）
                  </h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                      placeholder="输入清单名称，如：价值 + 动量组合"
                      className="border-gray-300 bg-gray-100 text-gray-800 placeholder:text-gray-300"
                    />
                    <Button
                      onClick={handleSave}
                      disabled={!listName.trim()}
                      variant="outline"
                      className="shrink-0 border-cyan-500/40 text-amber-500 hover:bg-amber-100"
                    >
                      <Save className="size-4" />
                      保存清单
                    </Button>
                  </div>
                </div>
              </>
            )}

            {(run.status === 'running_backtest' || run.status === 'completed' || run.status === 'failed') && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-white/40 p-16 text-center">
                <p className="text-sm text-gray-500">
                  {run.status === 'running_backtest' && 'Run 正在进行回测，请前往「回测分析」页查看进度。'}
                  {run.status === 'completed' && 'Run 已回测完成，可前往「回测分析」页查看结果。'}
                  {run.status === 'failed' && `筛选阶段失败：${run.failureReason ?? '未知原因'}（可点击上方「重试筛选」）。`}
                </p>
                <Button variant="outline" size="sm" onClick={() => navigate(`/backtest?runId=${runId}`)} className="border-cyan-500/40 text-amber-500 hover:bg-amber-100">
                  前往回测分析
                </Button>
              </div>
            )}
          </section>

          <LazyLoader><PortfolioRisk /></LazyLoader>
        </div>
      )}
    </div>
  )
}

/** legacy：无 runId 的手动工作台（行为不变） */
function LegacyWorkbench() {
  const [, setVersion] = useState(0)
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([])
  const [selectedFactors, setSelectedFactors] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)
  const [loading, setLoading] = useState(false)
  const [runError, setRunError] = useState('')
  const [ran, setRan] = useState(false)
  const [results, setResults] = useState<WatchItem[]>([])
  const [listName, setListName] = useState('')
  const [savedName, setSavedName] = useState<string | null>(null)

  useEffect(() => subscribeDB(() => setVersion((v) => v + 1)), [])

  const db = getDB()
  // db.strategies / db.factorPool 为原地变更（push/splice 不改引用），不能作为 useMemo
  // 依赖；数组很小，每次渲染直接计算，保证 db 事件驱动的刷新拿到最新数据
  const enabledStrategies = db.strategies.filter((s) => s.enabled)
  const poolFactors = db.factorPool
    .map((id) => db.factors.find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))

  // 首次进入默认全选；之后只有当因子池/策略的实际内容变化时才修剪
  const prevPoolRef = useRef<string>('')
  const currPoolKey = JSON.stringify([[...db.factorPool].sort(), enabledStrategies.map(s => s.id).sort()])

  useEffect(() => {
    // 初始默认全选
    if (!initialized) {
      setSelectedStrategies(enabledStrategies.map((s) => s.id))
      setSelectedFactors(poolFactors.map((f) => f.id))
      setInitialized(true)
      prevPoolRef.current = currPoolKey
      return
    }
    // 内容未变化则跳过
    if (prevPoolRef.current === currPoolKey) return
    prevPoolRef.current = currPoolKey
    // 修剪已失效的选项
    setSelectedFactors((prev) => prev.filter((id) => db.factorPool.includes(id)))
    setSelectedStrategies((prev) =>
      prev.filter((id) => enabledStrategies.some((s) => s.id === id)),
    )
  }, [initialized, currPoolKey])

  const toggle = (
    list: string[],
    id: string,
    setter: (v: string[]) => void,
  ) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const canRun = selectedStrategies.length >= 1 && !loading

  // 因子 × 策略方向冲突检测：反转型因子(asc)遇动量/均线条件、动量型因子(desc)遇反转区间条件时预警。
  // 仅提示不阻止运行；选中项变化即时更新。
  const conflicts = useMemo(() => {
    const strategies = enabledStrategies.filter((s) => selectedStrategies.includes(s.id))
    const factors = poolFactors.filter((f) => selectedFactors.includes(f.id))
    const msgs: string[] = []
    for (const f of factors) {
      const r = f.rule
      if (!r || !DIRECTIONAL_FACTOR_FIELDS.has(r.field)) continue
      const reversal = r.dir === 'asc' // asc = 值小好 = 反转型；desc = 动量型
      for (const s of strategies) {
        const hit = s.conditions.some((c) =>
          reversal ? isMomentumCondition(c) : isReversalCondition(c),
        )
        if (hit) {
          msgs.push(
            `因子「${f.name}」（${reversal ? '反转型' : '动量型'}）与策略「${s.name}」的动量/均线条件方向相反，交集可能极小甚至为 0。建议拆分为两组分别运行，或调整其中一方。`,
          )
        }
      }
    }
    return msgs
  }, [enabledStrategies, poolFactors, selectedFactors, selectedStrategies])

  const handleRun = async () => {
    setLoading(true)
    setSavedName(null)
    setRunError('')
    try {
      const items = await runScreening(selectedStrategies, selectedFactors)
      setResults([...items].sort((a, b) => b.reasons.length - a.reasons.length))
      setRan(true)
    } catch (e) {
      setRan(false)
      setRunError(e instanceof Error ? e.message : '筛选引擎运行失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    const name = listName.trim()
    if (!name) return
    updateDB((db) => {
      db.watchlists.push({
        id: uid(),
        name,
        strategyIds: selectedStrategies,
        factorIds: selectedFactors,
        items: results,
        createdAt: new Date().toISOString(),
      })
    })
    setSavedName(name)
    setListName('')
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 页头 */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <SlidersHorizontal className="size-6 text-amber-500" />
          组合工作台
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          组合策略与因子运行筛选引擎，生成备选股票清单并保存。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* 左栏：策略池 + 因子池 */}
        <div className="flex flex-col gap-6">
          {/* 策略选择池 */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <ListChecks className="size-4 text-amber-500" />
                策略选择池
              </h2>
              <span className="font-mono tabular-nums text-xs text-gray-400">
                {selectedStrategies.length}/{enabledStrategies.length}
              </span>
            </div>
            {enabledStrategies.length === 0 ? (
              <p className="text-sm text-gray-400">
                暂无启用的策略，请先到「策略配置」页启用策略。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {enabledStrategies.map((s) => {
                  const checked = selectedStrategies.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        checked
                          ? 'border-cyan-400/50 bg-cyan-500/5'
                          : 'border-gray-200 hover:border-gray-300',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          toggle(selectedStrategies, s.id, setSelectedStrategies)
                        }
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">
                            {s.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-gray-300 bg-gray-100 font-mono tabular-nums text-gray-500"
                          >
                            {s.conditions.length} 个条件
                          </Badge>
                        </span>
                        <span className="mt-1 block text-xs text-gray-400">
                          {s.description}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          {/* 因子选择池 */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Layers className="size-4 text-amber-500" />
                因子选择池
              </h2>
              <span className="font-mono tabular-nums text-xs text-gray-400">
                {selectedFactors.length}/{poolFactors.length}
              </span>
            </div>
            {poolFactors.length === 0 ? (
              <p className="text-sm text-gray-400">
                因子选择池为空，请先到「因子实验室」将因子加入选择池。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {poolFactors.map((f) => {
                  const checked = selectedFactors.includes(f.id)
                  return (
                    <label
                      key={f.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                        checked
                          ? 'border-cyan-400/50 bg-cyan-500/5'
                          : 'border-gray-200 hover:border-gray-300',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          toggle(selectedFactors, f.id, setSelectedFactors)
                        }
                      />
                      <span className="flex-1 text-sm font-medium text-gray-800">
                        {f.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-cyan-500/30 bg-amber-100 text-amber-500"
                      >
                        {f.category}
                      </Badge>
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          {/* 运行按钮 */}
          <div>
            {conflicts.length > 0 && (
              <Alert className="mb-3 border-amber-500/40 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <AlertTitle className="text-amber-300">搭配提醒</AlertTitle>
                <AlertDescription className="text-amber-200/80">
                  <ul className="flex flex-col gap-1.5">
                    {conflicts.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Button
              onClick={handleRun}
              disabled={!canRun}
              className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              <Play className="size-4" />
              {loading ? '筛选引擎运行中…' : '生成备选清单'}
            </Button>
            {selectedStrategies.length === 0 && (
              <p className="mt-2 text-center text-xs text-amber-400/90">
                请至少选择 1 个策略后再运行筛选
              </p>
            )}
          </div>
        </div>

        {/* 右栏：结果区 */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-800">筛选结果</h2>
            {ran && (
              <span className="font-mono tabular-nums text-xs text-gray-400">
                共筛出 {results.length} 只股票
              </span>
            )}
          </div>

          {runError && !loading && (
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

          {savedName && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                清单「{savedName}」已保存成功，可前往「备选清单」页查看。
              </span>
            </div>
          )}

          {!ran && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/40 p-16 text-center">
              <Play className="size-8 text-gray-300" />
              <p className="text-sm text-gray-400">
                选择左侧的策略与因子，点击「生成备选清单」运行筛选引擎。
              </p>
            </div>
          )}

          {loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-16">
              <div className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-cyan-400" />
              <p className="text-sm text-gray-500">筛选引擎运行中…</p>
            </div>
          )}

          {ran && !loading && results.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/40 p-16 text-center">
              <p className="text-sm text-gray-400">
                当前组合未筛出股票，试试调整策略或因子。
              </p>
            </div>
          )}

          {ran && !loading && results.length > 0 && (
            <>
              <div className="flex flex-col gap-3">
                {results.map((item) => (
                  <div
                    key={item.code}
                    className="rounded-xl border border-gray-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-gray-900">
                        {item.name}
                      </span>
                      <span className="font-mono tabular-nums text-sm text-gray-400">
                        {item.code}
                      </span>
                      <Badge
                        variant="outline"
                        className="ml-auto border-cyan-500/30 bg-amber-100 font-mono tabular-nums text-amber-500"
                      >
                        {item.reasons.length} 条原因
                      </Badge>
                    </div>
                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-gray-200/80 pt-3">
                      {item.reasons.map((r, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-gray-700"
                        >
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-400" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* 保存清单 */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Save className="size-4 text-amber-500" />
                  保存为备选清单
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="输入清单名称，如：价值 + 动量组合"
                    className="border-gray-300 bg-gray-100 text-gray-800 placeholder:text-gray-300"
                  />
                  <Button
                    onClick={handleSave}
                    disabled={!listName.trim()}
                    variant="outline"
                    className="shrink-0 border-cyan-500/40 text-amber-500 hover:bg-amber-100"
                  >
                    <Save className="size-4" />
                    保存清单
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        <LazyLoader><PortfolioRisk /></LazyLoader>
      </div>
    </div>
  )
}
