import fs from "node:fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { Plugin, ResolvedConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { refreshApi } from "./vite-plugins/refresh-api"
import { taskApi } from "./vite-plugins/task-api"

const PUBLIC_DIR = path.resolve(__dirname, "public")
const QLIB_STATIC_PREFIX = path.join("data", "qlib_data")

function isQlibStaticPath(file: string): boolean {
  const relative = path.relative(PUBLIC_DIR, file)
  return relative === QLIB_STATIC_PREFIX || relative.startsWith(`${QLIB_STATIC_PREFIX}${path.sep}`)
}

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".json": return "application/json; charset=utf-8"
    case ".js": return "text/javascript; charset=utf-8"
    case ".css": return "text/css; charset=utf-8"
    case ".svg": return "image/svg+xml"
    case ".png": return "image/png"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".ico": return "image/x-icon"
    default: return "application/octet-stream"
  }
}

/**
 * Serve/copy public assets lazily while excluding Python-only Qlib data.
 * Vite's built-in publicDir eagerly indexes every file; qlib_data contains
 * hundreds of thousands of tiny files and makes both Windows and Unix startup
 * unnecessarily expensive. No browser code consumes that directory.
 */
function runtimePublicAssets(): Plugin {
  let config: ResolvedConfig
  return {
    name: "alphamind-runtime-public-assets",
    configResolved(resolved) {
      config = resolved
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next()
        let pathname: string
        try {
          pathname = decodeURIComponent(req.url?.split("?")[0] ?? "/")
        } catch {
          return next()
        }
        const relative = pathname.replace(/^\/+/, "")
        if (!relative) return next()
        if (relative === "data/qlib_data" || relative.startsWith("data/qlib_data/")) {
          res.statusCode = 404
          res.end()
          return
        }
        const file = path.resolve(PUBLIC_DIR, relative)
        if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return next()
        }
        res.statusCode = 200
        res.setHeader("Content-Type", contentType(file))
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      const outputDir = path.resolve(config.root, config.build.outDir)
      fs.cpSync(PUBLIC_DIR, outputDir, {
        recursive: true,
        filter: (source) => !isQlibStaticPath(source),
      })
    },
  }
}

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
  const installMiddleware = (server: { middlewares: import("vite").ViteDevServer["middlewares"] }) => {
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
          fs.renameSync(TMP, FILE)
          json(res, 200, { ok: true })
        } catch {
          json(res, 400, { ok: false, error: "invalid JSON body" })
        }
      })
    })
  }
  return {
    name: "alphamind-sync",
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // Replaced by runtimePublicAssets() to avoid eagerly indexing qlib_data.
  publicDir: false,
  plugins: [runtimePublicAssets(), inspectAttr(), react(), alphamindSync(), refreshApi(), taskApi()],
  server: {
    port: 7200,
    watch: {
      ignored: ["**/public/data/qlib_data/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
