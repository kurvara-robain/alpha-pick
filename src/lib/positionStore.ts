// ─────────────────────────────────────────────────────────────
// 持仓管理 store
// localStorage key: alphamind_positions_v1
// ─────────────────────────────────────────────────────────────

import type { UniverseStock } from './marketData'

export interface Position {
  code: string
  name: string
  entryPrice: number   // 买入均价
  quantity: number      // 持股数量
  addedAt: string       // ISO
  notes?: string
}

export interface PositionSnapshot extends Position {
  currentPrice: number  // 最新价
  dailyChange: number   // 日涨跌 %
  cost: number          // 成本 = entryPrice × quantity
  marketValue: number   // 市值 = currentPrice × quantity
  pnl: number           // 盈亏金额
  pnlPct: number        // 盈亏 %
  weightPct: number     // 占总仓位 %
}

const KEY = 'alphamind_positions_v1'

export function getPositions(): Position[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as Position[]
  } catch { return [] }
}

function savePositions(list: Position[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function addPosition(code: string, name: string, entryPrice: number, quantity: number) {
  const list = getPositions()
  const exist = list.find(p => p.code === code)
  if (exist) {
    // 加权平均买入价
    const totalQty = exist.quantity + quantity
    const totalCost = exist.entryPrice * exist.quantity + entryPrice * quantity
    exist.entryPrice = totalCost / totalQty
    exist.quantity = totalQty
  } else {
    list.push({ code, name, entryPrice, quantity, addedAt: new Date().toISOString() })
  }
  savePositions(list)
}

export function removePosition(code: string) {
  savePositions(getPositions().filter(p => p.code !== code))
}

export function updatePosition(code: string, updates: Partial<Pick<Position, 'entryPrice' | 'quantity' | 'notes'>>) {
  const list = getPositions()
  const pos = list.find(p => p.code === code)
  if (!pos) return
  if (updates.entryPrice != null) pos.entryPrice = updates.entryPrice
  if (updates.quantity != null) pos.quantity = updates.quantity
  if (updates.notes !== undefined) pos.notes = updates.notes
  savePositions(list)
}

export function computePositionSnapshots(positions: Position[], universe: UniverseStock[]): PositionSnapshot[] {
  if (universe.length === 0) {
    return positions.map(p => ({
      ...p, currentPrice: 0, dailyChange: 0, cost: p.entryPrice * p.quantity,
      marketValue: 0, pnl: 0, pnlPct: 0, weightPct: 0,
    }))
  }
  const snaps = positions.map(p => {
    const u = universe.find(x => x.code === p.code || x.code === p.code + '.SH' || x.code === p.code + '.SZ')
    const cp = u?.price ?? 0
    const dc = u?.changePct ?? 0
    const cost = p.entryPrice * p.quantity
    const mv = cp * p.quantity
    const pnl = mv - cost
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
    return { ...p, currentPrice: cp, dailyChange: dc, cost, marketValue: mv, pnl, pnlPct, weightPct: 0 }
  })
  // 计算权重
  const totalMv = snaps.reduce((s, x) => s + x.marketValue, 0)
  for (const s of snaps) s.weightPct = totalMv > 0 ? (s.marketValue / totalMv) * 100 : 0
  return snaps
}
