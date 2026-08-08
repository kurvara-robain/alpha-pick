// AlphaMind 持仓缠论每日扫描器
// 读取 .alphamind-sync.json（前端 saveDB 时同步的持仓）+ public/data/kline/<code>.json，
// 用与前端完全相同的缠论引擎（chan-bundle.mjs，由 src/lib/chan.ts 打包）分析每只持仓，
// 与 .alphamind-chan-state.json 中的上次状态对比，输出新出现的买卖点/背驰信号。
//
// 用法：node scripts/chan-scan.mjs [--update]   (--update 时把本次结果写入状态文件)
// 输出（stdout JSON）：{ ok, scanned, newSignals: [...], all: [...], reason? }
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChanAnalysis } from './chan-bundle.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_FILE = join(ROOT, '.alphamind-sync.json')
const STATE_FILE = join(ROOT, '.alphamind-chan-state.json')
const KLINE_DIR = join(ROOT, 'public', 'data', 'kline')
const UPDATE = process.argv.includes('--update')

function readJson(p, fallback = null) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return fallback
  }
}

const sync = readJson(SYNC_FILE)
if (!sync || !Array.isArray(sync.holdings) || sync.holdings.length === 0) {
  console.log(JSON.stringify({ ok: true, scanned: 0, newSignals: [], all: [], reason: 'no holdings synced' }))
  process.exit(0)
}

const state = readJson(STATE_FILE, {})
const newState = { ...state }
const newSignals = []
const all = []

for (const h of sync.holdings) {
  const kl = readJson(join(KLINE_DIR, `${h.code}.json`))
  if (!kl || !kl.highs || !Array.isArray(kl.dates) || kl.dates.length < 60) {
    all.push({ code: h.code, name: h.name, skipped: 'kline unavailable or not upgraded' })
    continue
  }
  let a = null
  try {
    a = runChanAnalysis(kl)
  } catch {
    a = null
  }
  if (!a) {
    all.push({ code: h.code, name: h.name, skipped: 'analysis returned null' })
    continue
  }
  const signal = a.buySellPoint || (a.divergence ? (a.divergence === 'top' ? '顶背驰' : '底背驰') : null)
  const strokeTo = a.lastStroke?.to ?? ''
  const key = `${signal ?? ''}|${strokeTo}`
  const prev = state[h.code]
  const entry = {
    code: h.code,
    name: h.name,
    signal,
    strokeTo,
    trend: a.trend,
    conclusion: a.conclusion,
    zhongshu: a.zhongshu,
    keyLevels: a.keyLevels,
    lastBar: kl.dates[kl.dates.length - 1],
  }
  all.push(entry)
  newState[h.code] = { signal, strokeTo, scannedAt: new Date().toISOString() }
  // 新信号 = 当前有信号，且 (信号内容, 笔端日期) 组合与上次记录不同
  if (signal && (!prev || `${prev.signal ?? ''}|${prev.strokeTo ?? ''}` !== key)) {
    newSignals.push(entry)
  }
}

if (UPDATE) writeFileSync(STATE_FILE, JSON.stringify(newState, null, 1))

console.log(JSON.stringify({
  ok: true,
  scanned: all.filter((x) => !x.skipped).length,
  holdings: sync.holdings.length,
  newSignals,
  all,
}))
