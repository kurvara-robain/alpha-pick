// ─────────────────────────────────────────────────────────────
// 模拟交易引擎 — 完整版
// T+1 · 涨跌停 · 佣金印花税 · 滑点 · 持仓跟踪 · 盈亏计算
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type OrderSide = 'buy' | 'sell'
export type OrderStatus = 'filled' | 'rejected' | 'partial'

export interface SimOrder {
  id: string
  code: string
  name: string
  side: OrderSide
  price: number // 委托价
  filledPrice: number // 实际成交价（含滑点）
  quantity: number // 股数（100 的整数倍）
  status: OrderStatus
  rejectReason?: string
  /** 费用明细 */
  fees: {
    commission: number // 佣金
    stampTax: number // 印花税（仅卖出）
    slippage: number // 滑点损失
    total: number
  }
  createdAt: string // ISO
  tPlusOneDate?: string // T+1 解禁日期
}

export interface SimPosition {
  code: string
  name: string
  shares: number // 当前持股
  avgCost: number // 平均成本
  currentPrice: number // 当前市价（外部更新）
  marketValue: number // 市值
  unrealizedPnL: number // 浮动盈亏
  unrealizedPnLPct: number // 浮动盈亏 %
  /** T+1 锁定股数（今日买入，不可卖出） */
  lockedShares: number
  lockedUntil: string // T+1 解禁日期
}

export interface SimAccount {
  cash: number // 可用资金
  initialCapital: number // 初始本金
  positions: SimPosition[] // 持仓
  orders: SimOrder[] // 委托历史
  /** 累计已实现盈亏 */
  realizedPnL: number
  /** 总资产 = 现金 + 持仓市值 */
  totalValue: number
  /** 累计收益率 */
  totalReturn: number
  /** 交易统计 */
  stats: {
    totalTrades: number
    winningTrades: number
    losingTrades: number
    winRate: number
    bestTrade: number
    worstTrade: number
    totalFees: number
  }
}

// ═══════════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  COMMISSION_RATE: 0.00025, // 万2.5 佣金
  MIN_COMMISSION: 5, // 最低佣金 ¥5
  STAMP_TAX_RATE: 0.0005, // 万5 印花税（仅卖出）
  SLIPPAGE_RATE: 0.001, // 0.1% 滑点
  LOT_SIZE: 100, // 每手 100 股
  DAILY_LIMIT: 0.10, // 涨跌停 10%
  STAR_MARKET_LIMIT: 0.20, // 科创板/创业板 20%
  INITIAL_CAPITAL: 1_000_000, // 初始资金 100 万
}

// ═══════════════════════════════════════════════════════════════
// 存储层
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'alphamind_sim_account'

function uid(): string {
  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function loadAccount(): SimAccount {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as SimAccount
  } catch { /* fallthrough */ }
  return createDefaultAccount()
}

export function saveAccount(account: SimAccount): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
}

function createDefaultAccount(): SimAccount {
  return {
    cash: CONFIG.INITIAL_CAPITAL,
    initialCapital: CONFIG.INITIAL_CAPITAL,
    positions: [],
    orders: [],
    realizedPnL: 0,
    totalValue: CONFIG.INITIAL_CAPITAL,
    totalReturn: 0,
    stats: {
      totalTrades: 0, winningTrades: 0, losingTrades: 0,
      winRate: 0, bestTrade: 0, worstTrade: 0, totalFees: 0,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// 交易约束检查
// ═══════════════════════════════════════════════════════════════

interface StockSnapshot {
  code: string
  name: string
  price: number
  changePct: number
  isStarMarket?: boolean // 科创/创业板
}

/** 检查涨跌停 */
function isPriceLimited(snapshot: StockSnapshot): { limited: boolean; reason?: string } {
  const limit = snapshot.isStarMarket ? CONFIG.STAR_MARKET_LIMIT : CONFIG.DAILY_LIMIT
  if (snapshot.changePct >= limit * 100) {
    // 涨停 — 买不到
    return { limited: true, reason: '涨停板，无法买入' }
  }
  if (snapshot.changePct <= -limit * 100) {
    // 跌停 — 卖不掉
    return { limited: true, reason: '跌停板，无法卖出' }
  }
  return { limited: false }
}

/** 计算 T+1 可卖股数 */
function availableShares(position: SimPosition | undefined): number {
  if (!position) return 0
  const now = new Date()
  const lockedUntil = new Date(position.lockedUntil + 'T00:00:00')
  if (now < lockedUntil) {
    return Math.max(0, position.shares - position.lockedShares)
  }
  // T+1 已过，解锁
  return position.shares
}

// ═══════════════════════════════════════════════════════════════
// 核心交易函数
// ═══════════════════════════════════════════════════════════════

export function executeBuy(
  account: SimAccount,
  snapshot: StockSnapshot,
  quantity: number, // 股数
): { account: SimAccount; order: SimOrder } {
  const acct = { ...account, positions: account.positions.map((p) => ({ ...p })), orders: [...account.orders] }

  // 1. 涨跌停检查
  const limit = isPriceLimited(snapshot)
  if (limit.limited) {
    const order: SimOrder = {
      id: uid(), code: snapshot.code, name: snapshot.name, side: 'buy',
      price: snapshot.price, filledPrice: 0, quantity, status: 'rejected',
      rejectReason: limit.reason, fees: { commission: 0, stampTax: 0, slippage: 0, total: 0 },
      createdAt: new Date().toISOString(),
    }
    return { account: acct, order }
  }

  // 2. 滑点（买入价略高）
  const fillPrice = snapshot.price * (1 + CONFIG.SLIPPAGE_RATE)
  const grossAmount = fillPrice * quantity

  // 3. 佣金
  const commission = Math.max(CONFIG.MIN_COMMISSION, grossAmount * CONFIG.COMMISSION_RATE)
  const totalCost = grossAmount + commission

  // 4. 资金检查
  if (acct.cash < totalCost) {
    const order: SimOrder = {
      id: uid(), code: snapshot.code, name: snapshot.name, side: 'buy',
      price: snapshot.price, filledPrice: fillPrice, quantity, status: 'rejected',
      rejectReason: `资金不足：需要 ¥${totalCost.toFixed(2)}，可用 ¥${acct.cash.toFixed(2)}`,
      fees: { commission, stampTax: 0, slippage: grossAmount - snapshot.price * quantity, total: commission + (grossAmount - snapshot.price * quantity) },
      createdAt: new Date().toISOString(),
    }
    return { account: acct, order }
  }

  // 5. 成交
  acct.cash -= totalCost

  // 更新持仓
  const posIdx = acct.positions.findIndex((p) => p.code === snapshot.code)
  if (posIdx >= 0) {
    const pos = acct.positions[posIdx]
    const newTotalShares = pos.shares + quantity
    const newTotalCost = pos.avgCost * pos.shares + fillPrice * quantity
    pos.shares = newTotalShares
    pos.avgCost = newTotalCost / newTotalShares
    pos.lockedShares += quantity
  } else {
    acct.positions.push({
      code: snapshot.code, name: snapshot.name, shares: quantity,
      avgCost: fillPrice, currentPrice: snapshot.price,
      marketValue: snapshot.price * quantity,
      unrealizedPnL: 0, unrealizedPnLPct: 0,
      lockedShares: quantity,
      lockedUntil: getNextTradeDate(),
    })
  }

  const order: SimOrder = {
    id: uid(), code: snapshot.code, name: snapshot.name, side: 'buy',
    price: snapshot.price, filledPrice: fillPrice, quantity, status: 'filled',
    fees: { commission, stampTax: 0, slippage: grossAmount - snapshot.price * quantity, total: commission + (grossAmount - snapshot.price * quantity) },
    createdAt: new Date().toISOString(),
    tPlusOneDate: getNextTradeDate(),
  }
  acct.orders.push(order)

  // 更新统计
  acct.stats.totalTrades++
  acct.stats.totalFees += totalCost - grossAmount

  // 重新计算总资产
  recalculateAccount(acct)
  saveAccount(acct)
  return { account: acct, order }
}

export function executeSell(
  account: SimAccount,
  snapshot: StockSnapshot,
  quantity: number,
): { account: SimAccount; order: SimOrder } {
  const acct = { ...account, positions: account.positions.map((p) => ({ ...p })), orders: [...account.orders] }

  // 1. 涨跌停检查
  const limit = isPriceLimited(snapshot)
  if (limit.limited) {
    const order: SimOrder = {
      id: uid(), code: snapshot.code, name: snapshot.name, side: 'sell',
      price: snapshot.price, filledPrice: 0, quantity, status: 'rejected',
      rejectReason: limit.reason, fees: { commission: 0, stampTax: 0, slippage: 0, total: 0 },
      createdAt: new Date().toISOString(),
    }
    return { account: acct, order }
  }

  // 2. T+1 检查
  const pos = acct.positions.find((p) => p.code === snapshot.code)
  const availShares = availableShares(pos)
  if (availShares < quantity) {
    const order: SimOrder = {
      id: uid(), code: snapshot.code, name: snapshot.name, side: 'sell',
      price: snapshot.price, filledPrice: 0, quantity, status: 'rejected',
      rejectReason: `可卖股数不足：可用 ${availShares} 股，委托 ${quantity} 股（T+1 锁定 ${pos?.lockedShares ?? 0} 股）`,
      fees: { commission: 0, stampTax: 0, slippage: 0, total: 0 },
      createdAt: new Date().toISOString(),
    }
    return { account: acct, order }
  }

  // 3. 滑点（卖出价略低）
  const fillPrice = snapshot.price * (1 - CONFIG.SLIPPAGE_RATE)
  const grossAmount = fillPrice * quantity

  // 4. 费用
  const commission = Math.max(CONFIG.MIN_COMMISSION, grossAmount * CONFIG.COMMISSION_RATE)
  const stampTax = grossAmount * CONFIG.STAMP_TAX_RATE
  const totalFees = commission + stampTax
  const netAmount = grossAmount - totalFees

  // 5. 计算已实现盈亏
  const costBasis = (pos?.avgCost ?? 0) * quantity
  const realizedPnL = netAmount - costBasis

  // 6. 成交
  acct.cash += netAmount
  acct.realizedPnL += realizedPnL

  if (pos) {
    pos.shares -= quantity
    if (pos.shares <= 0) {
      acct.positions = acct.positions.filter((p) => p.code !== snapshot.code)
    } else {
      // 保持 avgCost 不变
    }
  }

  const order: SimOrder = {
    id: uid(), code: snapshot.code, name: snapshot.name, side: 'sell',
    price: snapshot.price, filledPrice: fillPrice, quantity, status: 'filled',
    fees: { commission, stampTax, slippage: snapshot.price * quantity - grossAmount, total: totalFees },
    createdAt: new Date().toISOString(),
  }
  acct.orders.push(order)

  // 更新统计
  acct.stats.totalTrades++
  acct.stats.totalFees += totalFees
  if (realizedPnL > 0) { acct.stats.winningTrades++; acct.stats.bestTrade = Math.max(acct.stats.bestTrade, realizedPnL) }
  else { acct.stats.losingTrades++; acct.stats.worstTrade = Math.min(acct.stats.worstTrade, realizedPnL) }
  acct.stats.winRate = acct.stats.totalTrades > 0 ? (acct.stats.winningTrades / acct.stats.totalTrades) * 100 : 0

  recalculateAccount(acct)
  saveAccount(acct)
  return { account: acct, order }
}

/** 用最新价格更新持仓市值并重算总资产 */
export function markToMarket(account: SimAccount, prices: Map<string, number>): SimAccount {
  const acct = { ...account, positions: account.positions.map((p) => {
    const price = prices.get(p.code) ?? p.currentPrice
    return {
      ...p,
      currentPrice: price,
      marketValue: price * p.shares,
      unrealizedPnL: (price - p.avgCost) * p.shares,
      unrealizedPnLPct: p.avgCost > 0 ? ((price - p.avgCost) / p.avgCost) * 100 : 0,
    }
  })}
  recalculateAccount(acct)
  return acct
}

/** 重算总资产和收益率 */
function recalculateAccount(account: SimAccount): void {
  const positionValue = account.positions.reduce((s, p) => s + p.marketValue, 0)
  account.totalValue = account.cash + positionValue
  account.totalReturn = account.initialCapital > 0
    ? ((account.totalValue - account.initialCapital) / account.initialCapital) * 100
    : 0
}

/** 计算下一个交易日（简化：跳过周末） */
function getNextTradeDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const dow = d.getDay()
  if (dow === 0) d.setDate(d.getDate() + 1) // 周日 → 周一
  else if (dow === 6) d.setDate(d.getDate() + 2) // 周六 → 周一
  return d.toISOString().slice(0, 10)
}

/** 重置账户 */
export function resetAccount(): SimAccount {
  const acct = createDefaultAccount()
  saveAccount(acct)
  return acct
}
