// ─────────────────────────────────────────────────────────────
// 核心引擎单元测试
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest'
import { validateDSL, buildDSLFromNL } from '../lib/strategyDSL'
import { executeBuy, executeSell, loadAccount, resetAccount, markToMarket } from '../lib/simTrade'

describe('Strategy DSL', () => {
  it('validates a minimal DSL', () => {
    const errors = validateDSL({
      schema_version: 1,
      name: 'test',
      universe: { market: 'A_SHARE', as_of: 'runtime' },
      filters: [],
      signals: [],
      portfolio: { method: 'equal_weight', top_n: 25, rebalance: 'weekly' },
      execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
      meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
    })
    expect(errors).toHaveLength(0)
  })

  it('flags missing name', () => {
    const errors = validateDSL({
      schema_version: 1,
      name: '',
      universe: { market: 'A_SHARE', as_of: 'runtime' },
      filters: [],
      signals: [],
      portfolio: { method: 'equal_weight', top_n: 25, rebalance: 'weekly' },
      execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
      meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('builds DSL from NL input', () => {
    const dsl = buildDSLFromNL('低PE策略', [{ field: 'pe', op: '<', value: 20, raw: 'PE<20' }], [], '', 25)
    expect(dsl.name).toBe('低PE策略')
    expect(dsl.filters[0].field).toBe('pe')
    expect(dsl.filters[0].operator).toBe('less_than')
    expect(dsl.filters[0].value).toBe(20)
  })

  it('excludes ST stocks by default', () => {
    const dsl = buildDSLFromNL('test', [], [], '', 25)
    expect(dsl.universe.exclude).toContain('ST')
    expect(dsl.universe.exclude).toContain('listed_days_lt:120')
  })
})

describe('SimTrade Engine', () => {
  beforeEach(() => {
    resetAccount()
  })

  it('starts with 1,000,000 capital', () => {
    const account = loadAccount()
    expect(account.cash).toBe(1_000_000)
    expect(account.initialCapital).toBe(1_000_000)
  })

  it('executes a buy order', () => {
    const account = loadAccount()
    const { order, account: newAccount } = executeBuy(account, {
      code: '600519', name: '贵州茅台', price: 1300, changePct: 0.5, isStarMarket: false,
    }, 100)
    expect(order.status).toBe('filled')
    expect(order.fees.commission).toBeGreaterThan(0)
    expect(newAccount.positions).toHaveLength(1)
    expect(newAccount.positions[0].shares).toBe(100)
    expect(newAccount.positions[0].lockedShares).toBe(100) // T+1 lock
  })

  it('rejects buy on limit-up', () => {
    const account = loadAccount()
    const { order } = executeBuy(account, {
      code: '000001', name: '涨停股', price: 10, changePct: 10.0, isStarMarket: false,
    }, 100)
    expect(order.status).toBe('rejected')
    expect(order.rejectReason).toContain('涨停')
  })

  it('rejects buy when insufficient funds', () => {
    const account = loadAccount()
    const { order } = executeBuy(account, {
      code: '600519', name: '贵州茅台', price: 500000, changePct: 1, isStarMarket: false,
    }, 10000)
    expect(order.status).toBe('rejected')
    expect(order.rejectReason).toContain('资金不足')
  })

  it('rejects sell when T+1 locked', () => {
    let account = loadAccount()
    // First buy
    const { account: afterBuy } = executeBuy(account, {
      code: '600519', name: '贵州茅台', price: 1300, changePct: 0.5, isStarMarket: false,
    }, 100)
    // Try to sell immediately (should fail due to T+1)
    const { order } = executeSell(afterBuy, {
      code: '600519', name: '贵州茅台', price: 1310, changePct: 0.8, isStarMarket: false,
    }, 100)
    expect(order.status).toBe('rejected')
    expect(order.rejectReason).toContain('可卖股数不足')
  })

  it('markToMarket updates position values', () => {
    let account = loadAccount()
    const { account: afterBuy } = executeBuy(account, {
      code: '600519', name: '贵州茅台', price: 1300, changePct: 0.5, isStarMarket: false,
    }, 100)
    const updated = markToMarket(afterBuy, new Map([['600519', 1400]]))
    expect(updated.positions[0].currentPrice).toBe(1400)
    expect(updated.positions[0].unrealizedPnL).toBeGreaterThan(0)
  })
})
