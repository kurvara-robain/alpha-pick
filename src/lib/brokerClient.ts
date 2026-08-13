// ─────────────────────────────────────────────────────────────
// 券商连接抽象层 — 统一接口
// 所有券商/数据源实现相同的 BrokerConnection 协议
// ─────────────────────────────────────────────────────────────

export interface BrokerPosition {
  code: string
  name: string
  shares: number
  availableShares: number // 可卖
  costPrice: number
  currentPrice: number
  marketValue: number
  profitLoss: number
  profitLossRatio: number
  currency?: string
}

export interface BrokerOrder {
  orderId: string
  code: string
  name: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  filledQuantity: number
  status: 'submitted' | 'partial' | 'filled' | 'cancelled' | 'rejected'
  createdAt: string
  updatedAt: string
}

export interface BrokerAccount {
  brokerId: string
  brokerName: string
  accountId: string
  totalAssets: number
  availableCash: number
  frozenCash: number
  marketValue: number
  totalProfitLoss: number
  totalProfitLossRatio: number
  positions: BrokerPosition[]
  recentOrders: BrokerOrder[]
  updatedAt: string
}

export type BrokerType = 'tushare' | 'akshare' | 'manual'

export interface BrokerConfig {
  type: BrokerType
  name: string
  enabled: boolean
  lastSyncAt?: string
  error?: string
  token?: string
}

// ═══════════════════════════════════════════════════════════════
// 统一同步接口
// ═══════════════════════════════════════════════════════════════

export async function syncBrokerAccount(brokerType: BrokerType): Promise<BrokerAccount> {
  const res = await fetch(`/api/broker/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ broker: brokerType }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? '券商同步失败')
  }
  return res.json()
}

export async function getBrokerStatus(): Promise<BrokerConfig[]> {
  const res = await fetch('/api/broker/status')
  if (!res.ok) return []
  return res.json()
}

export async function saveBrokerConfig(config: Partial<BrokerConfig> & { type: BrokerType }): Promise<void> {
  await fetch('/api/broker/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

// ═══════════════════════════════════════════════════════════════
// 通用导入：同步到 AlphaMind 本地 DB
// ═══════════════════════════════════════════════════════════════

import { updateDB } from '@/lib/store'

export function importBrokerToHoldings(account: BrokerAccount): void {
  updateDB((db) => {
    const existingCodes = new Set(db.holdings.map((h) => h.code))
    for (const pos of account.positions) {
      if (!existingCodes.has(pos.code)) {
        db.holdings.push({
          id: `broker-${account.brokerId}-${pos.code}`,
          code: pos.code,
          name: pos.name,
          cost: pos.costPrice,
          shares: pos.shares,
          addedAt: new Date().toISOString(),
        })
      }
    }
  })
}

export function importBrokerToSimTrade(account: BrokerAccount): void {
  // 导入模拟交易的历史委托
  updateDB((db) => {
    for (const order of account.recentOrders) {
      if (order.status === 'filled') {
        db.backtests.push({
          id: `broker-order-${order.orderId}`,
          config: {
            moduleName: `${account.brokerName} 真实委托`,
            strategyIds: [], factorIds: [],
            startDate: order.createdAt.slice(0, 10),
            endDate: order.updatedAt.slice(0, 10),
            rebalance: 'monthly', capital: 0,
          },
          credibility: 'research',
          metrics: {
            totalReturn: 0, annualReturn: 0, maxDrawdown: 0,
            sharpe: 0, winRate: 0, turnover: 0,
          },
          curve: [],
          periods: [],
          createdAt: order.updatedAt,
        })
      }
    }
  })
}
