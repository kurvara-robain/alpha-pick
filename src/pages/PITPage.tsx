// ─────────────────────────────────────────────────────────────
// V1.5 PIT 时间旅行 → 全局 PIT 基准
// 选择历史日期 → 设为全局 asOfDate（规则8：Run/筛选/回测/报告共用）
// 规则9：PIT 能力不足的数据标记 approximate/unavailable，不得宣称无前视偏差
// ─────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react'
import { CalendarDays, Clock, Database, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { fmtPct } from '@/lib/format'
import {
  getPitContext,
  getActiveSnapshot,
  setActivePit,
  registerDataSnapshot,
} from '@/lib/dataSnapshotStore'

interface PITSnapshot {
  code: string; name: string; industry: string; date: string
  close: number; volume: number; amplitude: number | null
  ma20: number | null; ma60: number | null
  mom5: number | null; mom20: number | null; mom60: number | null
  bias20: number | null; pe: number | null; pb: number | null
  mktCap: number | null; roe: number | null
}

interface PITResult {
  targetDate: string; totalStocks: number; snapshots: PITSnapshot[]
}

export default function PITPage() {
  const [date, setDate] = useState('2025-06-30')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PITResult | null>(null)
  const [search, setSearch] = useState('')
  const [pitTick, setPitTick] = useState(0)

  // 全局 PIT 基准（规则8：所有模块共用同一 asOfDate）
  // pitTick 触发重新渲染；上下文读取器自身负责返回当前快照。
  void pitTick
  const pit = getPitContext()
  const snap = getActiveSnapshot()

  const loadSnapshot = async () => {
    setLoading(true); setError('')
    try {
      const taskRes = await fetch('/api/tasks/pit-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      // 防御：非 JSON 响应（如 dev 中间件未挂载时返回 HTML）给出可诊断错误
      const taskBody = await taskRes.text()
      let taskJson: { taskId?: string; status?: string; error?: string }
      try {
        taskJson = JSON.parse(taskBody)
      } catch {
        throw new Error(
          `PIT 接口返回异常（HTTP ${taskRes.status}）：请确认 Vite 中间件已挂载（dev server），非 HTML 响应`,
        )
      }
      if (!taskJson.taskId) {
        throw new Error(taskJson.error ?? 'PIT 任务创建失败：无 taskId')
      }
      const { taskId } = taskJson

      // 轮询结果
      let attempts = 0
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 1000))
        const res = await fetch(`/api/tasks/${taskId}`)
        const task = await res.json()
        if (task.status === 'completed') {
          // 规则：结果经后端 API 读取（.runtime/pit/ 优先，兼容旧 public/data/），
          // 不再直接 fetch /data/pit-${date}.json（运行时产物不入 Git）
          const dataRes = await fetch(`/api/pit/result?date=${encodeURIComponent(date)}`)
          if (dataRes.ok) {
            const data = (await dataRes.json()) as PITResult
            setResult(data)
            // 注册真实 PIT 快照（数据来自后端按 ≤date 口径重建，非伪造）
            const loaded = (data.snapshots?.length ?? 0) > 0
            const snapReg = registerDataSnapshot({
              batchId: date,
              asOfDate: date,
              dataDate: date, // 后端仅用 ≤ 该日数据重建，PIT 口径
              publishDate: date,
              source: 'tushare',
              stockCount: data.totalStocks ?? 0,
              klineDays: 0,
              qualityChecks: [
                {
                  name: 'pit_snapshot_load',
                  passed: loaded,
                  detail: `重建 ${data.snapshots?.length ?? 0} 只股票截面`,
                },
              ],
              failureCount: loaded ? 0 : 1,
              syncStatus: loaded ? 'synced' : 'failed',
              snapshotId: `pit-${date}`,
            })
            // 规则8：设为全局 PIT 基准
            setActivePit(date, snapReg.id)
            setPitTick((t) => t + 1)
          } else {
            setResult({ targetDate: date, totalStocks: 0, snapshots: [] })
          }
          setLoading(false)
          return
        }
        if (task.status === 'failed') throw new Error(task.error ?? '生成失败')
        attempts++
      }
      throw new Error('超时')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!result) return []
    const q = search.toLowerCase()
    return result.snapshots.filter(
      (s) => s.code.includes(q) || s.name.toLowerCase().includes(q),
    )
  }, [result, search])

  if (loading) return <LoadingBlock text="PIT 截面重建中…逐日回溯计算因子…" />
  if (error) return <ErrorBlock error={error} onRetry={loadSnapshot} />

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Clock className="h-5 w-5 text-amber-500" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">PIT 时间旅行</h1>
          <p className="text-xs text-gray-400">还原任意历史日期可得的真实数据，杜绝前视偏差</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        <Input className="w-36 text-xs" type="date" value={date}
          onChange={(e) => setDate(e.target.value)} max="2026-08-08" />
        <Button onClick={loadSnapshot} className="bg-amber-500 text-xs text-white hover:bg-amber-600">
          <Clock className="h-3.5 w-3.5 mr-1" />穿越到该日期
        </Button>
        <span className="text-[10px] text-gray-400">
          PIT 口径：仅用 ≤ 选定日期的数据，无前视偏差
        </span>
      </div>

      {/* 全局 PIT 基准（规则8/9） */}
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${pit.active ? 'border-cyan-200 bg-cyan-50' : 'border-gray-200 bg-gray-50'}`}>
        <Database className={`h-3.5 w-3.5 ${pit.active ? 'text-cyan-500' : 'text-gray-300'}`} />
        <span className="font-medium text-gray-700">全局 PIT 基准：{pit.asOfDate ?? '未设置（实时数据）'}</span>
        {pit.active ? (
          pit.pitCapable ? (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-600">PIT 可用（无前视）</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-600">近似数据 (approximate)</Badge>
          )
        ) : (
          <Badge variant="outline" className="border-gray-300 bg-gray-100 text-gray-500">未启用</Badge>
        )}
        <span className="text-[10px] text-gray-400">该日期将影响 Run / 筛选 / 回测 / 报告的全局数据基准</span>
        {snap && (
          <span className="text-[10px] text-gray-400">
            快照 {snap.id} · {snap.source} · {snap.syncStatus} · 覆盖 {snap.stockCount} 只 · 失败 {snap.failureCount}
          </span>
        )}
        {pit.active && (
          <button
            onClick={() => { setActivePit(null, null); setPitTick((t) => t + 1) }}
            className="ml-auto text-[11px] text-rose-500 hover:underline"
          >
            退出 PIT 模式
          </button>
        )}
      </div>

      {result && (
        <>
          <div className="flex items-center gap-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-xs">
            <Database className="h-3.5 w-3.5 text-cyan-500" />
            <span className="font-medium">截面日期: {result.targetDate}</span>
            <span>全A可交易股票: {result.totalStocks} 只</span>
            <span>因子: MA20/MA60/动量5/20/60/Bias20</span>
          </div>

          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-gray-400" />
            <Input className="max-w-xs text-xs" placeholder="搜索代码或名称…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="text-[10px] text-gray-400">{filtered.length} 条结果</span>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">代码</th>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 text-right font-medium">收盘</th>
                  <th className="px-3 py-2 text-right font-medium">20日动量</th>
                  <th className="px-3 py-2 text-right font-medium">60日动量</th>
                  <th className="px-3 py-2 text-right font-medium">Bias20</th>
                  <th className="px-3 py-2 text-right font-medium">MA20</th>
                  <th className="px-3 py-2 text-right font-medium">MA60</th>
                  <th className="px-3 py-2 text-right font-medium">PE</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.code} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono text-[10px] text-gray-500">{s.code}</td>
                    <td className="px-3 py-1.5 font-medium text-gray-900">{s.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">¥{s.close.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${(s.mom20 ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {s.mom20 != null ? fmtPct(s.mom20) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${(s.mom60 ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {s.mom60 != null ? fmtPct(s.mom60) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${(s.bias20 ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {s.bias20 != null ? fmtPct(s.bias20) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-600">
                      {s.ma20 != null ? `¥${s.ma20.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-600">
                      {s.ma60 != null ? `¥${s.ma60.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-500">
                      {s.pe != null ? s.pe.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
