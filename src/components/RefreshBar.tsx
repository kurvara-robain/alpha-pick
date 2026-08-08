// ─────────────────────────────────────────────────────────────
// 实时数据拉通条：触发后端快照刷新（/api/refresh），按钮上展示进度，
// 完成后 toast 提示结果并回调上层重新加载数据。
// 快速拉通：快照 only，约 2 分钟；深度拉通：快照 + 全市场 K 线增量，约 30-60 分钟。
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Layers, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getRefreshStatus, postRefresh } from '../lib/refreshApi'
import type { RefreshMode, RefreshStatus } from '../lib/refreshApi'

const POLL_MS = 1500

interface Props {
  fetchedAt?: string // meta.json 的数据时间（空闲态展示数据截止）
  onRefreshed: () => void // 拉通成功后回调：失效缓存并重新加载
}

function fmtDataTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default function RefreshBar({ fetchedAt, onRefreshed }: Props) {
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [starting, setStarting] = useState<RefreshMode | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sawRunningRef = useRef(false)
  const onRefreshedRef = useRef(onRefreshed)
  onRefreshedRef.current = onRefreshed

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const finalize = useCallback(
    (s: RefreshStatus) => {
      stopPolling()
      sawRunningRef.current = false
      if (s.lastResult?.ok) {
        const r = s.lastResult
        if (s.mode === 'deep' || typeof r.klineUpdated === 'number') {
          toast.success(
            `深度拉通完成：快照 ${r.updated} 只 + K线 ${r.klineUpdated ?? 0} 只已更新` +
              (r.klineFailed ? `（失败 ${r.klineFailed} 只）` : ''),
          )
        } else {
          toast.success(`实时拉通完成：更新 ${r.updated} 只，数据时间 ${r.dataTime}`)
        }
        onRefreshedRef.current()
      } else {
        toast.error(`实时拉通失败：${s.error ?? '未知错误'}`)
      }
    },
    [stopPolling],
  )

  const poll = useCallback(async () => {
    try {
      const s = await getRefreshStatus()
      setStatus(s)
      if (s.running) {
        sawRunningRef.current = true
      } else if (sawRunningRef.current) {
        finalize(s)
      }
    } catch {
      // 状态查询失败（如接口不存在/服务器重启）：停止轮询并提示
      stopPolling()
      sawRunningRef.current = false
      setStatus(null)
      toast.error('无法连接刷新接口（vite 插件中间件仅在 dev server 下可用）')
    }
  }, [finalize, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    timerRef.current = setInterval(() => void poll(), POLL_MS)
  }, [poll, stopPolling])

  // 挂载时查一次：若页面刷新时恰有任务在跑，恢复进度展示
  useEffect(() => {
    void (async () => {
      try {
        const s = await getRefreshStatus()
        setStatus(s)
        if (s.running) {
          sawRunningRef.current = true
          startPolling()
        }
      } catch {
        /* dev 接口不可用时空闲即可，不打扰 */
      }
    })()
    return stopPolling
  }, [startPolling, stopPolling])

  const handleClick = async (mode: RefreshMode) => {
    setStarting(mode)
    const r = await postRefresh(mode)
    setStarting(null)
    if (r.started) {
      sawRunningRef.current = true
      setStatus({
        running: true,
        mode,
        stage: 'init',
        done: 0,
        total: 0,
        message: mode === 'deep' ? '正在启动深度拉通（快照 + K线增量）' : '正在启动刷新脚本',
        lastResult: null,
        error: null,
      })
      startPolling()
    } else if (r.conflict) {
      toast.info('已有拉通任务在运行中，正在同步进度…')
      sawRunningRef.current = true
      startPolling()
    } else {
      toast.error(`启动拉通失败：${r.error ?? '未知错误'}`)
    }
  }

  const running = status?.running ?? false
  const busy = running || starting !== null
  const isDeep = status?.mode === 'deep'
  const pct = running && status && status.total > 0 ? Math.round((status.done / status.total) * 100) : 0
  const stageLabel = (stage?: string) =>
    stage === 'quotes' ? '快照' : stage === 'kline' ? 'K线增量' : stage === 'indices' ? '指数' : stage === 'write' ? '落盘' : null
  const stage = running ? stageLabel(status?.stage) : null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* 快速拉通（主按钮） */}
        <button
          onClick={() => void handleClick('quick')}
          disabled={busy}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            busy
              ? 'cursor-not-allowed bg-amber-100 text-amber-500/70'
              : 'bg-gradient-to-r from-amber-400 to-amber-600 text-white shadow-[0_0_12px_rgba(245,158,11,0.25)] hover:from-amber-500 hover:to-amber-600'
          }`}
        >
          {running && !isDeep ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : starting === 'quick' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {running && !isDeep
            ? status?.message || '正在拉通…'
            : starting === 'quick'
              ? '正在启动…'
              : '实时数据拉通'}
        </button>

        {/* 深度拉通（次要按钮） */}
        <button
          onClick={() => void handleClick('deep')}
          disabled={busy}
          title="快照 + 全市场 K 线增量合并，预计 30-60 分钟"
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            busy
              ? 'cursor-not-allowed border-gray-200 bg-white/40 text-gray-400'
              : 'border-amber-500/40 bg-amber-50 text-amber-600 hover:border-amber-400 hover:bg-amber-100'
          }`}
        >
          {running && isDeep ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : starting === 'deep' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Layers className="h-4 w-4" />
          )}
          {running && isDeep
            ? status?.message || '深度拉通中…'
            : starting === 'deep'
              ? '正在启动…'
              : '深度拉通（含K线）'}
          {!busy && <span className="text-xs font-normal text-gray-400">约30-60分钟</span>}
        </button>

        {running && status && status.total > 0 && (
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500">
              {stage ? `${stage} ` : ''}
              {pct}%
            </span>
          </div>
        )}

        {!running && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Database className="h-3.5 w-3.5 shrink-0 text-gray-300" />
            数据截止 {fmtDataTime(fetchedAt)}，点击按钮拉取最新行情快照
          </span>
        )}
      </div>
    </div>
  )
}
