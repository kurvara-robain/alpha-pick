// ─────────────────────────────────────────────────────────────
// Zettaranc 交易体系因子引擎
// KDJ · 背离检测 · B1 信号评分 · 少妇战法 · 坑口 · 双枪
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
  // ── KDJ ──
  kdjK: number
  kdjD: number
  kdjJ: number
  // ── B1 信号 ──
  b1Score: number        // 0-100, B1 建仓波综合评分
  isB1Signal: boolean     // J<13 + 跌幅 + 换手约束
  b1DaysSinceSignal: number // 最近一次 B1 信号距今几天
  // ── 背离检测 ──
  macdDivergence: number  // -1=顶背离, 0=无, 1=底背离
  kdjDivergence: number   // -1=顶背离, 0=无, 1=底背离
  // ── 少妇战法 ──
  shaofuScore: number     // 0-100, 缩量+低位+均线粘合
  isShaofuCandidate: boolean
  // ── 坑口战法 ──
  kengkouScore: number    // 0-100, 颈线突破+回踩确认
  isKengkouCandidate: boolean
  // ── 双枪战法 ──
  shuangqiangSignal: number // -1/0/1 信号
  // ── 量比 ──
  volumeRatio: number      // 当日量/5日均量
  volumeSurge: boolean     // 放量（>2倍）
  volumeShrink: boolean    // 缩量（<0.5倍）
  // ── 均线 ──
  ma5: number
  ma10: number
  ma20: number
  ma60: number
  maStickiness: number     // 均线粘合度 (越小越粘合)
  // ── 综合战法匹配 ──
  matchedStrategies: string[]  // 匹配的战法列表
  zettarancScore: number   // 0-100 综合评分
}

// ═══════════════════════════════════════════════════════════════
// 核心计算
// ═══════════════════════════════════════════════════════════════

/** 计算 N 日指数移动平均 */
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

/** 简单移动平均 */
function sma(values: number[], n: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) { result.push(values[i]); continue }
    const sum = values.slice(i - n + 1, i + 1).reduce((s, v) => s + v, 0)
    result.push(sum / n)
  }
  return result
}

/** 计算 KDJ (9,3,3) */
function calcKDJ(kl: KlineData): { k: number[]; d: number[]; j: number[] } {
  const n = 9
  const k: number[] = []
  const d: number[] = []
  const j: number[] = []
  let prevK = 50, prevD = 50

  for (let i = 0; i < kl.closes.length; i++) {
    if (i < n - 1) { k.push(prevK); d.push(prevD); j.push(3 * prevK - 2 * prevD); continue }

    const windowHigh = Math.max(...kl.highs.slice(i - n + 1, i + 1))
    const windowLow = Math.min(...kl.lows.slice(i - n + 1, i + 1))
    const rsv = windowHigh === windowLow ? 50 : ((kl.closes[i] - windowLow) / (windowHigh - windowLow)) * 100

    const curK = (2 * prevK + rsv) / 3
    const curD = (2 * prevD + curK) / 3
    const curJ = 3 * curK - 2 * curD

    k.push(curK); d.push(curD); j.push(curJ)
    prevK = curK; prevD = curD
  }
  return { k, d, j }
}

/** MACD (12,26,9) */
function calcMACD(kl: KlineData) {
  const ema12 = ema(kl.closes, 12)
  const ema26 = ema(kl.closes, 26)
  const dif = ema12.map((v, i) => v - ema26[i])
  const dea = ema(dif, 9)
  const macd = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, macd }
}

/** 检测底背离 / 顶背离 */
function detectDivergence(kl: KlineData, indicator: number[], lookback = 20): number {
  if (indicator.length < lookback * 2) return 0
  const last = indicator.length - 1

  // 底背离：价格新低但指标未新低
  const windowClose = kl.closes.slice(last - lookback, last + 1)
  const windowInd = indicator.slice(last - lookback, last + 1)
  const priceLowIdx = windowClose.indexOf(Math.min(...windowClose))
  const indLowIdx = windowInd.indexOf(Math.min(...windowInd))

  if (priceLowIdx === windowClose.length - 1 && indLowIdx > windowClose.length - 3) return 0
  if (kl.closes[last] < kl.closes[last - lookback] && indicator[last] > indicator[last - lookback]) return 1

  // 顶背离：价格新高但指标未新高
  const priceHighIdx = windowClose.indexOf(Math.max(...windowClose))
  const indHighIdx = windowInd.indexOf(Math.max(...windowInd))
  if (kl.closes[last] > kl.closes[last - lookback] && indicator[last] < indicator[last - lookback]) return -1

  return 0
}

/** 均线粘合度（MA5/MA10/MA20 三线标准差与均值的比值，越小越粘合） */
function calcMAStickiness(kl: KlineData, i: number, ma5: number[], ma10: number[], ma20: number[]): number {
  if (i < 20) return 100
  const values = [ma5[i], ma10[i], ma20[i]]
  const mean = values.reduce((s, v) => s + v, 0) / 3
  if (mean === 0) return 100
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / 3)
  return (std / Math.abs(mean)) * 100
}

// ═══════════════════════════════════════════════════════════════
// 战法评分函数
// ═══════════════════════════════════════════════════════════════

/** B1 建仓波评分 */
function calcB1Score(i: number, kdjJ: number[], kl: KlineData, ma5: number[], ma20: number[]): { score: number; isSignal: boolean } {
  if (i < 20) return { score: 0, isSignal: false }
  let score = 0

  // J值 < 13 → 50 分
  if (kdjJ[i] < 13) score += 50
  else if (kdjJ[i] < 0) score += 60
  else if (kdjJ[i] < 20) score += 30
  else if (kdjJ[i] > 80) score -= 40

  // 近期跌幅 (5日)
  if (i >= 5) {
    const decline5 = (kl.closes[i] / kl.closes[i - 5] - 1) * 100
    if (decline5 < -10) score += 20
    else if (decline5 < -5) score += 10
    else if (decline5 > 10) score -= 20
  }

  // 换手率检查（用成交量变化率近似）
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const volRatio = kl.volumes[i] / avgVol
    if (volRatio < 0.5) score += 15  // 缩量更好
    else if (volRatio > 3) score -= 15 // 放量太大可能是出货
  }

  // 价格位置：相对 MA20
  if (kl.closes[i] < ma20[i]) score += 10
  if (kl.closes[i] < ma5[i]) score += 5

  const isSignal = kdjJ[i] < 13 && score >= 40
  return { score: Math.max(0, Math.min(100, score + 30)), isSignal }
}

/** 少妇战法评分（缩量+低位+均线粘合） */
function calcShaofuScore(i: number, kl: KlineData, ma5: number[], ma10: number[], ma20: number[], maStick: number): { score: number; isCandidate: boolean } {
  if (i < 20) return { score: 0, isCandidate: false }
  let score = 0

  // 缩量
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    const volRatio = kl.volumes[i] / avgVol
    if (volRatio < 0.3) score += 40   // 极度缩量
    else if (volRatio < 0.5) score += 25
    else if (volRatio < 0.7) score += 10
  }

  // 低位（相对 MA60）
  if (i >= 60) {
    const ma60 = kl.closes.slice(i - 59, i + 1).reduce((a, b) => a + b, 0) / 60
    const position = (kl.closes[i] / ma60 - 1) * 100
    if (position < -15) score += 30
    else if (position < -5) score += 15
    else if (position > 30) score -= 30
  }

  // 均线粘合
  if (maStick < 2) score += 30
  else if (maStick < 4) score += 15

  const isCandidate = score >= 50
  return { score: Math.max(0, Math.min(100, score)), isCandidate }
}

/** 坑口战法评分（颈线突破 + 回踩确认） */
function calcKengkouScore(i: number, kl: KlineData, ma20: number[]): { score: number; isCandidate: boolean } {
  if (i < 30) return { score: 0, isCandidate: false }
  let score = 0

  // 寻找前期高点（颈线）
  const lookback = Math.min(20, i)
  const recentHigh = Math.max(...kl.highs.slice(i - lookback, i - 5))

  // 突破颈线
  if (kl.closes[i] > recentHigh * 1.02) score += 40
  else if (kl.closes[i] > recentHigh) score += 20

  // 回踩不破
  const recentLow = Math.min(...kl.lows.slice(i - 3, i + 1))
  if (recentLow > recentHigh * 0.97) score += 25

  // 放量突破
  if (i >= 5) {
    const avgVol = kl.volumes.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5
    if (kl.volumes[i] / avgVol > 1.5) score += 20
  }

  // 均线多头
  if (kl.closes[i] > ma20[i] && ma20[i] > (kl.closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20)) score += 15

  const isCandidate = score >= 50
  return { score: Math.max(0, Math.min(100, score)), isCandidate }
}

// ═══════════════════════════════════════════════════════════════
// 主计算函数
// ═══════════════════════════════════════════════════════════════

export function computeZettarancFactors(code: string, kl: KlineData): ZettarancFactors {
  const n = kl.closes.length
  const lastIdx = n - 1

  // 基础指标
  const { k: kdjK, d: kdjD, j: kdjJ } = calcKDJ(kl)
  const { dif, dea, macd } = calcMACD(kl)
  const ma5 = sma(kl.closes, 5)
  const ma10 = sma(kl.closes, 10)
  const ma20 = sma(kl.closes, 20)
  const ma60vals = sma(kl.closes, 60)

  // 背离
  const macdDiv = detectDivergence(kl, dif)
  const kdjDiv = detectDivergence(kl, kdjJ)

  // 均线粘合
  const maStick = calcMAStickiness(kl, lastIdx, ma5, ma10, ma20)

  // 战法评分
  const b1 = calcB1Score(lastIdx, kdjJ, kl, ma5, ma20)
  const shaofu = calcShaofuScore(lastIdx, kl, ma5, ma10, ma20, maStick)
  const kengkou = calcKengkouScore(lastIdx, kl, ma20)

  // 量比
  const avgVol5 = lastIdx >= 4 ? kl.volumes.slice(lastIdx - 4, lastIdx + 1).reduce((a, b) => a + b, 0) / 5 : kl.volumes[lastIdx]
  const volRatio = kl.volumes[lastIdx] / (avgVol5 || 1)

  // 综合评分
  let zScore = 0
  const matched: string[] = []
  if (b1.isSignal) { zScore += 35; matched.push('B1建仓波') }
  if (shaofu.isCandidate) { zScore += 25; matched.push('少妇战法') }
  if (kengkou.isCandidate) { zScore += 20; matched.push('坑口战法') }
  if (macdDiv === 1) { zScore += 10; matched.push('MACD底背离') }
  if (kdjDiv === 1) { zScore += 10; matched.push('KDJ底背离') }
  if (macdDiv === -1) { zScore -= 15; matched.push('MACD顶背离⚠️') }
  if (kdjDiv === -1) { zScore -= 15; matched.push('KDJ顶背离⚠️') }
  if (volRatio > 3) { zScore -= 10; matched.push('放量异常') }

  return {
    code, date: kl.dates[lastIdx] ?? '',
    kdjK: kdjK[lastIdx] ?? 50, kdjD: kdjD[lastIdx] ?? 50, kdjJ: kdjJ[lastIdx] ?? 50,
    b1Score: b1.score, isB1Signal: b1.isSignal, b1DaysSinceSignal: 0,
    macdDivergence: macdDiv, kdjDivergence: kdjDiv,
    shaofuScore: shaofu.score, isShaofuCandidate: shaofu.isCandidate,
    kengkouScore: kengkou.score, isKengkouCandidate: kengkou.isCandidate,
    shuangqiangSignal: 0,
    volumeRatio: volRatio, volumeSurge: volRatio > 2, volumeShrink: volRatio < 0.5,
    ma5: ma5[lastIdx] ?? 0, ma10: ma10[lastIdx] ?? 0, ma20: ma20[lastIdx] ?? 0, ma60: ma60vals[lastIdx] ?? 0,
    maStickiness: maStick,
    matchedStrategies: matched,
    zettarancScore: Math.max(0, Math.min(100, zScore + 25)),
  }
}

/** 批量计算（从 K 线文件） */
export function computeBatchZettaranc(
  klineDir: string,
  codes: string[],
  onProgress?: (done: number, total: number) => void,
): ZettarancFactors[] {
  // 此函数在浏览器端调用，通过 fetch 加载 K 线数据
  // 返回空数组，实际计算通过 useAsync 逐个股票执行
  return []
}
