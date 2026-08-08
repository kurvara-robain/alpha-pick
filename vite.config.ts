import fs from "node:fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { refreshApi } from "./vite-plugins/refresh-api"
import { taskApi } from "./vite-plugins/task-api"

// 本地同步中间件：把前端持仓持久化到项目根目录 .alphamind-sync.json，
// 供缠论信号监控自动化读取（原子写入：先写临时文件再 rename）。
function alphamindSync(): Plugin {
  const FILE = path.resolve(__dirname, ".alphamind-sync.json")
  const TMP = `${FILE}.tmp`
  const MAX_BODY = 1024 * 1024 // 1MB 防御上限
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify(body))
  }
  return {
    name: "alphamind-sync",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/api/alphamind-sync") return next()
        if (req.method === "GET") {
          try {
            res.statusCode = 200
            res.setHeader("Content-Type", "application/json; charset=utf-8")
            res.end(fs.readFileSync(FILE, "utf8"))
          } catch {
            json(res, 404, { ok: false, error: "sync file not found" })
          }
          return
        }
        if (req.method !== "POST") return next()
        const chunks: Buffer[] = []
        let size = 0
        req.on("data", (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY && !res.headersSent) {
            json(res, 413, { ok: false, error: "body too large" })
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on("end", () => {
          if (res.headersSent) return
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
            if (typeof body !== "object" || body === null || !Array.isArray((body as { holdings?: unknown }).holdings)) {
              json(res, 400, { ok: false, error: "payload must be an object with a holdings array" })
              return
            }
            fs.writeFileSync(TMP, JSON.stringify(body, null, 2))
            fs.renameSync(TMP, FILE) // 原子替换
            json(res, 200, { ok: true })
          } catch {
            json(res, 400, { ok: false, error: "invalid JSON body" })
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), alphamindSync(), refreshApi(), taskApi()],
  server: {
    port: 7200,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
