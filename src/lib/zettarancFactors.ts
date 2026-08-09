// ─────────────────────────────────────────────────────────────
// Zettaranc 知行体系 因子引擎 v2.0
// 覆盖 20+ 战法：择时/选股/买点/卖点/持仓/风控/心法七层闭环
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface KlineData {
  dates: string[]
  opens: number[]
  closes: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
}

export interface ZettarancFactors {
  code: string
  date: string
  // ── ① 择时层 ──
  marketTimingSignal: number   // -1=熊市/0=震荡/1=牛市
  activeMarketCapChange: number // 活跃市值近5日变化率(%)
  whiteYellowCrossover: number  // -1=白线下穿黄线(空)/0=无/1=白线上穿黄线(多)
  // ── ② 选股层 ──
  anomalyScore: number         // 异动选股法评分 0-100
  isAnomaly: boolean           // 当日异动
  tripleBestScore: number      // 三最原则评分 0-100
  // ── ③ 买点层 ──
  kdjK: number
  kdjD: number
  kdjJ: number
  b1Score: number              // B1 建仓波评分 0-100
  isB1Signal: boolean
  superB1Score: number         // 超级 B1 评分(J<0+多周期共振)
  isSuperB1: boolean
  b2Score: number              // B2 突破评分
  isB2Signal: boolean
  b3Score: number              // B3 回踩买点评分
  isB3Signal: boolean
  sb1Score: number             // SB1 假摔评分
  isSB1Signal: boolean
  shuangqiangScore: number     // 双枪战法评分(量柱形态)
  isShuangqiang: boolean
  // ── ④ 卖点层 ──
  s1Score: number              // S1 卖出信号评分
  isS1Signal: boolean
  dszScore: number             // DSZ 死亡之星评分
  isDSZSignal: boolean
  deathKlineScore: number      // 十张死亡K线评分
  isDeathKline: boolean
  macdDivergence: number       // -1=顶背离 0=无 1=底背离
  kdjDivergence: number
  // ── ⑤ 持仓层 ──
  positionRankPct: number      // 持仓收益率排名百分位(0-100,越大越强)
  isWeakCut: boolean           // 去弱留强：是否在尾部 20%
  basePositionRatio: number    // 底仓建议比例(0-1)
  dynamicPositionRatio: number // 动态仓建议比例(0-1)
  // ── ⑥ 风控层 ──
  consecutiveLossDays: number  // 连续下跌天数
  maxDrawdown20: number        // 20日最大回撤(%)
  riskLevel: '低' | '中' | '高' | '极高'
  fourNoViolations: string[]   // 违反的"四不原则"
  // ── ⑦ 心法层 ──
  divergenceConsensus: number  // 分歧度(换手率标准差/均值)
  // ── 少妇/坑口(保留) ──
  shaofuScore: number
  isShaofuCandidate: boolean
  kengkouScore: number
  isKengkouCandidate: boolean
  // ── 量比/均线 ──
  volumeRatio: number
  volumeSurge: boolean
  volumeShrink: boolean
  ma5: number
  ma10: number
  ma20: number
  ma60: number
  maStickiness: number
  // ── 三波理论 ──
  wavePhase: number            // 0=无, 1=第一波, 2=第二波, 3=第三波
  waveRetraceRatio: number     // 当前回撤比例(%)
  // ── 综合评分 ──
  matchedStrategies: string[]
  zettarancScore: number
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function ema(values: number[], n: number): number[] {
  const result: number[] = []
  if (values.length === 0) return result
  const k = 2 / (n + 1)
  result.push(values[0])
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function sma(values: number[], n: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) { result.push(NaN); continue }
    const sum = values.slice(i - n + 1, i + 1).reduce((s, v) => s + v, 0)
    result.push(sum / n)
  }
  return result
}

function highest(values: number[], n: number, idx: number): number {
  if (idx < n - 1) return NaN
  return Math.max(...values.slice(idx - n + 1, idx + 1))
}

function lowest(values: number[], n: number, idx: number): number {
  if (idx < n - 1) return NaN
  return Math.min(...values.slice(idx - n + 1, idx + 1))
}

function std(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

// ═══════════════════════════════════════════════════════════════
// KDJ / MACD
// ═══════════════════════════════════════════════════════════════

function calcKDJ(kl: KlineData): { k: number[]; d: number[]; j: number[] } {
  const n = 9
  const k: number[] = [], d: number[] = [], j: number[] = []
  let prevK = 50, prevD = 50
  for (let i = 0; i < kl.closes.length; i++) {
    if (i < n - 1) { k.push(prevK); d.push(prevD); j.push(3 * prevK - 2 * prevD); continue }
    const wh = Math.max(...kl.highs.slice(i - n + 1, i + 1))
    const wl = Math.min(...kl.lows.slice(i - n + 1, i + 1))
    const rsv = wh === wl ? 50 : ((kl.closes[i] - wl) / (wh - wl)) * 100
    const curK = (2 * prevK + rsv) / 3
    const curD = (2 * prevD + curK) / 3
    const curJ = 3 * curK - 2 * curD
    k.push(curK); d.push(curD); j.push(curJ)
    prevK = curK; prevD = curD
  }
  return { k, d, j }
}

function calcMACD(kl: KlineData) {
  const ema12 = ema(kl.closes, 12)
  const ema26 = ema(kl.closes, 26)
  const dif = ema12.map((v, i) => v - ema26[i])
  const dea = ema(dif, 9)
  const macd = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, macd }
}

function detectDivergence(kl: KlineData, indicator: number[], lookback = 20): number {
  if (indicator.length < lookback * 2) return 0
  const last = indicator.length - 1
  // 底背离：价格新低但指标未新低
  if (kl.closes[last] < kl.closes[last - lookback] && indicator[last] > indicator[last - lookback]) return 1
  // 顶背离：价格新高但指标未新高
  if (kl.closes[last] > kl.closes[last - lookback] && indicator[last] < indicator[last - lookback]) return -1
  return 0
}

function calcMAStickiness(i: number, ma5: number[], ma10: number[], ma20: number[]): number {
  if (i < 20) return 100
  const values = [ma5[i], ma10[i], ma20[i]]
  const mean = values.reduce((s, v) => s + v, 0) / 3
  if (mean === 0) return 100
  const s = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / 3)
  return (s / Math.abs(mean)) * 100
}

// ═══════════════════════════════════════════════════════════════
// ① 择时层
// ═══════════════════════════════════════════════════════════════

/** 激活市值变化率（用全市场成交量变化率近似——市值需要外部数据） */
function calcActiveMarketCap(kl: KlineData, i: number): number {
  if (i < 20) return 0
  const vol5 = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
  const vol20 = kl.volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20
  if (vol20 === 0) return 0
  return ((vol5 / vol20) - 1) * 100
}

/** 白线黄线交叉 — 用短/长 EMA 模拟（需要市场指数实际调用时传入 indexData） */
function calcWhiteYellowCross(kl: KlineData, i: number): number {
  if (i < 60) return 0
  const shortEma = ema(kl.closes, 10)
  const longEma = ema(kl.closes, 36)
  // 当前交叉
  const curr = shortEma[i] > longEma[i] ? 1 : -1
  const prev = i > 0 ? (shortEma[i - 1] > longEma[i - 1] ? 1 : -1) : curr
  if (curr === 1 && prev === -1) return 1  // 金叉
  if (curr === -1 && prev === 1) return -1  // 死叉
  return curr // 维持
}

/** 市场择时总信号 */
function calcMarketTiming(i: number, kl: KlineData,
  ma5: number[], ma10: number[], ma20: number[], ma60: number[]): number {
  if (i < 60) return 0
  let score = 0
  // 均线多头排列
  if (ma5[i] > ma10[i] && ma10[i] > ma20[i] && ma20[i] > ma60[i]) score += 2
  // 价格在 MA60 上方
  if (kl.closes[i] > ma60[i]) score += 1
  // 短趋势向上
  if (i >= 5 && kl.closes[i] > kl.closes[i - 5]) score += 1
  // 长趋势向上
  if (i >= 20 && ma20[i] > (kl.closes.slice(i - 39, i + 1).reduce((a, b) => a + b, 0) / 40)) score += 1
  // 判断
  if (score >= 4) return 1
  if (score <= 1) return -1
  return 0
}

// ═══════════════════════════════════════════════════════════════
// ② 选股层
// ═══════════════════════════════════════════════════════════════

/** 异动选股法：涨>5%+量比>2+非涨停 */
function calcAnomaly(i: number, kl: KlineData): { score: number; isAnomaly: boolean } {
  if (i < 5) return { score: 0, isAnomaly: false }
  let score = 0
  // 当日涨幅
  const chg = ((kl.closes[i] / kl.closes[i - 1]) - 1) * 100
  if (chg > 9.5) score += 0   // 涨停不算异动(已封板)
  else if (chg > 7) score += 40
  else if (chg > 5) score += 30
  else if (chg > 3) score += 15
  else return { score: 0, isAnomaly: false }
  // 量比
  const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
  const vRatio = kl.volumes[i] / (avgVol || 1)
  if (vRatio > 3) score += 40
  else if (vRatio > 2) score += 25
  else if (vRatio > 1.5) score += 10
  else score -= 20
  // 非 ST/次新 由外部过滤
  const isAnomaly = score >= 45
  return { score: Math.max(0, Math.min(100, score + 10)), isAnomaly }
}

/** 三最原则：只选最美(多头排列)/只买最强(动量)/只拿最硬(低回撤) */
function calcTripleBest(i: number, kl: KlineData,
  ma5: number[], ma10: number[], ma20: number[], ma60: number[]): number {
  if (i < 60) return 0
  let score = 0
  // 最美：均线多头排列
  if (ma5[i] > ma10[i] && ma10[i] > ma20[i] && ma20[i] > ma60[i]) score += 40
  else if (kl.closes[i] > ma20[i]) score += 15
  // 最强：短期动量
  if (i >= 10) {
    const mom10 = ((kl.closes[i] / kl.closes[i - 10]) - 1) * 100
    if (mom10 > 15) score += 30
    else if (mom10 > 5) score += 15
    else if (mom10 < -5) score -= 15
  }
  // 最硬：低回撤
  if (i >= 20) {
    const h20 = Math.max(...kl.highs.slice(i - 19, i + 1))
    const dd = ((h20 / kl.closes[i]) - 1) * 100
    if (dd < 5) score += 30
    else if (dd < 10) score += 15
    else score -= 20
  }
  return Math.max(0, Math.min(100, score))
}

// ═══════════════════════════════════════════════════════════════
// ③ 买点层
// ═══════════════════════════════════════════════════════════════

/** B1 建仓波：J<13 + 跌幅 + 缩量 */
function calcB1(i: number, kdjJ: number[], kl: KlineData, ma5: number[], ma20: number[]): { score: number; isSignal: boolean } {
  if (i < 20) return { score: 0, isSignal: false }
  let score = 0
  // J值
  if (kdjJ[i] < 0) score += 60
  else if (kdjJ[i] < 13) score += 50
  else if (kdjJ[i] < 20) score += 30
  else if (kdjJ[i] > 80) score -= 40
  // 近期跌幅(5日)
  if (i >= 5) {
    const d5 = ((kl.closes[i] / kl.closes[i - 5]) - 1) * 100
    if (d5 < -10) score += 20
    else if (d5 < -5) score += 10
    else if (d5 > 10) score -= 20
  }
  // 缩量
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const vr = kl.volumes[i] / (avgVol || 1)
    if (vr < 0.5) score += 15
    else if (vr > 3) score -= 15
  }
  // 价格位置
  if (kl.closes[i] < ma20[i]) score += 10
  if (kl.closes[i] < ma5[i]) score += 5
  const isSignal = kdjJ[i] < 13 && score >= 40
  return { score: Math.max(0, Math.min(100, score + 30)), isSignal }
}

/** 超级 B1：J<0 + 周线/月线共振 + 多周期低位 */
function calcSuperB1(i: number, kdjJ: number[], kl: KlineData): { score: number; isSignal: boolean } {
  if (i < 60) return { score: 0, isSignal: false }
  let score = 0
  // J<0 是前提
  if (kdjJ[i] >= 0) return { score: 0, isSignal: false }
  score += 50
  // 周线级别低位(近似：40日最低点附近)
  const low40 = Math.min(...kl.lows.slice(i - 39, i + 1))
  if ((kl.closes[i] / low40 - 1) * 100 < 10) score += 30
  // 月线级别低位(近似：60日)
  if (i >= 60) {
    const low60 = Math.min(...kl.lows.slice(i - 59, i + 1))
    if ((kl.closes[i] / low60 - 1) * 100 < 15) score += 20
  }
  const isSignal = score >= 80
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** B2 突破：突破30日高点 + 量能配合 */
function calcB2(i: number, kl: KlineData): { score: number; isSignal: boolean } {
  if (i < 30) return { score: 0, isSignal: false }
  let score = 0
  // 突破30日高点
  const h30 = Math.max(...kl.highs.slice(i - 30, i - 1)) // 前30日(不含今天)
  const breakPct = ((kl.closes[i] / h30) - 1) * 100
  if (breakPct > 3) score += 50
  else if (breakPct > 0) score += 30
  else return { score: 0, isSignal: false }
  // 量能配合
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const vr = kl.volumes[i] / (avgVol || 1)
    if (vr > 2) score += 30
    else if (vr > 1.5) score += 15
    else score -= 10
  }
  // 前20日累计涨幅不过大(不是追高)
  if (i >= 20) {
    const m20 = ((kl.closes[i] / kl.closes[i - 20]) - 1) * 100
    if (m20 > 40) score -= 20
    else if (m20 < 0) score += 10
  }
  const isSignal = score >= 60
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** B3 买点：回踩均线 + 缩量企稳 + 拒绝下跌 */
function calcB3(i: number, kl: KlineData, ma5: number[], ma20: number[]): { score: number; isSignal: boolean } {
  if (i < 20) return { score: 0, isSignal: false }
  let score = 0
  // 回踩MA20附近
  const dist20 = ((kl.closes[i] / ma20[i]) - 1) * 100
  if (Math.abs(dist20) < 3) score += 30
  else if (dist20 < 5 && dist20 > -5) score += 15
  else return { score: 0, isSignal: false }
  // 缩量企稳
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const vr = kl.volumes[i] / (avgVol || 1)
    if (vr < 0.7) score += 30
    else if (vr < 1) score += 15
  }
  // 拒绝下跌：今日低点高于昨天低点
  if (kl.lows[i] > kl.lows[i - 1]) score += 15
  // 前期有上涨趋势(非熊股回踩)
  if (i >= 20) {
    const m20 = ((kl.closes[i] / kl.closes[i - 20]) - 1) * 100
    if (m20 > 10) score += 15
    else if (m20 < -10) score -= 20
  }
  // 价格在MA5上方更好
  if (kl.closes[i] > ma5[i]) score += 10
  const isSignal = score >= 55
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** SB1 假摔：B1 信号后短期假跌破再拉回 */
function calcSB1(i: number, kdjJ: number[], kl: KlineData): { score: number; isSignal: boolean } {
  if (i < 10) return { score: 0, isSignal: false }
  let score = 0
  // 5-8天前出现过B1信号
  let hadB1 = false
  let b1Day = 0
  for (let d = 3; d <= 8; d++) {
    if (i - d >= 0 && kdjJ[i - d] < 13) { hadB1 = true; b1Day = d; break }
  }
  if (!hadB1) return { score: 0, isSignal: false }
  score += 30
  // B1 后创新低(假摔)
  if (kl.lows[i] < kl.lows[i - b1Day]) score += 25
  // 但今天拉回来了(收阳线)
  if (kl.closes[i] > kl.opens[i]) score += 25
  // 且价格回到B1日附近
  if (Math.abs((kl.closes[i] / kl.closes[i - b1Day]) - 1) * 100 < 3) score += 20
  const isSignal = score >= 60
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** 双枪战法：连续两根放量阳线（或首阴后阳）探底回升 */
function calcShuangqiang(i: number, kl: KlineData): { score: number; isSignal: boolean } {
  if (i < 5) return { score: 0, isSignal: false }
  let score = 0
  const avgVol = kl.volumes.slice(i - 9, i - 1).reduce((a, b) => a + b, 0) / 8
  // 前一根：放量(阴或阳)
  const vr0 = kl.volumes[i - 1] / (avgVol || 1)
  if (vr0 < 1.3) return { score: 0, isSignal: false }
  // 今天：再放量 + 阳线
  const vr1 = kl.volumes[i] / (avgVol || 1)
  if (vr1 < 1.3) return { score: 0, isSignal: false }
  if (kl.closes[i] <= kl.opens[i]) return { score: 0, isSignal: false }
  score += 40
  // 量能递增
  if (kl.volumes[i] > kl.volumes[i - 1]) score += 20
  // 价格重心上移
  if (kl.closes[i] > kl.closes[i - 1]) score += 20
  // 前一日如果是阴线(洗盘) → 更确定
  if (kl.closes[i - 1] < kl.opens[i - 1]) score += 20
  const isSignal = score >= 60
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

// ═══════════════════════════════════════════════════════════════
// ④ 卖点层
// ═══════════════════════════════════════════════════════════════

/** S1 卖出信号：高位 + 放量滞涨 + 顶背离 */
function calcS1(i: number, kl: KlineData, kdjJ: number[], macdDiv: number): { score: number; isSignal: boolean } {
  if (i < 20) return { score: 0, isSignal: false }
  let score = 0
  // 高位：J值>80 或 20日涨幅>30%
  if (kdjJ[i] > 80) score += 40
  const m20 = ((kl.closes[i] / kl.closes[i - 20]) - 1) * 100
  if (m20 > 30) score += 30
  // 放量滞涨：量比>2 但涨幅<2%
  const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
  const vr = kl.volumes[i] / (avgVol || 1)
  const chg = ((kl.closes[i] / kl.closes[i - 1]) - 1) * 100
  if (vr > 2 && chg < 2) score += 30
  // 顶背离
  if (macdDiv === -1) score += 25
  if (kl.closes[i] < kl.opens[i]) score += 10  // 当天收阴
  const isSignal = score >= 60
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** DSZ 死亡之星：高位十字星/倒锤头/吊颈线 */
function calcDSZ(i: number, kl: KlineData): { score: number; isSignal: boolean } {
  if (i < 20) return { score: 0, isSignal: false }
  let score = 0
  // 前提：处于高位(20日涨幅>20%)
  const m20 = ((kl.closes[i] / kl.closes[i - 20]) - 1) * 100
  if (m20 < 15) return { score: 0, isSignal: false }
  score += 20
  const open = kl.opens[i], close = kl.closes[i], high = kl.highs[i], low = kl.lows[i]
  const body = Math.abs(close - open)
  const range = high - low
  if (range === 0) return { score: 0, isSignal: false }
  // 十字星：实体极小，上下影线长
  if (body / range < 0.15) score += 40
  // 倒锤头：上影线>实体2倍，收阴
  else if (close < open && (high - Math.max(open, close)) > body * 2) score += 35
  // 吊颈线：下影线>实体2倍
  else if ((Math.min(open, close) - low) > body * 2) score += 25
  else return { score: score, isSignal: false }
  // 量能放大
  const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
  if (kl.volumes[i] / (avgVol || 1) > 1.5) score += 25
  const isSignal = score >= 55
  return { score: Math.max(0, Math.min(100, score)), isSignal }
}

/** 十张死亡K线：检测经典见顶形态 */
function calcDeathKline(i: number, kl: KlineData): { score: number; isDead: boolean } {
  if (i < 3) return { score: 0, isDead: false }
  let score = 0
  // 前提：处于相对高位
  const m20 = ((kl.closes[i] / kl.closes[i - 20]) - 1) * 100
  if (m20 < 10) return { score: 0, isDead: false }
  score += 10
  // 1. 穿头破脚：前阳后阴，阴线实体包裹前阳
  if (i >= 1) {
    const prevBody = Math.abs(kl.closes[i - 1] - kl.opens[i - 1])
    const currBody = Math.abs(kl.closes[i] - kl.opens[i])
    if (kl.closes[i] < kl.opens[i] &&  // 今日阴线
        kl.closes[i - 1] > kl.opens[i - 1] && // 昨日阳线
        kl.closes[i] < kl.opens[i - 1] && // 收低于昨开
        kl.opens[i] > kl.closes[i - 1] && // 开高于昨收
        currBody > prevBody * 1.2) score += 30
  }
  // 2. 乌云盖顶：高开低走大阴线
  if (i >= 1 && kl.opens[i] > kl.closes[i - 1] &&
      kl.closes[i] < (kl.opens[i] + kl.closes[i - 1]) / 2) score += 25
  // 3. 三只乌鸦：连续三阴
  if (i >= 2 &&
      kl.closes[i] < kl.opens[i] && kl.closes[i] < kl.closes[i - 1] &&
      kl.closes[i - 1] < kl.opens[i - 1] && kl.closes[i - 1] < kl.closes[i - 2] &&
      kl.closes[i - 2] < kl.opens[i - 2]) score += 20
  // 4. 放量突破失败：冲高回落+放量
  if ((kl.highs[i] - kl.closes[i]) > (kl.closes[i] - kl.lows[i]) * 2) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    if (kl.volumes[i] / (avgVol || 1) > 1.5) score += 20
  }
  const isDead = score >= 50
  return { score: Math.max(0, Math.min(100, score + 10)), isDead }
}

// ═══════════════════════════════════════════════════════════════
// ⑤ 持仓层 — 需要外部传入持仓数据，此处提供计算函数
// ═══════════════════════════════════════════════════════════════

/** 去弱留强：给定持仓收益率数组，返回每只票的排名百分位 */
export function calcPositionRanks(returns: number[]): number[] {
  const n = returns.length
  if (n === 0) return []
  // 收益率排序(从高到低)
  const sorted = [...returns].sort((a, b) => b - a)
  return returns.map(r => {
    const rank = sorted.indexOf(r) + 1
    return ((n - rank) / (n - 1)) * 100  // 0=最弱, 100=最强
  })
}

/** 底仓/动态仓比例建议（基于持仓天数和浮盈） */
export function calcPositionRatios(holdDays: number, profitPct: number): { base: number; dynamic: number } {
  // 底仓 = 长线信仰仓，越长越好，但盈利高时适当减
  let base = 0.6
  if (holdDays > 60) base = 0.7
  else if (holdDays < 10) base = 0.4
  // 动态仓 = 短线博弈仓，盈利越高可适当加大
  let dynamic = 0.4
  if (profitPct > 20) dynamic = 0.5
  else if (profitPct < -10) dynamic = 0.2
  // 归一化
  const total = base + dynamic
  return { base: base / total, dynamic: dynamic / total }
}

// ═══════════════════════════════════════════════════════════════
// ⑥ 风控层
// ═══════════════════════════════════════════════════════════════

function calcRisk(i: number, kl: KlineData): {
  consecutiveLoss: number; maxdd20: number; level: '低' | '中' | '高' | '极高'; violations: string[]
} {
  const violations: string[] = []
  // 连续下跌天数
  let consec = 0
  for (let d = i; d > 0; d--) {
    if (kl.closes[d] < kl.closes[d - 1]) consec++
    else break
  }
  // 20日最大回撤
  let maxdd = 0
  if (i >= 20) {
    let peak = kl.closes[i - 20]
    for (let d = i - 19; d <= i; d++) {
      if (kl.closes[d] > peak) peak = kl.closes[d]
      const dd = (peak - kl.closes[d]) / peak * 100
      if (dd > maxdd) maxdd = dd
    }
  }
  // 风险等级
  let level: '低' | '中' | '高' | '极高' = '低'
  if (maxdd > 20 || consec > 5) level = '极高'
  else if (maxdd > 10 || consec > 3) level = '高'
  else if (maxdd > 5 || consec > 1) level = '中'
  // 四不原则
  if (consec > 2) violations.push('不逆势(连续下跌3天)')
  if (i >= 5 && kl.volumes[i] / (kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5 || 1) > 3)
    violations.push('不放量(异常放量)')
  return { consecutiveLoss: consec, maxdd20: round2(maxdd), level, violations }
}

// ═══════════════════════════════════════════════════════════════
// ⑦ 心法层 + 三波理论
// ═══════════════════════════════════════════════════════════════

/** 分歧度：换手率波动/均值，越高=分歧越大 */
function calcDivergence(i: number, kl: KlineData): number {
  if (i < 10) return 0
  const vols = kl.volumes.slice(i - 9, i + 1)
  const mean = vols.reduce((a, b) => a + b, 0) / 10
  if (mean === 0) return 0
  return round2(std(vols) / mean)
}

/** 三波理论：简易波浪识别 */
function calcWavePhase(i: number, kl: KlineData): { phase: number; retrace: number } {
  if (i < 60) return { phase: 0, retrace: 0 }
  // 寻找最近60天的高低点
  const h60 = Math.max(...kl.highs.slice(i - 59, i + 1))
  const l60 = Math.min(...kl.lows.slice(i - 59, i + 1))
  const range = h60 - l60
  if (range === 0) return { phase: 0, retrace: 0 }
  // 当前位置
  const pos = (kl.closes[i] - l60) / range // 0=底部, 1=顶部
  // 简单判断
  let phase = 0
  if (pos < 0.33) phase = 1
  else if (pos < 0.66) phase = 2
  else phase = 3
  // 回撤比例(从最近高点)
  let retrace = 0
  if (i >= 10) {
    const recentHigh = Math.max(...kl.highs.slice(i - 9, i + 1))
    retrace = round2((1 - kl.closes[i] / recentHigh) * 100)
  }
  return { phase, retrace }
}

// ═══════════════════════════════════════════════════════════════
// 少妇/坑口（保留）
// ═══════════════════════════════════════════════════════════════

function calcShaofu(i: number, kl: KlineData, ma5: number[], ma10: number[], ma20: number[], maStick: number):
  { score: number; isCandidate: boolean } {
  if (i < 20) return { score: 0, isCandidate: false }
  let score = 0
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const vr = kl.volumes[i] / (avgVol || 1)
    if (vr < 0.3) score += 40
    else if (vr < 0.5) score += 25
    else if (vr < 0.7) score += 10
  }
  if (i >= 60) {
    const ma60 = kl.closes.slice(i - 59, i + 1).reduce((a, b) => a + b, 0) / 60
    const pos = ((kl.closes[i] / ma60) - 1) * 100
    if (pos < -15) score += 30
    else if (pos < -5) score += 15
    else if (pos > 30) score -= 30
  }
  if (maStick < 2) score += 30
  else if (maStick < 4) score += 15
  return { score: Math.max(0, Math.min(100, score)), isCandidate: score >= 50 }
}

function calcKengkou(i: number, kl: KlineData, ma20: number[]):
  { score: number; isCandidate: boolean } {
  if (i < 30) return { score: 0, isCandidate: false }
  let score = 0
  const lookback = Math.min(20, i)
  const recentHigh = Math.max(...kl.highs.slice(i - lookback, i - 5))
  if (kl.closes[i] > recentHigh * 1.02) score += 40
  else if (kl.closes[i] > recentHigh) score += 20
  const recentLow = Math.min(...kl.lows.slice(i - 3, i + 1))
  if (recentLow > recentHigh * 0.97) score += 25
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    if (kl.volumes[i] / (avgVol || 1) > 1.5) score += 20
  }
  if (kl.closes[i] > ma20[i] && ma20[i] > (kl.closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20)) score += 15
  return { score: Math.max(0, Math.min(100, score)), isCandidate: score >= 50 }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function round2(n: number): number { return Math.round(n * 100) / 100 }
function safe(v: number): number { return isNaN(v) ? 0 : v }

// ═══════════════════════════════════════════════════════════════
// 主计算
// ═══════════════════════════════════════════════════════════════

export function computeZettarancFactors(code: string, kl: KlineData, holdDays = 0, profitPct = 0): ZettarancFactors {
  const n = kl.closes.length
  const last = n - 1

  // 基础指标
  const { k: kdjK, d: kdjD, j: kdjJ } = calcKDJ(kl)
  const { dif } = calcMACD(kl)
  const ma5 = sma(kl.closes, 5)
  const ma10 = sma(kl.closes, 10)
  const ma20 = sma(kl.closes, 20)
  const ma60 = sma(kl.closes, 60)
  const maStick = calcMAStickiness(last, ma5, ma10, ma20)
  const macdDiv = detectDivergence(kl, dif)
  const kdjDiv = detectDivergence(kl, kdjJ)

  // ① 择时
  const mktSignal = calcMarketTiming(last, kl, ma5, ma10, ma20, ma60)
  const amc = calcActiveMarketCap(kl, last)
  const wyCross = calcWhiteYellowCross(kl, last)

  // ② 选股
  const anomaly = calcAnomaly(last, kl)
  const tripleBest = calcTripleBest(last, kl, ma5, ma10, ma20, ma60)

  // ③ 买点
  const b1 = calcB1(last, kdjJ, kl, ma5, ma20)
  const superB1 = calcSuperB1(last, kdjJ, kl)
  const b2 = calcB2(last, kl)
  const b3 = calcB3(last, kl, ma5, ma20)
  const sb1 = calcSB1(last, kdjJ, kl)
  const sq = calcShuangqiang(last, kl)

  // ④ 卖点
  const s1 = calcS1(last, kl, kdjJ, macdDiv)
  const dsz = calcDSZ(last, kl)
  const dk = calcDeathKline(last, kl)

  // ⑤ 持仓
  const posRatio = calcPositionRatios(holdDays, profitPct)
  const isWeak = profitPct < -10 // 简化：浮亏>10% 视为弱

  // ⑥ 风控
  const risk = calcRisk(last, kl)

  // ⑦ 心法
  const divCons = calcDivergence(last, kl)
  const wave = calcWavePhase(last, kl)

  // 量比
  const avgVol5 = last >= 4 ? kl.volumes.slice(last - 4, last + 1).reduce((a, b) => a + b, 0) / 5 : kl.volumes[last]
  const vr = safe(kl.volumes[last] / (avgVol5 || 1))

  // 少妇/坑口
  const shaofu = calcShaofu(last, kl, ma5, ma10, ma20, maStick)
  const kengkou = calcKengkou(last, kl, ma20)

  // 综合评分
  let zScore = 0
  const matched: string[] = []
  // 买点信号
  if (b1.isSignal) { zScore += 30; matched.push('B1建仓波') }
  if (superB1.isSignal) { zScore += 20; matched.push('超级B1') }
  if (sb1.isSignal) { zScore += 25; matched.push('SB1假摔') }
  if (b2.isSignal) { zScore += 20; matched.push('B2突破') }
  if (b3.isSignal) { zScore += 15; matched.push('B3回踩') }
  if (sq.isSignal) { zScore += 15; matched.push('双枪战法') }
  if (shaofu.isCandidate) { zScore += 15; matched.push('少妇战法') }
  if (kengkou.isCandidate) { zScore += 15; matched.push('坑口战法') }
  // 卖点信号(减分)
  if (s1.isSignal) { zScore -= 30; matched.push('S1卖出⚠️') }
  if (dsz.isSignal) { zScore -= 20; matched.push('DSZ死亡之星⚠️') }
  if (dk.isDead) { zScore -= 25; matched.push('死亡K线⚠️') }
  // 择时
  if (mktSignal === 1) { zScore += 10; matched.push('多头环境') }
  if (mktSignal === -1) { zScore -= 15; matched.push('空头环境⚠️') }
  // 背离
  if (macdDiv === 1) { zScore += 10; matched.push('MACD底背离') }
  if (kdjDiv === 1) { zScore += 8; matched.push('KDJ底背离') }
  if (macdDiv === -1) { zScore -= 15; matched.push('MACD顶背离⚠️') }
  if (kdjDiv === -1) { zScore -= 12; matched.push('KDJ顶背离⚠️') }

  return {
    code, date: kl.dates[last] ?? '',
    marketTimingSignal: mktSignal,
    activeMarketCapChange: round2(amc),
    whiteYellowCrossover: wyCross,
    anomalyScore: anomaly.score, isAnomaly: anomaly.isAnomaly,
    tripleBestScore: tripleBest,
    kdjK: safe(kdjK[last]), kdjD: safe(kdjD[last]), kdjJ: safe(kdjJ[last]),
    b1Score: b1.score, isB1Signal: b1.isSignal,
    superB1Score: superB1.score, isSuperB1: superB1.isSignal,
    b2Score: b2.score, isB2Signal: b2.isSignal,
    b3Score: b3.score, isB3Signal: b3.isSignal,
    sb1Score: sb1.score, isSB1Signal: sb1.isSignal,
    shuangqiangScore: sq.score, isShuangqiang: sq.isSignal,
    s1Score: s1.score, isS1Signal: s1.isSignal,
    dszScore: dsz.score, isDSZSignal: dsz.isSignal,
    deathKlineScore: dk.score, isDeathKline: dk.isDead,
    macdDivergence: macdDiv, kdjDivergence: kdjDiv,
    positionRankPct: profitPct >= 0 ? 70 : 30,
    isWeakCut: isWeak,
    basePositionRatio: round2(posRatio.base),
    dynamicPositionRatio: round2(posRatio.dynamic),
    consecutiveLossDays: risk.consecutiveLoss,
    maxDrawdown20: risk.maxdd20,
    riskLevel: risk.level,
    fourNoViolations: risk.violations,
    divergenceConsensus: divCons,
    shaofuScore: shaofu.score, isShaofuCandidate: shaofu.isCandidate,
    kengkouScore: kengkou.score, isKengkouCandidate: kengkou.isCandidate,
    volumeRatio: round2(vr), volumeSurge: vr > 2, volumeShrink: vr < 0.5,
    ma5: safe(ma5[last]), ma10: safe(ma10[last]), ma20: safe(ma20[last]), ma60: safe(ma60[last]),
    maStickiness: round2(maStick),
    wavePhase: wave.phase, waveRetraceRatio: wave.retrace,
    matchedStrategies: matched,
    zettarancScore: Math.max(0, Math.min(100, zScore + 30)),
  }
}

/** 批量计算 */
export function computeBatchZettaranc(
  _klineDir: string,
  _codes: string[],
  _onProgress?: (done: number, total: number) => void,
): ZettarancFactors[] {
  return []
}
