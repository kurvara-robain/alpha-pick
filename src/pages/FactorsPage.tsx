// ─────────────────────────────────────────────────────────────
// P3 因子实验室 v3 — 紧凑摘要卡片 + 详情抽屉 + 双视图
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  Check,
  LayoutGrid,
  List,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getDB, updateDB } from '@/lib/store'
import {
  buildScreeningSpec,
  getRun,
  snapshotFactors,
  snapshotStrategies,
  updateRunConfiguration,
} from '@/lib/experimentRun'
import type { ExperimentRun, Factor } from '@/lib/types'
import type { FactorResearch, FactorResearchResult } from '@/lib/marketData'
import { loadFactorResearch } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { FactorDiagnostics, LazyLoader, FactorExpressionEditor, DiscoveredFactors } from '@/components/LazyComponents'

// ═══════════════════════════════════════════════════════════════
// 紧凑摘要卡片
// ═══════════════════════════════════════════════════════════════
function FactorCard({
  factor,
  isSelected,
  onToggle,
  onDetail,
}: {
  factor: Factor
  isSelected: boolean
  onToggle: () => void
  onDetail: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors cursor-pointer',
        isSelected
          ? 'border-amber-400 bg-amber-50/50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/20',
      )}
      onClick={onDetail}
    >
      {/* 第一行：名称 + 标签 */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 truncate">{factor.name}</h4>
          <p className="text-[10px] text-gray-400 font-mono truncate">{factor.id}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-gray-300 text-gray-500">{factor.category}</Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-gray-300 text-gray-400">{factor.origin}</Badge>
        </div>
      </div>

      {/* 第二行：一句话简介 */}
      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">
        {factor.definition?.slice(0, 100) ?? factor.notes?.slice(0, 100) ?? '暂无简介'}
      </p>

      {/* 第三行：指标 + 操作 */}
      <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-gray-50">
        <span className="text-[10px] text-gray-400 truncate max-w-[60%]">
          {factor.performance ? (
            <span className="text-gray-500">{factor.performance.slice(0, 40)}</span>
          ) : (
            <span className="text-gray-300">暂无实测</span>
          )}
        </span>
        <Button
          variant={isSelected ? 'outline' : 'outline'}
          size="sm"
          className={cn(
            'h-6 text-[10px] gap-1 shrink-0',
            isSelected
              ? 'border-amber-400 text-amber-600 bg-amber-50 hover:bg-amber-100'
              : 'border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600',
          )}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
        >
          {isSelected ? <><Check className="h-3 w-3" />已加入</> : '加入'}
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 右侧详情抽屉
// ═══════════════════════════════════════════════════════════════
function DetailDrawer({
  factor,
  isSelected,
  research,
  selectedFactors,
  onClose,
  onToggle,
}: {
  factor: Factor | null
  isSelected: boolean
  research: FactorResearch | null
  selectedFactors: Factor[]
  onClose: () => void
  onToggle: () => void
}) {
  if (!factor) return null

  const evalData = research?.results?.[factor.id.replace('f-jq-', '').replace('f-self-', '')]
    ?? research?.results?.[factor.id]

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      {/* 抽屉 */}
      <div className="fixed right-0 top-0 z-50 h-full w-[42%] min-w-[360px] max-w-[560px] border-l border-gray-200 bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">{factor.name}</h3>
            <p className="text-[11px] text-gray-400 font-mono">{factor.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={isSelected ? 'outline' : 'outline'}
              size="sm"
              className={cn(
                'h-7 text-xs',
                isSelected
                  ? 'border-amber-400 text-amber-600'
                  : 'border-gray-200 text-gray-500 hover:border-amber-300',
              )}
              onClick={onToggle}
            >
              {isSelected ? '移出选择池' : '加入选择池'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* 标签 */}
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{factor.category}</Badge>
            <Badge variant="outline" className="text-[10px] text-gray-400">{factor.origin}</Badge>
            {factor.source === 'public' && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">网络</Badge>}
            {factor.source === 'self' && <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-600">自研</Badge>}
          </div>

          {/* 定义 */}
          <section>
            <h4 className="text-xs font-semibold text-gray-700 mb-1">因子定义与计算逻辑</h4>
            <p className="text-xs text-gray-600 leading-relaxed">{factor.definition || '暂无定义'}</p>
          </section>

          {/* 适用环境 */}
          {factor.applicable && (
            <section>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">适用市场环境与范围</h4>
              <p className="text-xs text-gray-600">{factor.applicable}</p>
            </section>
          )}

          {/* 注意事项 */}
          {factor.notes && (
            <section>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">使用规范与注意事项</h4>
              <p className="text-xs text-gray-600">{factor.notes}</p>
            </section>
          )}

          {/* 实测数据 */}
          {evalData && (
            <section className="rounded-lg bg-gray-50 p-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">本系统实测</h4>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-gray-400">IC20</span><br /><span className="font-mono font-semibold">{evalData.ic20?.toFixed(4) ?? '–'}</span></div>
                <div><span className="text-gray-400">IR</span><br /><span className="font-mono font-semibold">{evalData.icir20?.toFixed(2) ?? '–'}</span></div>
                <div><span className="text-gray-400">胜率</span><br /><span className="font-mono font-semibold">{evalData.posRatio ? (evalData.posRatio * 100).toFixed(0) + '%' : '–'}</span></div>
                <div><span className="text-gray-400">多空利差</span><br /><span className="font-mono font-semibold">{evalData.spread20 ? (evalData.spread20 * 100).toFixed(1) + '%' : '–'}</span></div>
                <div><span className="text-gray-400">方向</span><br /><span className="font-mono">{evalData.dir ?? '–'}</span></div>
                <div><span className="text-gray-400">t值</span><br /><span className="font-mono">{evalData.tstat?.toFixed(1) ?? '–'}</span></div>
              </div>
            </section>
          )}

          {/* 历史表现 */}
          {factor.performance && (
            <section>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">历史有效性表现</h4>
              <p className="text-xs text-gray-600">{factor.performance}</p>
            </section>
          )}

          {/* 筛选规则 */}
          {factor.rule && (
            <section className="rounded-lg border border-gray-100 p-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1">筛选规则</h4>
              <p className="text-xs text-gray-500 font-mono">
                {factor.rule.field} {factor.rule.dir === 'asc' ? '升序' : '降序'} 前 {factor.rule.topPct * 100}%
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// 已选因子托盘
// ═══════════════════════════════════════════════════════════════
function SelectedTray({
  selected,
  onRemove,
}: {
  selected: Factor[]
  onRemove: (id: string) => void
}) {
  if (selected.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
      <span className="text-[11px] font-medium text-amber-700 mr-1">已选 {selected.length}</span>
      {selected.map((f) => (
        <Badge
          key={f.id}
          variant="outline"
          className="flex items-center gap-1 cursor-pointer border-amber-300 bg-white text-amber-700 text-[10px] px-2 py-0.5 hover:bg-amber-100"
        >
          {f.name}
          <X className="h-2.5 w-2.5 hover:text-red-500" onClick={(e) => { e.stopPropagation(); onRemove(f.id) }} />
        </Badge>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════
export default function FactorsPage() {
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const [pool, setPool] = useState<string[]>(() => getDB().factorPool)
  const [run, setRun] = useState<ExperimentRun | null>(() => (runId ? getRun(runId) : null))
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'ic'>('ic')
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')
  const [activeTab, setActiveTab] = useState<'library' | 'mining' | 'diagnostics'>('library')
  const [detailFactor, setDetailFactor] = useState<Factor | null>(null)

  const db = getDB()
  const factors = useMemo(() => {
    const pub = (db.factors ?? []).filter((f) => f.source === 'public')
    const self = (db.factors ?? []).filter((f) => f.source === 'self')
    return [...pub, ...self]
  }, [db.factors])

  const researchState = useAsync(loadFactorResearch)

  // 搜索 + 排序
  const filtered = useMemo(() => {
    let list = factors
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((f) =>
        f.name.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q) ||
        (f.origin ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [factors, search])

  const selectedFactors = useMemo(() => filtered.filter((f) => pool.includes(f.id)), [filtered, pool])

  const toggle = (id: string) => {
    updateDB((d) => {
      const idx = d.factorPool.indexOf(id)
      if (idx >= 0) d.factorPool.splice(idx, 1)
      else d.factorPool.push(id)
    })
    setPool(getDB().factorPool)
    syncRunConfig()
  }

  /**
   * V2：Run 处于 draft 时，因子池变化 → 重新固化快照（updateRunConfiguration 深拷贝）。
   * ready 以后配置冻结（服务强制），静默跳过 —— 修改配置必须新建 Run（规则2）。
   */
  const syncRunConfig = () => {
    if (!runId) return
    const current = getRun(runId)
    if (!current || current.status !== 'draft') return
    const db = getDB()
    const enabled = db.strategies.filter((s) => s.enabled)
    const poolFactors = db.factors.filter((f) => db.factorPool.includes(f.id))
    try {
      const updated = updateRunConfiguration(
        runId,
        buildScreeningSpec(current.asOfDate, enabled, poolFactors),
        snapshotStrategies(enabled),
        snapshotFactors(poolFactors),
        { mode: 'score', description: current.originalQuery.raw || '综合打分' },
      )
      setRun(updated)
    } catch {
      // 防御：配置已冻结/Run 不存在时不影响页面 legacy 操作
    }
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {run && (
        <p className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          V2 Run #{run.id.slice(-6)} · {run.status}
          <span className="text-amber-500">「{run.originalQuery.raw}」</span>
          {run.status === 'draft' ? '· 因子池变化将同步固化到 Run 快照' : '· 配置已冻结（ready 后修改需新建 Run）'}
        </p>
      )}
      {/* 已选托盘 */}
      <SelectedTray
        selected={selectedFactors}
        onRemove={(id) => toggle(id)}
      />

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="搜索因子名、ID、来源…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Button
            variant={viewMode === 'cards' ? 'outline' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setViewMode('cards')}
          >
            <LayoutGrid className="h-3 w-3" />卡片
          </Button>
          <Button
            variant={viewMode === 'table' ? 'outline' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setViewMode('table')}
          >
            <List className="h-3 w-3" />表格
          </Button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex items-center gap-0.5 border-b border-gray-200 pb-0">
        {(['library','mining','diagnostics'] as const).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-t transition-colors -mb-px',
              activeTab === tab
                ? 'border-x border-t border-gray-200 bg-white text-gray-900'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            )}>
            {{library:'因子库',mining:'因子挖掘',diagnostics:'实测诊断'}[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'library' && <>
      {/* 因子列表 */}
      {viewMode === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((f) => (
            <FactorCard
              key={f.id}
              factor={f}
              isSelected={pool.includes(f.id)}
              onToggle={() => toggle(f.id)}
              onDetail={() => setDetailFactor(f)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto max-w-full rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium">因子</th>
                <th className="px-3 py-2 font-medium">类别</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 text-right font-medium">IC20</th>
                <th className="px-3 py-2 text-right font-medium">IR</th>
                <th className="px-3 py-2 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const evalData = researchState.data?.results?.[f.id]
                const icVal = (evalData as any)?.dic20
                const irVal = (evalData as any)?.dicir20
                return (
                  <tr
                    key={f.id}
                    className={cn(
                      'border-t border-gray-50 hover:bg-amber-50/20 cursor-pointer',
                      pool.includes(f.id) && 'bg-amber-50/30',
                    )}
                    onClick={() => setDetailFactor(f)}
                  >
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-gray-800">{f.name}</span>
                      <span className="ml-1.5 text-[10px] text-gray-400">{f.id.slice(0,12)}</span>
                    </td>
                    <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{f.category}</Badge></td>
                    <td className="px-3 py-1.5 text-gray-500">{f.origin}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-600">{typeof icVal === 'number' ? icVal.toFixed(4) : '–'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-600">{typeof irVal === 'number' ? irVal.toFixed(2) : '–'}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('h-6 text-[10px]', pool.includes(f.id) ? 'text-amber-600' : 'text-gray-400')}
                        onClick={(e) => { e.stopPropagation(); toggle(f.id) }}
                      >
                        {pool.includes(f.id) ? '已选' : '选择'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 空状态 */}
      {filtered.length === 0 && (
        <div className="py-12 text-center text-gray-400 text-xs">未找到匹配的因子</div>
      )}

      {/* 详情抽屉 */}
      <DetailDrawer
        factor={detailFactor}
        isSelected={detailFactor ? pool.includes(detailFactor.id) : false}
        research={researchState.data ?? null}
        selectedFactors={selectedFactors}
        onClose={() => setDetailFactor(null)}
        onToggle={() => detailFactor && toggle(detailFactor.id)}
      />

      {/* 底部面板 */}
      </>
      }

      {activeTab === 'mining' && <>
      <LazyLoader><FactorExpressionEditor /></LazyLoader>
      <LazyLoader><DiscoveredFactors /></LazyLoader>
      </>
      }
      {activeTab === 'diagnostics' && <>
      <LazyLoader><FactorDiagnostics /></LazyLoader>
      </>
      }
    </div>
  )
}
