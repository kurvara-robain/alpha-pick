// ─────────────────────────────────────────────────────────────
// 行情拉通脚本（前端「实时数据拉通」按钮触发，vite 插件 spawn 调用）
// 快速模式（默认）：只做腾讯批量快照，约 2 分钟：
//   1. 刷新 universe.json 每只股票的 price/changePct/turnover/pb（其余字段原样保留）
//   2. 刷新 indices.json 六大指数最新值，并向历史序列追加/更新当日点
//   3. 刷新 meta.json 时间戳、涨跌家数、成交额
// 深度模式（--deep）：快照之上再对 universe 全部股票做 K 线增量合并
//   （腾讯 fqkline qfq+hfq 各 20 根，东财 hfq 主通道封禁时自动落腾讯分页兜底），
//   指数 K 线同步追加当日完整日线点，预计 30-60 分钟。
// 调试：--limit=N 只处理前 N 只股票的 K 线（快照阶段仍全量）。
//
// 进度协议（vite 插件中间件逐行解析 stdout，诊断信息一律走 stderr）：
//   PROGRESS <stage> <done> <total> <message…>   stage: init/quotes/indices/write/kline
//   RESULT {"ok":true,"updated":N,"dataTime":"...","klineUpdated":N,"klineFailed":N}
// 快照字段下标口径以 build-dataset.mjs 为准并实测确认（2026-07-27）：
//   f[1]名称 f[3]最新价 f[30]时间 f[32]涨跌% f[36]成交量(手) f[37]成交额(万元) f[38]换手率 f[46]PB
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../public/data')
const KLINE_DIR = join(DATA_DIR, 'kline')
const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sh000300', 'sh000905']
const CHUNK = 60 // 腾讯批量快照每次 60 只（与 build-dataset.mjs 一致）
const PACE_MS = 150
const KLINE_DAYS = 2500 // 与 build-dataset.mjs 窗口一致
const KLINE_CONCURRENCY = 2 // 腾讯 WAF 对高频请求会临时封 IP，并发务必保守（同 build-dataset.mjs）

const DEEP = process.argv.includes('--deep')
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dlog = (msg) => console.error(msg) // 诊断走 stderr，stdout 只留 PROGRESS/RESULT 协议行

function progress(stage, done, total, message) {
  console.log(`PROGRESS ${stage} ${done} ${total} ${message}`)
}

// 经 curl 取数（与 build-dataset.mjs 相同：本机代理对部分 Host 有 TLS 指纹拦截，curl 正常）
async function curlBytes(url) {
  const { stdout } = await execFileP(
    'curl',
    ['-sS', '--compressed', '--max-time', '30', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', url],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  return stdout
}

// JSON 接口取数（腾讯 fqkline 等），带重试；WAF 拦截页（501 HTML）30s/60s/90s 阶梯退避
async function fetchJson(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const buf = await curlBytes(url)
      let text
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf) // JSON 接口均为 UTF-8
      } catch {
        text = new TextDecoder('gbk').decode(buf)
      }
      if (text.trimStart().startsWith('<')) {
        if (i === retries) throw new Error('blocked by WAF')
        dlog(`  ⚠ WAF 拦截（${url.slice(0, 60)}…），退避 ${30 * (i + 1)}s`)
        await sleep(30000 * (i + 1))
        continue
      }
      return JSON.parse(text)
    } catch (e) {
      if (i === retries) throw e
      await sleep(1500 * (i + 1))
    }
  }
}

// 拉一块腾讯快照文本（GBK），带重试；单块失败不致命
async function fetchSnapshotText(tcodes, retries = 2) {
  const url = `https://qt.gtimg.cn/q=${tcodes.join(',')}`
  for (let i = 0; i <= retries; i++) {
    try {
      const buf = await curlBytes(url)
      const text = new TextDecoder('gbk').decode(buf)
      if (text.trimStart().startsWith('<')) throw new Error('blocked by WAF')
      return text
    } catch (e) {
      if (i === retries) throw e
      await sleep(e.message === 'blocked by WAF' ? 30000 * (i + 1) : 1500 * (i + 1))
    }
  }
  throw new Error('unreachable')
}

const parseLine = (text, tcode) => {
  const m = text.match(new RegExp(`v_${tcode}="([^"]*)"`))
  return m ? m[1].split('~') : null
}

// 原子写：先写临时文件再 rename，防写一半
function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, file)
}

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = () => localToday().replaceAll('-', '') // yyyymmdd
const dash = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
const toTcode = (code) => {
  const [bare, suffix] = code.split('.')
  return `${suffix.toLowerCase()}${bare}` // 600519.SH → sh600519
}

// ── K 线（以下函数抽取自 build-dataset.mjs，口径保持一致）──────
function addDays(yyyymmdd, delta) {
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6)) - 1
  const d = Number(yyyymmdd.slice(6, 8))
  const dt = new Date(y, m, d + delta)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}

async function fetchKline(tcode, begin, end, count = 800, adjust = 'qfq') {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcode},day,${begin},${end},${count},${adjust}`
  const json = await fetchJson(url)
  const d = json?.data?.[tcode]
  const rows = d?.[`${adjust}day`] || d?.day
  if (!rows) throw new Error('no kline')
  // 腾讯行格式：[date, open, close, high, low, vol, ...]
  return rows.map((r) => [r[0], parseFloat(r[1]), parseFloat(r[2]), parseFloat(r[3]), parseFloat(r[4]), parseFloat(r[5])])
}

// 全量历史分页拉取：腾讯单次上限 800 行，按结束日期逐页向前翻
async function fetchKlineFull(tcode, today, maxYears = 11, adjust = 'qfq') {
  const map = new Map()
  let end = today
  const stop = dash(addDays(today, -maxYears * 365))
  for (let page = 0; page < 8; page++) {
    const rows = await fetchKline(tcode, '', dash(end), 800, adjust)
    for (const r of rows) map.set(r[0], r)
    if (rows.length < 800) break
    const first = rows[0][0]
    if (first <= stop) break
    end = addDays(first.replaceAll('-', ''), -1) // 上一页结束日 = 本页首日的前一天（按真实日历减）
    await sleep(PACE_MS)
  }
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-KLINE_DAYS)
}

// 后复权全历史（东方财富，单次请求无分页；腾讯 hfq 分页作兜底——东财 push2his 当前封禁时会落兜底，属预期）
async function fetchKlineHfqEM(tcode) {
  const mkt = tcode.startsWith('sh') ? 1 : 0
  const secid = `${mkt}.${tcode.slice(2)}`
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=2&beg=0&end=20500101&lmt=10000`
  const json = await fetchJson(url)
  const kl = json?.data?.klines
  if (!kl?.length) throw new Error('no em kline')
  return kl
    .map((line) => {
      const p = line.split(',')
      return [p[0], parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[4]), parseFloat(p[5])]
    })
    .slice(-KLINE_DAYS)
}

async function fetchHfq(tcode, today) {
  try {
    return await fetchKlineHfqEM(tcode)
  } catch {
    return await fetchKlineFull(tcode, today, 11, 'hfq') // 腾讯分页兜底
  }
}

function klinePath(code) {
  return join(KLINE_DIR, `${code}.json`)
}

function readKline(code) {
  try {
    return JSON.parse(readFileSync(klinePath(code), 'utf-8'))
  } catch {
    return null
  }
}

// 增量合并：新数据按日期覆盖旧数据；行格式 [date, open, close, high, low, vol]
function mergeKline(old, fresh) {
  const map = new Map()
  for (const row of old?.data || []) map.set(row[0], row)
  for (const row of fresh) map.set(row[0], row)
  const merged = [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-KLINE_DAYS)
  return {
    dates: merged.map((r) => r[0]),
    opens: merged.map((r) => r[1]),
    closes: merged.map((r) => r[2]),
    highs: merged.map((r) => r[3]),
    lows: merged.map((r) => r[4]),
    vols: merged.map((r) => r[5]),
  }
}

function existingToRows(existing) {
  return {
    data: existing.dates.map((d, i) => [
      d,
      existing.opens?.[i],
      existing.closes[i],
      existing.highs?.[i],
      existing.lows?.[i],
      existing.vols[i],
    ]),
  }
}

function isMtimeToday(p) {
  try {
    const m = statSync(p).mtime
    const now = new Date()
    return m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth() && m.getDate() === now.getDate()
  } catch {
    return false
  }
}

// 单股 K 线增量（逻辑同 build-dataset.mjs updateKline，落盘改为原子写，单股失败由调用方捕获）
async function updateKlineIncremental(stock, today) {
  const existing = readKline(stock.code)
  const needFull = !existing || !existing.dates || existing.dates.length < 60 || !existing.highs || !existing.fullHist
  // 只补后复权
  if (!needFull && !existing.closesHfq) {
    const hfq = await fetchHfq(stock.tcode, today)
    const hmap = new Map(hfq.map((r) => [r[0], r[2]])) // date → close(hfq)
    existing.closesHfq = existing.dates.map((d) => hmap.get(d) ?? null)
    writeJsonAtomic(klinePath(stock.code), existing)
    return { status: 'hfq', bars: existing.dates.length }
  }
  if (!needFull) {
    if (isMtimeToday(klinePath(stock.code))) return { status: 'fresh', bars: existing.dates.length }
    const last = existing.dates[existing.dates.length - 1].replaceAll('-', '')
    if (last >= today) return { status: 'fresh', bars: existing.dates.length }
    const begin = addDays(last, -10)
    const fresh = await fetchKline(stock.tcode, dash(begin), dash(today), 20)
    const merged = mergeKline(existingToRows(existing), fresh)
    merged.fullHist = true
    const hfq = await fetchKline(stock.tcode, dash(begin), dash(today), 20, 'hfq')
    const hmap = new Map([...existing.dates.map((d, i) => [d, existing.closesHfq[i]]), ...hfq.map((r) => [r[0], r[2]])])
    merged.closesHfq = merged.dates.map((d) => hmap.get(d) ?? null)
    writeJsonAtomic(klinePath(stock.code), merged)
    return { status: 'updated', bars: merged.dates.length }
  }
  // 缺文件/旧格式：全量重抓（qfq 分页 + hfq 东财主/腾讯兜底）
  const fresh = await fetchKlineFull(stock.tcode, today)
  if (fresh.length < 20) throw new Error('kline too short')
  const merged = mergeKline(null, fresh)
  merged.fullHist = true
  const hfq = await fetchHfq(stock.tcode, today)
  const hmap = new Map(hfq.map((r) => [r[0], r[2]]))
  merged.closesHfq = merged.dates.map((d) => hmap.get(d) ?? null)
  writeJsonAtomic(klinePath(stock.code), merged)
  return { status: 'full', bars: merged.dates.length }
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()

  // ── 1/4 个股快照 ────────────────────────────────────────────
  progress('init', 0, 1, `读取本地 universe.json（${DEEP ? '深度' : '快速'}模式）`)
  const universeFile = join(DATA_DIR, 'universe.json')
  const universe = JSON.parse(readFileSync(universeFile, 'utf-8'))
  const total = universe.length

  let updated = 0
  let skipped = 0
  let chunkFailed = 0
  let amountYiSum = 0
  let snapshotTime = '' // 腾讯快照时间 f[30]（yyyymmddhhmmss）

  const chunks = Math.ceil(total / CHUNK)
  for (let c = 0; c < chunks; c++) {
    const slice = universe.slice(c * CHUNK, (c + 1) * CHUNK)
    const tcodes = slice.map((s) => toTcode(s.code))
    let text = null
    try {
      text = await fetchSnapshotText(tcodes)
    } catch (e) {
      chunkFailed++
      dlog(`  ✗ 快照分块 ${c + 1}/${chunks} 失败（不致命，保留旧值）: ${e.message}`)
    }
    if (text) {
      for (let i = 0; i < slice.length; i++) {
        const s = slice[i]
        const f = parseLine(text, tcodes[i])
        const price = f ? parseFloat(f[3]) : NaN
        if (!f || !(price > 0)) {
          skipped++ // 停牌/无行情：保留旧快照
          continue
        }
        s.price = price
        const changePct = parseFloat(f[32])
        if (Number.isFinite(changePct)) s.changePct = changePct
        const turnover = parseFloat(f[38])
        if (Number.isFinite(turnover)) s.turnover = turnover
        const pb = parseFloat(f[46])
        if (Number.isFinite(pb) && pb > 0) s.pb = pb
        const amt = parseFloat(f[37])
        if (Number.isFinite(amt)) amountYiSum += amt / 1e4 // 万元 → 亿元
        if (!snapshotTime && typeof f[30] === 'string' && f[30].length >= 14) snapshotTime = f[30]
        updated++
      }
    }
    progress('quotes', Math.min((c + 1) * CHUNK, total), total, `正在更新行情快照 ${Math.min((c + 1) * CHUNK, total)}/${total}`)
    await sleep(PACE_MS)
  }

  // ── 2/4 指数快照 + 当日序列点 ───────────────────────────────
  progress('indices', 0, INDEX_CODES.length, '正在更新指数快照')
  const indicesFile = join(DATA_DIR, 'indices.json')
  const indicesData = JSON.parse(readFileSync(indicesFile, 'utf-8'))
  let indicesUpdated = 0
  try {
    const text = await fetchSnapshotText(INDEX_CODES)
    const today = localToday()
    for (const code of INDEX_CODES) {
      const f = parseLine(text, code)
      const value = f ? parseFloat(f[3]) : NaN
      if (!f || !(value > 0)) continue
      const name = f[1]
      const changePct = parseFloat(f[32])
      const quote = indicesData.indices.find((q) => q.name === name)
      if (quote) {
        quote.value = value
        if (Number.isFinite(changePct)) quote.changePct = changePct
      }
      // 历史序列：只追加/更新当日点，不动历史
      const entry = indicesData.series.find((e) => e.code === code)
      if (entry) {
        const vol = parseFloat(f[36]) || 0 // 成交量（手），与 K 线 vol 口径一致
        const last = entry.series[entry.series.length - 1]
        if (last && last.date === today) {
          last.close = value
          last.vol = vol
        } else if (!last || last.date < today) {
          entry.series.push({ date: today, close: value, vol })
        }
      }
      indicesUpdated++
    }
  } catch (e) {
    dlog(`  ✗ 指数快照失败（不致命，保留旧值）: ${e.message}`)
  }
  progress('indices', INDEX_CODES.length, INDEX_CODES.length, `指数快照完成 ${indicesUpdated}/${INDEX_CODES.length}`)

  // ── 3/4 落盘（快照产物）─────────────────────────────────────
  progress('write', 0, 1, '正在写入数据文件')
  writeJsonAtomic(universeFile, universe)
  writeJsonAtomic(indicesFile, indicesData)

  const metaFile = join(DATA_DIR, 'meta.json')
  const writeMeta = () => {
    const meta = JSON.parse(readFileSync(metaFile, 'utf-8'))
    meta.fetchedAt = new Date().toISOString()
    meta.upCount = universe.filter((s) => s.changePct > 0).length
    meta.downCount = universe.filter((s) => s.changePct < 0).length
    if (amountYiSum > 0) meta.turnoverYi = Math.round(amountYiSum)
    writeJsonAtomic(metaFile, meta)
  }
  writeMeta()
  progress('write', 1, 1, '快照数据已落盘')

  // ── 4/4 深度模式：全市场 K 线增量 ───────────────────────────
  let klineUpdated = 0
  let klineFailed = 0
  if (DEEP) {
    const today = todayStr()
    const stocks = universe.slice(0, Math.min(LIMIT, total)).map((s) => ({ code: s.code, name: s.name, tcode: toTcode(s.code) }))
    const kTotal = stocks.length
    if (LIMIT < Infinity) dlog(`  --limit=${LIMIT} 调试模式，只处理前 ${kTotal} 只`)
    let kDone = 0
    let kFresh = 0
    // 简单并发池：2 条 lane，每股仍带间隔，口径同 build-dataset.mjs
    let idx = 0
    const lanes = Array.from({ length: Math.min(KLINE_CONCURRENCY, kTotal) }, async () => {
      while (idx < stocks.length) {
        const s = stocks[idx++]
        try {
          const r = await updateKlineIncremental(s, today)
          if (r.status === 'fresh') kFresh++
          else klineUpdated++
        } catch (e) {
          klineFailed++
          if (klineFailed <= 20 || klineFailed % 50 === 0) dlog(`  ✗ ${s.code} ${s.name}: ${e.message}（累计失败 ${klineFailed}）`)
        }
        kDone++
        if (kDone % 10 === 0 || kDone === kTotal) {
          progress('kline', kDone, kTotal, `K线增量 ${kDone}/${kTotal}（更新 ${klineUpdated}，跳过 ${kFresh}，失败 ${klineFailed}）`)
        }
        await sleep(PACE_MS)
      }
    })
    await Promise.all(lanes)

    // 指数 K 线：fqkline 增量合并当日完整日线点（含真实收盘/成交量，覆盖快照阶段的盘中值）
    progress('indices', 0, INDEX_CODES.length, '正在更新指数K线')
    const lastSeriesDate = (code) => {
      const e = indicesData.series.find((x) => x.code === code)
      return e?.series?.length ? e.series[e.series.length - 1].date.replaceAll('-', '') : '20100101'
    }
    let idxKlineOk = 0
    for (const code of INDEX_CODES) {
      try {
        const begin = addDays(lastSeriesDate(code), -10)
        const rows = await fetchKline(code, dash(begin), dash(today), 20)
        const entry = indicesData.series.find((x) => x.code === code)
        if (entry) {
          const map = new Map(entry.series.map((p) => [p.date, p]))
          for (const r of rows) map.set(r[0], { date: r[0], close: r[2], vol: r[5] })
          entry.series = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-KLINE_DAYS)
          idxKlineOk++
        }
      } catch (e) {
        dlog(`  ✗ 指数K线 ${code}: ${e.message}`)
      }
      await sleep(PACE_MS)
    }
    writeJsonAtomic(indicesFile, indicesData)
    progress('indices', INDEX_CODES.length, INDEX_CODES.length, `指数K线完成 ${idxKlineOk}/${INDEX_CODES.length}`)

    writeMeta() // 深度模式完成，顺带刷新 meta 时间戳
    progress('write', 1, 1, '深度拉通数据已落盘')
  }

  // 数据时间：优先腾讯快照时间 f[30]，其次本地时间
  const dataTime = snapshotTime
    ? `${snapshotTime.slice(0, 4)}-${snapshotTime.slice(4, 6)}-${snapshotTime.slice(6, 8)} ${snapshotTime.slice(8, 10)}:${snapshotTime.slice(10, 12)}:${snapshotTime.slice(12, 14)}`
    : new Date().toISOString()

  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  dlog(
    `完成（${DEEP ? '深度' : '快速'}）：快照 ${updated}/${total} 只（停牌跳过 ${skipped}，分块失败 ${chunkFailed}）` +
      (DEEP ? `，K线更新 ${klineUpdated} 只、失败 ${klineFailed} 只` : '') +
      `，耗时 ${mins} 分钟`,
  )
  console.log(`RESULT ${JSON.stringify({ ok: true, updated, dataTime, klineUpdated, klineFailed })}`)
}

main().catch((e) => {
  console.error(`刷新失败: ${e?.stack || e}`)
  console.log(`RESULT ${JSON.stringify({ ok: false, updated: 0, dataTime: '', klineUpdated: 0, klineFailed: 0 })}`)
  process.exit(1)
})
