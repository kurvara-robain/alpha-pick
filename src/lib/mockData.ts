// ─────────────────────────────────────────────────────────────
// AlphaMind AI 选股 · 演示数据（全部为虚构数据，不构成投资建议）
// ─────────────────────────────────────────────────────────────

export type Signal = '强烈买入' | '买入' | '持有' | '观望'

export interface Stock {
  code: string
  name: string
  industry: string
  price: number
  changePct: number
  aiScore: number
  signal: Signal
  factors: string[]
  winRate: number // 预期胜率 %
  mktCap: number // 总市值（亿元）
  pe: number
  pb: number
  roe?: number // %（演示数据专用，真实行情源不提供）
  turnover: number // 换手率 %
  pos60?: number // 现价处于近 60 日区间的位置（0-100）
  cashflow?: { period: string; value: number }[] // 最近四个单季度经营现金流净额（亿元，新的在前）
  radar: number[] // [动量, 价值, 成长, 资金流, 情绪, 技术形态] 0-100
  series: number[] // 近 60 日收盘价
  aiText: string
}

// 确定性伪随机数（mulberry32），保证每次刷新数据一致
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 生成 60 日价格序列（几何随机游走 + 趋势漂移）
function genSeries(seed: number, start: number, drift: number, vol: number): number[] {
  const rand = mulberry32(seed)
  const out: number[] = []
  let p = start
  for (let i = 0; i < 60; i++) {
    p = p * (1 + drift + (rand() - 0.5) * vol)
    out.push(Number(p.toFixed(2)))
  }
  return out
}

function mk(
  seed: number,
  code: string,
  name: string,
  industry: string,
  changePct: number,
  aiScore: number,
  signal: Signal,
  factors: string[],
  winRate: number,
  mktCap: number,
  pe: number,
  pb: number,
  roe: number,
  turnover: number,
  radar: number[],
  startPrice: number,
  drift: number,
  aiText: string,
): Stock {
  const series = genSeries(seed, startPrice, drift, 0.028)
  return {
    code,
    name,
    industry,
    price: series[series.length - 1],
    changePct,
    aiScore,
    signal,
    factors,
    winRate,
    mktCap,
    pe,
    pb,
    roe,
    turnover,
    radar,
    series,
    aiText,
  }
}

export const STOCKS: Stock[] = [
  mk(101, '688123.SH', '星澜科技', '半导体设备', 4.62, 94, '强烈买入', ['动量', '成长', '资金流'], 78, 486, 52.3, 8.1, 15.6, 6.8,
    [95, 42, 92, 88, 76, 90], 38.2, 0.004,
    'AI 引擎检测到该股连续 12 日主力资金净流入，动量与成长因子双重命中；板块景气度上行，量价配合良好，模型给出高置信度买入信号。'),
  mk(102, '300789.SZ', '北辰半导体', '芯片设计', 3.87, 91, '强烈买入', ['动量', '技术形态', '情绪'], 74, 312, 68.4, 9.6, 14.1, 9.2,
    [92, 35, 88, 79, 84, 93], 56.5, 0.0035,
    '日线级别突破长期整理平台，技术形态因子显著走强；舆情情绪升温，北向资金持股比例连续三周提升。'),
  mk(103, '600456.SH', '华曜能源', '光伏设备', 2.94, 88, '买入', ['价值', '成长', '资金流'], 71, 758, 18.2, 2.4, 13.2, 3.1,
    [68, 82, 85, 76, 58, 72], 24.8, 0.0028,
    '估值处于近三年 20% 分位，价值因子突出；新增产能投放带动盈利预测上修，资金悄然回流。'),
  mk(104, '688234.SH', '天枢智能', '人工智能', 5.13, 90, '强烈买入', ['动量', '成长', '情绪'], 76, 623, 88.6, 12.3, 11.8, 11.4,
    [94, 30, 95, 72, 90, 86], 92.0, 0.0042,
    'AI 应用落地加速，订单能见度提升；动量因子全市场前 1%，情绪指数创半年新高，弹性充足。'),
  mk(105, '002671.SZ', '峰瑞新材', '新材料', 1.86, 84, '买入', ['价值', '技术形态'], 66, 205, 24.7, 3.1, 12.5, 2.6,
    [62, 78, 64, 55, 48, 80], 31.4, 0.002,
    '股价回踩年线获得支撑，底部结构扎实；上游原料降价改善毛利，价值与形态因子共振。'),
  mk(106, '601872.SH', '沧浪航运', '航运港口', -0.72, 58, '观望', ['价值'], 52, 892, 9.8, 1.1, 9.4, 1.2,
    [35, 88, 40, 42, 36, 45], 18.6, -0.0005,
    '运价指数回落，动量走弱；估值虽低但缺乏催化，模型建议观望等待右侧信号。'),
  mk(107, '300952.SZ', '曜阳医疗', '创新药', 2.35, 86, '买入', ['成长', '资金流', '情绪'], 69, 445, 45.2, 6.8, 16.3, 4.7,
    [70, 48, 90, 82, 71, 66], 68.3, 0.0026,
    '核心管线 III 期数据即将读出，资金流因子连续走强；机构调研热度显著上升。'),
  mk(108, '688559.SH', '量子芯联', '量子计算', 6.28, 89, '买入', ['动量', '情绪', '技术形态'], 72, 287, 120.5, 15.2, 8.9, 14.8,
    [96, 22, 85, 68, 92, 88], 134.0, 0.0045,
    '主题催化密集，情绪因子爆表；波动率同步放大，模型提示控制仓位、快进快出。'),
  mk(109, '600089.SH', '恒岳特变', '电力设备', 1.24, 79, '持有', ['价值', '成长'], 61, 534, 16.5, 2.2, 13.4, 1.8,
    [55, 80, 72, 50, 44, 58], 22.7, 0.0012,
    '特高压招标放量支撑业绩确定性，估值合理；短期缺乏弹性，建议持有。'),
  mk(110, '003816.SZ', '青禾种业', '农业种植', -1.45, 47, '观望', [], 44, 158, 32.1, 2.9, 8.7, 2.2,
    [30, 55, 42, 35, 40, 38], 12.9, -0.001,
    '行业处于去库存阶段，多因子评分全线偏弱，模型未发出入场信号。'),
  mk(111, '688036.SH', '听海声学', '消费电子', 3.42, 87, '买入', ['动量', '技术形态', '成长'], 73, 396, 38.9, 5.4, 14.2, 5.9,
    [88, 52, 81, 74, 66, 89], 45.6, 0.0032,
    '新品周期开启，周线级别杯柄形态构筑完成；动量与形态因子同步命中。'),
  mk(112, '601228.SH', '白云机场快线', '交通运输', 0.58, 71, '持有', ['价值'], 58, 678, 14.2, 1.6, 11.2, 0.9,
    [42, 84, 52, 48, 42, 50], 9.8, 0.0006,
    '客流恢复至疫情前 110%，盈利稳步修复；防御属性突出，适合底仓配置。'),
  mk(113, '300124.SZ', '汇流智控', '工业自动化', 2.08, 83, '买入', ['成长', '资金流'], 67, 812, 42.3, 7.2, 18.6, 2.4,
    [66, 58, 89, 80, 55, 64], 58.9, 0.0022,
    '制造业资本开支回暖，在手订单同比 +35%；高 ROE 成长标的，回调即是机会。'),
  mk(114, '688981.SH', '晶岳制造', '晶圆代工', 1.97, 82, '买入', ['动量', '资金流'], 65, 2145, 35.6, 4.8, 10.4, 3.3,
    [78, 60, 68, 84, 62, 70], 82.4, 0.0018,
    '成熟制程稼动率回升，主力资金连续净流入；国产替代长逻辑不变。'),
  mk(115, '600309.SH', '万华新材集团', '基础化工', -0.35, 63, '持有', ['价值'], 55, 1876, 13.8, 2.0, 14.8, 0.7,
    [38, 86, 58, 44, 40, 46], 45.2, -0.0003,
    '周期底部区域，龙头成本优势明显；等待需求侧催化，持有为主。'),
  mk(116, '002594.SZ', '比迪亚汽车', '新能源汽车', 2.76, 85, '买入', ['成长', '动量', '情绪'], 70, 6850, 24.5, 4.6, 19.2, 2.1,
    [82, 62, 91, 70, 78, 74], 268.0, 0.0024,
    '新车型订单超预期，出口数据亮眼；成长与动量双高，机构一致上调盈利预测。'),
  mk(117, '688012.SH', '中微雕刻', '半导体设备', 1.53, 80, '持有', ['成长', '资金流'], 62, 1058, 58.7, 8.9, 12.6, 2.8,
    [60, 45, 86, 72, 52, 62], 168.5, 0.0015,
    '刻蚀设备份额持续提升，基本面扎实；前期涨幅已部分兑现，持有观察。'),
  mk(118, '600519.SH', '黔醉酒业', '白酒', 0.92, 69, '持有', ['价值', '情绪'], 57, 19800, 22.4, 7.8, 28.5, 0.4,
    [40, 78, 62, 50, 58, 48], 1520.0, 0.0005,
    '批价企稳回升，渠道库存去化良好；防御与分红价值凸显，适合长线配置。'),
]

// ── 市场概览 ─────────────────────────────────────────────────

export interface IndexQuote {
  name: string
  value: number
  changePct: number
}

export const INDICES: IndexQuote[] = [
  { name: '上证指数', value: 3287.45, changePct: 0.86 },
  { name: '深证成指', value: 10582.31, changePct: 1.42 },
  { name: '创业板指', value: 2176.88, changePct: 2.15 },
  { name: '科创50', value: 986.24, changePct: 1.73 },
]

export const MARKET_STATS = {
  upCount: 3842,
  downCount: 1456,
  turnover: 10842, // 两市成交额（亿元）
}

// ── 组合回测（近 12 个月，累计净值）──────────────────────────

export interface BacktestPoint {
  month: string
  strategy: number
  benchmark: number
}

export const BACKTEST: BacktestPoint[] = [
  { month: '8月', strategy: 1.0, benchmark: 1.0 },
  { month: '9月', strategy: 1.032, benchmark: 1.011 },
  { month: '10月', strategy: 1.058, benchmark: 0.998 },
  { month: '11月', strategy: 1.091, benchmark: 1.024 },
  { month: '12月', strategy: 1.124, benchmark: 1.037 },
  { month: '1月', strategy: 1.102, benchmark: 1.012 },
  { month: '2月', strategy: 1.156, benchmark: 1.045 },
  { month: '3月', strategy: 1.189, benchmark: 1.052 },
  { month: '4月', strategy: 1.171, benchmark: 1.028 },
  { month: '5月', strategy: 1.228, benchmark: 1.061 },
  { month: '6月', strategy: 1.274, benchmark: 1.073 },
  { month: '7月', strategy: 1.318, benchmark: 1.082 },
]

export const BACKTEST_METRICS = {
  annualReturn: 34.6, // 年化收益 %
  sharpe: 1.82,
  maxDrawdown: -6.4, // %
  winRate: 68.5, // %
  excessReturn: 23.2, // 超额收益 %
}

export const MONTHLY_BARS = BACKTEST.slice(1).map((p, i) => ({
  month: p.month,
  strategy: Number((((p.strategy / BACKTEST[i].strategy) - 1) * 100).toFixed(1)),
  benchmark: Number((((p.benchmark / BACKTEST[i].benchmark) - 1) * 100).toFixed(1)),
}))

export const ALL_FACTORS = ['动量', '价值', '成长', '资金流', '情绪', '技术形态']

export const RADAR_LABELS = ['动量', '价值', '成长', '资金流', '情绪', '技术形态']
