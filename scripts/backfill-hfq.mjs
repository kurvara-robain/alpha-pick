// 一次性脚本：给缺 closesHfq 的K线文件补拉后复权收盘价（东财源，绕开腾讯）
// 用法：node scripts/backfill-hfq.mjs
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const KLINE_DIR = join(__dirname, '../public/data/kline')
const KLINE_DAYS = 2500
const CONCURRENCY = 4
const PACE_MS = 80

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function curlJson(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { stdout } = await execFileP(
        'curl',
        ['-sS', '--compressed', '--max-time', '20', url],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      )
      return JSON.parse(stdout.toString('utf-8'))
    } catch (e) {
      if (i === retries) throw e
      await sleep(2000 * (i + 1))
    }
  }
}

async function fetchHfqEM(code) {
  // code: 600519.SH / 000001.SZ / 430047.BJ
  const [num, ex] = code.split('.')
  const mkt = ex === 'SH' ? 1 : 0
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${num}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=2&beg=0&end=20500101&lmt=10000`
  const json = await curlJson(url)
  const kl = json?.data?.klines
  if (!kl?.length) throw new Error('no em kline')
  return kl
    .map((line) => {
      const p = line.split(',')
      return [p[0], parseFloat(p[2])] // [date, close]
    })
    .slice(-KLINE_DAYS)
}

const files = readdirSync(KLINE_DIR).filter((f) => f.endsWith('.json'))
const todo = []
for (const f of files) {
  try {
    const d = JSON.parse(readFileSync(join(KLINE_DIR, f), 'utf-8'))
    if (!d.closesHfq || d.closesHfq.length !== d.dates.length) todo.push(f)
  } catch {}
}
console.log(`待补 ${todo.length}/${files.length} 只`)

let done = 0
let failed = 0
let idx = 0
const lanes = Array.from({ length: CONCURRENCY }, async () => {
  while (idx < todo.length) {
    const f = todo[idx++]
    const p = join(KLINE_DIR, f)
    try {
      const d = JSON.parse(readFileSync(p, 'utf-8'))
      const code = f.replace('.json', '')
      const hfq = await fetchHfqEM(code)
      const hmap = new Map(hfq)
      d.closesHfq = d.dates.map((dt) => hmap.get(dt) ?? null)
      writeFileSync(p, JSON.stringify(d))
      done++
    } catch (e) {
      failed++
      if (failed <= 5) console.log(`  ✗ ${f}: ${e.message}`)
    }
    if ((done + failed) % 200 === 0) console.log(`进度 ${done + failed}/${todo.length}（失败 ${failed}）`)
    await sleep(PACE_MS)
  }
})
await Promise.all(lanes)
console.log(`完成：成功 ${done}，失败 ${failed}`)
