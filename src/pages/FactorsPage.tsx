// ─────────────────────────────────────────────────────────────
// P3 因子实验室：网络热门因子库 + 自研因子，管理因子选择池
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ExternalLink,
  FlaskConical,
  Layers,
  Plus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getDB, subscribeDB, updateDB } from '@/lib/store'
import type { Factor, FactorStatus } from '@/lib/types'
import { loadFactorResearch, loadMlBacktest } from '@/lib/marketData'
import type { FactorResearch, FactorResearchResult } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { FactorDiagnostics, LazyLoader } from '@/components/LazyComponents'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const STATUS_STYLE: Record<FactorStatus, string> = {
  挖掘中: 'border-gray-400 bg-slate-500/10 text-gray-500',
  测试中: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  已验证: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  已弃用: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
}

// ── 因子实测评估（factor-research.json）──────────────────────────

type SortKey = 'name' | 'kind' | 'dir' | 'dic20' | 'dicir20' | 'tstat' | 'winRate' | 'spread' | 'decay'

const KIND_LABEL: Record<FactorResearchResult['kind'], { label: string; cls: string }> = {
  composite: { label: 'ML合成', cls: 'border-amber-400/50 bg-amber-400/10 text-amber-300' },
  core: { label: '核心', cls: 'border-cyan-500/30 bg-amber-100 text-amber-500' },
  candidate: { label: '候选', cls: 'border-gray-400 bg-gray-100 text-gray-500' },
}

/** IC 着色：正绿负红，|值| 越大越实 */
function icColor(v: number): string {
  const a = Math.min(0.45 + Math.abs(v) / 0.12, 1).toFixed(2)
  return v >= 0 ? `rgba(52, 211, 153, ${a})` : `rgba(251, 113, 133, ${a})`
}

/** 方向化均值：asc 因子 IC 取负（与 dic20 同口径，正 = 符合预期） */
function dirMean(r: FactorResearchResult, stat: { mean: number | null } | null): number | null {
  if (!stat || stat.mean === null) return null
  return r.dir === 'asc' ? -stat.mean : stat.mean
}

interface EvalRow {
  field: string
  r: FactorResearchResult
  tstat: number | null
  winRate: number | null
  decay: (number | null)[] // dic5 → dic10 → dic20 → dic40
}

/** ML 信号样本外回测卡片：净值曲线 + 指标条（loadMlBacktest 为 null 时不渲染） */
function MlBacktestCard() {
  const { data: bt } = useAsync(loadMlBacktest)
  if (!bt) return null
  const m = bt.metrics
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  const posNeg = (v: number) => (v >= 0 ? 'text-emerald-300' : 'text-rose-300')
  const chips: { label: string; value: string; cls: string }[] = [
    { label: '区间收益（组合 vs 基准）', value: `${pct(m.totalReturn)} vs ${pct(m.benchReturn)}`, cls: 'text-gray-900' },
    { label: '年化超额', value: pct(m.annExcess), cls: posNeg(m.annExcess) },
    { label: '最大回撤', value: `${m.maxDrawdown.toFixed(1)}%`, cls: 'text-rose-300' },
    { label: '夏普', value: m.sharpe.toFixed(2), cls: 'text-gray-900' },
    { label: '周胜率（对基准）', value: `${m.winRateVsBench.toFixed(1)}%`, cls: 'text-gray-900' },
    { label: '十分组利差（年化）', value: pct(m.decileSpreadAnn), cls: posNeg(m.decileSpreadAnn) },
    { label: '样本外 IC', value: m.oosIc.toFixed(3), cls: posNeg(m.oosIc) },
  ]
  return (
    <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-amber-200">ML 信号样本外回测</h3>
        <Badge variant="outline" className="border-amber-400/50 bg-amber-400/10 text-[10px] text-amber-300">
          严格样本外 · top30 周度调仓
        </Badge>
        {bt.metrics.pitMode ? (
          <Badge variant="outline" className="border-emerald-400/50 bg-emerald-400/10 text-[10px] text-emerald-300">
            时点正确口径 · 含退市股+历史ST
          </Badge>
        ) : (
          <Badge variant="outline" className="border-slate-500/50 bg-slate-500/10 text-[10px] text-gray-500">
            标准口径 · 未含退市股
          </Badge>
        )}
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={bt.curve} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#1e293b' }}
              minTickGap={48}
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value, name) => [
                typeof value === 'number' ? value.toFixed(4) : '-',
                name === 'port' ? '组合净值' : '沪深300',
              ]}
            />
            <Line
              type="monotone"
              dataKey="port"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="bench"
              stroke="#64748b"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {chips.map((c) => (
          <div key={c.label} className="rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 py-2">
            <div className="text-[10px] leading-tight text-gray-400">{c.label}</div>
            <div className={cn('mt-0.5 font-mono text-sm font-semibold tabular-nums', c.cls)}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        {bt.method} · 更新于 {bt.updatedAt.slice(0, 10)} · 历史回测不代表未来收益
      </p>
    </div>
  )
}

/** 表头排序单元格（模块级组件，避免渲染期创建组件被 React Compiler 报错） */
function Th({
  label,
  k,
  className,
  sort,
  onSort,
}: {
  label: string
  k: SortKey
  className?: string
  sort: { key: SortKey; asc: boolean }
  onSort: (key: SortKey) => void
}) {
  return (
    <th
      onClick={() => onSort(k)}
      className={cn(
        'cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium text-gray-400 transition-colors hover:text-gray-700',
        sort.key === k && 'text-amber-500',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === k &&
          (sort.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </span>
    </th>
  )
}

function ResearchEvalSection({ research }: { research: FactorResearch }) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'dic20', asc: false })

  const rows = useMemo<EvalRow[]>(() => {
    const list = Object.entries(research.results).map(([field, r]) => ({
      field,
      r,
      tstat: r.ic20?.tstat ?? null,
      winRate: r.ic20?.posRatio ?? null,
      decay: [r.ic5, r.ic10, r.ic20, r.ic40].map((s) => dirMean(r, s)),
    }))
    const num = (x: EvalRow): number | null => {
      switch (sort.key) {
        case 'dic20': return Math.abs(x.r.dic20)
        case 'dicir20': return Math.abs(x.r.dicir20)
        case 'tstat': return x.tstat
        case 'winRate': return x.winRate
        case 'spread': return x.r.spread20
        case 'decay': return x.decay[1] // 按 dic10 排序代表衰减档位
        default: return null
      }
    }
    const cmp = (a: EvalRow, b: EvalRow): number => {
      if (sort.key === 'name') return a.r.name.localeCompare(b.r.name, 'zh-CN')
      if (sort.key === 'kind') return a.r.kind.localeCompare(b.r.kind)
      if (sort.key === 'dir') return a.r.dir.localeCompare(b.r.dir)
      const va = num(a)
      const vb = num(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1 // null 沉底
      if (vb === null) return -1
      return va - vb
    }
    list.sort((a, b) => (sort.asc ? cmp(a, b) : cmp(b, a) || a.r.name.localeCompare(b.r.name, 'zh-CN')))
    // composite（ML 合成）无条件置顶
    return [...list.filter((x) => x.r.kind === 'composite'), ...list.filter((x) => x.r.kind !== 'composite')]
  }, [research.results, sort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: false }))

  const fmtNum = (v: number | null, digits = 3) => (v === null ? '–' : v.toFixed(digits))

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
      <MlBacktestCard />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <BarChart3 className="size-4 text-amber-500" />
          因子实测评估
        </h2>
        <p className="max-w-2xl truncate text-xs text-gray-400" title={research.method}>
          更新于 {research.updatedAt.slice(0, 10)} · {research.window.evalDates} 个评估日 /{' '}
          {research.window.stocks} 只股票 · 方法：{research.method}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <Th label="因子名" k="name" sort={sort} onSort={toggleSort} />
              <Th label="类别" k="kind" sort={sort} onSort={toggleSort} />
              <Th label="方向" k="dir" sort={sort} onSort={toggleSort} />
              <Th label="IC20" k="dic20" sort={sort} onSort={toggleSort} />
              <Th label="ICIR" k="dicir20" sort={sort} onSort={toggleSort} />
              <Th label="t值" k="tstat" sort={sort} onSort={toggleSort} />
              <Th label="胜率" k="winRate" sort={sort} onSort={toggleSort} />
              <Th label="多空利差" k="spread" sort={sort} onSort={toggleSort} />
              <Th label="衰减 5→10→20→40" k="decay" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ field, r, tstat, winRate, decay }) => {
              const composite = r.kind === 'composite'
              return (
                <tr
                  key={field}
                  className={cn(
                    'border-b border-gray-200/60',
                    composite
                      ? 'border-l-2 border-l-amber-400/80 bg-amber-400/5'
                      : 'hover:bg-gray-200/30',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn('font-medium', composite ? 'text-amber-200' : 'text-gray-800')}>
                      {r.name}
                    </span>
                    <span className="ml-1.5 font-mono text-[10px] text-gray-300">{field}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn('text-[10px]', KIND_LABEL[r.kind].cls)}>
                      {KIND_LABEL[r.kind].label}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {r.dir === 'asc' ? '值小为好' : '值大为好'}
                  </td>
                  <td
                    className="px-3 py-2 font-mono font-semibold tabular-nums"
                    style={{ color: icColor(r.dic20) }}
                  >
                    {r.dic20 >= 0 ? '+' : ''}
                    {r.dic20.toFixed(3)}
                  </td>
                  <td
                    className="px-3 py-2 font-mono tabular-nums"
                    style={{ color: icColor(r.dicir20) }}
                  >
                    {r.dicir20.toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 font-mono tabular-nums',
                      tstat !== null && Math.abs(tstat) > 2 ? 'text-gray-800' : 'text-gray-400',
                    )}
                  >
                    {fmtNum(tstat, 2)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-gray-500">
                    {winRate === null ? '–' : `${(winRate * 100).toFixed(0)}%`}
                  </td>
                  <td
                    className="px-3 py-2 font-mono tabular-nums"
                    style={r.spread20 === null ? undefined : { color: icColor(r.spread20 / 100) }}
                  >
                    {r.spread20 === null ? '–' : `${r.spread20 >= 0 ? '+' : ''}${r.spread20.toFixed(1)}%`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {decay.map((d, i) => (
                      <span key={i}>
                        {i > 0 && <span className="text-slate-700">→</span>}
                        {d === null ? (
                          <span className="text-gray-300">–</span>
                        ) : (
                          <span style={{ color: icColor(d) }}>{d.toFixed(3)}</span>
                        )}
                      </span>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs font-medium text-gray-400">{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-gray-700">{value}</p>
    </div>
  )
}

/** 本系统实测徽区块：dic20 为方向化 IC20（正 = 符合因子预期方向）；显著(|t|>2)且为正绿调、为负红调，不显著灰调。
 *  ic20 及其指标可能为 null（如 ML 合成条目缺 tstat），逐一防御。 */
function ResearchBadge({ r }: { r: FactorResearchResult }) {
  const ic20 = r.ic20
  if (!ic20) return null
  const dirSign = r.dir === 'asc' ? -1 : 1
  const dirIr = ic20.ir === null ? null : dirSign * ic20.ir // 方向化 IR，与 dic20 同口径（正 = 符合预期）
  const significant = ic20.tstat !== null && Math.abs(ic20.tstat) > 2
  const tone = !significant
    ? 'border-gray-300 bg-gray-200/40 text-gray-500'
    : r.dic20 > 0
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
  const signed = (v: number, digits: number) => (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits))
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs leading-relaxed', tone)}>
      本系统实测（近1年全A）IC20 {signed(r.dic20, 3)}（方向化）
      {dirIr !== null && <> · IR {dirIr.toFixed(1)}（方向化）</>}
      {r.spread20 !== null && <> · 多空 {signed(r.spread20, 1)}%</>} · {ic20.dates} 个评估日
    </div>
  )
}

function FactorCard({
  factor,
  inPool,
  research,
  onToggle,
}: {
  factor: Factor
  inPool: boolean
  research?: FactorResearchResult
  onToggle: (id: string) => void
}) {
  const deprecated = factor.status === '已弃用'
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border bg-white p-5 transition-colors',
        inPool
          ? 'border-amber-400 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
          : 'border-gray-200',
        deprecated && 'opacity-60',
      )}
    >
      {factor.status && (
        <Badge
          variant="outline"
          className={cn('absolute right-4 top-4', STATUS_STYLE[factor.status])}
        >
          {factor.status}
        </Badge>
      )}

      <div className="pr-16">
        <h3
          className={cn(
            'text-base font-semibold text-gray-900',
            deprecated && 'line-through decoration-rose-400/60',
          )}
        >
          {factor.name}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {factor.sourceUrl ? (
            <a
              href={factor.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title="打开外部来源"
              className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:border-cyan-500/40 hover:text-amber-500"
            >
              {factor.origin}
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <Badge
              variant="outline"
              className="border-gray-300 bg-gray-100 text-gray-500"
            >
              {factor.origin}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="border-cyan-500/30 bg-amber-100 text-amber-500"
          >
            {factor.category}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 border-t border-gray-200/80 pt-3">
        <Field label="因子定义与计算逻辑" value={factor.definition} />
        <Field label="适用市场环境与范围" value={factor.applicable} />
        <Field label="使用规范与注意事项" value={factor.notes} />
        {factor.rule && (
          <p className="text-xs leading-relaxed text-amber-500/80">
            规则：{factor.rule.field} {factor.rule.dir === 'asc' ? '升序' : '降序'}前 {factor.rule.topPct}%（
            {factor.rule.dir === 'asc' ? '值小优先' : '值大优先'}）
          </p>
        )}
        {factor.performance && (
          <div>
            <div className="text-xs font-medium text-gray-400">历史有效性表现</div>
            <p className="mt-1 text-sm leading-relaxed text-emerald-300/90">
              {factor.performance}
            </p>
          </div>
        )}
        {research && <ResearchBadge r={research} />}
      </div>

      <Button
        size="sm"
        variant={inPool ? 'secondary' : 'outline'}
        onClick={() => onToggle(factor.id)}
        className={cn(
          'mt-1 w-full',
          inPool
            ? 'border border-cyan-500/40 bg-amber-100 text-amber-500 hover:bg-cyan-500/20'
            : 'border-gray-300 text-gray-700 hover:border-cyan-500/40 hover:text-amber-500',
        )}
      >
        {inPool ? (
          <>
            <Check className="size-4" /> 已在选择池 · 点击移出
          </>
        ) : (
          <>
            <Plus className="size-4" /> 加入选择池
          </>
        )}
      </Button>
    </div>
  )
}

export default function FactorsPage() {
  const [, setVersion] = useState(0)
  const [category, setCategory] = useState<string>('全部')

  useEffect(() => subscribeDB(() => setVersion((v) => v + 1)), [])

  // 每周自研实测数据（factor-research.json，加载失败为 null，不阻塞页面）
  const { data: factorResearch, loading: researchLoading } = useAsync(loadFactorResearch)

  const db = getDB()
  const pool = db.factorPool
  // db.factors 为原地变更（push/splice 不改引用），不能作为 useMemo 依赖；
  // 数组很小（~30 条），每次渲染直接过滤，保证合并联网收集因子后立即可见
  const publicFactors = db.factors.filter((f) => f.source === 'public')
  const selfFactors = db.factors.filter((f) => f.source === 'self')

  const categories = ['全部', ...Array.from(new Set(db.factors.map((f) => f.category)))]

  const applyFilter = (list: Factor[]) =>
    category === '全部' ? list : list.filter((f) => f.category === category)

  const togglePool = (id: string) => {
    updateDB((db) => {
      const i = db.factorPool.indexOf(id)
      if (i >= 0) db.factorPool.splice(i, 1)
      else db.factorPool.push(id)
    })
  }

  const renderGrid = (list: Factor[]) => {
    const filtered = applyFilter(list)
    if (filtered.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white/40 p-10 text-center text-sm text-gray-400">
          该分类下暂无因子，换个分类看看。
        </div>
      )
    }
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((f) => (
          <FactorCard
            key={f.id}
            factor={f}
            inPool={pool.includes(f.id)}
            research={f.rule && factorResearch ? factorResearch.results[f.rule.field] : undefined}
            onToggle={togglePool}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <FlaskConical className="size-6 text-amber-500" />
            因子实验室
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            浏览网络热门因子与自研因子，将可用因子加入选择池，供组合工作台调用。
          </p>
          {factorResearch && (
            <p className="mt-1 max-w-2xl truncate text-xs text-gray-400" title={factorResearch.method}>
              实测数据更新于 {factorResearch.updatedAt.slice(0, 10)} · {factorResearch.window.evalDates}{' '}
              个评估日 / {factorResearch.window.stocks} 只股票 · 方法：{factorResearch.method}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2">
          <Layers className="size-4 text-amber-500" />
          <span className="text-sm text-gray-700">
            已选{' '}
            <span className="font-mono tabular-nums text-base font-semibold text-amber-500">
              {pool.length}
            </span>{' '}
            个因子
          </span>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">分类筛选</span>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              category === c
                ? 'border-amber-400 bg-amber-100 text-amber-500'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-800',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <Tabs defaultValue="public">
        <TabsList className="border border-gray-200 bg-white">
          <TabsTrigger value="public">
            网络热门因子库
            <span className="ml-1.5 font-mono tabular-nums text-xs text-gray-400">
              {publicFactors.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="self">
            自研因子
            <span className="ml-1.5 font-mono tabular-nums text-xs text-gray-400">
              {selfFactors.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="public" className="mt-4">
          <p className="mb-3 text-xs text-gray-400">
            来自 WorldQuant Alpha101、Fama-French、国泰君安 191、聚宽 / 米筐社区等公开来源的经典因子。
          </p>
          {renderGrid(publicFactors)}
        </TabsContent>

        <TabsContent value="self" className="mt-4">
          <p className="mb-3 text-xs text-gray-400">
            本系统自研因子，按研发阶段标记：挖掘中 / 测试中 / 已验证 / 已弃用（已弃用因子置灰显示，不建议入池）。
          </p>
          {renderGrid(selfFactors)}
        </TabsContent>
      </Tabs>

      {/* 因子实测评估（每周自研实测产出） */}
      {!researchLoading &&
        (factorResearch ? (
          <ResearchEvalSection research={factorResearch} />
        ) : (
          <section className="rounded-xl border border-dashed border-gray-200 bg-white/40 p-10 text-center text-sm text-gray-400">
            等待首次周度实测
          </section>
        ))}
      <LazyLoader><FactorDiagnostics /></LazyLoader>
    </div>
  )
}
