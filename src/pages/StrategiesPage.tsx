import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Pin,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getDB, subscribeDB, uid, updateDB } from '@/lib/store'
import { StrategyDebugger, LazyLoader } from '@/components/LazyComponents'
import { DSLEditor } from '@/components/LazyComponents'
import { parseStrategyNL, type ParseResult } from '@/lib/api'
import type { Strategy, StrategyCondition, StrategyKind } from '@/lib/types'

// ── 条件可读翻译 ──────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  pe: '市盈率',
  pb: '市净率',
  mktCap: '总市值',
  turnover: '换手率',
  mom_rank: '动量排名',
  mom_range: '区间涨幅',
  above_ma: '均线突破',
  list_years: '上市时间',
  ocf_4q: '经营现金流',
  exclude_st: '剔除 ST',
  exclude_subnew: '剔除次新股',
  aiScore: 'AI 评分',
  dividend_yield: '股息率',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

function conditionLabel(c: StrategyCondition): string {
  const range = Array.isArray(c.value) ? (c.value as [number, number]) : null
  switch (c.field) {
    case 'exclude_st':
      return '剔除 ST 股'
    case 'exclude_subnew':
      return '剔除次新股'
    case 'mom_rank':
      return `近 ${c.window ?? 20} 个交易日涨幅排名前 ${c.value}%`
    case 'mom_range':
      return range ? `近 ${c.window ?? 20} 日涨幅 ${range[0]}% ~ ${range[1]}%` : `近 ${c.window ?? 20} 日涨幅 ${c.op} ${c.value}%`
    case 'mktCap':
      return range ? `总市值 ${range[0]} 亿 ~ ${range[1]} 亿` : `总市值 ${c.op} ${c.value} 亿`
    case 'pe':
      return range ? `市盈率 ${range[0]} ~ ${range[1]}` : `市盈率 ${c.op} ${c.value}`
    case 'pb':
      return range ? `市净率 ${range[0]} ~ ${range[1]}` : `市净率 ${c.op} ${c.value}`
    case 'above_ma':
      return `收盘价站上 ${c.value} 日均线`
    case 'list_years':
      return `上市时间 ${c.op} ${c.value} 年（近似口径）`
    case 'ocf_4q':
      return '连续四季度经营现金流为正'
    case '__sort':
      return '按换手率降序排列（以当日换手率近似）'
    case 'turnover':
      return `换手率 ${c.op} ${c.value}%`
    case 'dividend_yield':
      return `股息率 ${c.op} ${c.value}%`
    default:
      return `${fieldLabel(c.field)} ${c.op} ${c.value}`
  }
}

function sourceLabel(source: Strategy['source']): string {
  switch (source) {
    case 'nl':
      return '自然语言'
    case 'seed':
      return '预置'
    default:
      return '手工'
  }
}

// ── 种子策略（一键添加）───────────────────────────────────────

interface SeedStrategy {
  name: string
  description: string
  conditions: StrategyCondition[]
  unsupported?: string[] // 数据暂缺、不生效的条件（须明示"暂不支持"，不静默丢弃）
}

const SEED_STRATEGIES: SeedStrategy[] = [
  {
    name: '低估值价值',
    description: '低 PE、低 PB 并剔除 ST 股，偏防守的价值型组合',
    conditions: [
      { field: 'pe', op: '<', value: 20, raw: '市盈率低于20倍' },
      { field: 'pb', op: '<', value: 3, raw: '市净率低于3倍' },
      { field: 'exclude_st', op: '=', value: true, raw: '剔除ST' },
    ],
  },
  {
    name: '动量趋势',
    description: '追踪近 20 日强势且有量能配合的股票',
    conditions: [
      { field: 'mom_rank', op: 'top_pct', value: 30, window: 20, raw: '近20个交易日涨幅排名前30%' },
      { field: 'turnover', op: '>', value: 1, raw: '换手率大于1%' },
    ],
  },
  {
    name: '高股息防御',
    description: '高股息、低估值，剔除 ST，震荡市中的防御底仓（股息率条件数据暂缺，暂不生效）',
    conditions: [
      { field: 'pe', op: '<', value: 15, raw: '市盈率低于15倍' },
      { field: 'exclude_st', op: '=', value: true, raw: '剔除ST' },
    ],
    // universe.json 暂无股息率字段，筛选引擎无法执行该条件——明示"暂不支持"而非静默放行
    unsupported: ['股息率大于3%'],
  },
  // ── Zettaranc 知行体系 ──
  {
    name: 'Zettaranc B1 建仓波',
    description: 'KDJ J<13 黄金买点 + 换手率<3% + 20日下跌，守株待兔式买入',
    conditions: [
      { field: 'kdj_j', op: '<', value: 13, raw: 'KDJ J值<13' },
      { field: 'turnover', op: '<', value: 3, raw: '换手率<3%' },
      { field: 'mom20', op: '<', value: -5, raw: '20日跌幅>5%' },
    ],
  },
  {
    name: 'Zettaranc 少妇战法',
    description: '缩量极致+均线粘合+低位，三合一共振信号',
    conditions: [
      { field: 'volume_ratio', op: '<', value: 0.5, raw: '量比<0.5（缩量）' },
      { field: 'ma_stickiness', op: '<', value: 4, raw: '均线粘合度<4%' },
      { field: 'position_vs_ma60', op: '<', value: -5, raw: '距60日线<-5%（低位）' },
    ],
  },
  {
    name: 'Zettaranc 坑口战法',
    description: '颈线突破+回踩确认+放量上攻，右侧确认进场',
    conditions: [
      { field: 'breakout_rate', op: '>', value: 2, raw: '突破颈线>2%' },
      { field: 'volume_surge', op: '>', value: 1.5, raw: '量比>1.5倍（放量突破）' },
    ],
  },
]

// ── 页面 ─────────────────────────────────────────────────────

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>(() => getDB().strategies)
  const [nlText, setNlText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [strategyName, setStrategyName] = useState('')
  const [saveKind, setSaveKind] = useState<StrategyKind>('fixed')
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    return subscribeDB(() => {
      setStrategies(getDB().strategies)
    })
  }, [])

  const fixedStrategies = useMemo(() => strategies.filter((s) => s.kind === 'fixed'), [strategies])
  const tempStrategies = useMemo(() => strategies.filter((s) => s.kind === 'temp'), [strategies])

  async function handleParse() {
    const text = nlText.trim()
    if (!text || parsing) return
    setParsing(true)
    setSavedFlash(false)
    try {
      const result = await parseStrategyNL(text)
      setParsed(result)
      if (!strategyName.trim()) {
        setStrategyName(text.slice(0, 18))
      }
    } finally {
      setParsing(false)
    }
  }

  function removeParsedCondition(index: number) {
    setParsed((prev) =>
      prev
        ? { ...prev, conditions: prev.conditions.filter((_, i) => i !== index) }
        : prev,
    )
  }

  function handleSave() {
    if (!parsed || parsed.conditions.length === 0) return
    const name = strategyName.trim() || '未命名策略'
    const strategy: Strategy = {
      id: uid(),
      name,
      description: parsed.summary,
      kind: saveKind,
      enabled: true,
      conditions: parsed.conditions,
      unsupported: parsed.unsupported,
      source: 'nl',
      createdAt: new Date().toISOString(),
    }
    updateDB((db) => {
      db.strategies.push(strategy)
    })
    setParsed(null)
    setNlText('')
    setStrategyName('')
    setSavedFlash(true)
  }

  function handleAddSeed(seedItem: SeedStrategy) {
    const strategy: Strategy = {
      id: uid(),
      name: seedItem.name,
      description: seedItem.description,
      kind: 'fixed',
      enabled: true,
      conditions: seedItem.conditions,
      unsupported: seedItem.unsupported ?? [],
      source: 'seed',
      createdAt: new Date().toISOString(),
    }
    updateDB((db) => {
      db.strategies.push(strategy)
    })
  }

  function toggleStrategy(id: string, enabled: boolean) {
    updateDB((db) => {
      const s = db.strategies.find((x) => x.id === id)
      if (s) s.enabled = enabled
    })
  }

  function deleteStrategy(id: string) {
    updateDB((db) => {
      db.strategies = db.strategies.filter((x) => x.id !== id)
    })
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Layers className="h-6 w-6 text-amber-500" />
          策略池
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          用自然语言描述选股思路，解析为结构化条件后确认保存，与社区共建的策略一起驱动选股。
        </p>
      </div>

      {/* 自然语言建策略 */}
      <Card className="rounded-xl border border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Wand2 className="h-5 w-5 text-amber-500" />
            自然语言建策略
          </CardTitle>
          <CardDescription>
            用一句话描述你的选股条件，系统会解析为可执行的结构化条件，确认无误后再保存。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <Textarea
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              placeholder="选市盈率低于20倍、近20个交易日涨幅排名前30%、剔除ST和次新股"
              className="min-h-[96px] flex-1 resize-y border-gray-300 bg-gray-100 text-gray-900 placeholder:text-gray-400"
            />
            <Button
              onClick={handleParse}
              disabled={parsing || !nlText.trim()}
              className="self-start bg-cyan-500 text-slate-950 hover:bg-cyan-400 md:self-end"
            >
              {parsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  解析中…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  解析条件
                </>
              )}
            </Button>
          </div>

          {/* 解析结果回显区 */}
          {parsed && (
            <div className="space-y-4 rounded-lg border border-gray-300/80 bg-gray-100/50 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle2 className="h-4 w-4 text-amber-500" />
                <span>{parsed.summary}</span>
                <span className="text-gray-400">· 请确认后再保存，未保存不会生效</span>
              </div>

              {parsed.conditions.length > 0 && (
                <div className="space-y-2">
                  {parsed.conditions.map((c, i) => (
                    <div
                      key={`${c.field}-${i}`}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white/70 px-3 py-2"
                    >
                      <Badge
                        variant="outline"
                        className="border-cyan-500/40 text-amber-500 font-mono tabular-nums"
                      >
                        {conditionLabel(c)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
                        原文：{c.raw}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeParsedCondition(i)}
                        className="text-gray-400 transition-colors hover:text-rose-400"
                        aria-label="删除该条件"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {parsed.unsupported.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    以下片段暂不支持
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {parsed.unsupported.map((u, i) => (
                      <Badge
                        key={`${u}-${i}`}
                        variant="outline"
                        className="border-amber-500/50 text-amber-300"
                      >
                        暂不支持 · {u}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-amber-200/70">
                    这些条件不会生效，也绝不会被静默丢弃——保存后会随策略一并展示，便于后续补充支持。
                  </p>
                </div>
              )}

              {parsed.conditions.length === 0 ? (
                <p className="text-sm text-gray-400">
                  没有可保存的条件，请调整描述后重新解析。
                </p>
              ) : (
                <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-end">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs text-gray-500">策略名称</label>
                    <Input
                      value={strategyName}
                      onChange={(e) => setStrategyName(e.target.value)}
                      placeholder="给这个策略起个名字"
                      className="border-gray-300 bg-gray-100 text-gray-900 placeholder:text-gray-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">保存形态</label>
                    <div className="flex overflow-hidden rounded-lg border border-gray-300">
                      <button
                        type="button"
                        onClick={() => setSaveKind('fixed')}
                        className={`px-3 py-2 text-sm transition-colors ${
                          saveKind === 'fixed'
                            ? 'bg-cyan-500/20 text-amber-500'
                            : 'bg-gray-100 text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        固定策略（长期保存）
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveKind('temp')}
                        className={`px-3 py-2 text-sm transition-colors ${
                          saveKind === 'temp'
                            ? 'bg-cyan-500/20 text-amber-500'
                            : 'bg-gray-100 text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        临时策略（本次会话）
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={handleSave}
                    className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                  >
                    确认保存
                  </Button>
                </div>
              )}
            </div>
          )}

          {savedFlash && !parsed && (
            <p className="flex items-center gap-2 text-sm text-amber-500">
              <CheckCircle2 className="h-4 w-4" />
              策略已保存到策略池。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 系统共建引导 */}
      <Card className="rounded-xl border border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="text-gray-900">还没有思路？试试这些种子策略</CardTitle>
          <CardDescription>一键添加为固定策略，之后可随时停用或删除。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {SEED_STRATEGIES.map((seedItem) => (
              <div
                key={seedItem.name}
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-100/50 p-3"
              >
                <div className="font-medium text-gray-900">{seedItem.name}</div>
                <p className="flex-1 text-xs text-gray-500">{seedItem.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {seedItem.conditions.map((c, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="border-gray-300 text-gray-500 font-mono tabular-nums"
                    >
                      {conditionLabel(c)}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAddSeed(seedItem)}
                  className="mt-1 border-cyan-500/40 text-amber-500 hover:bg-amber-100 hover:text-cyan-200"
                >
                  一键添加
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 策略列表 */}
      {strategies.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-gray-300 bg-white/40">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Layers className="h-10 w-10 text-gray-300" />
            <p className="text-gray-700">策略池还是空的</p>
            <p className="text-sm text-gray-400">
              用上方输入框描述你的选股思路，或从种子策略一键添加开始。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <StrategyGroup
            title="固定策略"
            icon={<Pin className="h-4 w-4 text-amber-500" />}
            strategies={fixedStrategies}
            onToggle={toggleStrategy}
            onDelete={deleteStrategy}
          />
          <StrategyGroup
            title="临时策略"
            icon={<Clock className="h-4 w-4 text-amber-400" />}
            strategies={tempStrategies}
            onToggle={toggleStrategy}
            onDelete={deleteStrategy}
          />
        </div>
      )}
      {/* DSL 编辑器 */}
      <LazyLoader><DSLEditor /></LazyLoader>

      {/* 策略调试器 */}
      <LazyLoader><StrategyDebugger /></LazyLoader>
    </div>
  )
}

// ── 策略分组 ─────────────────────────────────────────────────

function StrategyGroup({
  title,
  icon,
  strategies,
  onToggle,
  onDelete,
}: {
  title: string
  icon: ReactNode
  strategies: Strategy[]
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        {icon}
        {title}
        <span className="font-mono tabular-nums text-gray-400">{strategies.length}</span>
      </h2>
      {strategies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
          暂无{title}
        </p>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <StrategyCard key={s.id} strategy={s} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  )
}

// ── 策略卡片 ─────────────────────────────────────────────────

function StrategyCard({
  strategy,
  onToggle,
  onDelete,
}: {
  strategy: Strategy
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card
      className={`rounded-xl border border-gray-200 bg-white transition-opacity ${
        strategy.enabled ? '' : 'opacity-60'
      }`}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{strategy.name}</span>
              <Badge variant="outline" className="border-gray-300 text-gray-500">
                {sourceLabel(strategy.source)}
              </Badge>
              {strategy.kind === 'temp' && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-300">
                  仅本次会话
                </Badge>
              )}
            </div>
            {strategy.description && (
              <p className="mt-1 text-xs text-gray-400">{strategy.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={strategy.enabled}
              onCheckedChange={(v) => onToggle(strategy.id, v)}
              aria-label={strategy.enabled ? '停用策略' : '启用策略'}
            />
            <button
              type="button"
              onClick={() => onDelete(strategy.id)}
              className="text-gray-400 transition-colors hover:text-rose-400"
              aria-label="删除策略"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {strategy.conditions.map((c, i) => (
            <Badge
              key={i}
              variant="outline"
              className="border-cyan-500/30 text-cyan-200/90 font-mono tabular-nums"
            >
              {conditionLabel(c)}
            </Badge>
          ))}
        </div>

        {strategy.unsupported.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
            {strategy.unsupported.map((u, i) => (
              <Badge key={i} variant="outline" className="border-rose-500/50 text-rose-300">
                暂不支持 · {u}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
