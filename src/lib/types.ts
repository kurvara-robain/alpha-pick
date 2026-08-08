// ─────────────────────────────────────────────────────────────
// AlphaMind 量化选股系统 · 共享类型定义（所有页面共用，勿随意改动）
// ─────────────────────────────────────────────────────────────

/** 结构化选股条件（策略 DSL 的最小单元） */
export interface StrategyCondition {
  field: string // 'pe' | 'pb' | 'mktCap' | 'turnover' | 'mom_rank' | 'mom_range' | 'above_ma' | 'list_years' | 'exclude_st' | 'exclude_subnew' | '__sort' | ...
  op: string // '<' | '>' | 'top_pct' | 'between' | '=' | 'desc'
  value: number | string | boolean | [number, number] // between 时为 [下限, 上限]
  window?: number // 如 mom_rank / mom_range 的交易日窗口
  raw: string // 用户原始自然语言片段，用于回显
}

export type StrategyKind = 'fixed' | 'temp'

export interface Strategy {
  id: string
  name: string
  description: string
  kind: StrategyKind // 固定策略 / 临时策略
  enabled: boolean
  conditions: StrategyCondition[]
  unsupported: string[] // 无法映射的自然语言片段（须明示"暂不支持"）
  source: 'nl' | 'manual' | 'seed'
  createdAt: string
}

export type FactorStatus = '挖掘中' | '测试中' | '已验证' | '已弃用'

export interface Factor {
  id: string
  name: string
  source: 'public' | 'self' // 网络热门因子库 / 自研因子
  origin: string // 如 'WorldQuant Alpha101'、'Fama-French'、'聚宽社区'、'本系统'
  category: string // 动量 / 价值 / 波动 / 量价 / 情绪 ...
  definition: string // 因子定义与计算逻辑
  applicable: string // 适用市场环境与范围
  notes: string // 使用规范与注意事项
  performance?: string // 历史有效性表现（如有）
  status?: FactorStatus // 仅自研因子有
  sourceUrl?: string // 外部来源链接（联网收集因子有，卡片可点击打开）
  /**
   * 可执行筛选规则（可选）：dir 'asc' = 值小优先，'desc' = 值大优先；
   * topPct = 选全市场截面排名前 topPct%（如 30 表示前 30%）的股票
   */
  rule?: { field: string; dir: 'asc' | 'desc'; topPct: number }
}

/** 备选观察清单中的个股 */
export interface WatchItem {
  code: string
  name: string
  reasons: string[] // 入选原因（触发的策略条件与因子）
}

export interface WatchList {
  id: string
  name: string
  strategyIds: string[]
  factorIds: string[]
  items: WatchItem[]
  createdAt: string
}

export type RebalanceFreq = 'weekly' | 'monthly'

export interface BacktestConfig {
  moduleName: string // 策略+因子组合名
  strategyIds: string[]
  factorIds: string[]
  startDate: string // yyyy-MM-dd
  endDate: string
  rebalance: RebalanceFreq
  capital: number // 初始资金
}

export interface BacktestMetrics {
  totalReturn: number // 累计收益 %
  annualReturn: number
  maxDrawdown: number
  sharpe: number
  winRate: number
  turnover: number // 换手率
}

export interface BacktestPeriod {
  period: string // 如 '2026-06 第2期'
  picks: string[] // 该期选出的股票名称
}

export interface BacktestResult {
  id: string
  config: BacktestConfig
  metrics: BacktestMetrics
  curve: { date: string; strategy: number; benchmark: number }[] // 净值曲线
  periods: BacktestPeriod[] // 历史各期选股池回放
  createdAt: string
}

export type DiagnosisAdvice = '继续持有' | '卖出' | '等待观察'

export interface HoldingDiagnosis {
  advice: DiagnosisAdvice
  reasons: string[] // 分析依据（关键位置、多空结构）
  keyLevels: { support: number; resistance: number }
  factorSignals?: string[] // 量化因子信号（全市场截面百分位口径，如有）
  updatedAt: string
}

/** 缠论分析结果（缠中说禅技术体系，src/lib/chan.ts 引擎产出） */
export interface ChanAnalysis {
  updatedAt: string
  conclusion: string // 一句话结论
  signals: string[] // 分析明细（中文，每条一句）
  trend: 'up' | 'down' | 'consolidation' // 最近笔方向 / 中枢状态
  lastStroke: { dir: 'up' | 'down'; from: string; to: string; fromPrice: number; toPrice: number } // 最近一笔
  strokes?: { from: string; to: string; fromPrice: number; toPrice: number; dir: 'up' | 'down' }[] // 全部笔序列（结构图用，前端按窗口过滤）
  zhongshu: { zg: number; zd: number; startDate: string; endDate: string } | null // 最近生效中枢：ZG 上沿 / ZD 下沿
  buySellPoint: string | null // 如「第三类买点（回踩中枢上沿不破）」，无则 null
  divergence: 'top' | 'bottom' | null // 顶背驰 / 底背驰（简化 MACD 面积法）
  keyLevels: { support: number; resistance: number }
}

export interface Holding {
  id: string
  code: string
  name: string
  cost: number // 成本价
  shares: number // 持仓股数
  addedAt: string
  diagnosis?: HoldingDiagnosis
  chanAnalysis?: ChanAnalysis // 缠论分析结果（如有）
}

export interface DailyReport {
  id: string
  date: string // yyyy-MM-dd
  marketSummary: string // 当日市场概览摘要（对应 P1）
  signalChanges: { added: string[]; removed: string[]; note: string } // 策略信号变化
  recommendations: { code: string; name: string; logic: string }[] // 推荐股票及入选逻辑
  holdingNotes: string[] // 持仓提示（对应 P7）
  risks: string[] // 风险提示
}
