// 拉取真实行情并生成 src/lib/realData.ts
// 数据源：腾讯财经公开行情接口（qt.gtimg.cn / web.ifzq.gtimg.cn）
// 用法：node scripts/fetch-real-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../src/lib/realData.ts')

// 样本股池（66 只，覆盖主要行业与不同市值层级）
const UNIVERSE = [
  ['sh600519', '白酒'],
  ['sz000858', '白酒'],
  ['sz300750', '电池'],
  ['sh688981', '半导体'],
  ['sz002371', '半导体设备'],
  ['sz002594', '汽车'],
  ['sh601899', '有色金属'],
  ['sh600036', '银行'],
  ['sh600900', '电力'],
  ['sh601088', '煤炭'],
  ['sz002475', '消费电子'],
  ['sz300124', '工控自动化'],
  ['sh603259', '医药'],
  ['sh688111', '软件'],
  ['sh601012', '光伏'],
  ['sz300308', '光模块'],
  ['sz300014', '电池'],
  ['sz300274', '光伏逆变器'],
  ['sz300760', '医疗器械'],
  ['sz300059', '证券'],
  ['sz300347', '医药'],
  ['sh603799', '有色金属'],
  ['sh603501', '半导体'],
  ['sh600745', '消费电子'],
  ['sz002241', '消费电子'],
  ['sz300433', '消费电子'],
  ['sh688008', '半导体'],
  ['sz002049', '半导体'],
  ['sh603986', '半导体'],
  ['sz002230', '软件'],
  ['sz002415', '安防'],
  ['sh600570', '软件'],
  ['sz300033', '证券'],
  ['sh601100', '机械'],
  ['sh600031', '机械'],
  ['sz000338', '汽车'],
  ['sz002508', '家电'],
  ['sh603288', '食品饮料'],
  ['sh600887', '食品饮料'],
  ['sz000651', '家电'],
  ['sz000333', '家电'],
  ['sh601318', '保险'],
  ['sh600030', '证券'],
  ['sz002142', '银行'],
  ['sh601166', '银行'],
  ['sz300498', '农业'],
  ['sh600438', '光伏'],
  ['sz002271', '建筑材料'],
  ['sh603195', '家电'],
  ['sh600845', '软件'],
  ['sh688396', '半导体'],
  ['sz300661', '半导体'],
  ['sz300782', '半导体'],
  ['sz300763', '光伏逆变器'],
  ['sz002920', '汽车电子'],
  ['sz300496', '软件'],
  ['sh688169', '家电'],
  ['sh603486', '家电'],
  ['sz002851', '工控自动化'],
  ['sz300724', '光伏设备'],
  ['sz300751', '光伏设备'],
  ['sz002129', '光伏'],
  ['sz002460', '有色金属'],
  ['sz002466', '有色金属'],
  ['sh601877', '电力设备'],
  ['sz002959', '小家电'],
  ['sz002242', '小家电'],
  ['sz002705', '小家电'],
  ['sh603868', '小家电'],
  ['sz003006', '个护用品'],
  ['sz300911', '厨卫电器'],
  ['sz002035', '厨卫电器'],
  ['sz002677', '厨卫电器'],
  ['sh603801', '家居用品'],
  ['sz300616', '家居用品'],
  ['sh603898', '家居用品'],
  ['sz002790', '家居用品'],
]

const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sh000300', 'sh000905']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = await res.arrayBuffer()
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

// ── 快照（腾讯行情 ~ 分隔字段）────────────────────────────────
// 3 现价 4 昨收 30 时间 31 涨跌 32 涨跌% 33 最高 34 最低 37 成交额(万) 38 换手率 39 PE(TTM) 45 总市值(亿) 46 PB
function parseQuote(text, tcode) {
  const m = text.match(new RegExp(`v_${tcode}="([^"]*)"`))
  if (!m) throw new Error(`quote not found: ${tcode}`)
  const f = m[1].split('~')
  return {
    name: f[1],
    price: parseFloat(f[3]),
    time: f[30],
    changePct: parseFloat(f[32]),
    turnover: parseFloat(f[38]),
    pe: parseFloat(f[39]),
    mktCap: parseFloat(f[45]),
    pb: parseFloat(f[46]),
    amountWan: parseFloat(f[37]),
  }
}

function parseIndexQuote(text, tcode) {
  const m = text.match(new RegExp(`v_${tcode}="([^"]*)"`))
  if (!m) throw new Error(`index quote not found: ${tcode}`)
  const f = m[1].split('~')
  return { name: f[1], value: parseFloat(f[3]), changePct: parseFloat(f[32]), time: f[30] }
}

// ── K 线 ─────────────────────────────────────────────────────
async function fetchKlines(tcode, count = 260) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcode},day,,,${count},qfq`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const json = await res.json()
  const d = json?.data?.[tcode]
  const rows = d?.qfqday || d?.day
  if (!rows || rows.length < 30) throw new Error(`kline insufficient: ${tcode}`)
  // [date, open, close, high, low, volume]
  return rows.map((r) => ({ date: r[0], close: parseFloat(r[2]), vol: parseFloat(r[5]) }))
}

// ── 经营现金流（东方财富 datacenter，累计值 → 单季度差分）─────
async function fetchCashflow(tcode) {
  const bare = tcode.slice(2)
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DMSK_FN_CASHFLOW' +
    '&columns=SECURITY_CODE%2CREPORT_DATE%2CNETCASH_OPERATE' +
    `&filter=(SECURITY_CODE%3D%22${bare}%22)&sortColumns=REPORT_DATE&sortTypes=-1&pageSize=8`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const json = await res.json()
  const rows = json?.result?.data
  if (!rows || rows.length < 5) return []
  // rows 按报告期倒序，NETCASH_OPERATE 为年初至报告期累计值 → 差分得单季度
  const quarters = []
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]
    const [y, mm] = cur.REPORT_DATE.split('-').map(Number)
    const q = mm / 3 // 3/6/9/12 → Q1..Q4
    let single
    if (q === 1) {
      single = cur.NETCASH_OPERATE
    } else {
      const prev = rows.find((r) => {
        const [py, pm] = r.REPORT_DATE.split('-').map(Number)
        return py === y && pm === mm - 3
      })
      if (!prev) continue // 缺上一累计期，无法差分
      single = cur.NETCASH_OPERATE - prev.NETCASH_OPERATE
    }
    quarters.push({ period: `${y}Q${q}`, value: Number((single / 1e8).toFixed(2)) }) // 亿元
  }
  return quarters.slice(0, 4) // 最近四个单季度，新的在前
}

const pct = (a, b) => ((a / b - 1) * 100)

const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length

// 截面百分位（0-100）
function percentileScores(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => {
    const rank = sorted.filter((x) => x < v).length
    return Math.round((rank / Math.max(sorted.length - 1, 1)) * 100)
  })
}

async function main() {
  console.log('1/3 拉取指数快照与指数 K 线…')
  const idxText = await fetchText(`https://qt.gtimg.cn/q=${INDEX_CODES.join(',')}`)
  const indices = INDEX_CODES.map((c) => parseIndexQuote(idxText, c))
  const indexSeries = []
  for (const c of INDEX_CODES) {
    try {
      const kl = await fetchKlines(c)
      const q = parseIndexQuote(idxText, c)
      indexSeries.push({ code: c, name: q.name, series: kl })
      console.log(`  ✓ 指数 ${c} ${kl.length} 根`)
    } catch (e) {
      console.error(`  ✗ 指数 ${c}: ${e.message}（跳过）`)
    }
    await sleep(150)
  }

  console.log('2/3 拉取个股快照…')
  const codes = UNIVERSE.map(([c]) => c)
  const quoteText = await fetchText(`https://qt.gtimg.cn/q=${codes.join(',')}`)
  const quotes = {}
  for (const [tcode, industry] of UNIVERSE) {
    quotes[tcode] = { ...parseQuote(quoteText, tcode), industry }
  }

  console.log('3/3 逐只拉取日 K 线（约 260 根）与经营现金流…')
  const raw = []
  for (const [tcode] of UNIVERSE) {
    try {
      const kl = await fetchKlines(tcode)
      const cf = await fetchCashflow(tcode).catch(() => [])
      raw.push({ tcode, kl, cf })
      console.log(`  ✓ ${tcode} K线${kl.length}根 现金流${cf.length}季`)
    } catch (e) {
      console.error(`  ✗ ${tcode}: ${e.message}（跳过）`)
    }
    await sleep(150)
  }
  if (raw.length < 8) throw new Error('K 线成功数量不足，终止生成')

  // ── 计算因子与模型评分（全部来自真实行情）──────────────────
  const metrics = raw.map(({ tcode, kl, cf }) => {
    const closes = kl.map((k) => k.close)
    const vols = kl.map((k) => k.vol)
    const n = closes.length
    const last = closes[n - 1]
    const mom20 = pct(last, closes[n - 21])
    const mom60 = pct(last, closes[n - 61])
    const win60 = closes.slice(-60)
    const pos60 = ((last - Math.min(...win60)) / (Math.max(...win60) - Math.min(...win60) || 1)) * 100
    const volRatio = avg(vols.slice(-5)) / (avg(vols.slice(-20)) || 1)
    const q = quotes[tcode]
    // 波动率（20 日日收益标准差）
    const rets = []
    for (let i = n - 20; i < n; i++) rets.push(closes[i] / closes[i - 1] - 1)
    const mu = avg(rets)
    const vol20 = Math.sqrt(avg(rets.map((r) => (r - mu) ** 2))) * 100
    return { tcode, closes: closes.slice(-60), mom20, mom60, pos60, volRatio, vol20, q, cf }
  })

  const mom20S = percentileScores(metrics.map((m) => m.mom20))
  const mom60S = percentileScores(metrics.map((m) => m.mom60))
  const pos60S = percentileScores(metrics.map((m) => m.pos60))
  const volS = percentileScores(metrics.map((m) => m.volRatio))
  // 价值分：PE 越低分越高（剔除亏损/异常 PE）
  const peVals = metrics.map((m) => (m.q.pe > 0 && m.q.pe < 200 ? m.q.pe : 200))
  const peS = percentileScores(peVals).map((s) => 100 - s)

  const stocks = metrics.map((m, i) => {
    const aiScore = Math.round(0.3 * mom20S[i] + 0.2 * mom60S[i] + 0.2 * pos60S[i] + 0.15 * volS[i] + 0.15 * peS[i])
    const signal = aiScore >= 75 ? '强烈买入' : aiScore >= 60 ? '买入' : aiScore >= 45 ? '持有' : '观望'
    const winRate = Math.min(80, Math.max(35, Math.round(50 + (aiScore - 50) * 0.5)))
    const subs = [
      ['动量', mom20S[i]],
      ['成长', mom60S[i]],
      ['技术形态', pos60S[i]],
      ['资金流', volS[i]],
      ['价值', peS[i]],
    ].sort((a, b) => b[1] - a[1])
    const factors = subs.filter(([, s]) => s >= 60).slice(0, 3).map(([n]) => n)
    const q = m.q
    const aiText =
      `${q.name} 最新价 ${q.price} 元，当日涨跌幅 ${q.changePct}%。` +
      `近 20 日动量 ${m.mom20.toFixed(1)}%，近 60 日动量 ${m.mom60.toFixed(1)}%，` +
      `现价处于 60 日区间 ${m.pos60.toFixed(0)}% 分位；5 日量能比 ${m.volRatio.toFixed(2)}，` +
      `20 日年化前波动 ${m.vol20.toFixed(2)}%。PE(TTM) ${q.pe} 倍，PB ${q.pb} 倍，总市值约 ${Math.round(q.mktCap).toLocaleString()} 亿元。` +
      `演示模型综合评分 ${aiScore}/100，信号「${signal}」。`
    return {
      code: `${m.tcode.slice(2)}.${m.tcode.slice(0, 2).toUpperCase()}`,
      name: q.name,
      industry: q.industry,
      price: q.price,
      changePct: q.changePct,
      aiScore,
      signal,
      factors,
      winRate,
      mktCap: Math.round(q.mktCap),
      pe: q.pe,
      pb: q.pb,
      turnover: q.turnover,
      pos60: Math.round(m.pos60),
      cashflow: m.cf, // 最近四个单季度经营现金流净额（亿元，新的在前；不足则为空数组）
      radar: [mom20S[i], peS[i], mom60S[i], volS[i], Math.min(100, Math.round(50 + q.changePct * 10)), pos60S[i]],
      series: m.closes,
      aiText,
    }
  })

  // 样本统计（替代全市场宽度）
  const upCount = stocks.filter((s) => s.changePct > 0).length
  const downCount = stocks.filter((s) => s.changePct < 0).length
  const totalAmountYi = raw.reduce((s, { tcode }) => s + (quotes[tcode].amountWan || 0), 0) / 10000
  const t = stocks[0] ? metrics[0].q.time : ''
  const fetchedAt = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`

  const ts = `// 本文件由 scripts/fetch-real-data.mjs 自动生成，请勿手改
// 数据源：腾讯财经公开行情接口 · 快照时间 ${fetchedAt}
import type { Stock, IndexQuote } from './mockData'

export type { Stock, IndexQuote }

export const META = {
  source: '腾讯财经公开行情接口',
  fetchedAt: '${fetchedAt}',
  sampleSize: ${stocks.length},
}

export const STOCKS: Stock[] = ${JSON.stringify(stocks, null, 2)}

export const INDICES: IndexQuote[] = ${JSON.stringify(indices.map(({ name, value, changePct }) => ({ name, value, changePct })), null, 2)}

export interface IndexSeries {
  code: string
  name: string
  series: { date: string; close: number; vol: number }[]
}

export const INDEX_SERIES: IndexSeries[] = ${JSON.stringify(indexSeries, null, 2)}

export const MARKET_STATS = {
  upCount: ${upCount},
  downCount: ${downCount},
  turnover: ${totalAmountYi.toFixed(0)}, // 样本股成交额合计（亿元）
}
`
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, ts, 'utf-8')
  console.log(`\n已生成 ${OUT}（${stocks.length} 只股票，快照时间 ${fetchedAt}）`)
}

main().catch((e) => {
  console.error('生成失败:', e.message)
  process.exit(1)
})
