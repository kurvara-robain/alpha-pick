// ─────────────────────────────────────────────────────────────
// V2 组合/账户/交易统一测试
// 覆盖：候选快照建组合 / placeOrder（成交·资金不足·T+1锁定）/
//       unifiedHeldPositions 三类 legacy 聚合 / legacy 数据不被修改
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest'
import type { CandidateSnapshot, CandidateStock } from '../lib/types'
import { resetDBForTest, updateDB } from '../lib/store'
import {
  createPaperPortfolioFromCandidate,
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  markPortfolioToMarket,
  placeOrder,
} from '../lib/portfolioStore'
import { legacySourceLabel, unifiedHeldPositions } from '../lib/portfolioLegacy'
import { addPosition } from '../lib/positionStore'
import { executeBuy, loadAccount, resetAccount } from '../lib/simTrade'
import { addActualAccount, getAccount, listAccounts } from '../lib/accountStore'

const LEGACY_KEYS = ['alphamind_db_v2', 'alphamind_positions_v1', 'alphamind_sim_account']

function cand(code: string, name: string, rank: number, included: boolean): CandidateStock {
  return {
    stockCode: code,
    stockName: name,
    rank,
    included,
    strategyMatches: ['s-1'],
    factorScores: {},
    compositeScore: 0.9,
    marketDataTimestamp: '2026-08-01T15:00:00Z',
  }
}

function makeSnapshot(): CandidateSnapshot {
  return {
    id: 'snap-1',
    runId: 'run-1',
    asOfDate: '2026-08-01',
    createdAt: '2026-08-01T10:00:00Z',
    universeSnapshot: { scope: 'A_SHARE', stockCount: 3, source: 'test' },
    dataSnapshotId: 'ds-test',
    configHash: 'test-hash',
    candidates: [
      cand('000001.SZ', '平安银行', 1, true),
      cand('600000.SH', '浦发银行', 2, true),
      cand('000002.SZ', '万科A', 3, false),
    ],
  }
}

function seedSnapshot(): void {
  updateDB((db) => {
    db.candidateSnapshots.push(makeSnapshot())
  })
}

beforeEach(() => {
  localStorage.clear()
  resetDBForTest()
  resetAccount()
})

// ═══════════════════════════════════════════════════════════════
// (a) createPaperPortfolioFromCandidate：included 股票等权成仓
// ═══════════════════════════════════════════════════════════════
describe('createPaperPortfolioFromCandidate', () => {
  it('从候选快照创建等权组合：included 成仓、excluded 排除', () => {
    seedSnapshot()
    const prices = new Map([
      ['000001.SZ', 10],
      ['600000.SH', 20],
      ['000002.SZ', 30],
    ])
    const pf = createPaperPortfolioFromCandidate(undefined, 'snap-1', '等权测试组合', 1_000_000, prices)

    expect(pf.candidateSnapshotId).toBe('snap-1')
    expect(pf.runId).toBe('run-1') // 未显式传 runId 时取快照的 runId
    expect(pf.initialCapital).toBe(1_000_000)
    expect(pf.positions.map((p) => p.code).sort()).toEqual(['000001.SZ', '600000.SH'])
    expect(pf.positions.some((p) => p.code === '000002.SZ')).toBe(false) // excluded 不建仓

    const posA = pf.positions.find((p) => p.code === '000001.SZ')!
    const posB = pf.positions.find((p) => p.code === '600000.SH')!
    expect(posA.shares).toBeGreaterThan(0)
    expect(posB.shares).toBeGreaterThan(0)
    // 等权：单票花费不超过 budget = 50 万，且接近（含佣金滑点，误差 < 1000）
    const costA = posA.avgCost * posA.shares
    const costB = posB.avgCost * posB.shares
    expect(costA).toBeLessThanOrEqual(500_000)
    expect(costA).toBeGreaterThan(499_000)
    expect(costB).toBeLessThanOrEqual(500_000)
    expect(costB).toBeGreaterThan(499_000)
    // 真实价格落地：avgCost 含 0.1% 滑点、currentPrice 为快照价
    expect(posA.avgCost).toBeCloseTo(10.01, 2)
    expect(posA.currentPrice).toBe(10)
    expect(posB.avgCost).toBeCloseTo(20.02, 2)
    expect(posB.currentPrice).toBe(20)

    // 初始买入订单全部成交，无负数现金（等权花费受预算约束）
    expect(pf.orders).toHaveLength(2)
    expect(pf.orders.every((o) => o.status === 'filled' && o.side === 'buy')).toBe(true)
    expect(pf.cash).toBeGreaterThanOrEqual(0)
    expect(pf.totalValue).toBeGreaterThan(0)
    expect(pf.totalValue).toBeLessThan(1_000_000) // 滑点+佣金如实扣减
  })

  it('快照不存在时抛错，不产生任何写入', () => {
    expect(() => createPaperPortfolioFromCandidate(undefined, 'nope', 'x', 100_000)).toThrow()
    expect(listPortfolios()).toHaveLength(0)
  })

  it('无 included 候选时抛错', () => {
    updateDB((db) => {
      db.candidateSnapshots.push({ ...makeSnapshot(), id: 'snap-empty', candidates: [cand('000002.SZ', '万科A', 3, false)] })
    })
    expect(() =>
      createPaperPortfolioFromCandidate(undefined, 'snap-empty', 'x', 100_000, new Map([['000002.SZ', 30]])),
    ).toThrow(/included/)
  })
})

// ═══════════════════════════════════════════════════════════════
// (b) placeOrder：买入成交 / 资金不足拒绝 / T+1 锁定
// ═══════════════════════════════════════════════════════════════
describe('placeOrder', () => {
  function portfolioWithOneHolding(): string {
    seedSnapshot()
    const pf = createPaperPortfolioFromCandidate(
      undefined,
      'snap-1',
      '交易测试',
      1_000_000,
      new Map([['000001.SZ', 10]]),
    )
    return pf.id
  }

  it('买入成交：现金扣减、持仓增加、订单 filled', () => {
    const id = portfolioWithOneHolding()
    const before = getPortfolio(id)!
    const after = placeOrder(id, { code: '600000.SH', name: '浦发银行', side: 'buy', price: 20, quantity: 1000 })

    const order = after.orders[after.orders.length - 1]
    expect(order.status).toBe('filled')
    expect(order.side).toBe('buy')
    expect(order.quantity).toBe(1000)
    expect(order.filledPrice).toBeCloseTo(20.02, 2)
    expect(order.fees.commission).toBeGreaterThan(0)
    expect(after.cash).toBeLessThan(before.cash)
    expect(after.positions.find((p) => p.code === '600000.SH')?.shares).toBe(1000)
    // 已持久化
    expect(getPortfolio(id)!.positions.find((p) => p.code === '600000.SH')?.shares).toBe(1000)
  })

  it('资金不足：订单被拒并记录 rejectReason，现金不变', () => {
    const id = portfolioWithOneHolding()
    const before = getPortfolio(id)!
    const after = placeOrder(id, { code: '600519.SH', name: '贵州茅台', side: 'buy', price: 1500, quantity: 10000 })

    const order = after.orders[after.orders.length - 1]
    expect(order.status).toBe('rejected')
    expect(order.rejectReason).toContain('资金不足')
    expect(after.cash).toBe(before.cash)
    expect(after.positions.find((p) => p.code === '600519.SH')).toBeUndefined()
  })

  it('T+1 锁定：当日买入不可当日卖出', () => {
    const id = portfolioWithOneHolding()
    const bought = placeOrder(id, { code: '600000.SH', name: '浦发银行', side: 'buy', price: 20, quantity: 1000 })
    expect(bought.orders[bought.orders.length - 1].status).toBe('filled')

    const sold = placeOrder(id, { code: '600000.SH', name: '浦发银行', side: 'sell', price: 21, quantity: 1000 })
    const order = sold.orders[sold.orders.length - 1]
    expect(order.status).toBe('rejected')
    expect(order.rejectReason).toContain('T+1')
    // 持仓未被卖出
    expect(sold.positions.find((p) => p.code === '600000.SH')?.shares).toBe(1000)
  })

  it('markPortfolioToMarket 更新市价并重算总资产', () => {
    const id = portfolioWithOneHolding()
    const before = getPortfolio(id)!
    const marked = markPortfolioToMarket(id, new Map([['000001.SZ', 12]]))
    expect(marked.positions[0].currentPrice).toBe(12)
    expect(marked.totalValue).not.toBe(before.totalValue)
  })

  it('deletePortfolio 删除组合', () => {
    const id = portfolioWithOneHolding()
    expect(getPortfolio(id)).not.toBeNull()
    deletePortfolio(id)
    expect(getPortfolio(id)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// (c) unifiedHeldPositions：三类 legacy 来源聚合且可辨识
// ═══════════════════════════════════════════════════════════════
describe('unifiedHeldPositions', () => {
  function seedAllLegacySources(): void {
    updateDB((db) => {
      db.holdings.push({ id: 'h1', code: '600000.SH', name: '浦发银行', cost: 10, shares: 1000, addedAt: '2026-01-01T00:00:00Z' })
    })
    addPosition('000001.SZ', '平安银行', 12, 500)
    executeBuy(loadAccount(), { code: '600519.SH', name: '贵州茅台', price: 1500, changePct: 0.5, isStarMarket: false }, 100)
  }

  it('聚合 db.holdings / positionStore / simTrade 且各自可辨识', () => {
    seedAllLegacySources()
    const all = unifiedHeldPositions()

    expect(all).toHaveLength(3)
    const fromDb = all.find((p) => p.code === '600000.SH')
    const fromPs = all.find((p) => p.code === '000001.SZ')
    const fromSim = all.find((p) => p.code === '600519.SH')

    expect(fromDb?.source).toBe('db.holdings')
    expect(fromDb?.id.startsWith('db:')).toBe(true)
    expect(fromDb?.shares).toBe(1000)
    expect(fromDb?.avgCost).toBe(10)

    expect(fromPs?.source).toBe('positionStore')
    expect(fromPs?.id.startsWith('ps:')).toBe(true)
    expect(fromPs?.shares).toBe(500)
    expect(fromPs?.avgCost).toBe(12)

    expect(fromSim?.source).toBe('simTrade')
    expect(fromSim?.id.startsWith('sim:')).toBe(true)
    expect(fromSim?.shares).toBe(100)
    expect(fromSim?.currentPrice).toBe(1500)

    // 来源标签可辨识
    expect(legacySourceLabel('db.holdings')).toContain('持仓台账')
    expect(legacySourceLabel('positionStore')).toContain('自选持仓')
    expect(legacySourceLabel('simTrade')).toContain('模拟交易')
  })

  it('读取失败返回空数组不抛错', () => {
    // 非法 JSON → 各来源自行降级为空数组
    localStorage.setItem('alphamind_positions_v1', '{bad json')
    localStorage.setItem('alphamind_sim_account', 'not-json')
    const all = unifiedHeldPositions()
    expect(Array.isArray(all)).toBe(true)
    expect(all.filter((p) => p.source === 'positionStore')).toHaveLength(0)
    expect(all.filter((p) => p.source === 'simTrade')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// (d) legacy 数据不被修改（快照前后对比）
// ═══════════════════════════════════════════════════════════════
describe('legacy 数据只读', () => {
  it('unifiedHeldPositions / listPortfolios / listAccounts 不改变任何 legacy key', () => {
    updateDB((db) => {
      db.holdings.push({ id: 'h1', code: '600000.SH', name: '浦发银行', cost: 10, shares: 1000, addedAt: '2026-01-01T00:00:00Z' })
    })
    addPosition('000001.SZ', '平安银行', 12, 500)
    executeBuy(loadAccount(), { code: '600519.SH', name: '贵州茅台', price: 1500, changePct: 0.5, isStarMarket: false }, 100)

    const before = Object.fromEntries(LEGACY_KEYS.map((k) => [k, localStorage.getItem(k)]))

    unifiedHeldPositions()
    listPortfolios()
    listAccounts()
    const accounts = listAccounts()

    const after = Object.fromEntries(LEGACY_KEYS.map((k) => [k, localStorage.getItem(k)]))
    expect(after).toEqual(before)
    // V2 新 key 读取不产生写入
    expect(localStorage.getItem('alphamind_portfolios_v1')).toBeNull()

    // 兼容迁移：legacy 持仓 → 默认实际账户（数据来自真实 holdings，不伪造）
    expect(accounts.length).toBeGreaterThan(0)
    const migrated = accounts.find((a) => a.broker === 'legacy')
    expect(migrated?.positions[0]?.code).toBe('600000.SH')
  })

  it('迁移幂等：重复读取不重复创建账户', () => {
    updateDB((db) => {
      db.holdings.push({ id: 'h1', code: '600000.SH', name: '浦发银行', cost: 10, shares: 1000, addedAt: '2026-01-01T00:00:00Z' })
    })
    const first = listAccounts().filter((a) => a.broker === 'legacy')
    const second = listAccounts().filter((a) => a.broker === 'legacy')
    expect(second).toHaveLength(first.length)
    expect(first.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// accountStore：CRUD
// ═══════════════════════════════════════════════════════════════
describe('accountStore', () => {
  it('addActualAccount / listAccounts / getAccount', () => {
    const acct = addActualAccount({ name: '实盘账户', broker: 'tushare', positions: [] })
    expect(acct.id).toBeTruthy()
    expect(listAccounts().some((a) => a.id === acct.id)).toBe(true)
    expect(getAccount(acct.id)?.name).toBe('实盘账户')
    expect(getAccount('nope')).toBeNull()
  })
})
