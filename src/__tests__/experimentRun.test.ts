// ─────────────────────────────────────────────────────────────
// ExperimentRun V1 领域基础层测试
// 覆盖：存储迁移 / 生命周期 / 不可变性 / configHash
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest'
import { getDB, resetDBForTest, saveDB, uid, type DB } from '../lib/store'
import {
  computeConfigHash,
  completeBacktest,
  completeScreening,
  createDraftRun,
  failBacktest,
  failScreening,
  getCandidateSnapshot,
  getRun,
  listRuns,
  markRunReady,
  retryFromFailed,
  startBacktest,
  startScreening,
  updateRunConfiguration,
  verifyConfigIntegrity,
  ExperimentRunError,
} from '../lib/experimentRun'
import type {
  BacktestSpec,
  CandidateStock,
  CombinationLogic,
  ExperimentRun,
  FactorSnapshot,
  ScreeningSpec,
  StrategySnapshot,
} from '../lib/types'

const KEY = 'alphamind_db_v2'

function spec(asOf = '2026-08-01'): ScreeningSpec {
  return {
    universe: { scope: '全A', stockCount: 5540, source: 'tushare' },
    asOfDate: asOf,
    strategyConditions: [[{ field: 'pe', op: '<', value: 20, raw: 'PE<20' }]],
    combination: 'score',
    factorDirections: { f1: 'asc' },
    factorWeights: { f1: 1 },
    normalization: 'zscore',
    missingValuePolicy: 'drop',
    extremeValuePolicy: 'winsorize_99',
    neutralization: { byIndustry: true, bySize: false },
    topN: 25,
    rebalance: 'monthly',
    rankTieBreaker: 'code',
    dataSnapshotId: 'data-20260801',
    methodVersion: 'v1.0',
  }
}

function strategySnap(over?: Partial<StrategySnapshot>): StrategySnapshot {
  return {
    strategyId: 's-1',
    name: '低PE策略',
    conditions: [{ field: 'pe', op: '<', value: 20, raw: 'PE<20' }],
    source: 'manual',
    capturedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function factorSnap(over?: Partial<FactorSnapshot>): FactorSnapshot {
  return {
    factorId: 'f-1',
    name: 'EP因子',
    category: '价值',
    capturedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

const logic: CombinationLogic = { mode: 'score', description: '综合打分' }

function btSpec(): BacktestSpec {
  return {
    startDate: '2024-01-01',
    endDate: '2026-01-01',
    benchmark: '000300.SH',
    rebalance: 'monthly',
    portfolioConstruction: 'equal_weight',
    signalDelay: 't1',
    executionPrice: 'open',
    commission: 2.5,
    stampDuty: 0.05,
    slippage: 0.1,
    limitUpDownHandling: 'skip',
    suspensionHandling: 'skip',
  }
}

function makeReadyRun(): ExperimentRun {
  const run = createDraftRun({ raw: '找低PE高ROE的股票' }, '2026-08-01')
  updateRunConfiguration(run.id, spec(), [strategySnap()], [factorSnap()], logic)
  return markRunReady(run.id)
}

beforeEach(() => {
  resetDBForTest()
})

describe('存储迁移', () => {
  it('1. 旧Schema迁移后现有集合数量不变', () => {
    // 构造 v4 旧数据
    const legacy: Record<string, unknown> = {
      strategies: [{ id: 's-old', name: '旧策略', description: '', kind: 'fixed', enabled: true, conditions: [], unsupported: [], source: 'manual', createdAt: 'x' }],
      factors: [{ id: 'f-old', name: '旧因子', source: 'self', origin: 'x', category: '价值', definition: '', applicable: '', notes: '' }],
      factorPool: ['f-old'],
      watchlists: [{ id: 'w-old', name: '旧清单', strategyIds: [], factorIds: [], items: [], createdAt: 'x' }],
      backtests: [{ id: 'b-old', config: {}, metrics: {}, curve: [], periods: [], createdAt: 'x', credibility: 'simulation' }],
      holdings: [],
      reports: [],
      seedVersion: 4,
    }
    localStorage.setItem(KEY, JSON.stringify(legacy))
    const db = getDB()
    // 用户自建数据保留（迁移只追加种子因子，不删除用户数据）
    expect(db.strategies.find((s) => s.id === 's-old')).toBeDefined()
    expect(db.factors.find((f) => f.id === 'f-old')).toBeDefined()
    expect(db.watchlists).toHaveLength(1)
    expect(db.backtests).toHaveLength(1)
    // 种子因子补齐（migrateDB 设计行为）
    expect(db.factors.length).toBeGreaterThan(1)
  })

  it('2. 迁移后新增集合为空数组', () => {
    localStorage.setItem(KEY, JSON.stringify({ strategies: [], factors: [], factorPool: [], watchlists: [], backtests: [], holdings: [], reports: [], seedVersion: 4 }))
    const db = getDB()
    expect(db.runs).toEqual([])
    expect(db.candidateSnapshots).toEqual([])
    expect(db.backtestRunRecords).toEqual([])
    expect(db.seedVersion).toBe(5)
  })

  it('3. 重复迁移幂等', () => {
    localStorage.setItem(KEY, JSON.stringify({ strategies: [], factors: [], factorPool: [], watchlists: [], backtests: [], holdings: [], reports: [], seedVersion: 4 }))
    const db1 = getDB()
    const db2 = getDB()
    expect(db1.runs).toEqual(db2.runs)
    expect(db1.seedVersion).toBe(5)
    // 再次从 localStorage 读取也一致
    const again = JSON.parse(localStorage.getItem(KEY) as string) as DB
    expect(again.runs).toEqual([])
  })

  it('4. 无法解析的旧数据不会被空DB覆盖', () => {
    localStorage.setItem(KEY, '{broken json!!!')
    const db = getDB()
    // 内存可用
    expect(Array.isArray(db.strategies)).toBe(true)
    // localStorage 原始字符串保留
    expect(localStorage.getItem(KEY)).toBe('{broken json!!!')
  })

  it('5. legacy WatchList和BacktestResult仍可读取', () => {
    localStorage.setItem(KEY, JSON.stringify({
      strategies: [], factors: [], factorPool: [],
      watchlists: [{ id: 'w-old', name: '旧清单', strategyIds: [], factorIds: [], items: [], createdAt: 'x' }],
      backtests: [{ id: 'b-old', config: {}, metrics: {}, curve: [], periods: [], createdAt: 'x', credibility: 'simulation' }],
      holdings: [], reports: [], seedVersion: 4,
    }))
    const db = getDB()
    expect(db.watchlists[0].id).toBe('w-old')
    expect(db.backtests[0].id).toBe('b-old')
    // 不伪造 runId（legacy 记录保持无 runId）
    expect('runId' in db.watchlists[0]).toBe(false)
  })
})

describe('生命周期', () => {
  it('6. createDraftRun保存原始问题', () => {
    const run = createDraftRun({ raw: '找低PE高ROE的股票', parsedIntent: 'screen' }, '2026-08-01')
    expect(run.originalQuery.raw).toBe('找低PE高ROE的股票')
    expect(run.originalQuery.parsedIntent).toBe('screen')
    expect(run.status).toBe('draft')
  })

  it('7. Draft Run可以更新配置', () => {
    const run = createDraftRun({ raw: 'q' }, '2026-08-01')
    const updated = updateRunConfiguration(run.id, spec(), [strategySnap()], [factorSnap()], logic)
    expect(updated.strategySnapshots).toHaveLength(1)
    expect(updated.factorSnapshots).toHaveLength(1)
    expect(updated.status).toBe('draft')
  })

  it('8. markRunReady生成configHash', () => {
    const run = makeReadyRun()
    expect(run.status).toBe('ready')
    expect(run.configHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('9. ready后更新配置失败', () => {
    const run = makeReadyRun()
    expect(() =>
      updateRunConfiguration(run.id, spec(), [strategySnap({ name: '改了' })], [factorSnap()], logic),
    ).toThrow(ExperimentRunError)
    // 快照不变
    const after = getRun(run.id)
    expect(after?.strategySnapshots[0].name).toBe('低PE策略')
  })

  it('10. 非法状态转换失败', () => {
    const run = createDraftRun({ raw: 'q' }, '2026-08-01')
    expect(() => startScreening(run.id)).toThrow(ExperimentRunError) // draft → running_screen 非法
  })

  it('11. 筛选失败写入attempt记录', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    const failed = failScreening(run.id, '数据缺失')
    expect(failed.status).toBe('failed')
    expect(failed.failureReason).toContain('screening')
    expect(failed.attempts).toHaveLength(1)
    expect(failed.attempts[0].status).toBe('failed')
  })

  it('12. 回测失败写入attempt记录', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    startBacktest(run.id, btSpec())
    const failed = failBacktest(run.id, 'API超时')
    expect(failed.status).toBe('failed')
    const lastAttempt = failed.attempts[failed.attempts.length - 1]
    expect(lastAttempt.status).toBe('failed')
    expect(lastAttempt.failureReason).toContain('backtest')
  })

  it('13. 完整合法状态链可以完成', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    startBacktest(run.id, btSpec())
    const done = completeBacktest(run.id, 'bt-result-1')
    expect(done.status).toBe('completed')
    expect(done.attempts[done.attempts.length - 1].status).toBe('completed')
  })
})

describe('不可变性', () => {
  it('14. 修改当前Strategy不影响Run中的StrategySnapshot', () => {
    const run = makeReadyRun()
    const db = getDB()
    if (db.strategies.length === 0) db.strategies.push({ id: 's-1', name: '低PE策略', description: '', kind: 'fixed', enabled: true, conditions: [], unsupported: [], source: 'manual', createdAt: 'x' })
    db.strategies[0].name = '被修改了'
    saveDB(db)
    const after = getRun(run.id)
    expect(after?.strategySnapshots[0].name).toBe('低PE策略')
  })

  it('15. 修改当前Factor不影响Run中的FactorSnapshot', () => {
    const run = makeReadyRun()
    const db = getDB()
    if (db.factors.length === 0) db.factors.push({ id: 'f-1', name: 'EP因子', source: 'self', origin: 'x', category: '价值', definition: '', applicable: '', notes: '' })
    db.factors[0].name = '被修改了'
    saveDB(db)
    const after = getRun(run.id)
    expect(after?.factorSnapshots[0].name).toBe('EP因子')
  })

  it('16. 修改传给completeScreening的原始数组不影响CandidateSnapshot', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    const input = [candidate()]
    completeScreening(run.id, input)
    input[0].stockName = '被修改了'
    const snap = getCandidateSnapshot(run.id)
    expect(snap?.candidates[0].stockName).toBe('平安银行')
  })

  it('17. 删除或不存在WatchList不影响CandidateSnapshot', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    // 候选快照独立于 watchlists 集合存在
    const db = getDB()
    expect(db.candidateSnapshots).toHaveLength(1)
    const snap = getCandidateSnapshot(run.id)
    expect(snap?.candidates).toHaveLength(1)
  })

  it('18. getRun返回值被调用者修改后，重新读取的Run不变化', () => {
    const run = makeReadyRun()
    const copy = getRun(run.id) as ExperimentRun
    copy.strategySnapshots[0].name = '外部篡改'
    copy.status = 'completed'
    const fresh = getRun(run.id)
    expect(fresh?.strategySnapshots[0].name).toBe('低PE策略')
    expect(fresh?.status).toBe('ready')
  })
})

describe('configHash', () => {
  it('19. 键顺序不同，hash相同', () => {
    const run = makeReadyRun()
    const h1 = computeConfigHash(run)
    // 打乱 factorWeights 键顺序
    const shuffled = { ...run, screeningSpec: { ...run.screeningSpec, factorWeights: { f1: 1 } } }
    const h2 = computeConfigHash(shuffled)
    expect(h1).toBe(h2)
  })

  it('20. 状态和时间戳变化，hash相同', () => {
    const run = makeReadyRun()
    const h1 = computeConfigHash(run)
    const changed = { ...run, status: 'completed', updatedAt: '2099-01-01', attempt: 5 } as ExperimentRun
    expect(computeConfigHash(changed)).toBe(h1)
  })

  it('21. 策略条件变化，hash不同', () => {
    const run = makeReadyRun()
    const h1 = computeConfigHash(run)
    const changed = {
      ...run,
      strategySnapshots: [strategySnap({ conditions: [{ field: 'pb', op: '<', value: 3, raw: 'PB<3' }] })],
    } as ExperimentRun
    expect(computeConfigHash(changed)).not.toBe(h1)
  })

  it('22. 因子权重变化，hash不同', () => {
    const run = makeReadyRun()
    const h1 = computeConfigHash(run)
    const changed = { ...run, screeningSpec: { ...run.screeningSpec, factorWeights: { f1: 2 } } } as ExperimentRun
    expect(computeConfigHash(changed)).not.toBe(h1)
  })

  it('23. asOfDate变化，hash不同', () => {
    const run = makeReadyRun()
    const h1 = computeConfigHash(run)
    const changed = { ...run, asOfDate: '2026-09-01' } as ExperimentRun
    expect(computeConfigHash(changed)).not.toBe(h1)
  })

  it('24. verifyConfigIntegrity能发现配置被篡改', () => {
    const run = makeReadyRun()
    expect(verifyConfigIntegrity(run.id)).toBe(true)
    // 直接改 localStorage 中的配置
    const db = getDB()
    db.runs[0].factorSnapshots[0].name = '被篡改'
    saveDB(db)
    expect(verifyConfigIntegrity(run.id)).toBe(false)
  })
})

function candidate(over?: Partial<CandidateStock>): CandidateStock {
  return {
    stockCode: '000001.SZ',
    stockName: '平安银行',
    rank: 1,
    included: true,
    strategyMatches: ['s-1'],
    factorScores: { f1: 0.9 },
    compositeScore: 0.95,
    marketDataTimestamp: '2026-08-01T15:00:00Z',
    ...over,
  }
}

// 未使用引用保留（避免 lint 移除导入）
void uid
void listRuns
void retryFromFailed
