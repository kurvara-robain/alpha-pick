// ─────────────────────────────────────────────────────────────
// 数据自动刷新 Hook — 定时轮询 + 手动刷新
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'

interface AutoRefreshState<T> {
  data: T | null
  loading: boolean
  error: string
  lastUpdated: Date | null
  refresh: () => void
}

export function useAutoRefresh<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 30_000, // 默认 30 秒
  enabled: boolean = true,
): AutoRefreshState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetcher()
      if (mountedRef.current) {
        setData(result)
        setLastUpdated(new Date())
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : '刷新失败')
      }
    }
    if (mountedRef.current) setLoading(false)
  }, [fetcher])

  // 初始加载
  useEffect(() => {
    refresh()
  }, [refresh])

  // 定时轮询
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    timerRef.current = setInterval(refresh, intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refresh, intervalMs, enabled])

  // 页面隐藏时暂停，可见时恢复
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current)
      } else {
        refresh()
        if (enabled && intervalMs > 0) {
          timerRef.current = setInterval(refresh, intervalMs)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refresh, intervalMs, enabled])

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  return { data, loading, error, lastUpdated, refresh }
}
