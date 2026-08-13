// ─────────────────────────────────────────────────────────────
// legacy 兼容读取层（规则16/23）
// 只读聚合三类旧持仓来源 → 统一 PortfolioPosition：
//   (a) DB.holdings（store.ts 持仓台账）
//   (b) positionStore.getPositions()（alphamind_positions_v1）
//   (c) simTrade 账户持仓（alphamind_sim_account）
// 不写回、不伪造、不删除旧数据；单个来源读取失败返回空数组并 console.warn。
// ─────────────────────────────────────────────────────────────
import type { PortfolioPosition } from './types'
import { getDB } from './store'
import { getPositions } from './positionStore'
import { loadAccount } from './simTrade'

export type LegacySource = 'db.holdings' | 'positionStore' | 'simTrade'

export interface UnifiedHeldPosition extends PortfolioPosition {
  source: LegacySource
}

export const LEGACY_SOURCE_LABEL: Record<LegacySource, string> = {
  'db.holdings': '持仓台账',
  positionStore: '自选持仓(旧)',
  simTrade: '模拟交易',
}

export function legacySourceLabel(source: LegacySource): string {
  return LEGACY_SOURCE_LABEL[source] ?? source
}

function fromDbHoldings(): UnifiedHeldPosition[] {
  try {
    const db = getDB()
    return (db.holdings ?? []).map((h) => ({
      id: `db:${h.id}`,
      code: h.code,
      name: h.name,
      shares: h.shares,
      avgCost: h.cost,
      currentPrice: null, // DB 不存现价，不伪造（页面由 universe 行情叠加）
      addedAt: h.addedAt,
      realizedPnL: 0,
      source: 'db.holdings' as const,
    }))
  } catch (e) {
    console.warn('[portfolioLegacy] 读取 db.holdings 失败，按空处理', e)
    return []
  }
}

function fromPositionStore(): UnifiedHeldPosition[] {
  try {
    return getPositions().map((p) => ({
      id: `ps:${p.code}`,
      code: p.code,
      name: p.name,
      shares: p.quantity,
      avgCost: p.entryPrice,
      currentPrice: null, // positionStore 不存现价，不伪造
      addedAt: p.addedAt ?? '',
      realizedPnL: 0,
      source: 'positionStore' as const,
    }))
  } catch (e) {
    console.warn('[portfolioLegacy] 读取 positionStore 失败，按空处理', e)
    return []
  }
}

function fromSimTrade(): UnifiedHeldPosition[] {
  try {
    const acct = loadAccount()
    // addedAt 由首个买入委托推导（SimPosition 无该字段）
    const firstBuyAt = new Map<string, string>()
    for (const o of acct.orders) {
      if (o.side === 'buy' && !firstBuyAt.has(o.code)) {
        firstBuyAt.set(o.code, o.createdAt)
      }
    }
    return acct.positions.map((p) => ({
      id: `sim:${p.code}`,
      code: p.code,
      name: p.name,
      shares: p.shares,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      addedAt: firstBuyAt.get(p.code) ?? '',
      realizedPnL: 0,
      source: 'simTrade' as const,
    }))
  } catch (e) {
    console.warn('[portfolioLegacy] 读取 simTrade 账户失败，按空处理', e)
    return []
  }
}

/** 聚合三类 legacy 持仓来源，每条标注 source（来源可辨识） */
export function unifiedHeldPositions(): UnifiedHeldPosition[] {
  return [...fromDbHoldings(), ...fromPositionStore(), ...fromSimTrade()]
}
