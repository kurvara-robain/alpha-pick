// ─────────────────────────────────────────────────────────────
// 策略 DSL Schema v1 — 可版本化、可校验的策略中间表示
// 桥接：自然语言 → 结构化条件 → DSL → 选股/回测执行计划
// ─────────────────────────────────────────────────────────────

/** DSL 顶级 Schema 版本号（变更时递增，用于迁移） */
export const DSL_SCHEMA_VERSION = 1

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type Market = 'A_SHARE' | 'HK' | 'US'

export interface UniverseSpec {
  market: Market
  as_of: 'runtime' | string // 'runtime' = 运行时日期，否则为 ISO 日期
  exclude: string[] // ['ST', 'suspended', 'listed_days_lt:120', ...]
}

export type FilterOperator = 'between' | 'less_than' | 'greater_than' | 'equals' | 'top_pct'

export interface FilterCondition {
  field: string // 'pe_ttm' | 'pb' | 'mkt_cap' | 'roe_ttm' | 'turnover' | ...
  operator: FilterOperator
  value: number | [number, number] // between 时为 [lower, upper]
  raw?: string // 用户原始自然语言片段
}

export interface SignalSpec {
  factor: string // 因子 ID
  direction: 'ascending' | 'descending' // ascending = 值小优先
  weight: number // 0-1
}

export interface PortfolioSpec {
  method: 'equal_weight' | 'factor_weighted' | 'risk_parity'
  top_n: number
  rebalance: 'daily' | 'weekly' | 'monthly'
  constraints?: {
    max_single_weight?: number
    max_industry_weight?: number
    min_turnover_pct?: number
  }
}

export interface ExecutionSpec {
  market: string
  t_plus_one: boolean
  price: 'next_open' | 'next_close' | 'next_tradable_open'
  commission_bps?: number // 佣金 万分之一 = 1
  stamp_tax_bps?: number // 印花税
  slippage_bps?: number // 滑点
}

/** 完整策略 DSL 文档 */
export interface StrategyDSL {
  schema_version: number
  name: string
  description?: string
  universe: UniverseSpec
  filters: FilterCondition[]
  signals: SignalSpec[]
  portfolio: PortfolioSpec
  execution: ExecutionSpec
  /** 元数据：此 DSL 的来源 */
  meta?: {
    source: 'nl' | 'manual' | 'seed' | 'import'
    originalNL?: string // NL 原文
    createdAt: string
    version: number
    parentVersion?: number
  }
}

// ═══════════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════════

export interface DSLValidationError {
  path: string // 字段路径，如 'filters[0].value'
  message: string
}

export function validateDSL(dsl: unknown): DSLValidationError[] {
  const errors: DSLValidationError[] = []
  const d = dsl as Record<string, unknown>

  if (!d || typeof d !== 'object') {
    return [{ path: '', message: 'DSL 必须是一个对象' }]
  }

  if (d.schema_version !== DSL_SCHEMA_VERSION) {
    errors.push({ path: 'schema_version', message: `需要版本 ${DSL_SCHEMA_VERSION}，实际为 ${d.schema_version}` })
  }

  if (!d.name || typeof d.name !== 'string') {
    errors.push({ path: 'name', message: '策略名称(name)为必填字符串' })
  }

  if (!d.universe || typeof d.universe !== 'object') {
    errors.push({ path: 'universe', message: '股票池(universe)为必填项' })
  } else {
    const u = d.universe as Record<string, unknown>
    if (!['A_SHARE', 'HK', 'US'].includes(u.market as string)) {
      errors.push({ path: 'universe.market', message: `不支持的 market: ${u.market}` })
    }
  }

  if (!Array.isArray(d.filters)) {
    errors.push({ path: 'filters', message: '筛选条件(filters)必须为数组' })
  }

  if (!Array.isArray(d.signals)) {
    errors.push({ path: 'signals', message: '因子信号(signals)必须为数组' })
  }

  if (!d.portfolio || typeof d.portfolio !== 'object') {
    errors.push({ path: 'portfolio', message: '组合配置(portfolio)为必填项' })
  } else {
    const p = d.portfolio as Record<string, unknown>
    if (typeof p.top_n !== 'number' || p.top_n < 1) {
      errors.push({ path: 'portfolio.top_n', message: '持仓数量(top_n)必须 ≥ 1' })
    }
    if (!['equal_weight', 'factor_weighted', 'risk_parity'].includes(p.method as string)) {
      errors.push({ path: 'portfolio.method', message: `不支持的组合方法: ${p.method}` })
    }
  }

  // 权重总和检查
  if (Array.isArray(d.signals) && d.signals.length > 0) {
    const totalWeight = (d.signals as SignalSpec[]).reduce((s, sig) => s + (sig.weight ?? 0), 0)
    if (Math.abs(totalWeight - 1) > 0.01) {
      errors.push({ path: 'signals', message: `因子权重之和应为 1.0，实际为 ${totalWeight.toFixed(2)}` })
    }
  }

  return errors
}

// ═══════════════════════════════════════════════════════════════
// NL → DSL 桥接：将 parseStrategyNL 的结果转换为 DSL
// ═══════════════════════════════════════════════════════════════

import type { StrategyCondition } from './types'

/** 从现有的 StrategyCondition[] 构建 DSL filters */
function conditionsToFilters(conditions: StrategyCondition[]): FilterCondition[] {
  return conditions
    .filter((c) => c.field !== '__sort')
    .map((c) => {
      const opMap: Record<string, FilterOperator> = {
        '<': 'less_than', '>': 'greater_than', '=': 'equals',
        top_pct: 'top_pct', between: 'between',
      }
      return {
        field: c.field,
        operator: opMap[c.op] ?? 'equals',
        value: c.value as number | [number, number],
        raw: c.raw,
      }
    })
}

/** 从 NL 解析结果 + 因子列表构建完整的 DSL 文档 */
export function buildDSLFromNL(
  name: string,
  conditions: StrategyCondition[],
  factorIds: string[],
  originalNL: string,
  topN = 25,
): StrategyDSL {
  const filters = conditionsToFilters(conditions)

  const signals: SignalSpec[] = factorIds.map((id, i) => ({
    factor: id,
    direction: 'ascending' as const,
    weight: 1 / factorIds.length,
  }))

  // 如果只有一个因子，权重为 1
  if (signals.length === 1) signals[0].weight = 1

  return {
    schema_version: DSL_SCHEMA_VERSION,
    name,
    universe: {
      market: 'A_SHARE',
      as_of: 'runtime',
      exclude: ['ST', 'listed_days_lt:120'],
    },
    filters,
    signals,
    portfolio: {
      method: 'equal_weight',
      top_n: topN,
      rebalance: 'weekly',
    },
    execution: {
      market: 'CN_A',
      t_plus_one: true,
      price: 'next_tradable_open',
      commission_bps: 2.5,
      stamp_tax_bps: 10,
      slippage_bps: 10,
    },
    meta: {
      source: 'nl',
      originalNL,
      createdAt: new Date().toISOString(),
      version: 1,
    },
  }
}

/** DSL 序列化为 YAML 友好格式（JSON，字段对齐可读） */
export function serializeDSL(dsl: StrategyDSL): string {
  return JSON.stringify(dsl, null, 2)
}

/** 从 JSON 字符串反序列化 DSL */
export function deserializeDSL(json: string): { dsl: StrategyDSL | null; errors: DSLValidationError[] } {
  try {
    const dsl = JSON.parse(json) as StrategyDSL
    const errors = validateDSL(dsl)
    return { dsl: errors.length === 0 ? dsl : null, errors }
  } catch {
    return { dsl: null, errors: [{ path: '', message: 'JSON 解析失败' }] }
  }
}
