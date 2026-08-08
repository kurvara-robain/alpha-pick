// ─────────────────────────────────────────────────────────────
// 实时数据拉通 API 封装（vite dev server 中间件 /api/refresh*）
// 仅开发环境可用；生产静态部署下请求会 404，调用方按失败处理。
// ─────────────────────────────────────────────────────────────

export type RefreshMode = 'quick' | 'deep'

export interface RefreshResult {
  ok: boolean
  updated: number
  dataTime: string
  finishedAt: string
  klineUpdated?: number
  klineFailed?: number
}

export interface RefreshStatus {
  running: boolean
  mode: RefreshMode | null
  stage: string
  done: number
  total: number
  message: string
  lastResult: RefreshResult | null
  error: string | null
}

/** 触发一次实时拉通；已有任务在跑时 started=false 且 conflict=true */
export async function postRefresh(
  mode: RefreshMode = 'quick',
): Promise<{ started: boolean; conflict: boolean; error?: string }> {
  let res: Response
  try {
    res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
  } catch {
    return { started: false, conflict: false, error: '无法连接开发服务器刷新接口' }
  }
  if (res.status === 409) {
    return { started: false, conflict: true }
  }
  if (!res.ok) {
    return { started: false, conflict: false, error: `刷新接口异常（HTTP ${res.status}）` }
  }
  return { started: true, conflict: false }
}

/** 查询拉通任务状态 */
export async function getRefreshStatus(): Promise<RefreshStatus> {
  const res = await fetch('/api/refresh/status')
  if (!res.ok) throw new Error(`状态查询失败（HTTP ${res.status}）`)
  return (await res.json()) as RefreshStatus
}
