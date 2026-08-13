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

export type BacktestCredibility = 'simulation' | 'research'

export interface BacktestResult {
  id: string
  config: BacktestConfig
  metrics: BacktestMetrics
  curve: { date: string; strategy: number; benchmark: number }[] // 净值曲线
  periods: BacktestPeriod[] // 历史各期选股池回放
  createdAt: string
  credibility: BacktestCredibility // 快速模拟 vs 研究级
  dataVersion?: string // 研究级回测的数据批次版本
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

// ═══════════════════════════════════════════════════════════════
// ExperimentRun V1 领域类型（docs/experiment-run-v1-design.md 闸门设计）
// ═══════════════════════════════════════════════════════════════

/** 用户原始研究问题 */
export interface ResearchQuestion {
  raw: string
  parsedIntent?: string
  extractedEntities?: string[]
}

/** 策略不可变快照 */
export interface StrategySnapshot {
  strategyId: string
  name: string
  conditions: StrategyCondition[] // 深拷贝
  source: Strategy['source']
  capturedAt: string
}

/** 因子不可变快照 */
export interface FactorSnapshot {
  factorId: string
  name: string
  category: string
  rule?: Factor['rule']
  capturedAt: string
}

/** 策略间组合逻辑 */
export interface CombinationLogic {
  mode: 'intersection' | 'union' | 'score'
  description: string
}

/** 股票池定义（冻结） */
export interface UniverseSnapshot {
  scope: string
  stockCount: number
  source: string
}

/** 完整可执行筛选配置（闸门3：一次筛选可重放） */
export interface ScreeningSpec {
  universe: UniverseSnapshot
  asOfDate: string
  strategyConditions: StrategyCondition[][] // 每个策略一组条件
  combination: 'intersection' | 'union' | 'score'
  factorDirections: Record<string, 'asc' | 'desc'>
  factorWeights: Record<string, number>
  normalization: 'zscore' | 'rank' | 'none'
  missingValuePolicy: 'drop' | 'fill_mean' | 'none' | 'unsupported'
  extremeValuePolicy: 'winsorize_99' | 'none' | 'unsupported'
  neutralization: { byIndustry: boolean; bySize: boolean }
  topN: number
  rebalance: 'weekly' | 'monthly'
  rankTieBreaker: 'code' | 'name' | 'none'
  dataSnapshotId: string
  methodVersion: string
}

/** 回测规格（闸门4：回测开始前冻结） */
export interface BacktestSpec {
  startDate: string
  endDate: string
  benchmark: string
  rebalance: 'weekly' | 'monthly'
  portfolioConstruction: 'equal_weight' | 'score_weight'
  signalDelay: 't0' | 't1'
  executionPrice: 'open' | 'close'
  commission: number
  stampDuty: number
  slippage: number
  limitUpDownHandling: 'skip' | 'block'
  suspensionHandling: 'skip' | 'hold'
}

/**
 * 回测执行层设置（修正1）
 * 仅允许调用方提供与 Run 研究配置无关的执行参数。
 * 研究配置（策略/因子/股票池/组合逻辑/rebalance）必须由 Run 派生，
 * 不得出现在此处——防止外部配置覆盖 Run 快照。
 */
export interface BacktestExecutionSettings {
  startDate: string
  endDate: string
  benchmark: string
  portfolioConstruction: 'equal_weight' | 'score_weight'
  signalDelay: 't0' | 't1'
  executionPrice: 'open' | 'close'
  commission: number
  stampDuty: number
  slippage: number
  limitUpDownHandling: 'skip' | 'block'
  suspensionHandling: 'skip' | 'hold'
}

export type ExperimentRunStatus =
  | 'draft'
  | 'ready'
  | 'running_screen'
  | 'screened'
  | 'running_backtest'
  | 'completed'
  | 'failed'

/** 单只候选股（不可变） */
export interface CandidateStock {
  stockCode: string
  stockName: string
  rank: number
  included: boolean
  strategyMatches: string[] // 命中的策略快照 ID
  factorScores: Record<string, number> // 因子快照 ID → 得分
  compositeScore: number
  exclusionReasons?: string[]
  inclusionReasons?: string[]
  marketDataTimestamp: string
}

/** 独立候选快照（闸门2：不依赖 WatchList 存在） */
export interface CandidateSnapshot {
  id: string
  runId: string
  asOfDate: string
  createdAt: string
  universeSnapshot: UniverseSnapshot
  dataSnapshotId: string
  candidates: CandidateStock[]
  configHash: string
}

/** 失败重试历史（闸门5） */
export interface ExperimentAttempt {
  id: string // 每次尝试唯一 ID（同阶段重试创建新 ID）
  attempt: number
  stage: 'screening' | 'backtest' // 尝试阶段
  startedAt: string // 本次操作开始时间（非 run.createdAt）
  endedAt?: string // 完成/失败时间（进行中为 undefined）
  status: 'running' | 'screened' | 'failed' | 'completed'
  failureReason?: string
  candidateSnapshotId?: string
  backtestRunId?: string
}

/** 回测运行记录（闸门4/5） */
export interface BacktestRunRecord {
  id: string
  runId: string
  spec: BacktestSpec
  configHash: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  failureReason?: string
  createdAt: string
  completedAt?: string
  backtestResultId?: string
}

/** ExperimentRun 核心类型（唯一事实来源，闸门1） */
export interface ExperimentRun {
  id: string
  originalQuery: ResearchQuestion
  status: ExperimentRunStatus
  asOfDate: string
  screeningSpec: ScreeningSpec
  strategySnapshots: StrategySnapshot[]
  factorSnapshots: FactorSnapshot[]
  combinationLogic: CombinationLogic
  configHash: string
  candidateSnapshotId?: string
  backtestRunId?: string
  createdAt: string
  updatedAt: string
  failureReason?: string
  failureAt?: string
  attempt: number
  attempts: ExperimentAttempt[]
}

// ═══════════════════════════════════════════════════════════════
// V2 领域类型（AlphaMind V2 重构合同 — 由主 Agent 统一管理，勿分叉定义）
// ═══════════════════════════════════════════════════════════════

/** 数据快照（规则8/9/10/12：全局 PIT 合同与数据新鲜度载体） */
export interface DataSnapshot {
  id: string // 'ds-20260808-001'
  batchId: string // '2026-08-08'
  asOfDate: string // 研究基准日期（PIT 截止日）
  dataDate: string // 数据实际截止日（可能晚于 asOfDate = 前视风险）
  publishDate: string // 数据可得日期
  source: 'tushare' | 'akshare' | 'manual' | 'none'
  stockCount: number
  klineDays: number
  qualityChecks: { name: string; passed: boolean; detail: string }[]
  failureCount: number
  syncStatus: 'synced' | 'partial' | 'failed' | 'unknown'
  snapshotId: string
  scriptHash?: string
  createdAt: string
}

/** 全局 PIT 上下文（规则8：所有模块共用同一 asOfDate） */
export interface PitContext {
  active: boolean
  asOfDate: string | null
  dataSnapshotId: string | null
  /** 不具备真实 PIT 能力的模块必须标记，不得宣称无前视偏差 */
  pitCapable: boolean
}

/** 因子证据等级（规则11/12/13：文献/研报/本地回测/样本外/模型估算必须区分） */
export type FactorEvidenceLevel = 'literature' | 'broker_research' | 'local_backtest' | 'oos_validation' | 'model_estimate' | 'none'

export interface FactorEvidence {
  factorId: string
  level: FactorEvidenceLevel
  source: string // 文献出处 / 研报名 / 本地回测 / 样本外 / 模型
  ic?: number | null
  icir?: number | null
  coverage?: number // 覆盖股票数
  evalWindow?: string // 评估区间，如 '2023-01~2026-08'
  asOfDate?: string
  methodVersion?: string
  evaluatedAt: string
  isProduction: boolean // 规则13：仅本地实测+样本外通过的才可生产
}

/** 因子定义 V2（规则12：版本/公式/方向/数据需求/证据等级） */
export interface FactorDefinition extends Factor {
  formula: string
  formulaVersion: number
  direction: 'asc' | 'desc'
  dataRequirements: string[]
  evidence?: FactorEvidence[]
  coverage?: number
  evalRange?: string
  asOfDate?: string
  methodVersion?: string
  // 规则13：生产可用状态（本地实测+样本外通过）
  productionReady: boolean
}

/** 统一持仓（规则15/16/17：Candidate/Watchlist/Paper/Actual 分离后的持仓单元） */
export interface PortfolioPosition {
  id: string
  code: string
  name: string
  shares: number
  avgCost: number
  currentPrice: number | null
  addedAt: string
  realizedPnL: number
}

/** 统一订单（规则17：模拟组合产生订单/成交/持仓/归因） */
export interface PortfolioOrder {
  id: string
  portfolioId: string
  code: string
  name: string
  side: 'buy' | 'sell'
  price: number
  filledPrice: number
  quantity: number
  status: 'filled' | 'rejected' | 'partial'
  fees: { commission: number; stampTax: number; slippage: number; total: number }
  rejectReason?: string
  createdAt: string
}

/** 模拟组合（规则15/17：由 CandidateSnapshot 创建，独立于 Watchlist） */
export interface PaperPortfolio {
  id: string
  name: string
  runId?: string
  candidateSnapshotId: string
  asOfDate: string
  createdAt: string
  positions: PortfolioPosition[]
  orders: PortfolioOrder[]
  cash: number
  initialCapital: number
  totalValue: number
  realizedPnL: number
  attribution?: PortfolioAttribution
}

/** 组合归因（规则17） */
export interface PortfolioAttribution {
  asOfDate: string
  periodReturn: number
  topContributors: { code: string; name: string; contribution: number }[]
  topDetractors: { code: string; name: string; contribution: number }[]
  sectorExposure: { sector: string; weight: number }[]
}

/** 实际账户（规则15：与模拟组合分离，但结构统一） */
export interface ActualAccount {
  id: string
  name: string
  broker: string
  positions: PortfolioPosition[]
  createdAt: string
}

/** 个股研究项目（规则20：研究报告必须绑定 ResearchProject） */
export interface ResearchProject {
  id: string
  originalQuery: string
  stockCode: string
  stockName: string
  status: 'draft' | 'active' | 'completed'
  runId?: string // 可绑定 ExperimentRun
  asOfDate?: string
  dataSnapshotId?: string
  createdAt: string
  updatedAt: string
}

/** 证据条目（规则19：关键结论必须绑定 EvidenceItem） */
export interface EvidenceItem {
  id: string
  projectId: string
  kind: 'data' | 'document' | 'analysis' | 'model_inference'
  source: string
  summary: string
  detail?: string
  capturedAt: string
  asOfDate?: string
  dataSnapshotId?: string
}

/** 研究结论（规则19/20：绑定证据，无证据标记为模型推断） */
export interface ResearchClaim {
  id: string
  projectId: string
  claim: string
  evidenceIds: string[]
  confidence: 'high' | 'medium' | 'low'
  isModelInference: boolean // 规则19：无证据 → true
  conflicts: string[]
  createdAt: string
}

/** 研究报告 V2（规则20：绑定项目/Run/组合/快照/asOfDate） */
export interface ResearchReportV2 {
  id: string
  projectId: string
  runId?: string
  portfolioId?: string
  dataSnapshotId?: string
  asOfDate: string
  stockCode: string
  stockName: string
  generatedAt: string
  conclusion: string
  claims: string[] // ResearchClaim ids
}
