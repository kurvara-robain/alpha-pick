// ─────────────────────────────────────────────────────────────
// P9 个股投研 — 统一工作台
// 选股 + 框架 + 自然语言 + 知识库引用 → 一键综合报告
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  FileSearch,
  FileText,
  Layers,
  Search,
  Shield,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { RESEARCH_FRAMEWORKS, getFrameworkNote } from '@/lib/researchFrameworks'
import { runResearch } from '@/lib/researchEngine'
import { listDocuments } from '@/lib/researchKnowledge'
import { generateNLResearchReport, generateNarrativeSummary } from '@/lib/researchNL'
import type { ResearchReport, DimensionResult, ResearchFramework } from '@/lib/researchTypes'
import type { ResearchDocument } from '@/lib/researchKnowledge'
import {
  createResearchProject,
  addEvidenceItem,
  addResearchClaim,
  generateReport,
  getClaims,
  getEvidence,
} from '@/lib/researchProjectStore'
import UploadDialog from '@/components/UploadDialog'
import { AgentGraph, LazyLoader } from '@/components/LazyComponents'

// ═══════════════════════════════════════════════════════════════
// 复用小组件
// ═══════════════════════════════════════════════════════════════

function scoreBar(score: number) {
  const c = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : score >= 40 ? 'bg-orange-400' : 'bg-rose-500'
  return <div className="flex items-center gap-2"><div className="h-2 min-w-[60px] overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${c}`} style={{ width: `${score}%` }} /></div><span className="font-mono text-xs tabular-nums font-semibold text-gray-700">{score}</span></div>
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-amber-600'
  if (score >= 40) return 'text-orange-600'
  return 'text-rose-600'
}

function riskColor(level: string) {
  return level === '高' ? 'border-rose-500/40 bg-rose-50 text-rose-600' : level === '中' ? 'border-amber-500/40 bg-amber-50 text-amber-600' : 'border-emerald-500/40 bg-emerald-50 text-emerald-600'
}

// ═══════════════════════════════════════════════════════════════
// 统一输入面板
// ═══════════════════════════════════════════════════════════════

function UnifiedInput({
  universe,
  onSubmit,
  running,
  onRefreshKB,
  docs,
  onAddDoc,
}: {
  universe: UniverseStock[]
  onSubmit: (params: { stock: UniverseStock; frameworkId: string; nlQuery: string; refDocIds: string[] }) => void
  running: boolean
  onRefreshKB: () => void
  docs: ResearchDocument[]
  onAddDoc: () => void
}) {
  // 股票搜索
  const [stockQuery, setStockQuery] = useState('')
  const [selectedStock, setSelectedStock] = useState<UniverseStock | null>(null)
  const [showResults, setShowResults] = useState(false)

  const searchResults = useMemo(() => {
    if (stockQuery.length < 1) return []
    const q = stockQuery.toLowerCase()
    return universe.filter((s) => s.code.includes(q) || s.name.toLowerCase().includes(q)).slice(0, 12)
  }, [stockQuery, universe])

  // 框架选择
  const [frameworkId, setFrameworkId] = useState('auto')

  // NL 需求
  const [nlQuery, setNlQuery] = useState('')

  // 知识库引用
  const [refDocIds, setRefDocIds] = useState<string[]>([])
  const [showKB, setShowKB] = useState(false)

  const toggleDoc = (id: string) => {
    setRefDocIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const selectedDocs = docs.filter((d) => refDocIds.includes(d.id))

  const canSubmit = selectedStock !== null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-amber-500" />
        <h2 className="text-base font-semibold text-gray-900">投研工作台</h2>
        <span className="text-xs text-gray-400">选股 + 框架 + 需求 + 知识库 → 一键综合报告</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左列：选股 + 框架 */}
        <div className="space-y-4">
          {/* 选股 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">① 选择股票</label>
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5">
                <Search className="h-4 w-4 text-gray-400 shrink-0" />
                <Input
                  className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                  placeholder="输入代码或名称搜索…"
                  value={selectedStock ? `${selectedStock.name} (${selectedStock.code})` : stockQuery}
                  onChange={(e) => { setStockQuery(e.target.value); setShowResults(true); setSelectedStock(null) }}
                  onFocus={() => setShowResults(true)}
                />
                {selectedStock && (
                  <button onClick={() => { setSelectedStock(null); setStockQuery('') }} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                )}
              </div>
              {showResults && searchResults.length > 0 && !selectedStock && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
                  {searchResults.map((s) => (
                    <button key={s.code} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-amber-50 border-b border-gray-50 last:border-0"
                      onClick={() => { setSelectedStock(s); setStockQuery(''); setShowResults(false) }}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-gray-900">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.code} · {s.industry}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm tabular-nums text-gray-700">¥{fmtNum(s.price)}</div>
                        <div className={`font-mono text-xs tabular-nums ${pctColor(s.changePct)}`}>{fmtPct(s.changePct)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedStock && (
              <div className="mt-2 flex items-center gap-2 rounded bg-amber-50 px-3 py-1.5 text-xs">
                <Check className="h-3 w-3 text-amber-600" />
                <span className="font-medium text-amber-800">{selectedStock.name}</span>
                <span className="text-amber-600">{selectedStock.code}</span>
                <span className="text-amber-500">{selectedStock.industry}</span>
              </div>
            )}
          </div>

          {/* 框架 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">② 投研框架</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFrameworkId('auto')}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${frameworkId === 'auto' ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                🤖 自动匹配（根据NL需求）
              </button>
              {RESEARCH_FRAMEWORKS.map((fw) => (
                <button
                  key={fw.id}
                  onClick={() => setFrameworkId(fw.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${frameworkId === fw.id ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  title={fw.description}
                >
                  {fw.institution} · {fw.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右列：NL 需求 + 知识库 */}
        <div className="space-y-4">
          {/* NL */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">③ 自然语言需求</label>
            <Textarea
              className="text-sm"
              rows={3}
              placeholder="描述你的投研需求…&#10;例：关注估值安全边际和ROE质量，对比五粮液和泸州老窖，重点看直销渠道占比提升对毛利率的影响"
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {['看估值和ROE', '行业景气度分析', '低估值+高股息', '超跌反弹机会', '对比同行业龙头'].map((h) => (
                <button key={h} onClick={() => setNlQuery((prev) => prev ? `${prev}；${h}` : h)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-400 hover:border-amber-300 hover:text-amber-600">{h}</button>
              ))}
            </div>
          </div>

          {/* 知识库引用 */}
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-gray-600">
              <span>④ 引用知识库研报（可选）</span>
              <div className="flex items-center gap-2">
                <UploadDialog onDone={onAddDoc} />
                <button onClick={() => { setShowKB(!showKB); onRefreshKB() }} className="text-amber-500 hover:text-amber-600">
                  {showKB ? '收起' : `展开 (${docs.length}篇)`}
                </button>
              </div>
            </label>

            {/* 已选中的引用 */}
            {selectedDocs.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedDocs.map((d) => (
                  <span key={d.id} className="flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700">
                    {d.source} · {d.title.slice(0, 15)}…
                    <button onClick={() => toggleDoc(d.id)} className="ml-0.5 hover:text-blue-900"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}

            {/* 知识库列表 */}
            {showKB && (
              <div className="max-h-32 overflow-y-auto rounded border border-gray-200">
                {docs.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-400">
                    知识库为空 — 点击左侧「上传研报」添加
                  </div>
                ) : (
                  docs.map((d) => {
                    const sel = refDocIds.includes(d.id)
                    return (
                      <button key={d.id} onClick={() => toggleDoc(d.id)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs border-b border-gray-50 last:border-0 transition-colors ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${sel ? 'border-blue-400 bg-blue-500 text-white' : 'border-gray-300'}`}>
                          {sel && <Check className="h-3 w-3" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-800 truncate">{d.title}</div>
                          <div className="text-gray-400">{d.source} · {d.keyPoints.length}条观点</div>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 一键生成按钮 */}
      <div className="mt-5 flex items-center justify-between">
        <div className="text-xs text-gray-400">
          {selectedStock ? `✓ ${selectedStock.name}` : '○ 待选股'}
          <span className="mx-2">|</span>
          {frameworkId === 'auto' ? '🤖 自动框架' : `✓ ${RESEARCH_FRAMEWORKS.find((f) => f.id === frameworkId)?.institution}`}
          <span className="mx-2">|</span>
          {nlQuery ? `📝 NL需求 (${nlQuery.length}字)` : '○ 无NL需求'}
          <span className="mx-2">|</span>
          {refDocIds.length > 0 ? `📚 引用${refDocIds.length}篇研报` : '○ 无知识库引用'}
        </div>
        <Button
          onClick={() => selectedStock && onSubmit({ stock: selectedStock, frameworkId, nlQuery, refDocIds })}
          disabled={!canSubmit || running}
          className="flex items-center gap-2 bg-amber-500 px-8 py-2.5 text-white hover:bg-amber-600 text-base font-semibold"
        >
          <Sparkles className="h-5 w-5" />
          {running ? '生成中…' : '生成投研报告'}
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 报告展示区
// ═══════════════════════════════════════════════════════════════

function DimensionPanel({ dim }: { dim: DimensionResult }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{dim.name}</span>
          <Badge variant="outline" className="text-xs text-gray-400">权重 {(dim.weight * 100).toFixed(0)}%</Badge>
          {scoreBar(dim.score)}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          <p className="mb-3 text-xs text-gray-500">{dim.summary}</p>
          {dim.details.map((d) => (
            <div key={d.field} className="flex items-center justify-between py-1 text-xs">
              <span className="text-gray-600">{d.label}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono tabular-nums text-gray-900">{d.value !== null ? (typeof d.value === 'number' && Math.abs(d.value) > 100 ? fmtNum(d.value, 0) : d.value.toFixed(2)) : '—'}</span>
                <span className="text-gray-400">分位 {d.percentile}%</span>
                {scoreBar(d.score)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ValuationPanel({ report }: { report: ResearchReport }) {
  const v = report.valuation
  const items = [
    { label: 'PE(TTM)', value: v.peCurrent?.toFixed(0) ?? '亏损', sub: `同业中位 ${v.peHistoricalMedian?.toFixed(0) ?? '—'}` },
    { label: 'PE 分位', value: v.pePercentile != null ? `${v.pePercentile}%` : '—', sub: v.pePercentile != null ? (v.pePercentile < 30 ? '偏低估值区' : v.pePercentile > 70 ? '偏高估值区' : '合理估值区') : '' },
    { label: 'PB', value: v.pbCurrent?.toFixed(1) ?? '—', sub: `同业中位 ${v.pbHistoricalMedian?.toFixed(1) ?? '—'}` },
    { label: '安全边际', value: v.marginOfSafety != null ? `${v.marginOfSafety.toFixed(0)}%` : '—', sub: '同业估值折价' },
  ]
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><Target className="h-4 w-4 text-amber-500" />估值分析（同业比较）</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((m) => (
          <div key={m.label} className="rounded bg-gray-50 p-3 text-center">
            <div className="text-[11px] text-gray-400">{m.label}</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-gray-900">{m.value}</div>
            <div className="mt-0.5 text-[10px] text-gray-400">{m.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RiskPanel({ risks }: { risks: ResearchReport['risks'] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><AlertTriangle className="h-4 w-4 text-rose-500" />风险清单</h3>
      <div className="space-y-2">
        {risks.map((r, i) => (
          <div key={i} className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${riskColor(r.level)}`}>
            <span className="mt-0.5 font-semibold">[{r.level}]</span>
            <div><span className="font-medium">{r.category}</span><span className="ml-2 text-gray-600">{r.description}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CatalystPanel({ catalysts }: { catalysts: string[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles className="h-4 w-4 text-amber-500" />潜在催化</h3>
      <ul className="space-y-1.5">{catalysts.map((c, i) => (<li key={i} className="flex items-start gap-2 text-xs text-gray-700"><ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />{c}</li>))}</ul>
    </div>
  )
}

function PeerTable({ peers, stockName }: { peers: ResearchReport['peerComparison']; stockName: string }) {
  if (peers.length === 0) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600"><Building2 className="h-3.5 w-3.5" />同业对标 · {stockName}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-100 text-left text-gray-400"><th className="px-4 py-2 font-medium">名称</th><th className="px-4 py-2 font-medium">代码</th><th className="px-4 py-2 text-right font-medium">市值(亿)</th><th className="px-4 py-2 text-right font-medium">PE</th><th className="px-4 py-2 text-right font-medium">PB</th><th className="px-4 py-2 text-right font-medium">ROE</th></tr></thead>
          <tbody>
            {peers.map((p) => (
              <tr key={p.code} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900">{p.name}</td>
                <td className="px-4 py-2 font-mono text-gray-400">{p.code}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700">{fmtNum(p.mktCap, 0)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700">{p.pe?.toFixed(1) ?? '—'}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700">{p.pb?.toFixed(1) ?? '—'}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700">{p.roe?.toFixed(1) ?? '—'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function ResearchPage() {
  const universeState = useAsync(loadUniverse)
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [narrativeReport, setNarrativeReport] = useState('')
  const [running, setRunning] = useState(false)
  const [refDocs, setRefDocs] = useState<ResearchDocument[]>([])
  const [kbVersion, setKbVersion] = useState(0)

  const docs = useMemo(() => listDocuments(), [kbVersion])

  const handleSubmit = (params: { stock: UniverseStock; frameworkId: string; nlQuery: string; refDocIds: string[] }) => {
    setRunning(true)
    const selectedDocs = docs.filter((d) => params.refDocIds.includes(d.id))
    setRefDocs(selectedDocs)

    setTimeout(() => {
      const universe = universeState.data ?? []

      // 确定框架
      let framework: ResearchFramework
      if (params.frameworkId === 'auto' && params.nlQuery) {
        // 自动匹配
        const { report: r } = generateNLResearchReport(params.nlQuery, universe)
        if (r) {
          framework = r.framework
        } else {
          framework = RESEARCH_FRAMEWORKS[0]
        }
      } else if (params.frameworkId !== 'auto') {
        framework = RESEARCH_FRAMEWORKS.find((f) => f.id === params.frameworkId) ?? RESEARCH_FRAMEWORKS[0]
      } else {
        framework = RESEARCH_FRAMEWORKS[0]
      }

      // 如果有 NL 需求，合并维度
      if (params.nlQuery) {
        const { report: nlR } = generateNLResearchReport(params.nlQuery, universe)
        if (nlR && nlR.dimensions.length > 0) {
          // 融合：用 NL 维度替换框架默认维度
          framework = { ...framework, dimensions: nlR.framework.dimensions, indicators: nlR.framework.indicators }
        }
      }

      const r = runResearch(params.stock, framework, universe)

      // ── V2 研究项目 + 证据链（规则19/20）──
      const project = createResearchProject(
        params.nlQuery || `${params.stock.name} 投研分析`,
        params.stock.code,
        params.stock.name,
      )
      const evidenceIds: string[] = []
      // 维度分析 → analysis 证据
      for (const dim of r.dimensions) {
        const ev = addEvidenceItem(project.id, {
          kind: 'analysis',
          source: `框架维度: ${dim.name}`,
          summary: dim.summary,
          detail: dim.details
            .map((d) => `${d.label}: ${d.value ?? '—'}（分位 ${d.percentile}%）`)
            .join('；'),
        })
        evidenceIds.push(ev.id)
      }
      // 估值 → data 证据（行情截面数据）
      const valEv = addEvidenceItem(project.id, {
        kind: 'data',
        source: '行情估值截面数据',
        summary: `PE ${r.valuation.peCurrent ?? '亏损'}，同业中位 ${r.valuation.peHistoricalMedian ?? '—'}，PE 分位 ${r.valuation.pePercentile ?? '—'}%`,
      })
      evidenceIds.push(valEv.id)
      // 风险 → analysis 证据
      const riskEv = addEvidenceItem(project.id, {
        kind: 'analysis',
        source: '风险规则引擎',
        summary: r.risks
          .map((x) => `[${x.level}] ${x.category}: ${x.description}`)
          .join('；'),
      })
      evidenceIds.push(riskEv.id)
      // 关键结论（规则19：绑定证据）
      addResearchClaim(
        project.id,
        `综合评分 ${r.overallScore}/100（${r.overallScore >= 80 ? '强烈推荐' : r.overallScore >= 60 ? '推荐' : r.overallScore >= 40 ? '中性偏谨慎' : '回避'}）`,
        evidenceIds,
        r.overallScore >= 60 ? 'medium' : 'low',
      )
      addResearchClaim(
        project.id,
        `识别 ${r.risks.filter((x) => x.level === '高').length} 项高风险、${r.catalysts.length} 项潜在催化`,
        [riskEv.id],
        'medium',
      )
      // 规则19：无证据的结论 → 强制标记为模型推断
      addResearchClaim(project.id, '综合研报叙述性判断（模型生成，无本地实测证据）', [], 'low')

      // 生成研究报告 V2（规则20：绑定 projectId/asOfDate/快照/结论）
      generateReport(project.id)
      setReport({ ...r, projectId: project.id, evidenceIds, isModelInference: false })

      // 生成叙述性报告（含知识库上下文）
      let kbContext = ''
      if (selectedDocs.length > 0) {
        kbContext = selectedDocs.map((d) => `[${d.source}] ${d.title}:\n${d.keyPoints.map((p) => `  • ${p}`).join('\n')}`).join('\n\n')
      }
      const narrative = generateNarrativeSummary(params.nlQuery || `${params.stock.name} 综合投研分析`, r, kbContext)
      setNarrativeReport(narrative)

      setRunning(false)
    }, 50)
  }

  if (universeState.loading) return <div className="space-y-6"><PageHeader /><LoadingBlock text="股票池数据加载中…" /></div>
  if (universeState.error) return <div className="space-y-6"><PageHeader /><ErrorBlock error={universeState.error} onRetry={universeState.reload} /></div>

  return (
    <div className="space-y-6">
      <PageHeader />

      {/* 统一输入面板 */}
      <UnifiedInput
        universe={universeState.data ?? []}
        onSubmit={handleSubmit}
        running={running}
        onRefreshKB={() => setKbVersion((v) => v + 1)}
        docs={docs}
        onAddDoc={() => setKbVersion((v) => v + 1)}
      />

      {/* 报告输出 */}
      {report && (
        <div className="space-y-5">
          {/* 总览 */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{report.stockName}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  <span className="font-mono">{report.stockCode}</span>
                  <span className="mx-2">·</span>
                  {report.framework.institution} {report.framework.name}
                  <Badge variant="outline" className="ml-2 border-gray-200 bg-gray-50 text-[10px] font-normal text-gray-400">
                    {getFrameworkNote(report.framework)}
                  </Badge>
                </p>
                <p className="mt-2 max-w-xl text-xs text-gray-400">{report.framework.description}</p>

                {/* 引用的知识库研报 */}
                {refDocs.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-xs text-blue-600">引用研报：</span>
                    {refDocs.map((d) => (
                      <Badge key={d.id} variant="outline" className="border-blue-300 bg-blue-50 text-blue-600 text-[10px]">{d.source} · {d.title.slice(0, 20)}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-center">
                <div className={`text-4xl font-bold tabular-nums ${scoreColor(report.overallScore)}`}>{report.overallScore}</div>
                <div className="text-xs text-gray-400">综合评分 / 100</div>
                <Badge variant="outline" className={`mt-1.5 ${report.overallScore >= 80 ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : report.overallScore >= 60 ? 'border-amber-400 bg-amber-50 text-amber-700' : report.overallScore >= 40 ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-rose-400 bg-rose-50 text-rose-700'}`}>
                  {report.overallScore >= 80 ? '强烈推荐' : report.overallScore >= 60 ? '推荐' : report.overallScore >= 40 ? '中性偏谨慎' : '回避'}
                </Badge>
              </div>
            </div>
          </div>

          {/* 维度 */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><Layers className="h-4 w-4 text-amber-500" />多维度分析</h3>
            <div className="space-y-2">
              {report.dimensions.map((dim) => (<DimensionPanel key={dim.dimensionId} dim={dim} />))}
            </div>
          </div>

          {/* 估值 + 风险 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ValuationPanel report={report} />
            <div className="space-y-4"><RiskPanel risks={report.risks} /><CatalystPanel catalysts={report.catalysts} /></div>
          </div>

          {/* 同业对标 */}
          {report.peerComparison.length > 0 && <PeerTable peers={report.peerComparison} stockName={report.stockName} />}

          {/* 叙述性研报 */}
          {narrativeReport && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><FileText className="h-4 w-4 text-blue-500" />综合研报</h3>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700">{narrativeReport}</pre>
            </div>
          )}

          {/* V2 研究结论与证据链（规则19/20） */}
          {report.projectId && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><Shield className="h-4 w-4 text-amber-500" />研究结论与证据链</h3>
              <div className="space-y-2">
                {getClaims(report.projectId).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    <span className="text-gray-800">{c.claim}</span>
                    {c.isModelInference ? (
                      <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-600">模型推断</Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-600">证据 {c.evidenceIds.length} 条</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] text-gray-400">置信 {c.confidence}</Badge>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-2">
                <div className="mb-1 text-[11px] text-gray-400">证据条目（{getEvidence(report.projectId).length}）</div>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {getEvidence(report.projectId).map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-[11px] text-gray-500">
                      <Badge variant="outline" className="shrink-0 text-[10px] text-gray-400">{ev.kind}</Badge>
                      <span><span className="text-gray-700">{ev.source}</span>：{ev.summary}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />以上分析基于公开行情数据与因子截面排名，由框架 + NL需求 + 知识库综合驱动生成，不构成投资建议。
          </div>
        </div>
      )}

      <LazyLoader><AgentGraph /></LazyLoader>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <FileSearch className="h-5 w-5 text-amber-500" />
      <div>
        <h1 className="text-lg font-semibold text-gray-900">个股投研</h1>
        <p className="text-xs text-gray-400">选股 → 框架 → NL需求 → 知识库引用 → 一键综合报告</p>
      </div>
    </div>
  )
}
