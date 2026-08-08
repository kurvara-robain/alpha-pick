// ─────────────────────────────────────────────────────────────
// 通用异步数据 Hook：loading / error / reload 三态封装
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAsync<T>(factory: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data, loading: true, error: null }))
    factory()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (alive) {
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { ...state, reload }
}
