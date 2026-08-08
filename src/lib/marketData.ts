// ─────────────────────────────────────────────────────────────
// 全 A 股静态行情数据加载层（public/data/ 下的 JSON 文件，由独立脚本生成）
// 模块级缓存 Promise 本身：重复调用不会重复 fetch
// ─────────────────────────────────────────────────────────────
import type { Signal, Stock } from './mockData'

/** universe.json 中的个股汇总（全 A 股，约 5200 只） */
export interface UniverseStock {
  code: string // 6位代码.交易所，如 600519.SH
  name: string
  industry: string
  price: number
  changePct: number // 当日涨跌幅 %
  aiScore: number // 0-100
  signal: Signal // 强烈买入 | 买入 | 持有 | 观望
  factors: string[] // 命中因子，最多 3 个
  winRate: number // 35-80
  mktCap: number // 总市值（亿元）
  pe: number
  pb: number
  turnover: number // 换手率 %
  listDate: string // yyyy-MM-dd
  pos60: number // 0-100，近 60 日价格位置
  mom20: number // 近 20 日涨幅 %
  mom60: number // 近 60 日涨幅 %
  aboveMa20: boolean // 现价是否站上 20 日均线
  vol20: number // 20 日年化收益波动率 %（低波因子，值小好）
  vol60: number // 60 日年化收益波动率 %（值小好）
  cpv20: number // 20 日收盘价与成交量相关系数（量价背离，值小好）
  cpv10: number // 10 日收盘价与成交量相关系数（CPV 短窗口变体，值小好）
  vcv20: number // 20 日成交量变异系数（量能稳定性，值小好）
  vcv60: number // 60 日量能稳定度（值小好）
  vr2060: number // 量能比 20/60（值小好）
  bias60: number // 60 日乖离率 %（值小好）
  park20: number // Parkinson 波动率（值小好）
  bigup20: number // 近 20 日涨幅 >5% 的天数（值小好）
  kurt20: number // 收益超额峰度（值小好）
  mlScore?: number // ML 合成信号分（0-100，由 ml-scores.json 合并注入，可能缺失）
  ret5: number // 5 日涨幅 %（短期反转，值小好）
  sharpe20: number // 20 日年化收益/波动（动量质量，值大好）
  maxdd60: number // 60 日最大回撤 %（值小好）
  roe: number | null // 最新一期加权 ROE %（值大好，可能缺失）
  radar: number[] // 6 维 0-100
  cashflow: { period: string; value: number }[] // 最多 4 个单季度经营现金流净额（亿元）
}

/** kline/<code>.json：近 500 个交易日前复权日线（平行数组）。
 *  数据正在升级为 OHLC 格式：旧缓存可能只有 closes/vols，
 *  opens/highs/lows 为可选字段，消费方必须优雅处理缺失。 */
export interface KlineData {
  dates: string[]
  closes: number[]
  vols: number[]
  opens?: number[]
  highs?: number[]
  lows?: number[]
}

export interface IndexQuoteData {
  name: string
  value: number
  changePct: number
}

export interface IndexBar {
  date: string
  close: number
  vol: number
}

export interface IndexSeriesData {
  code: string
  name: string
  series: IndexBar[]
}

export interface IndicesData {
  indices: IndexQuoteData[]
  series: IndexSeriesData[]
}

export interface MarketMeta {
  source: string
  fetchedAt: string // ISO 时间
  stockCount: number
  klineDays: number
  upCount: number // 上涨家数
  downCount: number // 下跌家数
  turnoverYi: number // 两市成交额（亿元）
}

/** factor-research.json：单个 IC 统计块（ML 合成等条目的部分指标可为 null） */
export interface FactorICStat {
  mean: number | null
  ir: number | null
  tstat: number | null
  posRatio: number | null
  dates: number
}

/** factor-research.json：单字段（因子）实测结果 */
export interface FactorResearchResult {
  name: string
  dir: 'asc' | 'desc'
  kind: 'core' | 'candidate' | 'composite' // composite = ML 合成信号（field = mlScore）
  ic5: FactorICStat | null
  ic10: FactorICStat | null
  ic20: FactorICStat | null
  ic40: FactorICStat | null
  dic20: number // 方向化 IC20 均值（正 = 符合因子预期方向）
  dicir20: number // 方向化 IC20 IR
  spread20: number | null // 按方向的 top30%-bottom30% 多空 20 日利差 %
  spreadPosRatio: number | null
}

/** factor-research.json：每周自研实测产出（加载失败返回 null） */
export interface FactorResearch {
  updatedAt: string
  method: string
  window: { evalDates: number; stocks: number }
  results: Record<string, FactorResearchResult>
  history: { date: string; stocks: number; summary: string }[]
}

/** ml-scores.json：ML 合成信号产出（加载失败返回 null） */
export interface MlScores {
  updatedAt: string
  model: string
  method: string
  features: { field: string; name: string; absIcir: number }[]
  oos: { ic: number; icir: number; folds: Record<string, unknown>[] }
  trainRows: number
  scores: Record<string, number> // code → 0-100 分
  topPicks: { code: string; name: string; score: number }[]
  pitMode?: boolean // 时点正确口径（含退市股+历史 ST，PIT_MODE=1 产物）
}

/** ml-backtest.json：ML 信号样本外回测净值点 */
export interface MlBacktestCurvePoint {
  date: string
  port: number // 组合净值
  bench: number // 基准净值（沪深300）
  ret: number // 当期组合收益
}

/** ml-backtest.json：ML 信号样本外回测（加载失败返回 null） */
export interface MlBacktest {
  updatedAt: string
  method: string
  params: Record<string, number | string>
  metrics: {
    periods: number
    spanMonths: number
    totalReturn: number // 区间组合收益 %
    benchReturn: number // 区间基准收益 %
    annReturn: number
    annBench: number
    annExcess: number // 年化超额 %
    maxDrawdown: number // 最大回撤 %
    sharpe: number
    winRateVsBench: number // 周度跑赢基准胜率 %
    avgTurnover: number // 平均换手 %
    oosIc: number // 样本外 IC
    decileSpreadAnn: number // 年化十分组多空利差 %
    pitMode?: boolean // 时点正确口径（含退市股+历史 ST，PIT_MODE=1 产物）
  }
  curve: MlBacktestCurvePoint[]
}

/** factors-collected.json：每周联网收集的公开因子（加载失败返回空数组） */
export interface CollectedFactor {
  id: string
  name: string
  category: string
  origin: string
  sourceUrl?: string
  definition: string
  applicable: string
  notes: string
  performance?: string
  rule?: { field: string; dir: 'asc' | 'desc'; topPct: number }
}

const BASE = import.meta.env.BASE_URL

async function fetchJson<T>(path: string, label: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`)
  } catch {
    throw new Error(`${label}加载失败：网络请求异常，请检查网络后重试。`)
  }
  if (!res.ok) {
    throw new Error(`${label}加载失败（HTTP ${res.status}），数据文件可能尚未生成或部署。`)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new Error(`${label}加载失败：文件内容不是合法的 JSON。`)
  }
}

// ── 模块级缓存（缓存 Promise 本身，重复调用不重复 fetch）─────────
let universeCache: Promise<UniverseStock[]> | null = null
let indicesCache: Promise<IndicesData> | null = null
let metaCache: Promise<MarketMeta> | null = null
let mlScoresCache: Promise<MlScores | null> | null = null
let mlBacktestCache: Promise<MlBacktest | null> | null = null
const klineCache = new Map<string, Promise<KlineData>>()

/** ML 合成信号（PIT 时点正确口径优先，标准版兜底）；文件缺失或损坏时返回 null 而不抛错 */
export function loadMlScores(): Promise<MlScores | null> {
  mlScoresCache ??= fetchJson<MlScores>('data/ml-scores-pit.json', 'ML 合成信号（PIT）')
    .catch(() => fetchJson<MlScores>('data/ml-scores.json', 'ML 合成信号（ml-scores.json）'))
    .catch(() => null)
  return mlScoresCache
}

/** ML 信号样本外回测（PIT 时点正确口径优先，标准版兜底）；文件缺失或损坏时返回 null 而不抛错 */
export function loadMlBacktest(): Promise<MlBacktest | null> {
  mlBacktestCache ??= fetchJson<MlBacktest>('data/ml-backtest-pit.json', 'ML 信号回测（PIT）')
    .catch(() => fetchJson<MlBacktest>('data/ml-backtest.json', 'ML 信号回测（ml-backtest.json）'))
    .catch(() => null)
  return mlBacktestCache
}

/** 全 A 股股票汇总（约 5200 只）；加载后自动合并 ML 合成分为 mlScore 字段（无分数则不设） */
export function loadUniverse(): Promise<UniverseStock[]> {
  universeCache ??= fetchJson<UniverseStock[]>('data/universe.json', '股票池数据（universe.json）').then(
    async (stocks) => {
      const ml = await loadMlScores()
      if (!ml) return stocks
      for (const s of stocks) {
        const v = ml.scores[s.code]
        if (typeof v === 'number') s.mlScore = v
      }
      return stocks
    },
  )
  return universeCache
}

/** 个股近 500 个交易日前复权日线 */
export function loadKline(code: string): Promise<KlineData> {
  let p = klineCache.get(code)
  if (!p) {
    p = fetchJson<KlineData>(`data/kline/${code}.json`, `个股 ${code} 日线数据`)
    klineCache.set(code, p)
  }
  return p
}

/** 六大指数快照与历史走势序列 */
export function loadIndices(): Promise<IndicesData> {
  indicesCache ??= fetchJson<IndicesData>('data/indices.json', '指数数据（indices.json）')
  return indicesCache
}

/** 数据快照元信息（数据源、抓取时间、涨跌家数、成交额等） */
export function loadMeta(): Promise<MarketMeta> {
  metaCache ??= fetchJson<MarketMeta>('data/meta.json', '数据元信息（meta.json）')
  return metaCache
}

/** 实时拉通完成后调用：使快照类缓存失效，下次 load 重新 fetch（K 线不受影响） */
export function invalidateMarketCaches(): void {
  universeCache = null
  indicesCache = null
  metaCache = null
  mlScoresCache = null
}

// ── 因子实验室数据（每周脚本产出，缺失/失败时不阻塞页面）──────────
let factorResearchCache: Promise<FactorResearch | null> | null = null
let collectedFactorsCache: Promise<CollectedFactor[]> | null = null

/** 每周自研实测产出（factor-research.json）；文件缺失或损坏时返回 null 而不抛错 */
export function loadFactorResearch(): Promise<FactorResearch | null> {
  factorResearchCache ??= fetchJson<FactorResearch>(
    'data/factor-research.json',
    '因子实测数据（factor-research.json）',
  ).catch(() => null)
  return factorResearchCache
}

/** 每周联网收集的公开因子（factors-collected.json）；文件缺失或损坏时返回空数组而不抛错 */
export function loadCollectedFactors(): Promise<CollectedFactor[]> {
  collectedFactorsCache ??= fetchJson<{ updatedAt: string; factors: CollectedFactor[] }>(
    'data/factors-collected.json',
    '联网收集因子（factors-collected.json）',
  )
    .then((d) => d.factors)
    .catch(() => [])
  return collectedFactorsCache
}

// ── 适配层：universe.json → UI 侧消费的 Stock 形状 ─────────────

function buildAiText(u: UniverseStock): string {
  const mktCap = u.mktCap != null ? `${u.mktCap.toLocaleString('zh-CN')} 亿` : '—'
  const pe = u.pe > 0 ? `${u.pe} 倍` : '—'
  const pb = u.pb > 0 ? `${u.pb} 倍` : '—'
  return (
    `${u.name} 最新价 ${u.price ?? '—'} 元，当日涨跌幅 ${u.changePct ?? 0}%。` +
    `近 20 日动量 ${u.mom20?.toFixed(1) ?? '—'}%，近 60 日动量 ${u.mom60?.toFixed(1) ?? '—'}%，` +
    `现价处于 60 日区间 ${u.pos60 ?? '—'}% 分位，现价${u.aboveMa20 ? '站上' : '跌破'} 20 日均线。` +
    `PE(TTM) ${pe}，PB ${pb}，总市值约 ${mktCap}。` +
    `演示模型综合评分 ${u.aiScore ?? '—'}/100，信号「${u.signal ?? '—'}」。`
  )
}

/**
 * 映射为页面组件使用的 Stock 类型（mockData.ts 中定义）。
 * 注意：series（日线序列）不在 universe.json 中，置空数组；
 * 需要 K 线的场景请使用 loadKline(code) 异步加载。
 */
export function universeToStock(u: UniverseStock): Stock {
  return {
    code: u.code,
    name: u.name,
    industry: u.industry,
    price: u.price,
    changePct: u.changePct,
    aiScore: u.aiScore,
    signal: u.signal,
    factors: u.factors,
    winRate: u.winRate,
    mktCap: u.mktCap,
    pe: u.pe,
    pb: u.pb,
    turnover: u.turnover,
    pos60: u.pos60,
    cashflow: u.cashflow,
    radar: u.radar,
    series: [],
    aiText: buildAiText(u),
  }
}
