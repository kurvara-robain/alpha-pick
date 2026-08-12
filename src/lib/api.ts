// ─────────────────────────────────────────────────────────────
// 模拟 API 层：本地实现后端能力（NL 策略解析 / 筛选 / 回测 / 诊股 / 研报）
// 未来接真实后端时，只需替换本模块的函数实现，页面无需改动
// ─────────────────────────────────────────────────────────────
import { loadIndices, loadKline, loadMeta, loadUniverse } from './marketData'
import type { UniverseStock } from './marketData'
import { runChanAnalysis } from './chan'
import { getDB, uid } from './store'
import type {
  BacktestConfig,
  BacktestResult,
  CandidateStock,
  ChanAnalysis,
  DailyReport,
  DiagnosisAdvice,
  Factor,
  HoldingDiagnosis,
  Strategy,
  StrategyCondition,
  WatchItem,
} from './types'

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms))

// ── 自然语言策略解析（模拟 LLM 解析层）─────────────────────────

export interface ParseResult {
  conditions: StrategyCondition[]
  unsupported: string[]
  summary: string
}

interface Rule {
  re: RegExp
  build: (m: RegExpMatchArray) => StrategyCondition
}

const RULES: Rule[] = [
  // ── 区间/复合规则必须排在单值规则之前，避免被截断误配 ──
  {
    re: /(?:总市值|市值)\s*(\d+(?:\.\d+)?)\s*亿?\s*(?:到|至|~|—|-)\s*(\d+(?:\.\d+)?)\s*亿/,
    build: (m) => ({ field: 'mktCap', op: 'between', value: [Number(m[1]), Number(m[2])], raw: m[0] }),
  },
  {
    re: /(市盈率|PE|pe)\s*(\d+(?:\.\d+)?)\s*(?:到|至|~|—|-)\s*(\d+(?:\.\d+)?)/,
    build: (m) => ({ field: 'pe', op: 'between', value: [Number(m[2]), Number(m[3])], raw: m[0] }),
  },
  {
    re: /近\s*(\d+)\s*(?:个)?日涨幅\s*(?:大于|高于|>)\s*(-?\d+(?:\.\d+)?)\s*%?\s*(?:且|并且|,|，)\s*(?:小于|低于|<)\s*(-?\d+(?:\.\d+)?)\s*%/,
    build: (m) => ({ field: 'mom_range', op: 'between', value: [Number(m[2]), Number(m[3])], window: Number(m[1]), raw: m[0] }),
  },
  {
    re: /按[^，。,；;]*?换手率[^，。,；;]*?(?:从大到小|降序)(?:排序)?/,
    build: (m) => ({ field: '__sort', op: 'desc', value: 'turnover', raw: m[0] }),
  },
  {
    re: /(市盈率|PE|pe)\s*(低于|小于|<|≤)\s*(\d+(?:\.\d+)?)/,
    build: (m) => ({ field: 'pe', op: '<', value: Number(m[3]), raw: m[0] }),
  },
  {
    re: /(市净率|PB|pb)\s*(低于|小于|<|≤)\s*(\d+(?:\.\d+)?)/,
    build: (m) => ({ field: 'pb', op: '<', value: Number(m[3]), raw: m[0] }),
  },
  {
    re: /市值\s*(大于|超过|高于|>)\s*(\d+(?:\.\d+)?)\s*亿/,
    build: (m) => ({ field: 'mktCap', op: '>', value: Number(m[2]), raw: m[0] }),
  },
  {
    re: /近\s*(\d+)\s*(?:个)?交易日涨幅排名前\s*(\d+(?:\.\d+)?)\s*%/,
    build: (m) => ({ field: 'mom_rank', op: 'top_pct', value: Number(m[2]), window: Number(m[1]), raw: m[0] }),
  },
  {
    re: /近?(?:四个|4)(?:个)?季度[^，。,；;]*?现金流[^，。,；;]*?(?:大于|高于|>|为正|为正数)\s*0?/,
    build: (m) => ({ field: 'ocf_4q', op: '>', value: 0, raw: m[0] }),
  },
  {
    re: /(?:今日)?收盘价\s*(?:大于|高于|站上|>)\s*(\d+)\s*日均线/,
    build: (m) => ({ field: 'above_ma', op: '>', value: Number(m[1]), raw: m[0] }),
  },
  {
    re: /上市\s*(?:大于|超过|满)\s*(\d+(?:\.\d+)?)\s*年/,
    build: (m) => ({ field: 'list_years', op: '>', value: Number(m[1]), raw: m[0] }),
  },
  {
    re: /剔除\s*ST|排除\s*ST/i,
    build: (m) => ({ field: 'exclude_st', op: '=', value: true, raw: m[0] }),
  },
  {
    re: /(剔除|排除)次新股/,
    build: (m) => ({ field: 'exclude_subnew', op: '=', value: true, raw: m[0] }),
  },
  {
    re: /换手率\s*(大于|超过|高于|>)\s*(\d+(?:\.\d+)?)\s*%/,
    build: (m) => ({ field: 'turnover', op: '>', value: Number(m[2]), raw: m[0] }),
  },
  {
    re: /AI\s*评分\s*(大于|超过|高于|>)\s*(\d+)/,
    build: (m) => ({ field: 'aiScore', op: '>', value: Number(m[2]), raw: m[0] }),
  },
]

export async function parseStrategyNL(text: string): Promise<ParseResult> {
  await delay(700)
  const conditions: StrategyCondition[] = []
  let rest = text
  for (const rule of RULES) {
    const m = rest.match(rule.re)
    if (m) {
      conditions.push(rule.build(m))
      rest = rest.replace(m[0], '')
    }
  }
  // 残余片段按标点切分，无法映射的明示"暂不支持"
  const unsupported = rest
    .split(/[，,、。；;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !/^(和|与|并且|的|要|选股|股票|选)$/.test(s))
  const summary =
    conditions.length === 0
      ? '未识别出可用的结构化条件'
      : `识别出 ${conditions.length} 条条件` + (unsupported.length ? `，${unsupported.length} 条暂不支持` : '')
  return { conditions, unsupported, summary }
}

// ── 策略 × 因子 → 备选清单（模拟筛选引擎）─────────────────────
// 筛选基于 universe.json 的预计算字段，全市场约 5200 只纯同步过滤

const DAY_MS = 24 * 3600 * 1000

/** 上市天数；listDate 缺失/非法时返回 Infinity（不误杀） */
function listedDays(s: UniverseStock): number {
  const t = new Date(`${s.listDate}T00:00:00`).getTime()
  if (Number.isNaN(t)) return Infinity
  return (Date.now() - t) / DAY_MS
}

/** 动量取值：窗口 w≤30 用 mom20，否则用 mom60 */
function momOf(s: UniverseStock, w: number): number {
  return w <= 30 ? s.mom20 : s.mom60
}

/** 动量窗口归一化到预计算字段的档位（20 / 60） */
function momBucket(w: number): number {
  return w <= 30 ? 20 : 60
}

interface ScreenCtx {
  universe: UniverseStock[]
  /** 按动量档位（20/60）缓存的降序名次表：code → 名次（0 起） */
  rankMaps: Map<number, Map<string, number>>
  /** 因子规则截面排名缓存：key 为 `${field}|${dir}|${topPct}`，value 为满足条件的股票 code 集合 */
  ruleRankMaps: Map<string, Set<string>>
}

type FactorRule = NonNullable<Factor['rule']>

function rankMapFor(ctx: ScreenCtx, w: number): Map<string, number> {
  const bucket = momBucket(w)
  let map = ctx.rankMaps.get(bucket)
  if (!map) {
    const sorted = [...ctx.universe].sort((a, b) => momOf(b, w) - momOf(a, w))
    map = new Map<string, number>()
    for (let i = 0; i < sorted.length; i++) map.set(sorted[i].code, i)
    ctx.rankMaps.set(bucket, map)
  }
  return map
}

/** 因子规则的截面取值：字段缺失/非数值返回 null（该股票在该规则下视为不满足） */
function ruleValueOf(s: UniverseStock, field: string): number | null {
  const v = (s as unknown as Record<string, unknown>)[field]
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

/**
 * 计算某条因子规则在全市场截面上满足条件的股票 code 集合（惰性计算并缓存）：
 * asc 取字段值最小的 topPct%，desc 取最大的 topPct%；null/undefined 不参与排名。
 */
function ruleSetFor(ctx: ScreenCtx, rule: FactorRule): Set<string> {
  const key = `${rule.field}|${rule.dir}|${rule.topPct}`
  let set = ctx.ruleRankMaps.get(key)
  if (!set) {
    const ranked = ctx.universe
      .map((s) => ({ code: s.code, v: ruleValueOf(s, rule.field) }))
      .filter((x): x is { code: string; v: number } => x.v !== null)
      .sort((a, b) => (rule.dir === 'asc' ? a.v - b.v : b.v - a.v))
    const count = Math.ceil((ranked.length * rule.topPct) / 100)
    set = new Set(ranked.slice(0, count).map((x) => x.code))
    ctx.ruleRankMaps.set(key, set)
  }
  return set
}

function matchCondition(s: UniverseStock, c: StrategyCondition, ctx: ScreenCtx): boolean {
  const range = Array.isArray(c.value) ? (c.value as [number, number]) : null
  switch (c.field) {
    case 'pe':
      if (range) return s.pe > range[0] && s.pe < range[1]
      return s.pe > 0 && (c.op === '<' ? s.pe < Number(c.value) : s.pe > Number(c.value))
    case 'pb':
      return c.op === '<' ? s.pb < Number(c.value) : s.pb > Number(c.value)
    case 'mktCap':
      if (range) return s.mktCap > range[0] && s.mktCap < range[1]
      return c.op === '>' ? s.mktCap > Number(c.value) : s.mktCap < Number(c.value)
    case 'turnover':
      return c.op === '>' ? s.turnover > Number(c.value) : s.turnover < Number(c.value)
    case 'aiScore':
      return s.aiScore > Number(c.value)
    case 'exclude_st':
      return !s.name.includes('ST')
    case 'exclude_subnew':
      return listedDays(s) >= 365 // 上市不满一年剔除
    case 'list_years':
      return listedDays(s) >= Number(c.value) * 365
    case 'ocf_4q': {
      // 连续四个单季度经营现金流净额均为正（数据不足四季视为不满足）
      if (!s.cashflow || s.cashflow.length < 4) return false
      return s.cashflow.slice(0, 4).every((q) => q.value > 0)
    }
    case 'above_ma':
      // 近似口径：universe 预计算的「现价站上 20 日均线」
      return s.aboveMa20
    case 'mom_range': {
      const w = c.window ?? 20
      const m = momOf(s, w)
      return range ? m > range[0] && m < range[1] : true
    }
    case '__sort':
      return true // 排序指令，不参与过滤
    case 'mom_rank': {
      const w = c.window ?? 20
      const ranked = rankMapFor(ctx, w)
      const idx = ranked.get(s.code)
      return idx !== undefined && idx < Math.ceil((ranked.size * Number(c.value)) / 100)
    }
    default:
      return true
  }
}

/**
 * 筛选命中记录（V2 溯源扩展）：除 WatchItem 字段外携带命中的策略 ID 与
 * 因子实际字段值（供 CandidateSnapshot 溯源，不伪造得分）。
 */
export interface ScreenHit {
  code: string
  name: string
  reasons: string[]
  strategyIds: string[]
  factorScores: Record<string, number>
}

/**
 * 筛选引擎核心：策略/因子对象由调用方提供（V2 从 Run 快照还原，legacy 从 db 读取），
 * 引擎本身不读 db —— 保证「配置来源可追溯、db 后续变更不影响已冻结 Run」。
 */
export async function screeningCore(strategies: Strategy[], factors: Factor[]): Promise<ScreenHit[]> {
  const universe = await loadUniverse()
  const ctx: ScreenCtx = { universe, rankMaps: new Map(), ruleRankMaps: new Map() }
  const items: ScreenHit[] = []
  for (const s of universe) {
    const hitBy: string[] = []
    const hitStrategyIds: string[] = []
    let allPass = strategies.length > 0
    for (const st of strategies) {
      if (st.conditions.some((c) => !matchCondition(s, c, ctx))) {
        allPass = false
        break
      }
      for (const c of st.conditions) {
        if (c.field === '__sort') continue // 排序指令不写进入选原因
        hitBy.push(`策略「${st.name}」：${c.raw}`)
      }
      hitStrategyIds.push(st.id)
    }
    if (!allPass) continue
    // 带 rule 的因子是真正的过滤条件（AND 语义）：股票必须落在该因子
    // 字段的全市场截面最优 topPct% 内；字段为 null/undefined 视为不满足
    let rulePass = true
    const factorScores: Record<string, number> = {}
    for (const f of factors) {
      if (!f.rule) continue
      if (!ruleSetFor(ctx, f.rule).has(s.code)) {
        rulePass = false
        break
      }
      const v = ruleValueOf(s, f.rule.field)
      hitBy.push(
        `因子「${f.name}」：${f.rule.field}=${v === null ? '-' : Number(v.toFixed(2))}（截面前${f.rule.topPct}%）`,
      )
      if (v !== null) factorScores[f.id] = v
    }
    if (!rulePass) continue
    // 因子贡献：动量/低波等作为加分项写进入选原因（无 rule 的旧因子保持原行为）
    for (const f of factors) {
      if (f.rule) continue // 带 rule 的因子已在上方作为过滤条件处理
      if (f.category === '动量' && s.mom20 > 3) hitBy.push(`因子「${f.name}」：20 日动量 ${(s.mom20 ?? 0).toFixed(1)}%`)
      if (f.category === '价值' && s.pe > 0 && s.pe < 25) hitBy.push(`因子「${f.name}」：PE(TTM) ${s.pe} 倍`)
      if (f.category === '波动' && s.turnover < 2) hitBy.push(`因子「${f.name}」：低换手 ${s.turnover}%`)
      if (f.category === '资金流' && s.factors.includes('资金流')) hitBy.push(`因子「${f.name}」：资金面命中`)
      if (f.category === '量价' && s.turnover > 2) hitBy.push(`因子「${f.name}」：量能活跃`)
      if (f.category === '技术形态' && s.pos60 > 70) hitBy.push(`因子「${f.name}」：处于 60 日高位区`)
      if (f.category === '情绪' && s.changePct > 2) hitBy.push(`因子「${f.name}」：当日情绪强`)
      if (f.category === '规模' && s.mktCap < 500) hitBy.push(`因子「${f.name}」：中小市值`)
    }
    if (hitBy.length > 0) {
      items.push({ code: s.code, name: s.name, reasons: hitBy.slice(0, 4), strategyIds: hitStrategyIds, factorScores })
    }
  }
  // 排序指令：按换手率降序（以当日换手率快照为口径）
  const sortByTurnover = strategies.some((st) =>
    st.conditions.some((c) => c.field === '__sort' && c.value === 'turnover' && c.op === 'desc'),
  )
  if (sortByTurnover) {
    const turnoverOf = new Map(universe.map((x) => [x.code, x.turnover]))
    return items.sort((a, b) => (turnoverOf.get(b.code) ?? 0) - (turnoverOf.get(a.code) ?? 0))
  }
  return items.sort((a, b) => b.reasons.length - a.reasons.length)
}

/** legacy 路径：策略/因子 ID → db 读取 → WatchItem 列表（行为不变） */
export async function runScreening(strategyIds: string[], factorIds: string[]): Promise<WatchItem[]> {
  await delay(900)
  const db = getDB()
  const strategies = db.strategies.filter((s) => strategyIds.includes(s.id) && s.enabled)
  const factors = db.factors.filter((f) => factorIds.includes(f.id))
  const hits = await screeningCore(strategies, factors)
  return hits.map((h) => ({ code: h.code, name: h.name, reasons: h.reasons }))
}

/**
 * V2 路径：策略/因子对象来自 Run 快照（禁止从 db 重新拼装），
 * 产出 CandidateStock 列表（含命中策略 ID 与因子实际值溯源）。
 */
export async function runScreeningForRun(strategies: Strategy[], factors: Factor[]): Promise<CandidateStock[]> {
  await delay(300)
  const hits = await screeningCore(strategies, factors)
  const marketDataTimestamp = new Date().toISOString()
  return hits.map((h, i) => ({
    stockCode: h.code,
    stockName: h.name,
    rank: i + 1,
    included: true,
    strategyMatches: h.strategyIds,
    factorScores: h.factorScores,
    compositeScore: h.reasons.length, // 命中原因数（真实统计量，非伪造得分）
    inclusionReasons: h.reasons,
    marketDataTimestamp,
  }))
}

// ── 回测（真实引擎：前复权日K，等权组合，按调仓频率再平衡）──────
// 口径说明：选股池由当前快照的策略筛选确定（成分固定），回测期内的价格
// 走势全部来自真实前复权日线；基准为沪深300。基本面条件无历史序列，
// 因此结果反映的是"当前入选组合"的历史表现，非严格 point-in-time 模拟。

const BENCH_CODE = 'sh000300'
const POOL_SIZE = 25

function toMap(rows: { date: string; close: number }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.date, r.close]))
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  // legacy 路径：股票池来自 db 当前策略 × 因子组合（前 25 只等权）
  const items = await runScreening(config.strategyIds, config.factorIds)
  return runBacktestWithPool(config, items.slice(0, POOL_SIZE))
}

/**
 * V2 路径：股票池/策略/因子全部来自 Run 快照还原的对象，引擎不读 db。
 * 回测区间等执行参数由调用方（BacktestPage 从 Run 派生）传入。
 */
export async function runBacktestForRun(
  config: BacktestConfig,
  strategies: Strategy[],
  factors: Factor[],
): Promise<BacktestResult> {
  const hits = await screeningCore(strategies, factors)
  const pool = hits.slice(0, POOL_SIZE).map((h) => ({ code: h.code, name: h.name, reasons: h.reasons }))
  return runBacktestWithPool(config, pool)
}

/** 回测引擎主体：给定股票池与执行配置，逐期滚动计算（两路径共用） */
async function runBacktestWithPool(config: BacktestConfig, pool: WatchItem[]): Promise<BacktestResult> {
  if (pool.length === 0) throw new Error('当前策略组合在全市场未筛出股票，无法回测，请放宽条件')

  // 2. 加载真实 K 线与基准
  const [klineList, indices] = await Promise.all([
    Promise.all(pool.map((p) => loadKline(p.code).catch(() => null))),
    loadIndices(),
  ])
  const benchRows = (indices.series.find((s) => s.code === BENCH_CODE) ?? indices.series[0])?.series ?? []
  if (benchRows.length === 0) throw new Error('基准指数数据缺失，无法回测')
  const benchMap = toMap(benchRows.map((r) => ({ date: r.date, close: r.close })))

  // 3. 回测区间内的交易日序列（以基准为准）
  const days = benchRows
    .map((r) => r.date)
    .filter((d) => d >= config.startDate && d <= config.endDate)
    .sort()
  if (days.length < 20) throw new Error('回测区间内的交易日不足（<20），请调整起止日期')

  // 每只股票：日期→收盘价（停牌日沿用前一收盘价）
  const stockSeries = pool.map((p, i) => {
    const kl = klineList[i]
    const m = kl ? toMap(kl.dates.map((d, j) => ({ date: d, close: kl.closes[j] }))) : new Map<string, number>()
    return { name: p.name, map: m, last: 0 }
  })
  const valid = stockSeries.filter((s) => s.map.size > 0)
  if (valid.length === 0) throw new Error('股票池 K 线数据缺失，无法回测')

  // 4. 调仓日：区间首日 + 此后每月/每周首个交易日
  const isRebalance = (idx: number): boolean => {
    if (idx === 0) return true
    const prev = days[idx - 1]
    const cur = days[idx]
    if (config.rebalance === 'monthly') return cur.slice(0, 7) !== prev.slice(0, 7)
    // weekly：周一所在周变化
    const weekOf = (d: string) => {
      const dt = new Date(`${d}T00:00:00`)
      const dow = dt.getDay() || 7
      dt.setDate(dt.getDate() - dow + 1)
      return dt.toISOString().slice(0, 10)
    }
    return weekOf(cur) !== weekOf(prev)
  }

  // 5. 逐日净值：份额法等权组合，调仓日再平衡回等权
  const n = valid.length
  const nav: number[] = []
  const benchNav: number[] = []
  const lastPx: number[] = new Array(n).fill(0)
  const shares: number[] = new Array(n).fill(0)
  let navValue = 1
  let turnoverSum = 0
  const rebalanceIdx: number[] = []

  // 首日建仓：有价格的股票等权
  for (let j = 0; j < n; j++) lastPx[j] = valid[j].map.get(days[0]) ?? 0
  let active = lastPx.filter((p) => p > 0).length
  if (active === 0) throw new Error('回测首日股票池无可用价格')
  for (let j = 0; j < n; j++) if (lastPx[j] > 0) shares[j] = navValue / active / lastPx[j]

  const bench0 = benchMap.get(days[0]) ?? 1
  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    for (let j = 0; j < n; j++) {
      const px = valid[j].map.get(d)
      if (px !== undefined) lastPx[j] = px // 停牌日沿用前一收盘价
    }
    navValue = 0
    for (let j = 0; j < n; j++) navValue += shares[j] * lastPx[j]
    nav.push(navValue)
    benchNav.push((benchMap.get(d) ?? benchMap.get(days[i - 1]) ?? bench0) / bench0)

    if (isRebalance(i) && i > 0 && navValue > 0) {
      // 单边换手率：Σ |漂移后权重 − 目标等权|
      let t = 0
      active = lastPx.filter((p) => p > 0).length
      for (let j = 0; j < n; j++) {
        if (lastPx[j] <= 0) continue
        t += Math.abs((shares[j] * lastPx[j]) / navValue - 1 / active)
      }
      turnoverSum += t
      rebalanceIdx.push(i)
      for (let j = 0; j < n; j++) {
        shares[j] = lastPx[j] > 0 ? navValue / active / lastPx[j] : 0
      }
    }
  }

  // 6. 指标
  const totalReturn = (nav[nav.length - 1] - 1) * 100
  const years = days.length / 252
  const annualReturn = years > 0 ? (Math.pow(nav[nav.length - 1], 1 / years) - 1) * 100 : totalReturn
  let peak = nav[0]
  let maxDd = 0
  for (const v of nav) {
    peak = Math.max(peak, v)
    maxDd = Math.min(maxDd, (v / peak - 1) * 100)
  }
  const rets = nav.slice(1).map((v, i) => v / nav[i] - 1)
  const mean = rets.reduce((s, x) => s + x, 0) / Math.max(rets.length, 1)
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length, 1))
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0
  // 胜率：各调仓期内组合收益跑赢基准收益的期数占比
  const periodBounds = [0, ...rebalanceIdx, days.length - 1]
  let wins = 0
  let periodsCount = 0
  for (let k = 0; k + 1 < periodBounds.length; k++) {
    const a = periodBounds[k]
    const b = periodBounds[k + 1]
    if (b <= a) continue
    periodsCount++
    if (nav[b] / nav[a] > benchNav[b] / benchNav[a]) wins++
  }
  const winRate = periodsCount > 0 ? (wins / periodsCount) * 100 : 0
  const annualTurnover = years > 0 ? (turnoverSum / years) * 100 : turnoverSum * 100

  // 7. 曲线（按月取样，与页面既有形态一致）
  const curve: BacktestResult['curve'] = []
  let lastMonth = ''
  for (let i = 0; i < days.length; i++) {
    const m = days[i].slice(0, 7)
    if (m !== lastMonth) {
      curve.push({ date: m, strategy: Number(nav[i].toFixed(4)), benchmark: Number(benchNav[i].toFixed(4)) })
      lastMonth = m
    }
  }
  curve.push({
    date: days[days.length - 1].slice(0, 7),
    strategy: Number(nav[nav.length - 1].toFixed(4)),
    benchmark: Number(benchNav[benchNav.length - 1].toFixed(4)),
  })

  const periods: BacktestResult['periods'] = rebalanceIdx.slice(0, 12).map((idx, k) => ({
    period: `${days[idx].slice(0, 7)} 第${k + 1}期`,
    picks: pool.map((p) => p.name).slice(0, 8),
  }))

  return {
    id: uid(),
    config,
    credibility: 'simulation',
    metrics: {
      totalReturn: Number(totalReturn.toFixed(1)),
      annualReturn: Number(annualReturn.toFixed(1)),
      maxDrawdown: Number(maxDd.toFixed(1)),
      sharpe: Number(sharpe.toFixed(2)),
      winRate: Number(winRate.toFixed(1)),
      turnover: Number(annualTurnover.toFixed(0)),
    },
    curve,
    periods,
    createdAt: new Date().toISOString(),
  }
}

// ── 持仓诊股（技术分析辅助判断，非量化信号）────────────────────

function momFromSeries(ser: number[], n: number): number {
  if (ser.length < 2) return 0
  const back = Math.min(n, ser.length - 1) // 窗口超出可用序列时按实际可用长度计算
  return (ser[ser.length - 1] / ser[ser.length - 1 - back] - 1) * 100
}

/**
 * 量化因子信号：对因子库中每个带 rule 的因子（按 field 去重），
 * 计算该股字段值在全市场截面百分位（0-100，% 数值 = 全市场优于该股的比例，
 * 越小越好，asc/desc 均已归一）；落入选区（前 topPct%）出强信号，
 * topPct+10% 以内出「接近入选区间」弱信号。最多 6 条，按百分位优劣排序。
 */
function factorSignalsFor(universe: UniverseStock[], s: UniverseStock): string[] {
  const db = getDB()
  const seen = new Set<string>()
  const rules: { name: string; rule: FactorRule }[] = []
  for (const f of db.factors) {
    if (!f.rule || seen.has(f.rule.field)) continue
    seen.add(f.rule.field)
    rules.push({ name: f.name, rule: f.rule })
  }
  const out: { pct: number; text: string }[] = []
  for (const { name, rule } of rules) {
    const v = ruleValueOf(s, rule.field)
    if (v === null) continue // 字段缺失（如 roe 为 null）跳过
    let better = 0
    let n = 0
    for (const x of universe) {
      const xv = ruleValueOf(x, rule.field)
      if (xv === null) continue
      n++
      if (rule.dir === 'asc' ? xv < v : xv > v) better++
    }
    if (n < 10) continue
    const pct = (better / n) * 100
    if (pct <= rule.topPct) {
      out.push({
        pct,
        text: `${name}：${rule.field}=${Number(v.toFixed(2))}，位于全市场前 ${Math.max(Math.round(pct), 1)}%（入选区间）`,
      })
    } else if (pct <= rule.topPct + 10) {
      out.push({
        pct,
        text: `${name}：${rule.field}=${Number(v.toFixed(2))}，位于全市场前 ${Math.round(pct)}%（接近入选区间）`,
      })
    }
  }
  return out
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6)
    .map((x) => x.text)
}

export async function diagnoseHolding(code: string): Promise<HoldingDiagnosis> {
  await delay(800)
  const universe = await loadUniverse()
  const s = universe.find((x) => x.code === code)
  if (!s) {
    return {
      advice: '等待观察',
      reasons: ['全 A 股票池之外的股票，暂无足够行情数据，建议观察。'],
      keyLevels: { support: 0, resistance: 0 },
      updatedAt: new Date().toISOString(),
    }
  }
  const factorSignals = factorSignalsFor(universe, s)
  const kline = await loadKline(code)
  const ser = kline.closes
  if (ser.length === 0) {
    return {
      advice: '等待观察',
      reasons: [`${s.name} 暂无日线行情数据，建议观察。`],
      keyLevels: { support: 0, resistance: 0 },
      factorSignals,
      updatedAt: new Date().toISOString(),
    }
  }
  const win = ser.slice(-20)
  const support = Math.min(...win)
  const resistance = Math.max(...win)
  const last = ser[ser.length - 1]
  const pos = ((last - support) / (resistance - support || 1)) * 100
  const mom20 = momFromSeries(ser, 20)
  let advice: DiagnosisAdvice
  const reasons: string[] = []
  if (mom20 > 3 && pos > 40) {
    advice = '继续持有'
    reasons.push(`近 20 日动量 ${mom20.toFixed(1)}%，多头结构保持完好`)
    reasons.push(`现价处于 20 日区间 ${pos.toFixed(0)}% 分位，未跌破上升通道`)
  } else if (mom20 < -3 || pos < 25) {
    advice = '卖出'
    reasons.push(`近 20 日动量 ${mom20.toFixed(1)}%，空头排列`)
    reasons.push(`现价逼近 20 日区间下沿（${pos.toFixed(0)}% 分位），破位风险加大`)
  } else {
    advice = '等待观察'
    reasons.push(`动量 ${mom20.toFixed(1)}%，方向不明，多空胶着`)
    reasons.push(`关注 ${support.toFixed(2)} 支撑与 ${resistance.toFixed(2)} 阻力的突破方向`)
  }
  reasons.push(`关键位置：支撑 ${support.toFixed(2)} / 阻力 ${resistance.toFixed(2)}`)
  return { advice, reasons, keyLevels: { support, resistance }, factorSignals, updatedAt: new Date().toISOString() }
}

// ── 缠论分析（缠中说禅技术体系，引擎见 src/lib/chan.ts）─────────

/**
 * 对最近 500 根日K运行缠论分析。
 * K线数据升级中（缺 OHLC）或数据不足时返回 null，不抛错——前端显示友好提示即可。
 */
export async function analyzeChan(code: string): Promise<ChanAnalysis | null> {
  await delay(600)
  try {
    const kline = await loadKline(code)
    const r = runChanAnalysis(kline)
    if (!r) return null
    return { ...r, updatedAt: new Date().toISOString() }
  } catch {
    return null
  }
}

// ── 每日研报（汇总前七页的每日快照）───────────────────────────

export async function generateReport(date: string): Promise<DailyReport> {
  await delay(1200)
  const db = getDB()
  const [indicesData, universe, meta] = await Promise.all([loadIndices(), loadUniverse(), loadMeta()])
  const idxText = indicesData.indices
    .map((i) => `${i.name} ${i.changePct >= 0 ? '涨' : '跌'} ${Math.abs(i.changePct)}%`)
    .join('，')
  const top = [...universe].sort((a, b) => b.aiScore - a.aiScore).slice(0, 5)
  return {
    id: uid(),
    date,
    marketSummary: `今日主要指数：${idxText}。全市场上涨 ${meta.upCount.toLocaleString('zh-CN')} 家、下跌 ${meta.downCount.toLocaleString('zh-CN')} 家，两市成交额约 ${meta.turnoverYi.toLocaleString('zh-CN')} 亿元。`,
    signalChanges: {
      added: top.slice(0, 2).map((s) => `${s.name}（模型评分 ${s.aiScore}，新晋榜单前列）`),
      removed: ['全 A 股票池今日无剔除'],
      note: '信号变化基于最新行情快照与启用策略的重新计算。',
    },
    recommendations: top.map((s) => ({
      code: s.code,
      name: s.name,
      logic: `命中因子：${s.factors.join('、') || '综合评分'}；AI 评分 ${s.aiScore}，信号「${s.signal}」。`,
    })),
    holdingNotes:
      db.holdings.length === 0
        ? ['尚未录入持仓，可前往「持仓诊股」添加。']
        : db.holdings.map((h) =>
            h.diagnosis
              ? `${h.name}：${h.diagnosis.advice}（${h.diagnosis.reasons[0]}）`
              : `${h.name}：尚未诊断`,
          ),
    risks: [
      '本系统评分与信号为演示模型输出，不构成投资建议。',
      '市场波动加大时注意仓位管理，严格执行止损纪律。',
    ],
  }
}
