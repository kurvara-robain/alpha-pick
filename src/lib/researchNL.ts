// ─────────────────────────────────────────────────────────────
// 自然语言投研引擎
// 输入自然语言需求 → 解析关键要素 → 生成定制投研报告
// ─────────────────────────────────────────────────────────────
import type { UniverseStock } from './marketData'
import type { ResearchReport, ResearchFramework, ResearchDimension, ResearchIndicator } from './researchTypes'
import { runResearch } from './researchEngine'
import { getKnowledgeContext } from './researchKnowledge'

/** NL 解析结果 */
interface ParsedQuery {
  stockCode?: string
  stockName?: string
  dimensions: string[] // 用户关注的分析维度
  frameworkStyle?: string // 参考的机构风格
  specialRequirements: string[] // 额外要求
  rawQuery: string
}

/** 维度关键词映射 */
const DIMENSION_KEYWORDS: Record<string, string[]> = {
  '估值': ['估值', 'PE', 'PB', '便宜', '低估', '洼地', '安全边际', 'DCF', '现金流折现'],
  '成长': ['成长', '增长', '增速', '动量', '趋势', 'ROE', '盈利'],
  '质量': ['质量', 'ROE', '毛利率', '护城河', '壁垒', '龙头'],
  '动量': ['动量', '趋势', '突破', '强势', '涨幅', '涨'],
  '反转': ['反转', '超跌', '反弹', '抄底', '回调', '底部'],
  '行业': ['行业', '板块', '赛道', '产业链', '景气', '轮动'],
  '风险': ['风险', '回撤', '波动', '稳定', '防御', '安全'],
  '资金': ['资金', '北向', '主力', '筹码', '换手', '成交'],
}

/** 机构风格关键词 */
const STYLE_KEYWORDS: Record<string, string> = {
  '中金': 'cicc-quality',
  '天风': 'tf-industry',
  '中信': 'citics-value',
  '招商': 'cms-growth',
  '国泰君安': 'gtja-compare',
  '华泰': 'htsc-timing',
  '华夏': 'cicc-quality', // 默认映射到质量成长
  '易方达': 'cms-growth',
  '广发': 'tf-industry',
  '富国': 'citics-value',
  '雪球': 'cms-growth', // 社区风格→动量
  'GARP': 'cms-growth', // Growth at Reasonable Price
  '价值投资': 'citics-value',
  '成长投资': 'cms-growth',
  '趋势交易': 'tf-industry',
  '量化': 'htsc-timing',
}

function parseQuery(query: string, universe: UniverseStock[]): ParsedQuery {
  const result: ParsedQuery = {
    dimensions: [],
    specialRequirements: [],
    rawQuery: query,
  }

  // 1. 提取股票代码/名称
  const codeMatch = query.match(/(\d{6})/)
  if (codeMatch) {
    const code = codeMatch[1]
    const stock = universe.find((s) => s.code.startsWith(code))
    if (stock) {
      result.stockCode = stock.code
      result.stockName = stock.name
    }
  }
  // 按名称搜索
  for (const stock of universe) {
    if (query.includes(stock.name)) {
      result.stockCode = stock.code
      result.stockName = stock.name
      break
    }
  }

  // 2. 提取分析维度
  for (const [dim, keywords] of Object.entries(DIMENSION_KEYWORDS)) {
    if (keywords.some((kw) => query.includes(kw))) {
      result.dimensions.push(dim)
    }
  }
  if (result.dimensions.length === 0) {
    result.dimensions = ['估值', '成长', '质量'] // 默认
  }

  // 3. 提取机构风格
  for (const [keyword, frameworkId] of Object.entries(STYLE_KEYWORDS)) {
    if (query.includes(keyword)) {
      result.frameworkStyle = frameworkId
      break
    }
  }

  // 4. 额外要求
  const extraPatterns = [
    /对比(.+?)(?:和|与|vs)(.+)/,
    /风险提示/,
    /目标价/,
    /买入|卖出|持有|增持|减持/,
    /仓位/,
  ]
  for (const pat of extraPatterns) {
    const m = query.match(pat)
    if (m) result.specialRequirements.push(m[0])
  }

  return result
}

/** 根据 NL 解析结果动态构建投研框架 */
function buildDynamicFramework(parsed: ParsedQuery): ResearchFramework {
  const dimensions: ResearchDimension[] = []
  const indicators: Record<string, ResearchIndicator[]> = {}

  const dimWeights: Record<string, Record<string, number>> = {
    '估值': { pe: -1, pb: -1, mktCap: -1 },
    '成长': { mom20: 1, mom60: 1, sharpe20: 1 },
    '质量': { roe: 1, vol60: -1, maxdd60: -1 },
    '动量': { mom20: 1, sharpe20: 1, turnover: 1 },
    '反转': { ret5: -1, bias60: -1, cpv20: -1 },
    '行业': { changePct: 1, turnover: 1, mktCap: 1 },
    '风险': { vol60: -1, maxdd60: -1, vcv20: -1 },
    '资金': { turnover: 1, vcv20: -1, cpv20: -1 },
  }

  const dimLabels: Record<string, string> = {
    '估值': '估值安全边际', '成长': '成长动能', '质量': '盈利质量',
    '动量': '趋势强度', '反转': '反转信号', '行业': '行业景气',
    '风险': '风险控制', '资金': '资金流向',
  }

  const totalDims = parsed.dimensions.length
  for (const dim of parsed.dimensions) {
    const fields = dimWeights[dim]
    if (!fields) continue

    dimensions.push({
      id: `nl-${dim}`,
      name: dimLabels[dim] ?? dim,
      weight: 1 / totalDims,
      description: `基于自然语言需求提取的${dimLabels[dim] ?? dim}分析维度`,
    })

    indicators[`nl-${dim}`] = Object.entries(fields).map(([field, dir]) => ({
      field,
      label: field,
      scoreType: 'percentile' as const,
      direction: dir,
    }))
  }

  return {
    id: 'nl-custom',
    name: '自定义投研框架',
    institution: parsed.frameworkStyle
      ? `参考${Object.entries(STYLE_KEYWORDS).find(([, v]) => v === parsed.frameworkStyle)?.[0] ?? '自定义'}方法论`
      : '自然语言定制',
    description: `根据需求「${parsed.rawQuery.slice(0, 80)}${parsed.rawQuery.length > 80 ? '…' : ''}」动态生成`,
    version: 'nl-1.0',
    dimensions,
    indicators,
  }
}

/** 生成 NL 驱动的叙述性研究报告 */
export function generateNLResearchReport(
  query: string,
  universe: UniverseStock[],
): { report: ResearchReport | null; context: string; warnings: string[] } {
  const parsed = parseQuery(query, universe)
  const warnings: string[] = []

  if (!parsed.stockCode) {
    warnings.push('未识别到股票代码或名称，请在输入中包含6位代码或完整股票名称')
  }

  if (parsed.dimensions.length === 0) {
    warnings.push('未识别到分析维度，使用默认维度（估值/成长/质量）')
  }

  // 构建知识库上下文
  const knowledgeContext = getKnowledgeContext()

  let report: ResearchReport | null = null
  if (parsed.stockCode) {
    const stock = universe.find((s) => s.code === parsed.stockCode)
    if (stock) {
      const framework = buildDynamicFramework(parsed)
      report = runResearch(stock, framework, universe)
    } else {
      warnings.push(`未在股票池中找到 ${parsed.stockCode}`)
    }
  }

  return {
    report,
    context: knowledgeContext,
    warnings,
  }
}

/** 生成叙述性摘要 */
export function generateNarrativeSummary(query: string, report: ResearchReport | null, context: string): string {
  if (!report) {
    return `未找到匹配股票，请确认代码或名称后重试。\n\n${context ? `知识库参考：\n${context}` : ''}`
  }

  const rating = report.overallScore >= 80 ? '【强烈推荐】' : report.overallScore >= 60 ? '【推荐】' : report.overallScore >= 40 ? '【中性偏谨慎】' : '【回避】'
  const lines = [
    `## ${report.stockName}（${report.stockCode}）定制投研报告`,
    '',
    `> 分析需求：${query}`,
    `> 分析框架：${report.framework.institution} · ${report.framework.name}`,
    `> 生成时间：${new Date(report.generatedAt).toLocaleString('zh-CN')}`,
    '',
    `### 综合结论：${rating} 综合评分 ${report.overallScore}/100`,
    '',
  ]

  // 各维度分析
  for (const dim of report.dimensions) {
    lines.push(`**${dim.name}**（权重 ${(dim.weight * 100).toFixed(0)}%） — 得分 ${dim.score}/100`)
    lines.push(`> ${dim.summary}`)
    for (const d of dim.details) {
      const dir = d.score >= 70 ? '✅' : d.score <= 30 ? '⚠️' : '•'
      lines.push(`  ${dir} ${d.label}: ${d.value?.toFixed(2) ?? '—'}（全市场分位 ${d.percentile}%）`)
    }
    lines.push('')
  }

  // 估值
  if (report.valuation.peCurrent) {
    lines.push(`**估值参考**：PE ${report.valuation.peCurrent.toFixed(1)}倍，同业 ${report.valuation.pePercentile ?? '—'}% 分位`)
  }

  // 风险
  const highRisks = report.risks.filter((r) => r.level === '高')
  if (highRisks.length > 0) {
    lines.push(`\n**风险提示**：${highRisks.map((r) => r.description).join('；')}`)
  }

  // 催化
  if (report.catalysts.length > 0) {
    lines.push(`\n**潜在催化**：${report.catalysts.slice(0, 3).join('；')}`)
  }

  // 知识库
  if (context) {
    lines.push(`\n---\n### 相关研报参考\n${context}`)
  }

  // 声明
  lines.push('\n---\n*以上分析基于公开行情数据与因子截面排名，由自然语言需求驱动生成，不构成投资建议。*')

  return lines.join('\n')
}
