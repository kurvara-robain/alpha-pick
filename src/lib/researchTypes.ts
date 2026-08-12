// ─────────────────────────────────────────────────────────────
// 投研框架类型定义
// 可插拔的机构研究方法论模板，每个框架定义分析维度和评分规则
// ─────────────────────────────────────────────────────────────

/** 分析维度 */
export interface ResearchDimension {
  id: string
  name: string // 如 "估值安全边际"
  weight: number // 权重 0-1，所有权重之和=1
  description: string
}

/** 单项指标评分规则 */
export interface ResearchIndicator {
  field: string // 对应 UniverseStock / 财务数据的字段
  label: string // 显示名，如 "PE(TTM)"
  /** 评分函数类型 */
  scoreType: 'percentile' | 'threshold' | 'direction'
  /** percentile: 在全市场截面百分位打分（值越小分越高 = 反向） */
  /** threshold: 按阈值区间打分 [{max, score}, ...] */
  thresholds?: { max: number; score: number }[]
  /** direction: -1=越小越好, 1=越大越好 */
  direction?: number
}

/** 投研框架定义 */
export interface ResearchFramework {
  id: string
  name: string // "中金质量成长框架"
  institution: string // "中金公司"
  description: string
  version: string
  dimensions: ResearchDimension[]
  /** 每个维度下的指标 */
  indicators: Record<string, ResearchIndicator[]> // dimensionId → indicators
  /** 来源说明（规则21：不得暗示与机构官方合作/背书） */
  note?: string
}

/** 单维度分析结果 */
export interface DimensionResult {
  dimensionId: string
  name: string
  weight: number
  score: number // 0-100
  details: IndicatorDetail[]
  summary: string // AI 总结文本
}

/** 单项指标得分详情 */
export interface IndicatorDetail {
  field: string
  label: string
  value: number | null
  score: number // 0-100
  percentile?: number // 全市场百分位
  interpretation: string // 解读文本
}

/** 投研报告结果 */
export interface ResearchReport {
  stockCode: string
  stockName: string
  framework: ResearchFramework
  generatedAt: string
  overallScore: number // 0-100 加权综合分
  dimensions: DimensionResult[]
  valuation: ValuationSection
  risks: RiskItem[]
  catalysts: string[]
  peerComparison: PeerItem[]
  /** V2 证据链绑定（规则19/20）：本报告绑定的 EvidenceItem ids */
  evidenceIds?: string[]
  /** V2 绑定（规则20）：本报告对应的 ResearchProject id */
  projectId?: string
  /** V2（规则19）：报告整体是否为模型推断（无本地实测支撑） */
  isModelInference?: boolean
}

export interface ValuationSection {
  peCurrent: number | null
  peHistoricalMedian: number | null
  pePercentile: number | null // 当前PE在历史中的分位
  pbCurrent: number | null
  pbHistoricalMedian: number | null
  dcfEstimate?: number | null
  marginOfSafety?: number | null // 安全边际 %
}

export interface RiskItem {
  category: string // "财务风险"/"行业风险"/"估值风险"/"流动性风险"
  level: '高' | '中' | '低'
  description: string
}

export interface PeerItem {
  code: string
  name: string
  mktCap: number
  pe: number | null
  pb: number | null
  roe: number | null
  revenueGrowth: number | null
}
