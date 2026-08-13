// ─────────────────────────────────────────────────────────────
// 自动发现因子面板 — 展示遗传挖掘结果 + 一键入库
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { Dna, FlaskConical, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { updateDB } from '@/lib/store'

interface DiscoveredFactor {
  expression: string
  ic_mean: number
  ic_std: number
  icir: number
  valid_days: number
  abs_ic_mean: number
}

export default function DiscoveredFactorsPanel() {
  const [factors, setFactors] = useState<DiscoveredFactor[]>([])
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null)
  const [btMap, setBtMap] = useState<Record<string, { status: string; ic?: number; sharpe?: number }>>({})

  const loadFactors = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/data/discovered_factors.json')
      if (!res.ok) throw new Error('暂无发现因子，运行挖掘任务后生成')
      const data = await res.json()
      // Handle both array and { factors: [...], discovered_at: ... } formats
      if (Array.isArray(data)) {
        setFactors(data)
      } else {
        setFactors(data.factors ?? [])
        setDiscoveredAt(data.discovered_at ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
    setLoading(false)
  }

  useEffect(() => { loadFactors() }, [])

  const addToPool = (expr: string) => {
    const name = expr.length > 40 ? expr.slice(0, 40) + '…' : expr
    const factor = factors.find((f) => f.expression === expr)
    updateDB((db) => {
      // 检查是否已存在
      const existing = db.factors.find((f) => f.name === `挖掘: ${name}`)
      if (existing) return
      db.factors.push({
        id: `mined-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        name: `挖掘: ${name}`,
        origin: '遗传挖掘',
        category: '合成',
        source: 'self',
        definition: `自动发现因子: ${expr} · IC=${factor?.ic_mean?.toFixed(4)} · ICIR=${factor?.icir?.toFixed(2)} · ${factor?.valid_days}评估日`,
        applicable: '全市场',
        notes: `遗传算法自动生成，经${factor?.valid_days ?? 0}个评估日验证`,
        status: '挖掘中',
      })
      db.factorPool.push(`mined-${Date.now()}-${Math.random().toString(36).slice(2,6)}`)
    })
    setAdded(new Set([...added, expr]))
  }

  const triggerBacktest = async (expr: string) => {
    setBtMap(prev => ({ ...prev, [expr]: { status: 'running' } }))
    try {
      const res = await fetch('/api/factor/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: expr }),
      })
      if (!res.ok) throw new Error('评估失败')
      const result = await res.json()
      setBtMap(prev => ({ ...prev, [expr]: { status: 'done', ic: result.ic_mean ?? result.ic } }))
    } catch (e: any) {
      setBtMap(prev => ({ ...prev, [expr]: { status: 'error' } }))
    }
  }

  const triggerMining = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/factor/mine', { method: 'POST' })
      if (!res.ok) throw new Error('挖掘任务启动失败')
      const { taskId } = await res.json()
      // 轮询等待
      let attempts = 0
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 2000))
        const tRes = await fetch(`/api/tasks/${taskId}`)
        const task = await tRes.json()
        if (task.status === 'completed') {
          await loadFactors()
          return
        }
        if (task.status === 'failed') throw new Error(task.error ?? '挖掘失败')
        attempts++
      }
      throw new Error('超时')
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动失败')
    }
    setLoading(false)
  }

  const ranked = [...factors].sort((a, b) => b.abs_ic_mean - a.abs_ic_mean)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Dna className="h-4 w-4 text-amber-500" />自动发现因子
          {discoveredAt && (
            <span className="text-[10px] font-normal text-gray-400">
              · 挖掘于 {new Date(discoveredAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <Button onClick={triggerMining} disabled={loading} variant="outline" size="sm" className="text-xs gap-1">
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            立即挖掘
          </Button>
          <Button onClick={loadFactors} disabled={loading} variant="outline" size="sm" className="text-xs">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        遗传算法自动生成候选因子，基于真实 K 线数据评估 IC，|IC|{' > '}0.03 的强因子可一键入库。
      </p>

      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{error}</div>}

      {ranked.length === 0 && !loading && !error ? (
        <div className="rounded border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
          暂无发现因子 — 点击「立即挖掘」或等待每周自动挖掘任务
        </div>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">表达式</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">|IC|</th>
                <th className="px-2 py-1.5 text-right font-medium w-12">ICIR</th>
                <th className="px-2 py-1.5 text-right font-medium w-12">天数</th>
                <th className="px-2 py-1.5 text-center font-medium w-12">回测</th>
                <th className="px-2 py-1.5 text-center font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((f, i) => (
                <tr key={i} className={`border-t border-gray-100 ${f.abs_ic_mean > 0.03 ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700 max-w-xs truncate" title={f.expression}>
                    {f.expression}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${f.abs_ic_mean > 0.05 ? 'text-emerald-600 font-bold' : f.abs_ic_mean > 0.03 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {f.ic_mean >= 0 ? '+' : ''}{f.ic_mean.toFixed(4)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-600">{f.icir.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-400">{f.valid_days}</td>
                  <td className="px-1 py-1.5 text-center">
                    {(() => {
                      const bt = btMap[f.expression]
                      if (!bt || bt.status === 'idle') return (
                        <button onClick={() => triggerBacktest(f.expression)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 underline cursor-pointer bg-transparent border-0 p-0"
                          title="对该因子运行回测">回测</button>
                      )
                      if (bt.status === 'running') return <span className="text-[10px] text-gray-400 animate-pulse">⏳</span>
                      if (bt.status === 'error') return <span className="text-[10px] text-rose-400" title="回测失败">✗</span>
                      return <span className="text-[10px] text-emerald-600 font-mono" title={`IC=${bt.ic?.toFixed(3) ?? '?'} SR=${bt.sharpe?.toFixed(2) ?? '?'}`}>IC{bt.ic != null ? (bt.ic >= 0 ? '+' : '') + bt.ic.toFixed(2) : '?'}</span>
                    })()}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    {added.has(f.expression) ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-600 text-[10px]">已入库</Badge>
                    ) : (
                      <Button onClick={() => addToPool(f.expression)} size="sm" variant="outline"
                        className="text-[10px] h-6 px-1.5 border-amber-300 text-amber-600 hover:bg-amber-50">
                        <Plus className="h-2.5 w-2.5 mr-0.5" />入库
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
