// ─────────────────────────────────────────────────────────────
// 任务 API 客户端
// POST /api/tasks/backtest → 研究级回测
// POST /api/tasks/import-csv → 券商数据导入
// GET  /api/tasks → 任务列表
// ─────────────────────────────────────────────────────────────

interface Task {
  id: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message: string
  result?: unknown
  error?: string
  createdAt: string
  completedAt?: string
}

export async function submitBacktest(params: {
  strategyIds: string[]
  factorIds: string[]
  startDate: string
  endDate: string
  rebalance: string
  topN: number
}): Promise<{ taskId: string }> {
  const res = await fetch('/api/tasks/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`Backtest submission failed: ${res.status}`)
  return res.json()
}

export async function submitPITSnapshot(): Promise<{ taskId: string }> {
  const res = await fetch('/api/tasks/pit-snapshot', { method: 'POST' })
  if (!res.ok) throw new Error(`PIT snapshot failed: ${res.status}`)
  return res.json()
}

export async function importCSV(csvText: string): Promise<Task> {
  const res = await fetch('/api/tasks/import-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(csvText),
  })
  if (!res.ok) throw new Error(`CSV import failed: ${res.status}`)
  return res.json()
}

export async function getTask(taskId: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${taskId}`)
  if (!res.ok) throw new Error(`Task fetch failed: ${res.status}`)
  return res.json()
}

export async function listTasks(): Promise<Task[]> {
  const res = await fetch('/api/tasks')
  if (!res.ok) return []
  return res.json()
}

export function pollTask(
  taskId: string,
  onUpdate: (task: Task) => void,
  onComplete: (task: Task) => void,
  intervalMs = 2000,
): () => void {
  let active = true
  const poll = async () => {
    if (!active) return
    try {
      const task = await getTask(taskId)
      onUpdate(task)
      if (task.status === 'completed' || task.status === 'failed') {
        onComplete(task)
        return
      }
      setTimeout(poll, intervalMs)
    } catch {
      setTimeout(poll, intervalMs * 2)
    }
  }
  poll()
  return () => { active = false }
}
