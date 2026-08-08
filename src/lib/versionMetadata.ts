// ─────────────────────────────────────────────────────────────
// 版本元数据 — 数据/因子/模型/回测产物的可追溯血缘
// 任何推荐股票/回测结果都应能回溯到使用的数据批次和版本
// ─────────────────────────────────────────────────────────────

/** 数据批次版本 */
export interface DataVersion {
  /** 批次标识，如 '2026-08-08' */
  batchId: string
  /** 数据截止日期 */
  dataDate: string
  /** 发布日期（PIT 口径：用户实际可获得此数据的日期） */
  publishDate: string
  /** 数据源 */
  source: string // 'tushare' | 'akshare' | 'manual'
  /** 股票池覆盖：数量 */
  stockCount: number
  /** K 线天数上限 */
  klineDays: number
  /** 质量门禁结果 */
  qualityGate: DataQualityGate
  /** 生成脚本版本/哈希 */
  scriptHash?: string
}

export interface DataQualityGate {
  passed: boolean
  checks: DataQualityCheck[]
  /** 通过检查数 / 总检查数 */
  summary: string
}

export interface DataQualityCheck {
  name: string // 'stocks_count_range', 'kline_days_min', 'null_rate_max', ...
  passed: boolean
  detail: string
}

/** 因子版本 */
export interface FactorVersion {
  factorId: string
  name: string
  formula: string // 因子计算公式（可执行）
  formulaVersion: number
  /** 使用哪个数据批次计算 */
  dataBatchId: string
  /** 计算时间 */
  computedAt: string
  /** 计算脚本版本 */
  scriptVersion?: string
  /** 覆盖股票数 */
  coverage: number
  /** 缺失率 */
  nullRate: number
}

/** 模型版本 */
export interface ModelVersion {
  modelId: string
  name: string
  modelType: string // 'HistGradientBoosting' | 'LightGBM' | ...
  /** 使用的因子版本列表 */
  factorVersions: string[] // factorId@version
  /** 使用的数据批次 */
  dataBatchId: string
  /** 训练窗口 */
  trainStart: string
  trainEnd: string
  /** 验证窗口 */
  validStart: string
  validEnd: string
  /** 样本外窗口 */
  oosStart: string
  oosEnd: string
  /** 训练参数 */
  params: Record<string, unknown>
  /** 性能指标 */
  metrics: {
    icMean?: number
    icir?: number
    rankIC?: number
    sharpe?: number
    maxDrawdown?: number
  }
  /** 训练时间 */
  trainedAt: string
  /** 产物哈希 */
  artifactHash?: string
}

/** 实验版本 */
export interface ExperimentVersion {
  experimentId: string
  strategyDSLId: string
  strategyDSLVersion: number
  /** 使用的数据批次 */
  dataBatchId: string
  /** 使用的因子版本快照 */
  factorSnapshots: FactorVersion[]
  /** 使用的模型版本 */
  modelVersion?: ModelVersion
  /** 回测配置 */
  backtestConfig: {
    startDate: string
    endDate: string
    rebalance: string
    benchmark: string
    costModel: string
  }
  /** 随机种子 */
  randomSeed: number
  /** 代码版本 */
  codeVersion: string // git commit hash
  /** 结果 */
  resultSummary: {
    totalReturn: number
    annualReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
  }
  /** 质量门禁 */
  qualityGate: {
    passed: boolean
    checks: string[]
  }
  /** 创建时间 */
  createdAt: string
}

/** 从市场元数据构建当前数据版本 */
export function buildDataVersion(meta: {
  source: string
  fetchedAt: string
  stockCount: number
  klineDays: number
  upCount: number
  downCount: number
}): DataVersion {
  const date = meta.fetchedAt.slice(0, 10)
  const checks: DataQualityCheck[] = [
    {
      name: 'stock_count_min',
      passed: meta.stockCount >= 4000,
      detail: meta.stockCount >= 4000
        ? `股票池 ${meta.stockCount} 只 ≥ 4000，通过`
        : `股票池 ${meta.stockCount} 只 < 4000，未通过`,
    },
    {
      name: 'kline_days_min',
      passed: meta.klineDays >= 200,
      detail: meta.klineDays >= 200
        ? `K线天数 ${meta.klineDays} ≥ 200，通过`
        : `K线天数 ${meta.klineDays} < 200，未通过`,
    },
    {
      name: 'turnover_valid',
      passed: meta.upCount + meta.downCount > 0,
      detail: `涨跌家数有效：↑${meta.upCount} ↓${meta.downCount}`,
    },
  ]

  const passed = checks.every((c) => c.passed)

  return {
    batchId: date,
    dataDate: date,
    publishDate: meta.fetchedAt,
    source: meta.source,
    stockCount: meta.stockCount,
    klineDays: meta.klineDays,
    qualityGate: {
      passed,
      checks,
      summary: `${checks.filter((c) => c.passed).length}/${checks.length} 项通过`,
    },
  }
}

/** 生成产物血缘链（从数据到组合的完整追溯） */
export function buildLineage(experiment: ExperimentVersion): string[] {
  return [
    `数据批次: ${experiment.dataBatchId}`,
    `因子快照: ${experiment.factorSnapshots.map((f) => `${f.factorId}@v${f.formulaVersion}`).join(', ') || '无'}`,
    experiment.modelVersion
      ? `模型: ${experiment.modelVersion.modelId} (${experiment.modelVersion.modelType})`
      : '',
    `策略 DSL: ${experiment.strategyDSLId}@v${experiment.strategyDSLVersion}`,
    `代码版本: ${experiment.codeVersion}`,
    `随机种子: ${experiment.randomSeed}`,
    `回测: ${experiment.backtestConfig.startDate}~${experiment.backtestConfig.endDate}`,
    `质量门禁: ${experiment.qualityGate.passed ? '✓ 通过' : '✗ 未通过'}`,
  ].filter(Boolean)
}
