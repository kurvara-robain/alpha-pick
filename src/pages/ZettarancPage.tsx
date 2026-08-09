// ─────────────────────────────────────────────────────────────
// Zettaranc 知行决策仪表盘 v3
// Bloomberg 风格 7 步闭环 + 实时扫描 + 知识库引用
// ─────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Shield, Target, Eye, Zap, BarChart3, Gauge, Activity, BookOpen, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { computeZettarancFactors, type ZettarancFactors, type KlineData } from '@/lib/zettarancFactors'
import { generateNarrative, getKnowledgeCards, getConceptByName, type KnowledgeCard } from '@/lib/zettarancKnowledge'

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

interface StepData {
  status: 'bullish' | 'bearish' | 'neutral' | 'alert'
  signal: string
  detail: string
  value?: string
}

interface ScanResult {
  code: string
  factors: ZettarancFactors
}

// ═══════════════════════════════════════════════════════════════
// K线加载器 — 从 public/data/kline/ 采样 N 只股票
// ═══════════════════════════════════════════════════════════════

function statusColor(s: StepData['status']): string {
  switch (s) {
    case 'bullish': return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    case 'bearish': return 'text-rose-600 bg-rose-50 border-rose-200'
    case 'alert': return 'text-amber-600 bg-amber-50 border-amber-200'
    default: return 'text-slate-500 bg-slate-50 border-slate-200'
  }
}

function statusIcon(s: StepData['status']) {
  const cls = 'h-4 w-4'
  switch (s) {
    case 'bullish': return <TrendingUp className={cn(cls, 'text-emerald-500')} />
    case 'bearish': return <TrendingDown className={cn(cls, 'text-rose-500')} />
    case 'alert': return <AlertTriangle className={cn(cls, 'text-amber-500')} />
    default: return <Minus className={cn(cls, 'text-slate-400')} />
  }
}

/** 从批量扫描结果聚合统计 */
function aggregateStats(results: ScanResult[]) {
  if (results.length === 0) return null

  let totalScore = 0, b1Count = 0, s1Count = 0, anomalyCount = 0
  let superB1Count = 0, b2Count = 0, sb1Count = 0, shaofuCount = 0, kengkouCount = 0
  let sqCount = 0, dszCount = 0, dkCount = 0
  let bullCount = 0, bearCount = 0
  let totalVolRatio = 0, totalDivCons = 0

  for (const r of results) {
    const f = r.factors
    totalScore += f.zettarancScore
    if (f.isB1Signal) b1Count++
    if (f.isSuperB1) superB1Count++
    if (f.isB2Signal) b2Count++
    if (f.isSB1Signal) sb1Count++
    if (f.isShuangqiang) sqCount++
    if (f.isS1Signal) s1Count++
    if (f.isDSZSignal) dszCount++
    if (f.isDeathKline) dkCount++
    if (f.isAnomaly) anomalyCount++
    if (f.isShaofuCandidate) shaofuCount++
    if (f.isKengkouCandidate) kengkouCount++
    if (f.marketTimingSignal === 1) bullCount++
    if (f.marketTimingSignal === -1) bearCount++
    totalVolRatio += f.volumeRatio
    totalDivCons += f.divergenceConsensus
  }

  const n = results.length
  return {
    scanned: n,
    avgScore: Math.round(totalScore / n),
    b1Count, s1Count, anomalyCount, superB1Count, b2Count, sb1Count,
    shaofuCount, kengkouCount, sqCount, dszCount, dkCount,
    bullCount, bearCount,
    avgVolRatio: +(totalVolRatio / n).toFixed(2),
    avgDivCons: +(totalDivCons / n).toFixed(2),
    // 用第一只票的择时作为市场整体（或用多数）
    marketTiming: bearCount > n / 2 ? -1 : bullCount > n / 2 ? 1 : 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// K线加载器 — 从 public/data/kline/ 采样 N 只股票
// ═══════════════════════════════════════════════════════════════

async function loadKlineFile(code: string): Promise<KlineData | null> {
  try {
    const resp = await fetch(`/data/kline/${code}.json`)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data.closes || data.closes.length < 60) return null
    return {
      dates: data.dates ?? [],
      opens: data.opens ?? [],
      closes: data.closes,
      highs: data.highs ?? data.closes,
      lows: data.lows ?? data.closes,
      volumes: data.vols ?? data.volumes ?? [],
    }
  } catch {
    return null
  }
}

/** 采样扫描：加载 N 只有代表性的股票 */
async function sampleStocks(n = 100): Promise<KlineData[]> {
  // 硬编码一批有代表性的股票代码（不同市值/行业的混合）
  const SAMPLE_CODES = [
    // 大盘蓝筹
    '600519.SH', '000858.SZ', '601318.SH', '600036.SH', '000333.SZ',
    '600276.SH', '000651.SZ', '601398.SH', '600900.SH', '000002.SZ',
    // 中盘成长
    '002415.SZ', '300750.SZ', '603259.SH', '600809.SH', '000568.SZ',
    '002475.SZ', '300124.SZ', '601012.SH', '688981.SH', '002230.SZ',
    // 小盘题材
    '300059.SZ', '002049.SZ', '600570.SH', '300033.SZ', '000977.SZ',
    '688008.SH', '300502.SZ', '002371.SZ', '603501.SH', '300782.SZ',
  ]

  const results: KlineData[] = []
  for (const code of SAMPLE_CODES.slice(0, n)) {
    const kline = await loadKlineFile(code)
    if (kline) results.push(kline)
  }
  return results
}

// ═══════════════════════════════════════════════════════════════
// 知识卡片子组件
// ═══════════════════════════════════════════════════════════════

function KnowledgeCardView({ card }: { card: KnowledgeCard }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded border border-amber-200 bg-white transition-colors hover:border-amber-400">
      <button className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <BookOpen size={12} className="text-amber-500" />
          <span className="text-xs font-medium text-gray-700">{card.conceptName}</span>
          <Badge variant="outline" className="text-[9px] text-gray-400">{card.layer}</Badge>
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="border-t border-amber-100 px-3 pb-2 pt-1.5">
          <p className="text-[11px] text-amber-800 leading-relaxed mb-1.5">{card.oneLiner}</p>
          {card.rules.slice(0, 5).map((rule, i) => (
            <div key={i} className="flex items-start gap-1.5 py-0.5">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
              <span className="text-[10px] text-gray-600 leading-relaxed">{rule}</span>
            </div>
          ))}
          {card.rules.length > 5 && <p className="text-[10px] text-gray-400 mt-1">…还有 {card.rules.length - 5} 条规则</p>}
        </div>
      )}
    </div>
  )
}

const BUY_SIGNALS = [
  { name: 'B1建仓波', field: 'b1Count' as const, desc: 'J<13 + 跌幅 + 缩量三合一', concept: 'B1建仓波' },
  { name: '超级B1', field: 'superB1Count' as const, desc: 'J<0 + 周月线多周期共振', concept: '超级B1' },
  { name: 'B2突破', field: 'b2Count' as const, desc: '突破30日高+量能配合', concept: 'B2突破' },
  { name: 'SB1假摔', field: 'sb1Count' as const, desc: 'B1后假跌破再拉回', concept: 'SB1假摔战法' },
  { name: '双枪战法', field: 'sqCount' as const, desc: '连续放量阳线探底', concept: '双枪战法' },
  { name: '少妇战法', field: 'shaofuCount' as const, desc: '缩量+低位+均线粘合', concept: '少妇战法' },
  { name: '坑口战法', field: 'kengkouCount' as const, desc: '颈线突破+回踩确认', concept: '坑口战法' },
]

const SELL_SIGNALS = [
  { name: 'S1卖出', field: 's1Count' as const, desc: '高位放量滞涨+顶背离', concept: 'S1信号' },
  { name: 'DSZ死亡之星', field: 'dszCount' as const, desc: '高位十字星/倒锤头', concept: 'DSZ战法' },
  { name: '死亡K线', field: 'dkCount' as const, desc: '穿头破脚/乌云盖顶', concept: '十张死亡K线图' },
]

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function ZettarancPage() {
  const [scanning, setScanning] = useState(false)
  const [scanTime, setScanTime] = useState<string>('')
  const [results, setResults] = useState<ScanResult[]>([])
  const [stats, setStats] = useState<ReturnType<typeof aggregateStats> | null>(null)
  const [narrative, setNarrative] = useState('')
  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCard[]>([])
  const [selectedConcept, setSelectedConcept] = useState<KnowledgeCard | null>(null)
  const [showNarrative, setShowNarrative] = useState(true)
  const [scanSample, setScanSample] = useState(100)

  // 首次加载自动跑一次
  useEffect(() => { runScan() }, [])

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const klines = await sampleStocks(scanSample)
      const scanResults: ScanResult[] = []

      // 逐只计算 Zettaranc 因子
      for (const kl of klines) {
        const code = kl.dates?.[kl.dates.length - 1]?.replace(/-/g, '') ?? ''
        const factors = computeZettarancFactors(code, kl)
        scanResults.push({ code, factors })
      }

      setResults(scanResults)
      const s = aggregateStats(scanResults)
      setStats(s)

      // 生成 Z 哥视角
      if (scanResults.length > 0) {
        // 用第一只有信号的票生成叙事（或汇总所有信号）
        const bestResult = [...scanResults].sort((a, b) => b.factors.zettarancScore - a.factors.zettarancScore)[0]
        setNarrative(generateNarrative(bestResult.factors))

        // 汇总所有触发的信号
        const allSignals = new Set<string>()
        for (const r of scanResults) {
          for (const sig of r.factors.matchedStrategies) {
            allSignals.add(sig)
          }
        }
        getKnowledgeCards([...allSignals]).then(setKnowledgeCards)
      }

      setScanTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (e) {
      console.error('Scan error:', e)
    } finally {
      setScanning(false)
    }
  }, [scanSample])

  if (!stats) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto mb-3 animate-spin text-amber-500" />
          <p className="text-sm text-gray-500">正在扫描全市场 Zettaranc 信号…</p>
          <p className="text-[11px] text-gray-400 mt-1">加载 K 线数据 + 计算 20+ 战法因子</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── 标题栏 ── */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-500">
            <Target size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Zettaranc 知行决策仪表盘</h1>
            <p className="text-[11px] text-gray-400">规则驱动 · 纪律优先 · 7 步闭环 · 扫描 {stats.scanned} 只</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="h-7 rounded border border-gray-200 bg-white px-2 text-[11px] text-gray-600"
            value={scanSample}
            onChange={(e) => setScanSample(Number(e.target.value))}
          >
            <option value={30}>30 只</option>
            <option value={100}>100 只</option>
            <option value={200}>200 只</option>
          </select>
          <span className="text-[11px] text-gray-400">
            刷新 {scanTime}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Activity size={12} className="mr-1" />}
            {scanning ? '扫描中…' : '刷新扫描'}
          </Button>
        </div>
      </div>

      {/* ── Z 哥视角 ── */}
      {showNarrative && narrative && (
        <Card className="border-l-4 border-l-blue-500 bg-blue-50/30 p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500">
                <Target size={12} className="text-white" />
              </div>
              <span className="text-xs font-semibold text-blue-700 tracking-wide uppercase">Z 哥视角 · 综合研判</span>
            </div>
            <button onClick={() => setShowNarrative(false)} className="text-gray-400 hover:text-gray-600"><Minus size={14} /></button>
          </div>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{narrative}</div>
          {!showNarrative && (
            <button onClick={() => setShowNarrative(true)} className="mt-2 text-[10px] text-blue-500 hover:underline">展开 Z 哥视角</button>
          )}
        </Card>
      )}

      {/* ── ① 择时 ── */}
      <Card className="border-l-4 border-l-amber-500 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-full border',
              stats.marketTiming === 1 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
              : stats.marketTiming === -1 ? 'text-rose-600 bg-rose-50 border-rose-200'
              : 'text-slate-500 bg-slate-50 border-slate-200')}>
              {stats.marketTiming === 1 ? <TrendingUp className="h-4 w-4 text-emerald-500" />
              : stats.marketTiming === -1 ? <TrendingDown className="h-4 w-4 text-rose-500" />
              : <Minus className="h-4 w-4 text-slate-400" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">① 择时 · 市场环境</span>
                <Badge variant="outline" className={cn('text-[10px]',
                  stats.marketTiming === 1 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                  : stats.marketTiming === -1 ? 'text-rose-600 bg-rose-50 border-rose-200'
                  : 'text-gray-400')}>
                  {stats.marketTiming === 1 ? '多头环境' : stats.marketTiming === -1 ? '空头环境' : '震荡市'}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-gray-700">
                {stats.bullCount} 只多头 / {stats.bearCount} 只空头 · 均量比 {stats.avgVolRatio}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className={cn('text-2xl font-bold tabular-nums',
              stats.marketTiming === -1 ? 'text-rose-600' : 'text-emerald-600')}>
              {stats.marketTiming === -1 ? '观望' : stats.marketTiming === 1 ? '积极' : '谨慎'}
            </div>
            <div className="text-[10px] text-gray-400">操作建议</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5">
            <span className="text-[11px] text-gray-500">多头票数</span>
            <span className="font-mono text-xs tabular-nums text-emerald-500">{stats.bullCount}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5">
            <span className="text-[11px] text-gray-500">空头票数</span>
            <span className="font-mono text-xs tabular-nums text-rose-500">{stats.bearCount}</span>
          </div>
        </div>
      </Card>

      {/* ── ② 选股 + ⑥ 风控 ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">② 选股 · 异动扫描</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">异动选股法（涨&gt;5% + 量比&gt;2）</span>
              <Badge variant="outline" className={cn('text-[10px]', stats.anomalyCount > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-400')}>
                {stats.anomalyCount > 0 ? `${stats.anomalyCount} 只触发` : '无'}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">三最原则（最美/最强/最硬）</span>
              <Badge variant="outline" className="text-[10px] text-gray-400">待接入财务数据</Badge>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-gray-400">异动选股法过滤涨停板/ST/次新，只保留有参与价值的标的</p>
        </Card>

        <Card className={cn('p-4', stats.marketTiming === -1 ? 'border-l-4 border-l-rose-500' : '')}>
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-rose-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">⑥ 风控 · 四不原则</span>
          </div>
          <div className="space-y-1.5">
            <div className={cn('flex items-center justify-between rounded px-3 py-1.5',
              stats.marketTiming === -1 ? 'bg-rose-50' : 'bg-gray-50')}>
              <span className={cn('text-xs', stats.marketTiming === -1 ? 'text-rose-700' : 'text-gray-500')}>🚫 不逆势</span>
              <span className={cn('text-[10px]', stats.marketTiming === -1 ? 'text-rose-500' : 'text-gray-400')}>
                {stats.marketTiming === -1 ? '空头环境' : '环境正常'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-1.5 bg-gray-50">
              <span className="text-xs text-gray-500">🚫 不重仓</span>
              <span className="text-[10px] text-gray-400">单票≤20%</span>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-1.5 bg-gray-50">
              <span className="text-xs text-gray-500">🚫 不追高</span>
              <span className="text-[10px] text-gray-400">不碰高位放量</span>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-1.5 bg-gray-50">
              <span className="text-xs text-gray-500">🚫 不死扛</span>
              <span className="text-[10px] text-gray-400">-8% 无条件止损</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── ③ 买点 + ④ 卖点 ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-emerald-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">③ 买点 · 战法信号矩阵</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400">
                <th className="pb-2 text-left font-medium">战法</th>
                <th className="pb-2 text-right font-medium">命中</th>
                <th className="pb-2 text-right font-medium">命中率</th>
              </tr>
            </thead>
            <tbody>
              {BUY_SIGNALS.map((s) => {
                const count = (stats as Record<string, number>)[s.field] ?? 0
                const rate = stats.scanned > 0 ? ((count / stats.scanned) * 100).toFixed(1) : '0'
                return (
                  <tr key={s.name}
                    className="border-b border-gray-50 hover:bg-amber-50/30 transition-colors cursor-pointer"
                    onClick={() => { getConceptByName(s.concept).then(setSelectedConcept) }}
                  >
                    <td className="py-2">
                      <div className="font-medium text-gray-700">{s.name}</div>
                      <div className="text-[10px] text-gray-400">{s.desc}</div>
                    </td>
                    <td className="py-2 text-right">
                      <span className={cn('font-mono tabular-nums font-semibold',
                        count > 0 ? 'text-emerald-600' : 'text-gray-400')}>
                        {count}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-gray-500">{rate}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-rose-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">④ 卖点 · 离场信号监控</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400">
                <th className="pb-2 text-left font-medium">信号</th>
                <th className="pb-2 text-right font-medium">命中</th>
                <th className="pb-2 text-right font-medium">命中率</th>
              </tr>
            </thead>
            <tbody>
              {SELL_SIGNALS.map((s) => {
                const count = (stats as Record<string, number>)[s.field] ?? 0
                const rate = stats.scanned > 0 ? ((count / stats.scanned) * 100).toFixed(1) : '0'
                return (
                  <tr key={s.name}
                    className="border-b border-gray-50 hover:bg-rose-50/30 transition-colors cursor-pointer"
                    onClick={() => { getConceptByName(s.concept).then(setSelectedConcept) }}
                  >
                    <td className="py-2">
                      <div className="font-medium text-gray-700">{s.name}</div>
                      <div className="text-[10px] text-gray-400">{s.desc}</div>
                    </td>
                    <td className="py-2 text-right">
                      <span className={cn('font-mono tabular-nums font-semibold',
                        count > 0 ? 'text-rose-600' : 'text-gray-400')}>
                        {count}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-gray-500">{rate}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* ── ⑤ 持仓 + ⑦ 心法 ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">⑤ 持仓 · 去弱留强</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">综合评分均值</span>
              <span className="font-mono text-xs tabular-nums font-semibold text-blue-600">{stats.avgScore}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">买入信号覆盖率</span>
              <span className="font-mono text-xs tabular-nums font-semibold text-amber-600">
                {(((stats.b1Count + stats.superB1Count + stats.b2Count + stats.sb1Count) / stats.scanned) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">去弱留强触发</span>
              <Badge variant="outline" className="text-[10px] text-gray-400">接入持仓数据后启用</Badge>
            </div>
          </div>
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] text-amber-700">💡 <strong>底仓守信仰，动态仓守纪律</strong> — 股票不是爱情，不涨就换</p>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={14} className="text-purple-500" />
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">⑦ 心法 · 交易心理</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">市场分歧度均值</span>
              <span className="font-mono text-xs tabular-nums text-purple-600">{stats.avgDivCons.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">三波理论阶段</span>
              <span className="font-mono text-xs tabular-nums text-gray-600">{stats.marketTiming === 1 ? '第2波' : stats.marketTiming === -1 ? '第1波' : '震荡'}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-600">均量比</span>
              <span className="font-mono text-xs tabular-nums text-amber-600">{stats.avgVolRatio}</span>
            </div>
          </div>
          <div className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-[11px] text-blue-700">🧠 <strong>交易到最后，拼的不是技术，是人性</strong> — 分歧越大越要冷静</p>
          </div>
        </Card>
      </div>

      {/* ── 知识库引用 ── */}
      {knowledgeCards.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">知识库引用 — 当前信号匹配</span>
            <Badge variant="outline" className="text-[9px] text-amber-600">{knowledgeCards.length} 个概念页</Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {knowledgeCards.map((card) => (
              <KnowledgeCardView key={card.conceptName} card={card} />
            ))}
          </div>
        </div>
      )}

      {/* ── 选中概念弹窗 ── */}
      {selectedConcept && (
        <Card className="border-2 border-blue-400 p-4 bg-blue-50/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-blue-500" />
              <span className="text-sm font-semibold text-gray-800">{selectedConcept.conceptName}</span>
              <Badge variant="outline" className="text-[9px]">{selectedConcept.layer}</Badge>
            </div>
            <button onClick={() => setSelectedConcept(null)} className="text-gray-400 hover:text-gray-600"><Minus size={14} /></button>
          </div>
          <p className="text-sm text-blue-800 mb-2">{selectedConcept.oneLiner}</p>
          <div className="space-y-1">
            {selectedConcept.rules.slice(0, 8).map((rule, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                <span className="text-xs text-gray-700 leading-relaxed">{rule}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
