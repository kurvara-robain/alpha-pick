// ─────────────────────────────────────────────────────────────
// 知行体系 — 极简版
// 选范围 → 扫描 → 看结果。没有多余的东西。
// ─────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { fmtNum } from '@/lib/format'
import { computeZettarancFactors, type ZettarancFactors, type KlineData } from '@/lib/zettarancFactors'
import { getWatchlist } from '@/lib/watchlistStore'
import { getKnowledgeCards } from '@/lib/zettarancKnowledge'
import { getDB } from '@/lib/store'
import type { KnowledgeCard } from '@/lib/zettarancKnowledge'

const SAMPLE_CODES = [
  '600519.SH','000858.SZ','601318.SH','600036.SH','000333.SZ','600276.SH','000651.SZ','601398.SH','600900.SH','000002.SZ',
  '002415.SZ','300750.SZ','603259.SH','600809.SH','000568.SZ','002475.SZ','300124.SZ','601012.SH','688981.SH','002230.SZ',
  '300059.SZ','002049.SZ','600570.SH','300033.SZ','000977.SZ','688008.SH','300502.SZ','002371.SZ','603501.SH','300782.SZ',
]

type ScanEntry = { code: string; factors: ZettarancFactors }

async function loadKline(code: string): Promise<KlineData | null> {
  try {
    const r = await fetch(`/data/kline/${code}.json`)
    if (!r.ok) return null
    const d = await r.json()
    if (!d.closes || d.closes.length < 60) return null
    return { dates: d.dates??[], opens: d.opens??d.closes, closes: d.closes, highs: d.highs??d.closes, lows: d.lows??d.closes, volumes: d.vols??d.volumes??[] }
  } catch { return null }
}

export default function ZettarancPage() {
  const [mode, setMode] = useState<'watchlist'|'30'|'100'|'200'>('30')
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<ScanEntry[]>([])
  const [concept, setConcept] = useState<KnowledgeCard | null>(null)
  const [wlCodes, setWlCodes] = useState<string[]>([])
  const [watchlists, setWatchlists] = useState<Record<string, string[]>>({})
  const [selList, setSelList] = useState('')

  // 首次加载：手动自选 + 各备选清单
  useEffect(() => {
    const codes = new Set<string>()
    // 手动追踪的自选股
    for (const s of getWatchlist()) codes.add(s.code)
    if (codes.size > 0) setWlCodes(['__manual__', ...codes])
    // DB 中保存的每个备选清单单独一个集合
    const db = getDB()
    const lists: Record<string, string[]> = {}
    for (const wl of (db.watchlists ?? [])) {
      const wCodes = (wl.items ?? []).map(i => i.code)
      if (wCodes.length > 0) lists[wl.name ?? `清单${wl.id.slice(0,6)}`] = wCodes
    }
    setWatchlists(lists)
    // 默认选中第一个
    const names = Object.keys(lists)
    if (names.length > 0) { setSelList(names[0]); setMode('watchlist') }
  }, [])

  const runScan = useCallback(async () => {
    setScanning(true)
    setResults([])
    let codes: string[]
    if (mode === 'watchlist') {
      // 使用选中清单的代码
      codes = watchlists[selList] ?? []
      if (codes.length === 0) codes = wlCodes.filter(c => c !== '__manual__')
    }
    else codes = SAMPLE_CODES.slice(0, Number(mode))
    
    const entries: ScanEntry[] = []
    for (const code of codes) {
      const kl = await loadKline(code)
      if (!kl) continue
      entries.push({ code, factors: computeZettarancFactors(code, kl) })
    }
    entries.sort((a, b) => b.factors.zettarancScore - a.factors.zettarancScore)
    setResults(entries)
    setScanning(false)
  }, [mode, wlCodes, watchlists, selList])

  return (
    <div className="space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">知行体系</h1>
          <p className="text-[11px] text-gray-400">
            {results.length > 0 ? `扫描 ${results.length} 只 · Top Z评分 ${results[0]?.factors.zettarancScore ?? 0}` : '选择范围后点击扫描'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-7 rounded border border-gray-200 px-2 text-xs text-gray-600"
            value={mode === 'watchlist' && selList ? selList : mode}
            onChange={e => {
              const v = e.target.value
              if (watchlists[v]) { setMode('watchlist'); setSelList(v) }
              else if (v === '__manual__') { setMode('watchlist'); setSelList('') }
              else setMode(v as any)
            }}>
            {wlCodes.length > 1 && <option value="__manual__">手动自选 ({wlCodes.length - 1}只)</option>}
            {Object.entries(watchlists).map(([name, codes]) => (
              <option key={name} value={name}>{name} ({codes.length}只)</option>
            ))}
            <option value="30">30 只</option>
            <option value="100">100 只</option>
            <option value="200">200 只</option>
          </select>
          <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 size={12} className="mr-1 animate-spin"/> : <Activity size={12} className="mr-1"/>}
            {scanning ? '扫描中…' : '扫描'}
          </Button>
        </div>
      </div>

      {/* 结果表 */}
      {results.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50 text-[10px] text-gray-400">
                <th className="py-2 px-3 text-left">代码</th>
                <th className="py-2 px-3 text-right">Z评分</th>
                <th className="py-2 px-3 text-left">命中战法</th>
                <th className="py-2 px-3 text-right">K / D / J</th>
                <th className="py-2 px-3 text-right">量比</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const f = r.factors
                return (
                  <tr key={r.code} className={cn('border-b border-gray-50', f.zettarancScore >= 50 ? 'hover:bg-amber-50/30' : 'hover:bg-gray-50')}>
                    <td className="py-1.5 px-3 font-mono text-gray-700">{r.code}</td>
                    <td className="py-1.5 px-3 text-right">
                      <span className={cn('font-mono font-semibold', f.zettarancScore >= 60 ? 'text-red-500' : f.zettarancScore >= 40 ? 'text-amber-600' : 'text-gray-400')}>
                        {f.zettarancScore}
                      </span>
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="flex flex-wrap gap-0.5">
                        {f.matchedStrategies.slice(0, 5).map(s => (
                          <Badge key={s} variant="outline"
                            className={cn('text-[9px] cursor-pointer', s.includes('⚠️') ? 'text-rose-500 border-rose-200' : 'text-amber-600 border-amber-200')}
                            onClick={async () => {
                              // 点击战法名→查知识库
                              const name = s.replace('⚠️','').trim()
                              const cards = await getKnowledgeCards([s])
                              if (cards[0]) setConcept(cards[0])
                            }}>
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-[10px] text-gray-500">
                      {f.kdjK.toFixed(0)}/{f.kdjD.toFixed(0)}/{f.kdjJ.toFixed(0)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-gray-500">{f.volumeRatio.toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* 知识库弹窗 */}
      {concept && (
        <Card className="border-2 border-blue-400 p-4 bg-blue-50/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">{concept.conceptName}</span>
            <button onClick={() => setConcept(null)} className="text-gray-400 text-lg leading-none">&times;</button>
          </div>
          <p className="text-xs text-blue-800 mb-2">{concept.oneLiner}</p>
          <div className="space-y-0.5">
            {concept.rules.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400"/>
                <span className="text-[10px] text-gray-700">{r}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!scanning && results.length === 0 && (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          选择扫描范围，点击「扫描」开始分析
        </div>
      )}
    </div>
  )
}
