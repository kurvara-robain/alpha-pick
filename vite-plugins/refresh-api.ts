// ─────────────────────────────────────────────────────────────
// 实时数据拉通中间件（vite dev server 插件）
//   POST /api/refresh        启动 scripts/refresh-quotes.mjs（已有任务在跑返回 409）
//                            body: {"mode":"quick"|"deep"}（默认 quick；deep 传 --deep 给脚本）
//   GET  /api/refresh/status 查询任务状态（前端每 1.5s 轮询）
// 任务状态仅存内存：dev server 重启即重置；脚本 stdout 的 PROGRESS / RESULT 行驱动状态。
// ─────────────────────────────────────────────────────────────
import { spawn } from "node:child_process"
import type { ServerResponse } from "node:http"
import type { Plugin } from "vite"

export type RefreshMode = "quick" | "deep"

export interface RefreshResult {
  ok: boolean
  updated: number
  dataTime: string
  finishedAt: string
  klineUpdated?: number
  klineFailed?: number
}

export interface RefreshState {
  running: boolean
  mode: RefreshMode | null
  stage: string
  done: number
  total: number
  message: string
  lastResult: RefreshResult | null
  error: string | null
}

const idleState = (): RefreshState => ({
  running: false,
  mode: null,
  stage: "idle",
  done: 0,
  total: 0,
  message: "",
  lastResult: null,
  error: null,
})

const state: RefreshState = idleState()

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(body))
}

function readBody(req: import("node:http").IncomingMessage, maxBytes = 16 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error("body too large"))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")))
      } catch {
        reject(new Error("invalid JSON body"))
      }
    })
    req.on("error", reject)
  })
}

interface ScriptResult {
  ok: boolean
  updated: number
  dataTime: string
  klineUpdated?: number
  klineFailed?: number
}

function startRefresh(cwd: string, mode: RefreshMode) {
  Object.assign(state, idleState(), {
    running: true,
    mode,
    stage: "init",
    message: mode === "deep" ? "正在启动深度拉通（快照 + K线增量）" : "正在启动刷新脚本",
  })
  const args = ["scripts/refresh-quotes.mjs"]
  if (mode === "deep") args.push("--deep")
  const child = spawn(process.execPath, args, { cwd })

  let buf = ""
  let resultLine: ScriptResult | null = null
  let stderrTail = ""

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf-8")
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith("PROGRESS ")) {
        // PROGRESS <stage> <done> <total> <message…>
        const m = line.match(/^PROGRESS (\S+) (\d+) (\d+) ?(.*)$/)
        if (m) {
          state.stage = m[1]
          state.done = Number(m[2])
          state.total = Number(m[3])
          state.message = m[4] ?? ""
        }
      } else if (line.startsWith("RESULT ")) {
        try {
          resultLine = JSON.parse(line.slice(7)) as ScriptResult
        } catch {
          /* 忽略坏行 */
        }
      }
    }
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf-8")).slice(-2000)
  })
  child.on("error", (e) => {
    state.running = false
    state.error = `刷新脚本启动失败：${e.message}`
  })
  child.on("close", (code) => {
    state.running = false
    if (code === 0 && resultLine?.ok) {
      state.lastResult = { ...resultLine, finishedAt: new Date().toISOString() }
      state.stage = "done"
      state.message = "拉通完成"
      state.error = null
    } else {
      state.error =
        stderrTail.trim() ||
        (resultLine && !resultLine.ok ? "刷新脚本报告失败" : `刷新脚本异常退出（exit ${code}）`)
      state.stage = "error"
    }
  })
}

export function refreshApi(): Plugin {
  return {
    name: "refresh-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0]
        if (path === "/api/refresh" && req.method === "POST") {
          if (state.running) {
            json(res, 409, { started: false, error: "已有拉通任务在运行中" })
            return
          }
          readBody(req)
            .then((body) => {
              const mode: RefreshMode =
                typeof body === "object" && body !== null && (body as { mode?: unknown }).mode === "deep"
                  ? "deep"
                  : "quick"
              startRefresh(server.config.root, mode)
              json(res, 200, { started: true, mode })
            })
            .catch((e: Error) => {
              json(res, 400, { started: false, error: e.message })
            })
          return
        }
        if (path === "/api/refresh/status" && req.method === "GET") {
          json(res, 200, state)
          return
        }
        next()
      })
    },
  }
}
