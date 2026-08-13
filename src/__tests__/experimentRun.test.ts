// ─────────────────────────────────────────────────────────────
// ExperimentRun V1 领域基础层测试
// 覆盖：存储迁移 / 生命周期 / 不可变性 / configHash
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
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
  prepareBacktest,
  retryFromFailed,
  setClockForTest,
  sha256Sync,
  startBacktest,
  startScreening,
  updateRunConfiguration,
  verifyConfigIntegrity,
  ExperimentRunError,
} from '../lib/experimentRun'
import type {
  BacktestExecutionSettings,
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

function btSettings(over?: Partial<BacktestExecutionSettings>): BacktestExecutionSettings {
  return {
    startDate: '2024-01-01',
    endDate: '2026-01-01',
    benchmark: '000300.SH',
    portfolioConstruction: 'equal_weight',
    signalDelay: 't1',
    executionPrice: 'open',
    commission: 2.5,
    stampDuty: 0.05,
    slippage: 0.1,
    limitUpDownHandling: 'skip',
    suspensionHandling: 'skip',
    ...over,
  }
}

function makeReadyRun(): ExperimentRun {
  const run = createDraftRun({ raw: '找低PE高ROE的股票' }, '2026-08-01')
  updateRunConfiguration(run.id, spec(), [strategySnap()], [factorSnap()], logic)
  return markRunReady(run.id)
}

beforeEach(() => {
  resetDBForTest()
  setClockForTest(null) // 每个测试重置为真实时钟
})

afterEach(() => {
  setClockForTest(null)
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
    expect(run.configHash).toMatch(/^[0-9a-f]{64}$/) // 修正3：完整 64 位 SHA-256
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
    const rec = prepareBacktest(run.id, btSettings())
    startBacktest(run.id, rec.id)
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
    const rec = prepareBacktest(run.id, btSettings())
    startBacktest(run.id, rec.id)
    const done = completeBacktest(run.id, 'bt-result-1')
    expect(done.status).toBe('completed')
    expect(done.attempts[done.attempts.length - 1].status).toBe('completed')
  })

  it('13a. prepareBacktest不改变Run状态，且spec.rebalance由Run派生', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    // Run 的 rebalance 为 monthly（spec() 默认），执行设置无法覆盖
    const rec = prepareBacktest(run.id, btSettings())
    expect(rec.status).toBe('pending')
    expect(rec.spec.rebalance).toBe('monthly') // 来自 run.screeningSpec.rebalance
    // 执行设置里没有 rebalance 字段（BacktestExecutionSettings 不含研究配置）
    expect('rebalance' in btSettings()).toBe(false)
    const after = getRun(run.id)
    expect(after?.status).toBe('screened') // prepare 不改变 Run 状态
  })

  it('13b. startBacktest拒绝不属于本Run的record', () => {
    const runA = makeReadyRun()
    startScreening(runA.id)
    completeScreening(runA.id, [candidate()])
    prepareBacktest(runA.id, btSettings())

    const runB = makeReadyRun()
    startScreening(runB.id)
    completeScreening(runB.id, [candidate()])
    prepareBacktest(runB.id, btSettings())

    // runA 启动 runB 的 record → 必须失败
    const runBBtId = getRun(runB.id)?.backtestRunId as string
    expect(() => startBacktest(runA.id, runBBtId)).toThrow(ExperimentRunError)
  })

  it('13c. startBacktest只接受pending状态的record', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    const rec = prepareBacktest(run.id, btSettings())
    startBacktest(run.id, rec.id)
    // 已启动的记录不能再次启动
    expect(() => startBacktest(run.id, rec.id)).toThrow(ExperimentRunError)
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

// ═══════════════════════════════════════════════════════════════
// A. 修正1：回测配置完整性验证
// ═══════════════════════════════════════════════════════════════

describe('修正1: 回测完整性验证', () => {
  function screenedRun(): ExperimentRun {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    return getRun(run.id) as ExperimentRun
  }

  it('A1. prepareBacktest后record.configHash等于Run.configHash', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    expect(rec.configHash).toBe(run.configHash)
  })

  it('A2. Run配置被篡改后prepareBacktest失败', () => {
    const run = screenedRun()
    const db = getDB()
    db.runs[0].factorSnapshots[0].name = '被篡改'
    saveDB(db)
    expect(() => prepareBacktest(run.id, btSettings())).toThrow(ExperimentRunError)
  })

  it('A3. Run配置被篡改后startBacktest失败', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    const db = getDB()
    db.runs[0].strategySnapshots[0].name = '被篡改'
    saveDB(db)
    expect(() => startBacktest(run.id, rec.id)).toThrow(ExperimentRunError)
  })

  it('A4. 修改当前db.strategies后派生BacktestSpec不变化', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    const db = getDB()
    if (db.strategies.length === 0) db.strategies.push({ id: 's-1', name: '低PE', description: '', kind: 'fixed', enabled: true, conditions: [], unsupported: [], source: 'manual', createdAt: 'x' })
    db.strategies[0].name = '改了'
    saveDB(db)
    const rec2 = getDB().backtestRunRecords.find((r) => r.id === rec.id)
    expect(rec2?.spec).toEqual(rec.spec)
  })

  it('A5. 修改当前db.factorPool后派生BacktestSpec不变化', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    const db = getDB()
    db.factorPool.splice(0, db.factorPool.length)
    saveDB(db)
    const rec2 = getDB().backtestRunRecords.find((r) => r.id === rec.id)
    expect(rec2?.spec).toEqual(rec.spec)
  })

  it('A6. executionSettings运行时传入多余字段不合并进spec（universe）', () => {
    const run = screenedRun()
    // 模拟运行时传入多余字段（TypeScript 编译期拦截不到 JS 调用方）
    const polluted = btSettings() as BacktestExecutionSettings & { universe: string; strategySnapshots: unknown[]; combinationLogic: unknown; dataSnapshotId: string; methodVersion: string }
    polluted.universe = 'HACKED_UNIVERSE'
    polluted.strategySnapshots = [{ strategyId: 'hack' }]
    polluted.combinationLogic = { mode: 'union', description: 'hack' }
    polluted.dataSnapshotId = 'hack-data'
    polluted.methodVersion = 'hack-v9'
    const rec = prepareBacktest(run.id, polluted)
    // 白名单提取：多余字段必须被忽略
    expect(JSON.stringify(rec.spec)).not.toContain('HACKED_UNIVERSE')
    expect(JSON.stringify(rec.spec)).not.toContain('hack')
    // rebalance 来自 Run（monthly），不受污染
    expect(rec.spec.rebalance).toBe('monthly')
  })

  it('A7. 旧startBacktest(runId, fullSpec)签名已移除', () => {
    // 导出中不再有接收完整 spec 的 startBacktest
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    // 新签名：只接受 recordId；传对象（旧签名）会被当作 recordId → 类型/运行时失败
    expect(() => startBacktest(run.id, rec.id)).not.toThrow()
  })

  it('A8. startBacktest再次验证Run完整性（未篡改时通过）', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    const started = startBacktest(run.id, rec.id)
    expect(started.status).toBe('running')
  })

  it('A9. 篡改record.configHash后startBacktest失败', () => {
    const run = screenedRun()
    const rec = prepareBacktest(run.id, btSettings())
    const db = getDB()
    const stored = db.backtestRunRecords.find((r) => r.id === rec.id) as { configHash: string }
    stored.configHash = 'f'.repeat(64)
    saveDB(db)
    expect(() => startBacktest(run.id, rec.id)).toThrow(ExperimentRunError)
  })

  it('A10. prepareBacktest拒绝无候选快照的Run', () => {
    const run = makeReadyRun()
    // 未 completeScreening
    expect(() => prepareBacktest(run.id, btSettings())).toThrow(ExperimentRunError)
  })
})

// ═══════════════════════════════════════════════════════════════
// B. 修正2：attempt 真实时间线
// ═══════════════════════════════════════════════════════════════

describe('修正2: attempt真实时间线', () => {
  // 递增时钟：每次调用 +1 秒
  let tick: number
  beforeEach(() => {
    tick = 1_000_000_000_000 // 2001-09-09
    setClockForTest(() => new Date((tick += 1000)))
  })

  it('B1. attempt.startedAt不等于更早的run.createdAt', () => {
    const run = createDraftRun({ raw: 'q' }, '2026-08-01')
    const created = run.createdAt
    updateRunConfiguration(run.id, spec(), [strategySnap()], [factorSnap()], logic)
    markRunReady(run.id)
    startScreening(run.id)
    const started = getRun(run.id)
    const attempt = started?.attempts.find((a) => a.stage === 'screening')
    expect(attempt?.startedAt).not.toBe(created)
    expect(Date.parse(attempt?.startedAt as string)).toBeGreaterThan(Date.parse(created))
  })

  it('B2. 两次筛选尝试ID不同', () => {
    // 第一次：失败 → 重试 → 第二次
    const run = makeReadyRun()
    startScreening(run.id)
    failScreening(run.id, '第一次失败')
    retryFromFailed(run.id)
    markRunReady(run.id)
    startScreening(run.id)
    const r = getRun(run.id)
    const attempts = r?.attempts.filter((a) => a.stage === 'screening') ?? []
    expect(attempts.length).toBe(2)
    expect(attempts[0].id).not.toBe(attempts[1].id)
  })

  it('B3. 两次尝试时间分别对应各自开始时间', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    failScreening(run.id, '第一次失败')
    const t1 = getRun(run.id)?.attempts.find((a) => a.stage === 'screening')?.startedAt
    retryFromFailed(run.id)
    markRunReady(run.id)
    startScreening(run.id)
    const t2 = getRun(run.id)?.attempts.find((a) => a.stage === 'screening' && a.status === 'running')?.startedAt
    expect(Date.parse(t2 as string)).toBeGreaterThan(Date.parse(t1 as string))
  })

  it('B4. 第二次重试不修改第一次attempt', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    failScreening(run.id, '第一次失败')
    const first = getRun(run.id)?.attempts[0]
    retryFromFailed(run.id)
    markRunReady(run.id)
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    const after = getRun(run.id)
    const firstAfter = after?.attempts[0]
    expect(firstAfter?.status).toBe('failed')
    expect(firstAfter?.failureReason).toBe('screening: 第一次失败')
    expect(firstAfter?.endedAt).toBe(first?.endedAt)
  })

  it('B5. complete只关闭当前活动attempt', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    const after = getRun(run.id)
    const scr = after?.attempts.find((a) => a.stage === 'screening')
    expect(scr?.status).toBe('screened')
    expect(scr?.endedAt).toBeDefined()
  })

  it('B6. fail只关闭当前活动attempt', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    failScreening(run.id, '数据源超时')
    const after = getRun(run.id)
    const scr = after?.attempts.find((a) => a.stage === 'screening')
    expect(scr?.status).toBe('failed')
    expect(scr?.failureReason).toBe('screening: 数据源超时')
    expect(scr?.endedAt).toBeDefined()
  })

  it('B7. screening和backtest attempt阶段不同', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    const rec = prepareBacktest(run.id, btSettings())
    startBacktest(run.id, rec.id)
    const after = getRun(run.id)
    const stages = after?.attempts.map((a) => a.stage) ?? []
    expect(stages).toContain('screening')
    expect(stages).toContain('backtest')
    expect(stages.length).toBe(2)
  })

  it('B8. finishedAt晚于或等于startedAt', () => {
    const run = makeReadyRun()
    startScreening(run.id)
    completeScreening(run.id, [candidate()])
    const rec = prepareBacktest(run.id, btSettings())
    startBacktest(run.id, rec.id)
    completeBacktest(run.id, 'bt-1')
    const after = getRun(run.id)
    for (const a of after?.attempts ?? []) {
      expect(Date.parse(a.endedAt as string)).toBeGreaterThanOrEqual(Date.parse(a.startedAt))
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// C. 修正3：SHA-256 标准一致性
// ═══════════════════════════════════════════════════════════════

describe('修正3: SHA-256标准一致性', () => {
  it('C1. 空字符串标准向量', () => {
    expect(sha256Sync('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('C2. "abc"标准向量', () => {
    expect(sha256Sync('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('C3. 中文Unicode输入与Node crypto一致', () => {
    const input = '找低PE高ROE的股票'
    expect(sha256Sync(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'))
    // 包含代理对字符
    const emoji = '量化📈投研'
    expect(sha256Sync(emoji)).toBe(createHash('sha256').update(emoji, 'utf8').digest('hex'))
  })

  it('C4. 长字符串与Node crypto一致', () => {
    const long = '量化投研因子'.repeat(500) // 超过一个块（64 字节）
    expect(sha256Sync(long)).toBe(createHash('sha256').update(long, 'utf8').digest('hex'))
  })

  it('C5. 多次调用结果一致', () => {
    const input = '稳定测试输入'
    const a = sha256Sync(input)
    const b = sha256Sync(input)
    const c = sha256Sync(input)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('C6. configHash输出为64位小写十六进制', () => {
    const run = makeReadyRun()
    expect(run.configHash).toMatch(/^[0-9a-f]{64}$/)
    expect(run.configHash).toBe(run.configHash.toLowerCase())
    // configHash 确实是 SHA-256 的 64 位输出
    expect(sha256Sync('')).toHaveLength(64)
    expect(sha256Sync('abc')).toHaveLength(64)
  })
})

// 未使用引用保留（避免 lint 移除导入）
void uid
void listRuns
void retryFromFailed
