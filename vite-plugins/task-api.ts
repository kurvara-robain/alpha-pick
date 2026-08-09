// ─────────────────────────────────────────────────────────────
// Vite 中间件：任务 API
// POST /api/tasks/backtest  → 提交回测任务
// POST /api/tasks/pit-snapshot → 生成 PIT 截面
// POST /api/tasks/import-csv → 导入券商 CSV
// GET  /api/tasks/:id → 查询任务状态
// GET  /api/tasks → 列出所有任务
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Plugin, ViteDevServer } from 'vite'

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

interface Task {
  id: string
  type: 'backtest' | 'pit_snapshot' | 'import_csv'
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number // 0-100
  message: string
  result?: unknown
  error?: string
  createdAt: string
  completedAt?: string
}

// ═══════════════════════════════════════════════════════════════
// 任务存储（文件系统）
// ═══════════════════════════════════════════════════════════════

const TASKS_DIR = path.resolve('.alphamind-tasks')
if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true })

function taskPath(id: string): string {
  return path.join(TASKS_DIR, `${id}.json`)
}

function saveTask(task: Task): void {
  fs.writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2))
}

function loadTask(id: string): Task | null {
  try {
    return JSON.parse(fs.readFileSync(taskPath(id), 'utf8')) as Task
  } catch {
    return null
  }
}

function listTasks(): Task[] {
  try {
    return fs.readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf8')) as Task }
        catch { return null }
      })
      .filter((t): t is Task => t !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch {
    return []
  }
}

function uid(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ═══════════════════════════════════════════════════════════════
// 任务执行器
// ═══════════════════════════════════════════════════════════════

function runPythonScript(scriptPath: string, args: string[], task: Task): void {
  task.status = 'running'
  task.message = '正在执行 Python 脚本…'
  saveTask(task)

  const child = spawn('/usr/bin/python3', [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    timeout: 10 * 60 * 1000, // 10 分钟超时
  })

  let stdout = ''
  let stderr = ''

  child.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString()
    // 解析进度（脚本输出 "PROGRESS:50" 格式）
    const progressMatch = stdout.match(/PROGRESS:(\d+)/g)
    if (progressMatch) {
      const last = progressMatch[progressMatch.length - 1]
      task.progress = parseInt(last.split(':')[1])
      task.message = `回测中… ${task.progress}%`
      saveTask(task)
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
  })

  child.on('close', (code) => {
    if (code === 0) {
      task.status = 'completed'
      task.progress = 100
      task.message = '回测完成'
      task.result = { stdout: stdout.slice(-500), outputFiles: extractOutputFiles(stdout) }
      task.completedAt = new Date().toISOString()
    } else {
      task.status = 'failed'
      task.error = stderr || stdout || `进程退出码 ${code}`
      task.message = '回测失败'
      task.completedAt = new Date().toISOString()
    }
    saveTask(task)
  })

  child.on('error', (err) => {
    task.status = 'failed'
    task.error = err.message
    task.message = '进程启动失败'
    task.completedAt = new Date().toISOString()
    saveTask(task)
  })
}

function extractOutputFiles(stdout: string): string[] {
  const files: string[] = []
  const match = stdout.match(/OUTPUT:(.+\.json)/g)
  if (match) match.forEach((m) => files.push(m.replace('OUTPUT:', '')))
  return files
}

// ═══════════════════════════════════════════════════════════════
// HTTP 处理
// ═══════════════════════════════════════════════════════════════

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(body))
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

// ═══════════════════════════════════════════════════════════════
// Vite 插件
// ═══════════════════════════════════════════════════════════════

export function taskApi(): Plugin {
  return {
    name: 'alphamind-task-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''

        // CORS 预检
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }

        // ── POST /api/agent/run ──
        if (url === '/api/agent/run' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const taskId = uid()
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/agent_runtime.py'), 'run',
            '--task-id', taskId,
            '--params', JSON.stringify(params),
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 60000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', () => {
            try { json(res, 200, JSON.parse(stdout)) }
            catch { json(res, 500, { error: stdout.slice(0, 500) }) }
          })
          child.on('error', (err) => json(res, 500, { error: err.message }))
          return
        }

        // ── POST /api/agent/approve ──
        if (url === '/api/agent/approve' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/agent_runtime.py'), 'approve',
            '--run-id', (params.runId as string) ?? '',
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 30000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', () => {
            try { json(res, 200, JSON.parse(stdout)) }
            catch { json(res, 500, { error: stdout.slice(0, 500) }) }
          })
          child.on('error', (err) => json(res, 500, { error: err.message }))
          return
        }

        // ── GET /api/agent/runs ──
        if (url === '/api/agent/runs' && req.method === 'GET') {
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/agent_runtime.py'), 'list',
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 10000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', () => {
            try { json(res, 200, JSON.parse(stdout)) }
            catch { json(res, 200, []) }
          })
          child.on('error', () => json(res, 200, []))
          return
        }

        // ── POST /api/pit/generate ──
        if (url === '/api/pit/generate' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const date = (params.date as string) ?? '2025-06-30'
          const id = uid()
          const task: Task = {
            id, type: 'pit_snapshot', status: 'pending', progress: 0,
            message: 'PIT 截面生成中…', createdAt: new Date().toISOString(),
          }
          saveTask(task)
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/pit_snapshot.py'),
            '--date', date, '--top-n', '100',
            '--output', `pit-${date}.json`,
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 300000 })
          child.stdout?.on('data', (d: Buffer) => {
            const text = d.toString()
            const pm = text.match(/PROGRESS:(\d+)/)
            if (pm) { task.progress = parseInt(pm[1]); task.message = `重建中… ${task.progress}%`; saveTask(task) }
          })
          child.on('close', (code) => {
            task.status = code === 0 ? 'completed' : 'failed'
            task.progress = code === 0 ? 100 : 0
            task.message = code === 0 ? 'PIT 截面完成' : '生成失败'
            task.completedAt = new Date().toISOString()
            saveTask(task)
          })
          child.on('error', (err) => {
            task.status = 'failed'; task.error = err.message
            task.message = '进程启动失败'; task.completedAt = new Date().toISOString()
            saveTask(task)
          })
          json(res, 202, { taskId: id, status: 'pending' })
          return
        }


        // ── POST /api/factor/mine ──
        if (url === '/api/factor/mine' && req.method === 'POST') {
          const id = uid()
          const task: Task = {
            id, type: 'factor_mine', status: 'pending', progress: 0,
            message: '因子挖掘任务已提交', createdAt: new Date().toISOString(),
          }
          saveTask(task)
          const child = spawn('/Users/kurvara/.hermes/hermes-agent/venv/bin/python3.11', [
            path.resolve('scripts/factor_miner.py'), 'mine',
            '-g', '500', '-k', '50', '-o', 'discovered_factors.json',
            '--top-stocks', '500',
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 600000 })
          child.stdout?.on('data', (d: Buffer) => {
            const text = d.toString()
            const pm = text.match(/PROGRESS:(\d+)/)
            if (pm) { task.progress = parseInt(pm[1]); task.message = text.trim().slice(-80); saveTask(task) }
          })
          child.on('close', (code) => {
            task.status = code === 0 ? 'completed' : 'failed'
            task.progress = code === 0 ? 100 : 0
            task.message = code === 0 ? '因子挖掘完成' : '挖掘失败'
            task.completedAt = new Date().toISOString()
            saveTask(task)
          })
          child.on('error', (err) => {
            task.status = 'failed'; task.error = err.message
            task.message = '进程启动失败'; task.completedAt = new Date().toISOString()
            saveTask(task)
          })
          json(res, 202, { taskId: id })
          return
        }


        // ── POST /api/factor/eval ──
        if (url === '/api/factor/eval' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const expr = (params.expression as string) ?? ''
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/factor_miner.py'), 'eval', '-e', expr,
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 120000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.stderr?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', (code) => {
            try { json(res, code === 0 ? 200 : 500, JSON.parse(stdout.trim() || '{}')) }
            catch { json(res, 500, { error: stdout.slice(0, 500) || 'parse error' }) }
          })
          child.on('error', (err) => json(res, 500, { error: err.message }))
          return
        }


        // ── POST /api/tasks/backtest ──
        if (url === '/api/tasks/backtest' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* use defaults */ }

          const id = uid()
          const task: Task = {
            id, type: 'backtest', status: 'pending', progress: 0,
            message: '回测任务已提交', createdAt: new Date().toISOString(),
          }
          saveTask(task)

          const scriptPath = path.resolve('scripts/backtest_runner.py')
          const strategyIds = (params.strategyIds as string[] ?? []).join(',')
          const factorIds = (params.factorIds as string[] ?? []).join(',')
          const startDate = (params.startDate as string) ?? '2024-01-01'
          const endDate = (params.endDate as string) ?? '2026-01-01'
          const rebalance = (params.rebalance as string) ?? 'monthly'
          const topN = (params.topN as number) ?? 25

          runPythonScript(scriptPath, [
            '--strategy-ids', strategyIds,
            '--factor-ids', factorIds,
            '--start', startDate,
            '--end', endDate,
            '--rebalance', rebalance,
            '--top-n', String(topN),
            '--task-id', id,
          ], task)

          json(res, 202, { taskId: id, status: 'pending' })
          return
        }

        // ── POST /api/tasks/pit-snapshot ──
        if (url === '/api/tasks/pit-snapshot' && req.method === 'POST') {
          const id = uid()
          const task: Task = {
            id, type: 'pit_snapshot', status: 'pending', progress: 0,
            message: 'PIT 截面生成任务已提交', createdAt: new Date().toISOString(),
          }
          saveTask(task)

          const scriptPath = path.resolve('scripts/pit_backfill.py')
          runPythonScript(scriptPath, ['--task-id', id], task)

          json(res, 202, { taskId: id, status: 'pending' })
          return
        }

        // ── POST /api/tasks/import-csv ──
        if (url === '/api/tasks/import-csv' && req.method === 'POST') {
          const body = await readBody(req)
          const id = uid()
          const task: Task = {
            id, type: 'import_csv', status: 'completed', progress: 100,
            message: 'CSV 导入完成',
            result: { parsed: parseCSV(body) },
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }
          saveTask(task)
          json(res, 200, task)
          return
        }

        // ── POST /api/broker/sync ──
        if (url === '/api/broker/sync' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const broker = (params.broker as string) ?? 'tushare'
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/broker_sync.py'), 'sync', '--broker', broker,
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 30000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', (code) => {
            if (code === 0) {
              try { json(res, 200, JSON.parse(stdout)) }
              catch { json(res, 500, { error: 'parse error' }) }
            } else {
              json(res, 500, { error: stdout || `exit ${code}` })
            }
          })
          child.on('error', (err) => json(res, 500, { error: err.message }))
          return
        }

        // ── GET /api/broker/status ──
        if (url === '/api/broker/status' && req.method === 'GET') {
          const child = spawn('/usr/bin/python3', [path.resolve('scripts/broker_sync.py'), 'status'], {
            cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 10000,
          })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', (code) => {
            if (code === 0) {
              try { json(res, 200, JSON.parse(stdout)) }
              catch { json(res, 200, []) }
            } else { json(res, 200, []) }
          })
          child.on('error', () => json(res, 200, []))
          return
        }

        // ── POST /api/broker/config ──
        if (url === '/api/broker/config' && req.method === 'POST') {
          const body = await readBody(req)
          let params: Record<string, unknown> = {}
          try { params = JSON.parse(body) } catch { /* */ }
          const child = spawn('/usr/bin/python3', [
            path.resolve('scripts/broker_sync.py'), 'config',
            '--broker', (params.type as string) ?? 'tushare',
            '--token', (params.token as string) ?? '',
          ], { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED: '1' }, timeout: 10000 })
          let stdout = ''
          child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
          child.on('close', () => {
            try { json(res, 200, JSON.parse(stdout || '{}')) }
            catch { json(res, 200, { ok: true }) }
          })
          child.on('error', (err) => json(res, 500, { error: err.message }))
          return
        }

        // ── GET /api/tasks/:id ──
        const taskMatch = url.match(/^\/api\/tasks\/([a-z0-9-]+)$/)
        if (taskMatch && req.method === 'GET') {
          const task = loadTask(taskMatch[1])
          if (!task) { json(res, 404, { error: 'task not found' }); return }
          json(res, 200, task)
          return
        }

        // ── GET /api/tasks ──
        if (url === '/api/tasks' && req.method === 'GET') {
          const tasks = listTasks().slice(0, 50)
          json(res, 200, tasks)
          return
        }

        next()
      })
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// CSV 解析器（券商导出格式）
// ═══════════════════════════════════════════════════════════════

function parseCSV(csvText: string): unknown {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return { error: 'CSV 至少需要标题行 + 1 行数据' }

  const headers = lines[0].split(',').map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i]?.trim() ?? '' })
    return row
  })

  // 自动识别字段
  const fieldMap: Record<string, string> = {
    '代码': 'code', '股票代码': 'code', '证券代码': 'code',
    '名称': 'name', '股票名称': 'name', '证券名称': 'name',
    '持仓': 'shares', '持股数量': 'shares', '持仓数量': 'shares',
    '成本价': 'cost', '持仓成本': 'cost', '成本': 'cost',
    '现价': 'price', '最新价': 'price',
    '盈亏': 'pnl', '浮动盈亏': 'pnl',
  }

  const normalized = rows.map((row) => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      const mapped = fieldMap[key] ?? key
      out[mapped] = value
    }
    return out
  })

  return { headers, rowCount: rows.length, sample: normalized.slice(0, 5), normalized }
}
