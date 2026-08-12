// ─────────────────────────────────────────────────────────────
// AlphaMind V2 核心主链接线测试
// HomePage NL → createDraftRun → 策略/因子快照 → Workbench
// markRunReady / startScreening / completeScreening → 独立
// CandidateSnapshot（深拷贝）→ Backtest 两阶段（配置只从 Run 派生）
// ＋ 无 runId legacy 路径不变
//
// 与 experimentRun.test.ts（服务状态机 51 项）互补：本文件聚焦
// 「主链接线」跨层契约，全部走真实 lib 服务，不 mock 状态机。
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDB, resetDBForTest, updateDB } from '../lib/store'
import { invalidateMarketCaches } from '../lib/marketData'
import { searchRoute, todayAsOfDate } from '../lib/nlRouting'
import { screeningCore, runScreening } from '../lib/api'
import {
  buildScreeningSpec,
  completeBacktest,
  completeScreening,
  createDraftRun,
  deriveBacktestExecution,
  factorFromSnapshot,
  getBacktestRunRecord,
  getCandidateSnapshot,
  getRun,
  markRunReady,
  prepareBacktest,
  snapshotFactors,
  snapshotStrategies,
  startBacktest,
  startScreening,
  strategyFromSnapshot,
  updateRunConfiguration,
} from '../lib/experimentRun'
import type {
  BacktestExecutionSettings,
  CandidateStock,
  ExperimentRun,
  Factor,
  Strategy,
} from '../lib/types'

const AS_OF = '2026-08-01'

// ── fixtures ──────────────────────────────────────────────────

function makeStrategy(id: string, name: string, pe: number): Strategy {
  return {
    id,
    name,
    description: '',
    kind: 'fixed',
    enabled: true,
    conditions: [{ field: 'pe', op: '<', value: pe, raw: `PE<${pe}` }],
    unsupported: [],
    source: 'manual',
    createdAt: `${AS_OF}T00:00:00.000Z`,
  }
}

function makeFactor(id: string, name: string, field = 'vol20'): Factor {
  return {
    id,
    name,
    source: 'public',
    origin: 'test',
    category: '波动',
    definition: '',
    applicable: '',
    notes: '',
    rule: { field, dir: 'asc', topPct: 50 },
  }
}

function makeCandidates(n = 2): CandidateStock[] {
  return Array.from({ length: n }, (_, i) => ({
    stockCode: `60000${i}.SH`,
    stockName: `测试股${i}`,
    rank: i + 1,
    included: true,
    strategyMatches: ['s1'],
    factorScores: { f1: 10 - i },
    compositeScore: 2,
    inclusionReasons: ['策略「低PE」：PE<20'],
    marketDataTimestamp: `${AS_OF}T10:00:00.000Z`,
  }))
}

/** 种子 db（策略+因子）→ 建 Run → 固化快照 → ready → running_screen → screened */
function runThroughScreening(candidates: CandidateStock[], rebalance: 'weekly' | 'monthly' = 'weekly'): ExperimentRun {
  const s = makeStrategy('s1', '低PE', 20)
  const f = makeFactor('f1', '低波')
  updateDB((d) => {
    d.strategies.push(s)
    d.factors.push(f)
    d.factorPool.push(f.id)
  })
  const run = createDraftRun({ raw: '低PE低波选股' }, AS_OF)
  const spec = buildScreeningSpec(AS_OF, [s], [f])
  spec.rebalance = rebalance
  updateRunConfiguration(
    run.id,
    spec,
    snapshotStrategies([s]),
    snapshotFactors([f]),
    { mode: 'score', description: '低PE低波选股' },
  )
  markRunReady(run.id)
  startScreening(run.id)
  completeScreening(run.id, candidates)
  return getRun(run.id) as ExperimentRun
}

/** legacy 测试用微宇宙：600001 满足 PE<20，600002 不满足 */
const UNIVERSE = [
  {
    code: '600001.SH', name: '测试股1', industry: '制造', price: 10, changePct: 1.2, aiScore: 60,
    signal: '买入', factors: [], winRate: 50, mktCap: 300, pe: 12, pb: 1.5, turnover: 3,
    listDate: '2020-01-01', pos60: 60, mom20: 5, mom60: 15, aboveMa20: true, vol20: 25, vol60: 30,
    cpv20: 0.1, cpv10: 0.1, vcv20: 0.5, vcv60: 0.6, vr2060: 1.1, bias60: 8, park20: 30,
    bigup20: 2, kurt20: 3, ret5: 2, sharpe20: 1.2, maxdd60: 20, roe: 10,
    radar: [50, 50, 50, 50, 50, 50], cashflow: [{ period: '2026Q1', value: 1 }],
  },
  {
    code: '600002.SH', name: '测试股2', industry: '制造', price: 20, changePct: -0.5, aiScore: 40,
    signal: '观望', factors: [], winRate: 40, mktCap: 800, pe: 45, pb: 3.5, turnover: 1,
    listDate: '2021-06-01', pos60: 30, mom20: -3, mom60: -8, aboveMa20: false, vol20: 35, vol60: 40,
    cpv20: 0.2, cpv10: 0.2, vcv20: 0.6, vcv60: 0.7, vr2060: 1.2, bias60: -5, park20: 40,
    bigup20: 0, kurt20: 4, ret5: -1, sharpe20: 0.5, maxdd60: 30, roe: 5,
    radar: [40, 40, 40, 40, 40, 40], cashflow: [{ period: '2026Q1', value: -1 }],
  },
]

function stubUniverseFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('universe.json')) return { ok: true, status: 200, json: async () => UNIVERSE } as Response
      if (url.includes('ml-scores')) return { ok: true, status: 200, json: async () => null } as Response
      return { ok: false, status: 404, json: async () => ({}) } as Response
    }),
  )
}

beforeEach(() => {
  resetDBForTest()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ── (a) HomePage NL → DraftRun 上下文传递 ──────────────────────

describe('(a) HomePage NL → DraftRun 上下文传递', () => {
  it('searchRoute：选股类查询进入主链接线页面，持仓/板块走 legacy 直达路由', () => {
    expect(searchRoute('帮我选出低PE高股息股票')).toBe('/workbench')
    expect(searchRoute('用低PE策略选股')).toBe('/strategies')
    expect(searchRoute('回测一下我的策略')).toBe('/strategies')
    expect(searchRoute('看看动量因子')).toBe('/factors')
    // legacy：不创建 Run 的直达路由
    expect(searchRoute('查看我的持仓')).toBe('/holdings')
    expect(searchRoute('板块轮动机会')).toBe('/market')
  })

  it('createDraftRun 完整保留 NL 查询（规则3）与 asOfDate，可从 store 回读', () => {
    const query = '低PE 且 低波动 的股票'
    const run = createDraftRun({ raw: query }, todayAsOfDate())
    expect(run.status).toBe('draft')
    expect(run.originalQuery.raw).toBe(query)
    expect(run.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const fetched = getRun(run.id)
    expect(fetched?.id).toBe(run.id)
    expect(fetched?.originalQuery.raw).toBe(query)
    expect(fetched?.asOfDate).toBe(run.asOfDate)
  })
})

// ── (b) Workbench 链：markRunReady → startScreening → completeScreening ──

describe('(b) Workbench 链：markRunReady → startScreening → completeScreening', () => {
  it('draft+快照 → ready（configHash 冻结，规则2）→ running_screen → screened，attempt 落盘', () => {
    const s = makeStrategy('s1', '低PE', 20)
    const f = makeFactor('f1', '低波')
    updateDB((d) => {
      d.strategies.push(s)
      d.factors.push(f)
      d.factorPool.push(f.id)
    })
    const run = createDraftRun({ raw: '低PE低波' }, AS_OF)
    const spec = buildScreeningSpec(AS_OF, [s], [f])
    updateRunConfiguration(run.id, spec, snapshotStrategies([s]), snapshotFactors([f]), {
      mode: 'score',
      description: '低PE低波',
    })

    const ready = markRunReady(run.id)
    expect(ready.status).toBe('ready')
    expect(ready.configHash).toBeTruthy()
    // 规则2：ready 以后配置不可修改，修改配置必须新建 Run
    expect(() =>
      updateRunConfiguration(run.id, spec, snapshotStrategies([s]), snapshotFactors([f]), {
        mode: 'score',
        description: '想改配置',
      }),
    ).toThrow()

    const running = startScreening(run.id)
    expect(running.status).toBe('running_screen')
    expect(running.attempts).toHaveLength(1)
    expect(running.attempts[0].stage).toBe('screening')
    expect(running.attempts[0].status).toBe('running')

    const done = completeScreening(run.id, makeCandidates(2))
    expect(done.status).toBe('screened')
    expect(done.candidateSnapshotId).toBeTruthy()
    expect(done.attempts[0].status).toBe('screened')
    expect(done.attempts[0].candidateSnapshotId).toBe(done.candidateSnapshotId)
  })

  it('strategyFromSnapshot / factorFromSnapshot：Workbench 从 Run 快照还原可执行对象，不依赖 db', () => {
    const s = makeStrategy('s1', '低PE', 20)
    const f = makeFactor('f1', '低波')
    updateDB((d) => {
      d.strategies.push(s)
      d.factors.push(f)
      d.factorPool.push(f.id)
    })
    const run = createDraftRun({ raw: '低PE低波' }, AS_OF)
    updateRunConfiguration(
      run.id,
      buildScreeningSpec(AS_OF, [s], [f]),
      snapshotStrategies([s]),
      snapshotFactors([f]),
      { mode: 'score', description: '低PE低波' },
    )
    const frozen = getRun(run.id) as ExperimentRun
    const st = strategyFromSnapshot(frozen.strategySnapshots[0])
    expect(st.id).toBe('s1')
    expect(st.conditions[0].value).toBe(20)
    const ft = factorFromSnapshot(frozen.factorSnapshots[0])
    expect(ft.id).toBe('f1')
    expect(ft.rule?.dir).toBe('asc')
  })
})

// ── (c) completeScreening 创建独立 CandidateSnapshot（深拷贝） ──

describe('(c) completeScreening 创建独立 CandidateSnapshot（深拷贝）', () => {
  it('调用方后续修改原数组/嵌套对象不影响快照；快照不依赖 watchlist 存在（规则5）', () => {
    const cands = makeCandidates(2)
    const run = runThroughScreening(cands)

    // 调用方篡改输入数组
    cands.push({ ...makeCandidates(1)[0], stockCode: '999999.SH' })
    cands[0].rank = 999
    cands[0].factorScores.f1 = 12345
    ;(cands[0].inclusionReasons as string[]).push('被篡改')

    const snap = getCandidateSnapshot(run.id)
    expect(snap).not.toBeNull()
    expect(snap!.runId).toBe(run.id)
    expect(snap!.asOfDate).toBe(AS_OF)
    expect(snap!.configHash).toBe(run.configHash)
    expect(snap!.candidates).toHaveLength(2)
    expect(snap!.candidates[0].rank).toBe(1)
    expect(snap!.candidates[0].factorScores.f1).toBe(10)
    expect(snap!.candidates[0].inclusionReasons).toEqual(['策略「低PE」：PE<20'])
    expect(snap!.candidates.some((c) => c.stockCode === '999999.SH')).toBe(false)
    // 规则5：候选快照独立于 watchlist（从未保存备选清单也可读）
    expect(getDB().watchlists).toHaveLength(0)
  })
})

// ── (d) Backtest 两阶段：配置只从 Run 派生，db 篡改不影响 ──────

describe('(d) Backtest 只从 Run 派生配置（篡改 db 后 spec 不变）', () => {
  it('prepareBacktest→startBacktest→completeBacktest；rebalance 强制取 run.screeningSpec.rebalance；db 篡改不影响 spec', () => {
    const run = runThroughScreening(makeCandidates(2), 'weekly')
    const settings = deriveBacktestExecution(run)
    expect(settings.endDate).toBe(AS_OF)
    expect(settings.startDate < settings.endDate).toBe(true)

    // 阶段1：执行层设置即使夹带 rebalance 也被白名单忽略（研究配置由 Run 派生）
    const record = prepareBacktest(run.id, { ...settings, rebalance: 'daily' } as BacktestExecutionSettings)
    expect(record.spec.rebalance).toBe('weekly')
    expect(record.spec.startDate).toBe(settings.startDate)
    expect(record.spec.endDate).toBe(settings.endDate)
    expect(record.configHash).toBe(run.configHash)

    // 篡改 db.strategies / db.factors / db.factorPool（规则6：禁止从 db 重新拼装）
    updateDB((d) => {
      d.strategies[0].conditions[0].value = 999
      d.strategies.push(makeStrategy('tamper', '篡改策略', 1))
      d.factors.push(makeFactor('tamper-f', '篡改因子'))
      d.factorPool.push('tamper-f')
    })

    const after = getRun(run.id) as ExperimentRun
    // Run 快照深拷贝：db 被篡改后研究配置不变
    expect(after.screeningSpec.strategyConditions[0][0].value).toBe(20)
    // 派生结果也不变（deriveBacktestExecution 只读 Run）
    expect(deriveBacktestExecution(after)).toEqual(settings)

    // 阶段2：启动（configHash 完整性通过 —— 篡改的是 db 而非 Run）
    const started = startBacktest(run.id, record.id)
    expect(started.status).toBe('running')
    expect(getRun(run.id)!.status).toBe('running_backtest')

    const rec = getBacktestRunRecord(run.id)
    expect(rec).not.toBeNull()
    expect(rec!.spec.startDate).toBe(settings.startDate)
    expect(rec!.spec.endDate).toBe(settings.endDate)
    expect(rec!.spec.rebalance).toBe('weekly')
    expect(rec!.configHash).toBe(after.configHash)

    // 完成：结果归档到 record
    const completed = completeBacktest(run.id, 'res-1')
    expect(completed.status).toBe('completed')
    const rec2 = getBacktestRunRecord(run.id)
    expect(rec2!.status).toBe('completed')
    expect(rec2!.backtestResultId).toBe('res-1')
  })
})

// ── (e) 无 runId legacy 路径不变 ───────────────────────────────

describe('(e) 无 runId legacy 路径不变', () => {
  it('screeningCore（legacy runScreening 的引擎）从调用方传入的策略/因子过滤，行为不变', async () => {
    stubUniverseFetch()
    invalidateMarketCaches()
    const hits = await screeningCore([makeStrategy('legacy-s1', '低PE', 20)], [])
    expect(hits).toHaveLength(1)
    expect(hits[0].code).toBe('600001.SH')
    expect(hits[0].name).toBe('测试股1')
    expect(hits[0].strategyIds).toEqual(['legacy-s1'])
    expect(hits[0].reasons.length).toBeGreaterThan(0)
  })

  it('legacy runScreening(strategyIds, factorIds) 仍从 db 读取并返回 WatchItem[]', async () => {
    stubUniverseFetch()
    invalidateMarketCaches()
    updateDB((d) => {
      d.strategies.push(makeStrategy('legacy-s1', '低PE', 20))
      d.strategies.push(makeStrategy('legacy-s2', '高PE', 10))
    })
    vi.useFakeTimers()
    try {
      const p = runScreening(['legacy-s1'], [])
      await vi.advanceTimersByTimeAsync(1500)
      const items = await p
      expect(items).toHaveLength(1)
      expect(items[0].code).toBe('600001.SH')
      expect(items[0]).toHaveProperty('name')
      expect(items[0]).toHaveProperty('reasons')
    } finally {
      vi.useRealTimers()
    }
  })
})
