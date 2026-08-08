// ─────────────────────────────────────────────────────────────
// 缠论分析引擎（缠中说禅技术体系，标准流程的可靠简化版）
// 流程：包含关系合并 → 分型 → 笔 → 中枢 → 背驰（简化 MACD 面积法）→ 买卖点启发式
// 防御性：K线 < 60 根或缺 highs/lows（数据升级中）时返回 null
// ─────────────────────────────────────────────────────────────
import type { KlineData } from './marketData'
import type { ChanAnalysis } from './types'

const MIN_BARS = 60 // 最少原始 K 线数
const MIN_STROKE_GAP = 4 // 相邻分型顶点至少间隔 4 根合并K（一笔至少 5 根K）
const DIVERGENCE_RATIO = 0.8 // 背驰阈值：当前笔面积 < 前一同向笔的 80%
const ZS_TOLERANCE = 0.02 // 中枢第三类买卖点回抽容差 2%

interface MergedBar {
  high: number
  low: number
  date: string // 该合并K最后一根原始K的日期
}

interface Fractal {
  idx: number // 合并序列索引
  type: 'top' | 'bottom'
  price: number
  date: string
}

interface Stroke {
  dir: 'up' | 'down'
  fromPrice: number
  toPrice: number
  fromDate: string
  toDate: string
}

interface Zhongshu {
  zg: number
  zd: number
  startDate: string
  endDate: string
}

/** 1. 包含关系合并：向上取 max(high)/max(low)，向下取 min(high)/min(low)；
 *  方向由最近一根非包含K与前一根的高低关系确定（初始未定方向按向上处理） */
function mergeInclusion(dates: string[], highs: number[], lows: number[]): MergedBar[] {
  const out: MergedBar[] = []
  let dir: 'up' | 'down' | null = null
  for (let i = 0; i < dates.length; i++) {
    const h = highs[i]
    const l = lows[i]
    const last = out[out.length - 1]
    if (!last) {
      out.push({ high: h, low: l, date: dates[i] })
      continue
    }
    const contained = (last.high >= h && last.low <= l) || (h >= last.high && l <= last.low)
    if (!contained) {
      dir = h > last.high ? 'up' : 'down'
      out.push({ high: h, low: l, date: dates[i] })
    } else {
      const up = dir !== 'down'
      last.high = up ? Math.max(last.high, h) : Math.min(last.high, h)
      last.low = up ? Math.max(last.low, l) : Math.min(last.low, l)
      last.date = dates[i]
    }
  }
  return out
}

/** 2. 分型：顶分型 = 中间K high 严格高于左右（且 low 也高于左右 low）；底分型反之 */
function findFractals(bars: MergedBar[]): Fractal[] {
  const out: Fractal[] = []
  for (let i = 1; i < bars.length - 1; i++) {
    const p = bars[i - 1]
    const c = bars[i]
    const n = bars[i + 1]
    if (c.high > p.high && c.high > n.high && c.low > p.low && c.low > n.low) {
      out.push({ idx: i, type: 'top', price: c.high, date: c.date })
    } else if (c.low < p.low && c.low < n.low && c.high < p.high && c.high < n.high) {
      out.push({ idx: i, type: 'bottom', price: c.low, date: c.date })
    }
  }
  return out
}

/** 3. 笔：交替连接顶/底分型，相邻顶点至少间隔 4 根合并K；
 *  同向出现更极端分型则笔延伸（替换端点），反向分型满足间距则成笔 */
function buildStrokes(fractals: Fractal[]): Stroke[] {
  const pts: Fractal[] = []
  for (const f of fractals) {
    const last = pts[pts.length - 1]
    if (!last) {
      pts.push(f)
      continue
    }
    if (f.type !== last.type) {
      if (f.idx - last.idx >= MIN_STROKE_GAP) pts.push(f) // 间距不足：忽略该分型
    } else if (
      (f.type === 'top' && f.price >= last.price) ||
      (f.type === 'bottom' && f.price <= last.price)
    ) {
      pts[pts.length - 1] = f // 同向更极端：笔延伸
    }
  }
  const strokes: Stroke[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    strokes.push({
      dir: a.type === 'bottom' ? 'up' : 'down',
      fromPrice: a.price,
      toPrice: b.price,
      fromDate: a.date,
      toDate: b.date,
    })
  }
  return strokes
}

/** 4. 中枢：最近三笔（含）以上的重叠区间，ZG = min(各笔高点)、ZD = max(各笔低点)，
 *  ZG > ZD 成立；从最近三笔起向更早的笔扩展，取仍成立的最大窗口 */
function findZhongshu(strokes: Stroke[]): Zhongshu | null {
  const n = strokes.length
  if (n < 3) return null
  const overlap = (from: number, to: number): Zhongshu | null => {
    let zg = Infinity
    let zd = -Infinity
    for (let i = from; i <= to; i++) {
      zg = Math.min(zg, Math.max(strokes[i].fromPrice, strokes[i].toPrice))
      zd = Math.max(zd, Math.min(strokes[i].fromPrice, strokes[i].toPrice))
    }
    if (zg <= zd) return null
    return { zg, zd, startDate: strokes[from].fromDate, endDate: strokes[to].toDate }
  }
  let best = overlap(n - 3, n - 1)
  if (!best) return null
  for (let from = n - 4; from >= 0; from--) {
    const z = overlap(from, n - 1)
    if (!z) break
    best = z
  }
  return best
}

function ema(arr: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = new Array(arr.length)
  out[0] = arr[0]
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k)
  return out
}

/** 5. 背驰（简化 MACD 面积法）：比较最近两段同向笔区间内 DIF 与 0 轴围成的面积；
 *  当前笔价格创新高/低但面积 < 前笔 80% → 顶/底背驰 */
function detectDivergence(
  strokes: Stroke[],
  dif: number[],
  dateIdx: Map<string, number>,
): { kind: 'top' | 'bottom'; ratio: number } | null {
  const areaOf = (s: Stroke): number => {
    const a = dateIdx.get(s.fromDate) ?? 0
    const b = dateIdx.get(s.toDate) ?? 0
    let sum = 0
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      sum += s.dir === 'up' ? Math.max(dif[i], 0) : Math.max(-dif[i], 0)
    }
    return sum
  }
  const check = (dir: 'up' | 'down', kind: 'top' | 'bottom') => {
    const same = strokes.filter((s) => s.dir === dir)
    if (same.length < 2) return null
    const cur = same[same.length - 1]
    const prev = same[same.length - 2]
    const prevArea = areaOf(prev)
    if (prevArea <= 0) return null
    const ratio = areaOf(cur) / prevArea
    const newExtreme = dir === 'up' ? cur.toPrice > prev.toPrice : cur.toPrice < prev.toPrice
    return newExtreme && ratio < DIVERGENCE_RATIO ? { kind, ratio } : null
  }
  // 最近一笔向下优先看顶背驰（上升动能衰竭），向上优先看底背驰
  const lastDir = strokes[strokes.length - 1].dir
  return lastDir === 'down'
    ? (check('up', 'top') ?? check('down', 'bottom'))
    : (check('down', 'bottom') ?? check('up', 'top'))
}

/** 6. 买卖点启发式：第三类买卖点（回抽不进中枢，容差 2%）> 背驰一/二类 > 中枢震荡提示 */
function judgePoint(
  strokes: Stroke[],
  zs: Zhongshu | null,
  div: { kind: 'top' | 'bottom'; ratio: number } | null,
): string | null {
  const last = strokes[strokes.length - 1]
  const prev = strokes[strokes.length - 2]
  if (zs && prev) {
    if (
      prev.dir === 'up' &&
      prev.toPrice > zs.zg * (1 + ZS_TOLERANCE) &&
      last.dir === 'down' &&
      last.toPrice > zs.zg * (1 - ZS_TOLERANCE)
    ) {
      return '第三类买点（回踩中枢上沿不破）'
    }
    if (
      prev.dir === 'down' &&
      prev.toPrice < zs.zd * (1 - ZS_TOLERANCE) &&
      last.dir === 'up' &&
      last.toPrice < zs.zd * (1 + ZS_TOLERANCE)
    ) {
      return '第三类卖点（反抽中枢下沿不过）'
    }
  }
  if (div) {
    if (div.kind === 'top' && last.dir === 'down') return '警惕第一类/第二类卖点（顶背驰后转入向下笔）'
    if (div.kind === 'bottom' && last.dir === 'up') return '关注第一类/第二类买点（底背驰后转入向上笔）'
  }
  if (zs) {
    // 现价（最近一笔终点）仍在中枢内才提示震荡，已离开中枢则不给该提示
    if (last.toPrice >= zs.zd && last.toPrice <= zs.zg) {
      return '中枢震荡中，关注上下沿 ZG/ZD 的突破方向'
    }
  }
  return null
}

const r2 = (v: number) => Number(v.toFixed(2))

/**
 * 对近 500 根日K运行缠论分析。
 * 数据不足（< 60 根）或缺 highs/lows（K线数据升级中）时返回 null。
 */
export function runChanAnalysis(k: KlineData): Omit<ChanAnalysis, 'updatedAt'> | null {
  const { dates, closes, highs, lows } = k
  if (
    !highs ||
    !lows ||
    dates.length < MIN_BARS ||
    closes.length !== dates.length ||
    highs.length !== dates.length ||
    lows.length !== dates.length
  ) {
    return null
  }

  const bars = mergeInclusion(dates, highs, lows)
  if (bars.length < 10) return null
  const fractals = findFractals(bars)
  const strokes = buildStrokes(fractals)
  if (strokes.length < 2) return null

  const zs = findZhongshu(strokes)
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const dif = closes.map((_, i) => e12[i] - e26[i])
  const dateIdx = new Map(dates.map((d, i) => [d, i]))
  const div = detectDivergence(strokes, dif, dateIdx)
  const point = judgePoint(strokes, zs, div)

  const last = strokes[strokes.length - 1]
  const lastPrice = closes[closes.length - 1]
  const inZs = zs !== null && last.toPrice >= zs.zd && last.toPrice <= zs.zg
  const trend: ChanAnalysis['trend'] = inZs ? 'consolidation' : last.dir

  // 关键位置：中枢下/上沿优先，否则取最近底/顶分型，兜底近 20 根最低/最高价
  const lastBottom = [...fractals].reverse().find((f) => f.type === 'bottom')
  const lastTop = [...fractals].reverse().find((f) => f.type === 'top')
  const support = zs ? zs.zd : (lastBottom?.price ?? Math.min(...lows.slice(-20)))
  const resistance = zs ? zs.zg : (lastTop?.price ?? Math.max(...highs.slice(-20)))

  const posText = zs
    ? lastPrice > zs.zg
      ? '中枢上方'
      : lastPrice < zs.zd
        ? '中枢下方'
        : '中枢内部'
    : ''
  const strokePct = ((last.toPrice / last.fromPrice - 1) * 100).toFixed(1)

  const signals: string[] = [
    `原始 ${dates.length} 根日K经包含合并后为 ${bars.length} 根，识别分型 ${fractals.length} 个，构成笔 ${strokes.length} 笔`,
    `最近一笔${last.dir === 'up' ? '向上' : '向下'}：${last.fromDate} ${last.fromPrice.toFixed(2)} → ${last.toDate} ${last.toPrice.toFixed(2)}（${strokePct}%）`,
    zs
      ? `中枢区间 ZD ${zs.zd.toFixed(2)} ~ ZG ${zs.zg.toFixed(2)}（${zs.startDate} 起生效），现价 ${lastPrice.toFixed(2)} 位于${posText}`
      : `最近 ${Math.min(strokes.length, 3)} 笔未形成有效中枢，走势处于笔级别趋势中`,
    div
      ? `${div.kind === 'top' ? '顶' : '底'}背驰：最近同向笔价格${div.kind === 'top' ? '创新高' : '创新低'}，但 MACD(DIF) 面积缩小至前一笔的 ${(div.ratio * 100).toFixed(0)}%（< 80%）`
      : '未检测到明显背驰信号',
    point ? `买卖点判断：${point}` : '暂无明确买卖点信号',
  ]

  const parts = [
    `近 500 日缠论结构呈${trend === 'up' ? '上升' : trend === 'down' ? '下降' : '中枢震荡'}态势`,
    zs ? `现价位于${posText}` : '',
    div ? `出现${div.kind === 'top' ? '顶' : '底'}背驰` : '',
    point ?? '',
  ].filter(Boolean)

  return {
    conclusion: parts.join('，') + '。',
    signals,
    trend,
    lastStroke: {
      dir: last.dir,
      from: last.fromDate,
      to: last.toDate,
      fromPrice: r2(last.fromPrice),
      toPrice: r2(last.toPrice),
    },
    strokes: strokes.map((s) => ({
      from: s.fromDate,
      to: s.toDate,
      fromPrice: r2(s.fromPrice),
      toPrice: r2(s.toPrice),
      dir: s.dir,
    })),
    zhongshu: zs ? { zg: r2(zs.zg), zd: r2(zs.zd), startDate: zs.startDate, endDate: zs.endDate } : null,
    buySellPoint: point,
    divergence: div?.kind ?? null,
    keyLevels: { support: r2(support), resistance: r2(resistance) },
  }
}
