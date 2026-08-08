// ─────────────────────────────────────────────────────────────
// 个股投研引擎
// 给定股票 + 投研框架 → 产出多维分析报告（纯函数，可在 Node/浏览器运行）
// ─────────────────────────────────────────────────────────────
import type { UniverseStock } from './marketData'
import type {
  ResearchFramework,
  ResearchReport,
  DimensionResult,
  IndicatorDetail,
  ValuationSection,
  RiskItem,
  PeerItem,
} from './researchTypes'

/** 计算全市场截面百分位（0-100，值越小 = 排名越靠前） */
function percentile(values: number[], v: number, asc: boolean): number {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = asc
    ? sorted.filter((x) => x <= v).length
    : sorted.filter((x) => x >= v).length
  return (rank / sorted.length) * 100
}

/** 指标打分（0-100，100=最优） */
function scoreIndicator(
  stock: UniverseStock,
  indicator: { field: string; direction: number },
  universe: UniverseStock[],
): { value: number | null; score: number; percentile: number } {
  const raw = (stock as unknown as Record<string, unknown>)[indicator.field]
  const v = typeof raw === 'number' && !Number.isNaN(raw) ? raw : null

  if (v === null) return { value: null, score: 50, percentile: 50 } // 缺失给中性分

  const allValues = universe
    .map((s) => (s as unknown as Record<string, unknown>)[indicator.field])
    .filter((x): x is number => typeof x === 'number' && !Number.isNaN(x))

  if (allValues.length < 10) return { value: v, score: 50, percentile: 50 }

  const pct = percentile(allValues, v, indicator.direction === -1)
  
  // 百分位转 0-100 分：direction=1（值大分高），direction=-1（值小分高）
  const score = indicator.direction === 1 ? pct : 100 - pct

  return { value: v, score: Math.round(Math.max(0, Math.min(100, score))), percentile: Math.round(pct) }
}

/** 生成单项指标解读 */
function interpret(field: string, value: number | null, percentile: number, direction: number): string {
  if (value === null) return '数据缺失'
  const rank = percentile >= 80 ? '前20%' : percentile >= 60 ? '前40%' : percentile >= 40 ? '中等' : percentile >= 20 ? '后40%' : '后20%'
  const dir = direction === 1 ? '高' : '低'
  const labels: Record<string, string> = {
    roe: 'ROE', pe: 'PE(TTM)', pb: 'PB', mktCap: '市值',
    mom20: '20日动量', mom60: '60日动量', sharpe20: '动量质量',
    vol20: '20日波动', vol60: '60日波动', maxdd60: '60日最大回撤',
    cpv20: '量价背离', cpv10: '10日量价背离', vcv20: '量能稳定度',
    turnover: '换手率', changePct: '当日涨跌幅', ret5: '5日反转',
    bias60: '60日乖离', vr2060: '量能比',
  }
  const name = labels[field] ?? field
  return `全市场${rank}，${name}${dir}于${percentile}%同类`
}

/** 生成风险清单 */
function assessRisks(stock: UniverseStock, dimensions: DimensionResult[]): RiskItem[] {
  const risks: RiskItem[] = []

  // 估值风险
  if (stock.pe > 100 || stock.pe <= 0) {
    risks.push({ category: '估值风险', level: '高', description: stock.pe <= 0 ? '当前亏损，PE指标失效' : `PE(TTM) ${stock.pe}倍，估值偏高` })
  } else if (stock.pe > 50) {
    risks.push({ category: '估值风险', level: '中', description: `PE(TTM) ${stock.pe}倍，需关注估值消化` })
  }

  // 流动性风险
  if (stock.turnover < 0.5) {
    risks.push({ category: '流动性风险', level: '高', description: `换手率仅${stock.turnover}%，流动性不足` })
  } else if (stock.turnover < 1) {
    risks.push({ category: '流动性风险', level: '中', description: `换手率${stock.turnover}%，交投偏清淡` })
  }

  // 动量风险
  if (stock.mom60 < -20) {
    risks.push({ category: '趋势风险', level: '高', description: `近60日跌幅${Math.abs(stock.mom60).toFixed(1)}%，处于下跌趋势` })
  } else if (stock.mom20 < -10) {
    risks.push({ category: '趋势风险', level: '中', description: `近20日跌幅${Math.abs(stock.mom20).toFixed(1)}%，短期弱势` })
  }

  // 波动风险
  if (stock.vol60 > 60) {
    risks.push({ category: '波动风险', level: '高', description: `60日年化波动率${(stock.vol60 ?? 0).toFixed(0)}%，波动较大` })
  }

  // 低分维度风险
  for (const dim of dimensions) {
    if (dim.score < 30) {
      risks.push({ category: '综合评分', level: '中', description: `${dim.name}维度得分${dim.score}分，显著低于市场平均` })
    }
  }

  if (risks.length === 0) {
    risks.push({ category: '综合评估', level: '低', description: '未识别到显著风险因子，各项指标处于合理区间' })
  }

  return risks
}

/** 生成催化因素 */
function assessCatalysts(stock: UniverseStock, dimensions: DimensionResult[]): string[] {
  const cats: string[] = []

  if (stock.mom20 > 5) cats.push(`短期动量强劲（+${(stock.mom20 ?? 0).toFixed(1)}%），资金持续流入`)
  if (stock.cpv20 < -0.3) cats.push('量价背离信号，可能酝酿突破')
  if (stock.changePct > 3) cats.push(`当日涨幅${(stock.changePct ?? 0).toFixed(1)}%，存在事件驱动`)
  if (stock.roe !== null && stock.roe > 15) cats.push(`ROE ${stock.roe}%，盈利能力突出`)
  if (stock.pe > 0 && stock.pe < 15) cats.push('低估值区间，存在估值修复空间')

  for (const dim of dimensions) {
    if (dim.score >= 80) cats.push(`${dim.name}维度得分${dim.score}分，显著优于市场`)
  }

  if (cats.length === 0) cats.push('暂无明显催化信号，需等待基本面或技术面改善')
  return cats.slice(0, 5)
}

/** 选出同行业可比公司（取市值最接近的5家） */
function findPeers(stock: UniverseStock, universe: UniverseStock[]): PeerItem[] {
  const sameIndustry = universe.filter(
    (s) => s.industry === stock.industry && s.code !== stock.code,
  )
  // 按市值差距排序，取最近的5家
  const ranked = sameIndustry
    .sort((a, b) => Math.abs(a.mktCap - stock.mktCap) - Math.abs(b.mktCap - stock.mktCap))
    .slice(0, 5)
  return ranked.map((s) => ({
    code: s.code,
    name: s.name,
    mktCap: s.mktCap,
    pe: s.pe,
    pb: s.pb,
    roe: s.roe,
    revenueGrowth: s.mom60, // 用60日动量近似增长
  }))
}

/** 主入口：对单只股票运行指定投研框架 */
export function runResearch(
  stock: UniverseStock,
  framework: ResearchFramework,
  universe: UniverseStock[],
): ResearchReport {
  const dimensions: DimensionResult[] = []

  for (const dim of framework.dimensions) {
    const indicators = framework.indicators[dim.id] ?? []
    const details: IndicatorDetail[] = []

    for (const ind of indicators) {
      const { value, score, percentile: pct } = scoreIndicator(
        stock,
        { field: ind.field, direction: ind.direction ?? 1 },
        universe,
      )
      details.push({
        field: ind.field,
        label: ind.label,
        value,
        score,
        percentile: pct,
        interpretation: interpret(ind.field, value, pct, ind.direction ?? 1),
      })
    }

    const avgScore = details.length > 0
      ? Math.round(details.reduce((s, d) => s + d.score, 0) / details.length)
      : 50

    const topDetails = details.filter((d) => d.score >= 70).map((d) => d.label)
    const bottomDetails = details.filter((d) => d.score <= 30).map((d) => d.label)

    let summary = ''
    if (topDetails.length > 0) summary += `优势：${topDetails.join('、')}领先同类。`
    if (bottomDetails.length > 0) summary += `短板：${bottomDetails.join('、')}落后同类。`
    if (!summary) summary = '各项指标处于市场中性水平。'

    dimensions.push({
      dimensionId: dim.id,
      name: dim.name,
      weight: dim.weight,
      score: avgScore,
      details,
      summary,
    })
  }

  const overallScore = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0),
  )

  // 估值分析
  const peValues = universe
    .filter((s) => s.pe > 0 && s.industry === stock.industry)
    .map((s) => s.pe)
    .sort((a, b) => a - b)
  const peMedian = peValues.length > 0 ? peValues[Math.floor(peValues.length / 2)] : null
  const pePct = peValues.length > 0 && stock.pe > 0
    ? Math.round((peValues.filter((v) => v <= stock.pe).length / peValues.length) * 100)
    : null

  const pbValues = universe
    .filter((s) => s.pb > 0 && s.industry === stock.industry)
    .map((s) => s.pb)
    .sort((a, b) => a - b)
  const pbMedian = pbValues.length > 0 ? pbValues[Math.floor(pbValues.length / 2)] : null

  const valuation: ValuationSection = {
    peCurrent: stock.pe > 0 ? stock.pe : null,
    peHistoricalMedian: peMedian,
    pePercentile: pePct,
    pbCurrent: stock.pb > 0 ? stock.pb : null,
    pbHistoricalMedian: pbMedian,
    dcfEstimate: null,
    marginOfSafety: null,
  }

  return {
    stockCode: stock.code,
    stockName: stock.name,
    framework,
    generatedAt: new Date().toISOString(),
    overallScore,
    dimensions,
    valuation,
    risks: assessRisks(stock, dimensions),
    catalysts: assessCatalysts(stock, dimensions),
    peerComparison: findPeers(stock, universe),
  }
}

/** 生成摘要文本（用于快速预览） */
export function generateSummary(report: ResearchReport): string {
  const rating = report.overallScore >= 80 ? '强烈推荐' : report.overallScore >= 65 ? '推荐' : report.overallScore >= 50 ? '中性' : report.overallScore >= 35 ? '谨慎' : '回避'
  const parts = [
    `「${report.framework.institution} · ${report.framework.name}」综合评分 ${report.overallScore}/100（${rating}）`,
    `估值：${report.valuation.peCurrent ? `PE ${report.valuation.peCurrent}倍` : '亏损'}${report.valuation.pePercentile ? `，同业${report.valuation.pePercentile}%分位` : ''}`,
    `风险：${report.risks.filter((r) => r.level === '高').length}项高风险，${report.risks.filter((r) => r.level === '中').length}项中风险`,
    `催化：${report.catalysts.length}项潜在催化因素`,
  ]
  return parts.join(' · ')
}
