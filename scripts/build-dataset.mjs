// ─────────────────────────────────────────────────────────────
// 全 A 股数据集构建脚本（首次全量 + 每日增量）
// 数据源：东方财富 clist（股票清单+快照）、腾讯 fqkline（日K 前复权）、
//         东方财富 datacenter（经营现金流，季报，每周一更新）
// 产物（写入 public/data/）：
//   universe.json        全市场股票汇总表（快照+预计算因子指标，无K线序列）
//   kline/<code>.json    每只股票近 500 个交易日日K {dates, opens, closes, highs, lows, vols}
//   indices.json         六大指数快照 + 日K序列
//   meta.json            数据时间、数量、口径说明
// 用法：
//   node scripts/build-dataset.mjs              # 自动模式（增量；缺文件自动补全量）
//   node scripts/build-dataset.mjs --full       # 强制全量重建K线
//   node scripts/build-dataset.mjs --cashflow   # 强制更新现金流
//   node scripts/build-dataset.mjs --limit=200  # 只处理前200只（调试用）
// 脚本可断点续跑：每只股票处理完立即落盘。
// ─────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../public/data')
const KLINE_DIR = join(DATA_DIR, 'kline')
const FULL = process.argv.includes('--full')
const FORCE_CF = process.argv.includes('--cashflow')
const UNIVERSE_ONLY = process.argv.includes('--universe-only') // 只重建 universe/indices/meta（修复产物，不碰K线）
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity

const KLINE_DAYS = 2500 // 近十年交易日（全量历史，供长期因子研究/回测）
const PACE_MS = 150 // 请求间隔，防限流
const UT = 'fa5fd1943c7b386f172d6893dbfba10b'
const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sh000300', 'sh000905']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 进度日志：同时写控制台和日志文件（subprocess 捕获的 stdout 在中断时不可见，日志文件可随时 tail）
import { appendFileSync } from 'node:fs'
const LOG_FILE = join(DATA_DIR, '.build.log')
function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`
  console.log(line)
  try {
    appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

// 简单并发池：按 worker 数并行处理，每个 worker 内部仍带间隔，控制对单 host 的压力
// 注意：腾讯 WAF 对高频请求会临时封 IP（返回 501 HTML 页），并发务必保守
const CONCURRENCY = 2
async function runPool(items, worker, label, concurrency = CONCURRENCY, paceMs = PACE_MS) {
  let idx = 0
  let done = 0
  let failed = 0
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++]
      try {
        await worker(item)
        done++
        if (done % 100 === 0) log(`  ${label}进度 ${done}/${items.length}（失败 ${failed}）`)
      } catch (e) {
        failed++
        if (failed <= 20 || failed % 50 === 0) log(`  ✗ ${item.code} ${item.name}: ${e.message}（累计失败 ${failed}）`)
      }
      await sleep(paceMs)
    }
  })
  await Promise.all(lanes)
  return { done, failed }
}
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// 经 curl 取数（本机代理对部分 Host 有 TLS 指纹拦截，Node fetch 会被断连，curl 正常）
async function curlBytes(url) {
  const { stdout } = await execFileP(
    'curl',
    ['-sS', '--compressed', '--max-time', '30', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', url],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  return stdout
}

async function fetchJson(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const buf = await curlBytes(url)
      let text
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf) // JSON 接口均为 UTF-8
      } catch {
        text = new TextDecoder('gbk').decode(buf) // 腾讯快照是 GBK
      }
      if (text.trimStart().startsWith('<')) {
        // WAF 拦截页（501 HTML）：长退避后重试，避免持续触发封锁
        if (i === retries) throw new Error('blocked by WAF')
        log(`  ⚠ WAF 拦截（${url.slice(0, 60)}…），退避 ${30 * (i + 1)}s`)
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

// ── 全 A 股票清单 + 快照 ──────────────────────────────────────
// 清单/基本面：东财选股器 datacenter（push2 clist 被本机代理拦截，选股器接口正常）
// PB/成交量/成交额：腾讯批量快照 qt.gtimg.cn（选股器无 PB 指标）
async function fetchUniverseSnapshot() {
  const sty =
    'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,NEW_PRICE,CHANGE_RATE,TURNOVERRATE,' +
    'TOTAL_MARKET_CAP,PE9,MARKET,INDUSTRY,LISTING_DATE,ROE_WEIGHT'
  const pageSize = 500
  const out = []
  let page = 1
  for (;;) {
    const url =
      `https://datacenter.eastmoney.com/stock/selection/api/data/get/?type=RPTA_APP_STOCKSELECT` +
      `&sty=${sty}&source=SELECT_SECURITIES&client=APP&p=${page}&ps=${pageSize}`
    const json = await fetchJson(url)
    const rows = json?.result?.data
    if (!rows || rows.length === 0) break
    for (const r of rows) {
      if (typeof r.NEW_PRICE !== 'number' || !r.SECUCODE) continue // 停牌无价格
      if ((r.MARKET || '').includes('北')) continue // 不含北交所
      const [bare, suffix] = r.SECUCODE.split('.')
      if (!suffix || (suffix !== 'SH' && suffix !== 'SZ')) continue
      out.push({
        code: r.SECUCODE, // 600519.SH
        tcode: `${suffix.toLowerCase()}${bare}`, // sh600519
        name: r.SECURITY_NAME_ABBR,
        industry: r.INDUSTRY || '未分类',
        price: r.NEW_PRICE,
        changePct: r.CHANGE_RATE ?? 0,
        volume: 0, // 由腾讯快照补
        amountYi: 0,
        turnover: r.TURNOVERRATE ?? 0,
        pe: r.PE9 ?? null, // PE9 = 市盈率 TTM
        pb: null, // 由腾讯快照补
        mktCap: Math.round((r.TOTAL_MARKET_CAP || 0) / 1e8), // 元 → 亿元
        listDate: r.LISTING_DATE || null,
        roe: typeof r.ROE_WEIGHT === 'number' ? r.ROE_WEIGHT : null, // 加权 ROE（最新一期）
      })
    }
    log(`  清单进度 ${out.length}（第 ${page} 页）`)
    if (!json.result.nextpage || rows.length < pageSize) break
    page++
    await sleep(200)
  }

  // 腾讯批量快照补 PB / 成交量 / 成交额（每次 60 只）
  log('  腾讯批量快照补 PB / 量额…')
  for (let i = 0; i < out.length; i += 60) {
    const chunk = out.slice(i, i + 60)
    try {
      const buf = await curlBytes(`https://qt.gtimg.cn/q=${chunk.map((s) => s.tcode).join(',')}`)
      const text = new TextDecoder('gbk').decode(buf)
      for (const s of chunk) {
        const m = text.match(new RegExp(`v_${s.tcode}="([^"]*)"`))
        if (!m) continue
        const f = m[1].split('~')
        s.pb = parseFloat(f[46]) || null
        s.volume = parseFloat(f[36]) || 0 // 手
        s.amountYi = (parseFloat(f[37]) || 0) / 1e4 // 万元 → 亿元
      }
    } catch (e) {
      log(`  ✗ 腾讯快照分片 ${i}: ${e.message}`)
    }
    await sleep(150)
  }
  return out
}

// ── 日 K 线（腾讯，前复权）─────────────────────────────────────
const dash = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

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
// 直到拿满 KLINE_DAYS 行、翻完 maxYears 年、或某页不足 800 行（已到上市首日）
// 后复权全历史（东方财富，单次请求无分页、无 WAF 限制；腾讯 hfq 分页作兜底）
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

async function fetchKlineFull(tcode, today, maxYears = 11, adjust = 'qfq') {
  const map = new Map()
  let end = today
  const stop = dash(addDays(today, -maxYears * 365))
  for (let page = 0; page < 8; page++) {
    const rows = await fetchKline(tcode, '', dash(end), 800, adjust)
    for (const r of rows) map.set(r[0], r)
    if (rows.length < 800) break // 已到上市首日
    const first = rows[0][0]
    if (first <= stop) break // 已覆盖目标年限
    end = addDays(first.replaceAll('-', ''), -1) // 上一页结束日 = 本页首日的前一天（按真实日历减，不能简单整数-1）
    await sleep(PACE_MS)
  }
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-KLINE_DAYS)
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

// 存为 {dates, opens, closes, highs, lows, vols, closesHfq} 平行数组
// closes = 前复权（图表/前端展示用）；closesHfq = 后复权（研究脚本算收益率用：
// 前复权在高分红股票的远期历史上会出现趋零甚至负价，导致收益率爆炸，后复权无此问题）
// 旧格式缓存（无 highs 字段）视为需要全量重抓，自动升级为 OHLC 格式
// 无 fullHist 标记的文件（2 年短历史时代产物）同样需要全量重抓，补齐 10 年
// 有 fullHist 但无 closesHfq 的文件：只补拉后复权序列合并
// 跳过规则：文件今日已更新过（mtime 为今天）直接跳过——避免中断重启后反复重抓头部股票
async function updateKline(stock, today) {
  const existing = readKline(stock.code)
  const needFull = FULL || !existing || !existing.dates || existing.dates.length < 60 || !existing.highs || !existing.fullHist
  // 只补后复权
  if (!needFull && !existing.closesHfq) {
    const hfq = await fetchHfq(stock.tcode, today)
    const hmap = new Map(hfq.map((r) => [r[0], r[2]])) // date → close(hfq)
    existing.closesHfq = existing.dates.map((d) => hmap.get(d) ?? null)
    writeFileSync(klinePath(stock.code), JSON.stringify(existing))
    return { status: 'hfq', bars: existing.dates.length }
  }
  if (!needFull) {
    if (!FULL && isMtimeToday(klinePath(stock.code))) return { status: 'fresh', bars: existing.dates.length }
    const last = existing.dates[existing.dates.length - 1].replaceAll('-', '')
    if (last >= today) return { status: 'fresh', bars: existing.dates.length }
    const begin = addDays(last, -10)
    const fresh = await fetchKline(stock.tcode, dash(begin), dash(today), 20)
    const merged = mergeKline(existingToRows(existing), fresh)
    merged.fullHist = true
    const hfq = await fetchKline(stock.tcode, dash(begin), dash(today), 20, 'hfq')
    const hmap = new Map([...existing.dates.map((d, i) => [d, existing.closesHfq[i]]), ...hfq.map((r) => [r[0], r[2]])])
    merged.closesHfq = merged.dates.map((d) => hmap.get(d) ?? null)
    writeFileSync(klinePath(stock.code), JSON.stringify(merged))
    return { status: 'updated', bars: merged.dates.length }
  }
  const fresh = await fetchKlineFull(stock.tcode, today)
  if (fresh.length < 20) throw new Error('kline too short')
  const merged = mergeKline(null, fresh)
  merged.fullHist = true
  const hfq = await fetchHfq(stock.tcode, today)
  const hmap = new Map(hfq.map((r) => [r[0], r[2]]))
  merged.closesHfq = merged.dates.map((d) => hmap.get(d) ?? null)
  writeFileSync(klinePath(stock.code), JSON.stringify(merged))
  return { status: 'full', bars: merged.dates.length }
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

function addDays(yyyymmdd, delta) {
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6)) - 1
  const d = Number(yyyymmdd.slice(6, 8))
  const dt = new Date(y, m, d + delta)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}

// ── 经营现金流（东财 datacenter，累计→单季度差分）──────────────
// 每股一个缓存文件 cashflow/<code>.json，7 天内视为新鲜（季报数据，每周更新足够）
const CF_DIR = join(DATA_DIR, 'cashflow')
const CF_FRESH_DAYS = 7

function cashflowPath(code) {
  return join(CF_DIR, `${code}.json`)
}

function readCachedCashflow(code) {
  try {
    const p = cashflowPath(code)
    const ageDays = (Date.now() - statSync(p).mtimeMs) / 86400000
    if (!FORCE_CF && ageDays < CF_FRESH_DAYS) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {}
  return null
}

async function getCashflow(stock) {
  const cached = readCachedCashflow(stock.code)
  if (cached) return cached
  const quarters = await fetchCashflow(stock.code.slice(0, 6))
  try {
    mkdirSync(CF_DIR, { recursive: true })
    writeFileSync(cashflowPath(stock.code), JSON.stringify(quarters))
  } catch {}
  return quarters
}

async function fetchCashflow(bareCode) {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DMSK_FN_CASHFLOW' +
    '&columns=SECURITY_CODE%2CREPORT_DATE%2CNETCASH_OPERATE' +
    `&filter=(SECURITY_CODE%3D%22${bareCode}%22)&sortColumns=REPORT_DATE&sortTypes=-1&pageSize=8`
  const json = await fetchJson(url, 1)
  const rows = json?.result?.data
  if (!rows || rows.length < 5) return []
  const quarters = []
  for (const cur of rows) {
    const [y, mm] = cur.REPORT_DATE.split('-').map(Number)
    const q = mm / 3
    let single
    if (q === 1) {
      single = cur.NETCASH_OPERATE
    } else {
      const prev = rows.find((r) => {
        const [py, pm] = r.REPORT_DATE.split('-').map(Number)
        return py === y && pm === mm - 3
      })
      if (!prev) continue
      single = cur.NETCASH_OPERATE - prev.NETCASH_OPERATE
    }
    quarters.push({ period: `${y}Q${q}`, value: Number((single / 1e8).toFixed(2)) })
  }
  return quarters.slice(0, 4)
}

// ── 指标计算 ──────────────────────────────────────────────────
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0)
const pctOf = (a, b) => (b ? (a / b - 1) * 100 : 0)

function percentileScores(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => Math.round((sorted.filter((x) => x < v).length / Math.max(sorted.length - 1, 1)) * 100))
}

function computeMetrics(stock, kl) {
  const closes = kl.closes
  const vols = kl.vols
  const highs = kl.highs || closes
  const lows = kl.lows || closes
  const n = closes.length
  const last = closes[n - 1]
  const mom20 = n > 21 ? pctOf(last, closes[n - 21]) : 0
  const mom60 = n > 61 ? pctOf(last, closes[n - 61]) : 0
  const win60 = closes.slice(-60)
  const pos60 = Math.round(((last - Math.min(...win60)) / (Math.max(...win60) - Math.min(...win60) || 1)) * 100)
  const ma20 = avg(closes.slice(-20))
  const aboveMa20 = last > ma20
  const volRatio = avg(vols.slice(-5)) / (avg(vols.slice(-20)) || 1)

  // ── 因子值（日频近似版，供可执行因子规则使用）──
  const rets = []
  for (let i = 1; i < n; i++) rets.push(closes[i] / closes[i - 1] - 1)
  const std = (arr) => (arr.length ? Math.sqrt(avg(arr.map((x) => (x - avg(arr)) ** 2))) : 0)
  const corr = (a, b) => {
    if (a.length < 3) return 0
    const ma = avg(a)
    const mb = avg(b)
    let s = 0
    let sa = 0
    let sb = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma
      const y = b[i] - mb
      s += x * y
      sa += x * x
      sb += y * y
    }
    return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : 0
  }
  const r20 = rets.slice(-20)
  const r60 = rets.slice(-60)
  const v20 = vols.slice(-20)
  const vol20 = std(r20) * Math.sqrt(252) * 100 // 20 日年化波动率 %
  const vol60 = std(r60) * Math.sqrt(252) * 100
  const cpv20 = corr(closes.slice(-20), v20) // 量价相关系数（CPV 日频近似，值小为好）
  const cpv10 = corr(closes.slice(-10), vols.slice(-10)) // 10 日 CPV（自研实测优于 20 日，值小为好）
  const vcv20 = std(v20) / (avg(v20) || 1) // 量能变异系数（换手率波动近似，值小为好）
  const ret5 = n > 6 ? pctOf(last, closes[n - 6]) : 0 // 5 日涨幅（短期反转，值小为好）
  const sharpe20 = vol20 > 0 ? (avg(r20) * 252 * 100) / vol20 : 0 // 动量质量（收益/波动，值大为好）
  let peak = win60[0] ?? last
  let mdd = 0
  for (const c of win60) {
    peak = Math.max(peak, c)
    mdd = Math.min(mdd, (c / peak - 1) * 100)
  }
  // ── 晋升因子（自研实测高 IC 因子，与 factor-research.py 口径一致）──
  const v60 = vols.slice(-60)
  const vcv60 = std(v60) / (avg(v60) || 1) // 60 日量能稳定度（值小为好）
  const vr2060 = (avg(v20) || 0) / (avg(v60) || 1) // 量能比 20/60（值小为好）
  const bias60 = (last / (avg(closes.slice(-60)) || last) - 1) * 100 // 60 日乖离率（值小为好）
  const hl20h = highs.slice(-20)
  const hl20l = lows.slice(-20)
  const park20 =
    hl20h.length > 1
      ? Math.sqrt(avg(hl20h.map((h, i) => Math.log(h / (hl20l[i] || h)) ** 2)) / (4 * Math.LN2)) * Math.sqrt(252) * 100
      : 0 // Parkinson 波动率（值小为好）
  const bigup20 = r20.filter((r) => r > 0.05).length // 近 20 日暴涨计数（>5%，值小为好）
  const m4 = r20.length > 3 ? avg(r20.map((r) => (r - avg(r20)) ** 4)) : 0
  const kurt20 = vol20 > 0 && m4 > 0 ? m4 / std(r20) ** 4 - 3 : 0 // 收益峰度（超额，值小为好）
  return {
    mom20, mom60, pos60, aboveMa20, volRatio, vol20, vol60, cpv20, cpv10, vcv20, ret5, sharpe20, maxdd60: mdd,
    vcv60, vr2060, bias60, park20, bigup20, kurt20,
  }
}

// ── 指数 ─────────────────────────────────────────────────────
async function fetchIndices(today) {
  const buf = await curlBytes(`https://qt.gtimg.cn/q=${INDEX_CODES.join(',')}`)
  const text = new TextDecoder('gbk').decode(buf)
  const indices = []
  const series = []
  for (const c of INDEX_CODES) {
    const m = text.match(new RegExp(`v_${c}="([^"]*)"`))
    if (m) {
      const f = m[1].split('~')
      indices.push({ name: f[1], value: parseFloat(f[3]), changePct: parseFloat(f[32]) })
      try {
        const kl = await fetchKlineFull(c, today)
        series.push({ code: c, name: f[1], series: kl.map(([date, , close, , , vol]) => ({ date, close, vol })) })
      } catch (e) {
        log(`  ✗ 指数 ${c}: ${e.message}`)
      }
      await sleep(150)
    }
  }
  return { indices, series }
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  const today = todayStr()
  mkdirSync(KLINE_DIR, { recursive: true })

  log('1/4 拉取全 A 股票清单与快照（东财选股器 + 腾讯快照）…')
  let universe = await fetchUniverseSnapshot()
  log(`  共 ${universe.length} 只`)
  if (LIMIT < Infinity) {
    universe = universe.slice(0, LIMIT)
    log(`  --limit=${LIMIT} 调试模式，只处理前 ${universe.length} 只（不会改写 universe/indices/meta 产物）`)
  }

  let failed = 0
  const klMap = new Map()
  const cfMap = new Map()

  if (UNIVERSE_ONLY) {
    // 修复产物专用：只读本地缓存，不碰网络
    for (const s of universe) {
      const kl = readKline(s.code)
      if (kl) klMap.set(s.code, kl)
      try {
        cfMap.set(s.code, JSON.parse(readFileSync(cashflowPath(s.code), 'utf-8')))
      } catch {
        cfMap.set(s.code, [])
      }
    }
    log(`2/4 --universe-only：本地读取 K线 ${klMap.size} 只、现金流缓存 ${cfMap.size} 只（不请求网络）`)
  } else {
    // 缺文件的优先抓（全量补缺），已有文件的做增量（今日已更新的会在 updateKline 内跳过）
    const missing = universe.filter((s) => !existsSync(klinePath(s.code)))
    const present = universe.filter((s) => existsSync(klinePath(s.code)))
    log(`2/4 增量更新日 K 线…（缺文件 ${missing.length} 只优先，已有 ${present.length} 只增量）`)
    const klineWorker = async (s) => {
      await updateKline(s, today)
      klMap.set(s.code, readKline(s.code))
    }
    const kr1 = await runPool(missing, klineWorker, 'K线补缺')
    const kr2 = await runPool(present, klineWorker, 'K线增量')
    failed = kr1.failed + kr2.failed
    log(`  K线完成 ${kr1.done + kr2.done}，失败 ${failed}`)
  }

  if (!UNIVERSE_ONLY && LIMIT === Infinity) {
    log('3/4 更新经营现金流（每股磁盘缓存 7 天，周一/首次/手动强制刷新）…')
    // 先用旧 universe.json 的现金流播种缓存（兼容旧版产物）
    if (!FORCE_CF) {
      try {
        const old = JSON.parse(readFileSync(join(DATA_DIR, 'universe.json'), 'utf-8'))
        let seeded = 0
        for (const o of old) {
          if (!o.cashflow) continue
          cfMap.set(o.code, o.cashflow)
          if (!existsSync(cashflowPath(o.code))) {
            try {
              mkdirSync(CF_DIR, { recursive: true })
              writeFileSync(cashflowPath(o.code), JSON.stringify(o.cashflow))
              seeded++
            } catch {}
          }
        }
        if (seeded) log(`  旧 universe.json 播种现金流缓存 ${seeded} 只`)
      } catch {}
    }
    const cr = await runPool(
      universe,
      async (s) => {
        try {
          cfMap.set(s.code, await getCashflow(s))
        } catch {
          if (!cfMap.has(s.code)) cfMap.set(s.code, [])
        }
      },
      '现金流',
      6, // datacenter 接口无 WAF 限制，可放宽并发
      80,
    )
    log(`  现金流完成 ${cr.done}，失败 ${cr.failed}`)
  } else if (!UNIVERSE_ONLY) {
    // limit 调试：现金流直接用磁盘缓存，不请求网络
    for (const s of universe) {
      try {
        cfMap.set(s.code, JSON.parse(readFileSync(cashflowPath(s.code), 'utf-8')))
      } catch {
        cfMap.set(s.code, [])
      }
    }
  }

  if (LIMIT < Infinity) {
    log(`4/4 --limit=${LIMIT} 调试模式：跳过写出 universe / indices / meta，正式产物保持不动`)
    log(`完成：${universe.length} 只股票（调试）`)
    return
  }

  log('4/4 计算指标并写出 universe / indices / meta…')
  const enriched = []
  for (const s of universe) {
    const kl = klMap.get(s.code)
    if (!kl || kl.closes.length < 60) continue
    enriched.push({ ...s, ...computeMetrics(s, kl), cashflow: cfMap.get(s.code) || [] })
  }
  // 截面百分位 → AI 评分
  const mom20S = percentileScores(enriched.map((m) => m.mom20))
  const mom60S = percentileScores(enriched.map((m) => m.mom60))
  const pos60S = percentileScores(enriched.map((m) => m.pos60))
  const volS = percentileScores(enriched.map((m) => m.volRatio))
  const peS = percentileScores(enriched.map((m) => (m.pe > 0 && m.pe < 200 ? m.pe : 200))).map((x) => 100 - x)
  const final = enriched.map((m, i) => {
    const aiScore = Math.round(0.3 * mom20S[i] + 0.2 * mom60S[i] + 0.2 * pos60S[i] + 0.15 * volS[i] + 0.15 * peS[i])
    const signal = aiScore >= 75 ? '强烈买入' : aiScore >= 60 ? '买入' : aiScore >= 45 ? '持有' : '观望'
    const subs = [
      ['动量', mom20S[i]],
      ['成长', mom60S[i]],
      ['技术形态', pos60S[i]],
      ['资金流', volS[i]],
      ['价值', peS[i]],
    ].sort((a, b) => b[1] - a[1])
    return {
      code: m.code,
      name: m.name,
      industry: m.industry,
      price: m.price,
      changePct: m.changePct,
      aiScore,
      signal,
      factors: subs.filter(([, x]) => x >= 60).slice(0, 3).map(([n]) => n),
      winRate: Math.min(80, Math.max(35, Math.round(50 + (aiScore - 50) * 0.5))),
      mktCap: m.mktCap,
      pe: m.pe,
      pb: m.pb,
      turnover: m.turnover,
      listDate: m.listDate,
      pos60: m.pos60,
      mom20: Number(m.mom20.toFixed(2)),
      mom60: Number(m.mom60.toFixed(2)),
      aboveMa20: m.aboveMa20,
      vol20: Number(m.vol20.toFixed(1)),
      vol60: Number(m.vol60.toFixed(1)),
      cpv20: Number(m.cpv20.toFixed(2)),
      cpv10: Number(m.cpv10.toFixed(2)),
      vcv20: Number(m.vcv20.toFixed(2)),
      vcv60: Number((m.vcv60 ?? 0).toFixed(2)),
      vr2060: Number((m.vr2060 ?? 0).toFixed(2)),
      bias60: Number((m.bias60 ?? 0).toFixed(2)),
      park20: Number((m.park20 ?? 0).toFixed(1)),
      bigup20: m.bigup20 ?? 0,
      kurt20: Number((m.kurt20 ?? 0).toFixed(2)),
      ret5: Number(m.ret5.toFixed(2)),
      sharpe20: Number(m.sharpe20.toFixed(2)),
      maxdd60: Number(m.maxdd60.toFixed(1)),
      roe: m.roe,
      radar: [mom20S[i], peS[i], mom60S[i], volS[i], Math.min(100, Math.round(50 + m.changePct * 10)), pos60S[i]],
      cashflow: m.cashflow,
    }
  })
  writeFileSync(join(DATA_DIR, 'universe.json'), JSON.stringify(final))

  const idx = await fetchIndices(today)
  writeFileSync(join(DATA_DIR, 'indices.json'), JSON.stringify(idx))

  const upCount = final.filter((s) => s.changePct > 0).length
  const downCount = final.filter((s) => s.changePct < 0).length
  writeFileSync(
    join(DATA_DIR, 'meta.json'),
    JSON.stringify(
      {
        source: '东方财富选股器（清单/基本面）/ 腾讯财经（快照PB、K线）/ 东方财富 datacenter（现金流），公开接口',
        fetchedAt: new Date().toISOString(),
        stockCount: final.length,
        klineFailed: failed,
        klineDays: KLINE_DAYS,
        upCount,
        downCount,
        turnoverYi: Math.round(universe.reduce((s, x) => s + (x.amountYi || 0), 0)),
        cashflowUpdated: FORCE_CF || new Date().getDay() === 1,
        note: 'K线为前复权日线；市值单位亿元；现金流转单季度差分；AI评分为演示模型输出',
      },
      null,
      2,
    ),
  )
  log(`完成：${final.length} 只股票，耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`)
}

main().catch((e) => {
  log(`构建失败: ${e?.stack || e}`)
  process.exit(1)
})
