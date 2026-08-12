// ─────────────────────────────────────────────────────────────
// V1.5 DSL 可视化编辑器
// 拖拽式条件构建 + 实时预览 + YAML 导出
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Code, Copy, Eye, EyeOff, Plus, Trash2, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildDSLFromNL,
  serializeDSL,
  validateDSL,
} from '@/lib/strategyDSL'
import type { StrategyDSL, FilterCondition, SignalSpec } from '@/lib/strategyDSL'
import type { StrategyCondition } from '@/lib/types'

// ═══════════════════════════════════════════════════════════════
// 字段选项
// ═══════════════════════════════════════════════════════════════

const FIELD_OPTIONS = [
  { field: 'pe', label: 'PE(TTM)', type: 'number' },
  { field: 'pb', label: 'PB', type: 'number' },
  { field: 'mktCap', label: '总市值(亿)', type: 'number' },
  { field: 'roe', label: 'ROE(%)', type: 'number' },
  { field: 'turnover', label: '换手率(%)', type: 'number' },
  { field: 'mom20', label: '20日动量(%)', type: 'number' },
  { field: 'mom60', label: '60日动量(%)', type: 'number' },
  { field: 'vol20', label: '20日波动率(%)', type: 'number' },
  { field: 'vol60', label: '60日波动率(%)', type: 'number' },
  { field: 'maxdd60', label: '60日最大回撤(%)', type: 'number' },
  { field: 'sharpe20', label: '动量质量(Sharpe)', type: 'number' },
]

const OPERATOR_OPTIONS = [
  { op: 'less_than', label: '<' },
  { op: 'greater_than', label: '>' },
  { op: 'between', label: '…之间' },
  { op: 'top_pct', label: '前 %' },
]

// ═══════════════════════════════════════════════════════════════
// 条件行
// ═══════════════════════════════════════════════════════════════

function ConditionRow({
  cond, onChange, onRemove,
}: {
  cond: FilterCondition
  onChange: (c: FilterCondition) => void
  onRemove: () => void
}) {
  const field = FIELD_OPTIONS.find((f) => f.field === cond.field)

  return (
    <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2">
      <select
        className="rounded border border-gray-300 px-2 py-1 text-xs"
        value={cond.field}
        onChange={(e) => onChange({ ...cond, field: e.target.value })}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.field} value={f.field}>{f.label}</option>
        ))}
      </select>

      <select
        className="rounded border border-gray-300 px-2 py-1 text-xs"
        value={cond.operator}
        onChange={(e) => {
          const op = e.target.value as FilterCondition['operator']
          const isBetween = op === 'between'
          const isTopPct = op === 'top_pct'
          onChange({
            ...cond,
            operator: op,
            value: isBetween ? [0, 100] : isTopPct ? 30 : 0,
          })
        }}
      >
        {OPERATOR_OPTIONS.map((o) => (
          <option key={o.op} value={o.op}>{o.label}</option>
        ))}
      </select>

      {cond.operator === 'between' ? (
        <div className="flex items-center gap-1">
          <Input
            className="w-20 text-xs"
            type="number"
            aria-label={`${cond.field} 条件下限`}
            value={Array.isArray(cond.value) ? cond.value[0] : 0}
            onChange={(e) => onChange({ ...cond, value: [Number(e.target.value), Array.isArray(cond.value) ? cond.value[1] : 100] })}
          />
          <span className="text-xs text-gray-400">~</span>
          <Input
            className="w-20 text-xs"
            type="number"
            aria-label={`${cond.field} 条件上限`}
            value={Array.isArray(cond.value) ? cond.value[1] : 100}
            onChange={(e) => onChange({ ...cond, value: [Array.isArray(cond.value) ? cond.value[0] : 0, Number(e.target.value)] })}
          />
        </div>
      ) : (
        <Input
          className="w-24 text-xs"
          type="number"
          value={typeof cond.value === 'number' ? cond.value : ''}
          onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })}
        />
      )}

      <span className="text-[10px] text-gray-400">{field?.label ?? cond.field}</span>
      <button onClick={onRemove} className="ml-auto text-gray-400 hover:text-rose-500">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default function DSLEditor({
  initialNL, onDSLGenerated,
}: {
  initialNL?: string
  onDSLGenerated?: (dsl: StrategyDSL) => void
}) {
  const [name, setName] = useState('')
  const [filters, setFilters] = useState<FilterCondition[]>([{ field: 'pe', operator: 'less_than', value: 25 }])
  const [signals, setSignals] = useState<string>('')
  const [topN, setTopN] = useState(25)
  const [rebalance, setRebalance] = useState<'weekly' | 'monthly'>('weekly')
  const [showPreview, setShowPreview] = useState(false)
  const [nlInput, setNlInput] = useState(initialNL ?? '')
  const [copied, setCopied] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const addFilter = () => {
    setFilters([...filters, { field: 'pe', operator: 'less_than', value: 25 }])
  }

  const updateFilter = (index: number, cond: FilterCondition) => {
    const next = [...filters]
    next[index] = cond
    setFilters(next)
  }

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index))
  }

  const buildDSL = (): StrategyDSL | null => {
    const signalList: SignalSpec[] = signals
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map((id, i, arr) => ({ factor: id, direction: 'descending' as const, weight: 1 / arr.length }))

    // 如果只有一个因子，权重 1
    if (signalList.length === 1) signalList[0].weight = 1

    const dsl: StrategyDSL = {
      schema_version: 1,
      name: name || '未命名策略',
      universe: { market: 'A_SHARE', as_of: 'runtime', exclude: ['ST', 'listed_days_lt:120'] },
      filters: filters.filter((f) => f.field),
      signals: signalList,
      portfolio: { method: 'equal_weight', top_n: topN, rebalance },
      execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open', commission_bps: 2.5, stamp_tax_bps: 10, slippage_bps: 10 },
      meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
    }

    const validationErrors = validateDSL(dsl)
    setErrors(validationErrors.map((e) => `${e.path}: ${e.message}`))

    return validationErrors.length === 0 ? dsl : null
  }

  const handleExport = () => {
    const dsl = buildDSL()
    if (dsl) {
      const yaml = serializeDSL(dsl)
      navigator.clipboard.writeText(yaml).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      onDSLGenerated?.(dsl)
    }
  }

  const handleNLImport = () => {
    if (!nlInput.trim()) return
    try {
      // 简单解析 NL → 提取数字条件
      const c: StrategyCondition[] = []
      const peMatch = nlInput.match(/市盈率|PE.*?(\d+)/i)
      if (peMatch) c.push({ field: 'pe', op: '<', value: Number(peMatch[1] || 25), raw: peMatch[0] })
      const pbMatch = nlInput.match(/市净率|PB.*?(\d+)/i)
      if (pbMatch) c.push({ field: 'pb', op: '<', value: Number(pbMatch[1] || 3), raw: pbMatch[0] })

      const dsl = buildDSLFromNL(name || 'NL策略', c, [], nlInput, topN)
      setFilters(dsl.filters)
      setName(dsl.name)
      setErrors([])
    } catch {
      setErrors(['NL 解析失败，请手动配置条件'])
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900">DSL 可视化编辑器</h3>
        <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">V1.5</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：NL 导入 */}
        <div>
          <label className="mb-1 block text-xs text-gray-500">自然语言导入</label>
          <div className="flex gap-2">
            <Textarea className="text-xs flex-1" rows={2} placeholder="例：PE<20, ROE>12, 20日动量前30%"
              value={nlInput} onChange={(e) => setNlInput(e.target.value)} />
            <Button onClick={handleNLImport} size="sm" className="shrink-0 bg-amber-500 text-white text-xs">
              <Wand2 className="h-3 w-3 mr-1" />解析
            </Button>
          </div>
        </div>

        {/* 右：策略名 + topN */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-500">策略名称</label>
              <Input className="text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="未命名策略" />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-xs text-gray-500">持仓数</label>
              <Input className="text-xs" type="number" aria-label="目标持仓数量" value={topN} onChange={(e) => setTopN(Number(e.target.value))} />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs text-gray-500">调仓</label>
              <select className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs" value={rebalance}
                onChange={(e) => setRebalance(e.target.value as 'weekly' | 'monthly')}>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 条件列表 */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">筛选条件 ({filters.length})</span>
          <Button onClick={addFilter} variant="outline" size="sm" className="text-xs">
            <Plus className="h-3 w-3 mr-1" />添加条件
          </Button>
        </div>
        <div className="space-y-2">
          {filters.map((f, i) => (
            <ConditionRow key={i} cond={f} onChange={(c) => updateFilter(i, c)} onRemove={() => removeFilter(i)} />
          ))}
        </div>
      </div>

      {/* 因子信号 */}
      <div className="mt-3">
        <label className="mb-1 block text-xs text-gray-500">因子信号（ID逗号分隔）</label>
        <Input className="text-xs" placeholder="low_vol_20d, roe_ttm, mom_20d" value={signals}
          onChange={(e) => setSignals(e.target.value)} />
      </div>

      {/* 错误 */}
      {errors.length > 0 && (
        <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-600">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={handleExport} size="sm" className="bg-amber-500 text-white text-xs hover:bg-amber-600">
          <Code className="h-3.5 w-3.5 mr-1" />
          {copied ? '已复制 ✓' : '导出 DSL (YAML)'}
        </Button>
        <Button onClick={() => setShowPreview(!showPreview)} variant="outline" size="sm" className="text-xs">
          {showPreview ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
          {showPreview ? '隐藏预览' : '预览 DSL'}
        </Button>
      </div>

      {/* DSL 预览 */}
      {showPreview && (() => {
        const dsl = buildDSL()
        return (
          <pre className="mt-3 max-h-64 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs font-mono text-gray-700">
            {dsl ? serializeDSL(dsl) : 'DSL 校验未通过'}
          </pre>
        )
      })()}
    </div>
  )
}
