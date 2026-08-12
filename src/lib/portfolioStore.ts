// ─────────────────────────────────────────────────────────────
// 模拟组合 store（V2 统一领域模型 · 规则15/17）
// localStorage key: alphamind_portfolios_v1
// 独立实现于 legacy simTrade 引擎（simTrade.ts 只读不改，规则23）；
// 幂等迁移：旧数据保留不删，新 key 独立存在。
// ─────────────────────────────────────────────────────────────
import type {
  CandidateSnapshot,
  PaperPortfolio,
  PortfolioOrder,
  PortfolioPosition,
} from './types'
import { getDB, uid } from './store'

const KEY = 'alphamind_portfolios_v1'
const EVENT = 'alphamind-portfolios'

// 交易参数（与 simTrade 独立实现；参数口径一致以便可比）
const CONFIG = {
  COMMISSION_RATE: 0.00025, // 万2.5 佣金
  MIN_COMMISSION: 5, // 最低佣金 ¥5
  STAMP_TAX_RATE: 0.0005, // 万5 印花税（仅卖出）
  SLIPPAGE_RATE: 0.001, // 0.1% 滑点
  DAILY_LIMIT: 0.1, // 涨跌停 10%
  STAR_MARKET_LIMIT: 0.2, // 科创板/创业板 20%
}

export interface PlaceOrderInput {
  code: string
  name: string
  side: 'buy' | 'sell'
  price: number // 委托价
  quantity: number // 股数
  changePct?: number // 当日涨跌幅 %，用于涨跌停检查
  isStarMarket?: boolean // 科创/创业板（20% 涨跌停）
}

type PriceSource = ReadonlyMap<string, number> | Record<string, number>

// ── 存储层 ───────────────────────────────────────────────────

/** 兼容两种 code 形态（600519.SH / 600519），优先精确匹配 */
function lookupPrice(source: PriceSource, code: string): number | undefined {
  const map =
    source instanceof Map ? source : new Map(Object.entries(source))
  const direct = map.get(code)
  if (direct !== undefined) return direct
  const bare = code.replace(/\.(SH|SZ|BJ)$/i, '')
  if (bare !== code) return map.get(bare)
  // 反过来：入参是裸代码，找带后缀的 key
  for (const k of map.keys()) {
    if (k.replace(/\.(SH|SZ|BJ)$/i, '') === bare) return map.get(k)
  }
  return undefined
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function parseList(raw: string | null): PaperPortfolio[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as PaperPortfolio[]) : []
  } catch {
    return []
  }
}

let listCache: { raw: string | null; value: PaperPortfolio[] } | null = null

/** 读取全部组合；raw 未变化时返回同一引用（供 useSyncExternalStore） */
export function listPortfolios(): PaperPortfolio[] {
  const raw = readRaw()
  if (listCache && listCache.raw === raw) return listCache.value
  const value = parseList(raw)
  listCache = { raw, value }
  return value
}

function saveList(list: PaperPortfolio[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
  listCache = null // 使下次 listPortfolios 重新解析
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT))
  }
}

export function subscribePortfolios(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export function getPortfolio(portfolioId: string): PaperPortfolio | null {
  return parseList(readRaw()).find((p) => p.id === portfolioId) ?? null
}

export function deletePortfolio(portfolioId: string): void {
  saveList(parseList(readRaw()).filter((p) => p.id !== portfolioId))
}

// ── 组合创建 ─────────────────────────────────────────────────

/**
 * 从 CandidateSnapshot 创建等权模拟组合（闸门2 快照 → 规则15/17 组合）。
 * 仅收录 candidates 中 included=true 的股票；等权分配初始资金。
 * 需要真实价格（priceMap 或 universe 行情），无法定价的候选跳过并 console.warn，
 * 全部无法定价则抛错——不伪造数据（规则23）。
 */
export function createPaperPortfolioFromCandidate(
  runId: string | undefined,
  candidateSnapshotId: string,
  name: string,
  initialCapital: number,
  priceMap?: PriceSource,
): PaperPortfolio {
  let snapshot: CandidateSnapshot | null = null
  try {
    snapshot =
      getDB().candidateSnapshots.find((s) => s.id === candidateSnapshotId) ??
      null
  } catch (e) {
    throw new Error(`[portfolioStore] 读取候选快照失败: ${String(e)}`)
  }
  if (!snapshot) {
    throw new Error(`[portfolioStore] 候选快照不存在: ${candidateSnapshotId}`)
  }
  if (!initialCapital || initialCapital <= 0) {
    throw new Error('[portfolioStore] 初始资金必须为正数')
  }
  const prices = priceMap ?? {}
  const included = snapshot.candidates.filter((c) => c.included)
  if (included.length === 0) {
    throw new Error('[portfolioStore] 候选快照中没有 included=true 的股票')
  }

  const now = new Date().toISOString()
  const portfolioId = `pf-${uid()}`
  const positions: PortfolioPosition[] = []
  const orders: PortfolioOrder[] = []
  let cash = initialCapital
  let skipped = 0

  const budget = initialCapital / included.length
  for (const cand of included) {
    const price = lookupPrice(prices, cand.stockCode)
    if (price === undefined || price <= 0) {
      console.warn(
        `[portfolioStore] 跳过 ${cand.stockCode} ${cand.stockName}: 无法获取真实价格`,
      )
      skipped++
      continue
    }
    // 等权买入：以含滑点成交价计算可买股数，花费不超过单票预算（含佣金）
    const fillPrice = price * (1 + CONFIG.SLIPPAGE_RATE)
    let shares = Math.floor(budget / fillPrice)
    let totalCost = 0
    for (; shares > 0; shares--) {
      const gross = fillPrice * shares
      const commission = Math.max(
        CONFIG.MIN_COMMISSION,
        gross * CONFIG.COMMISSION_RATE,
      )
      totalCost = gross + commission
      if (totalCost <= budget) break
    }
    if (shares <= 0) {
      console.warn(
        `[portfolioStore] 跳过 ${cand.stockCode} ${cand.stockName}: 预算不足以买入 1 股`,
      )
      skipped++
      continue
    }
    const gross = fillPrice * shares
    const commission = Math.max(
      CONFIG.MIN_COMMISSION,
      gross * CONFIG.COMMISSION_RATE,
    )
    totalCost = gross + commission
    cash -= totalCost
    positions.push({
      id: `pos-${uid()}`,
      code: cand.stockCode,
      name: cand.stockName,
      shares,
      avgCost: fillPrice,
      currentPrice: price,
      addedAt: now,
      realizedPnL: 0,
    })
    orders.push({
      id: `ord-${uid()}`,
      portfolioId,
      code: cand.stockCode,
      name: cand.stockName,
      side: 'buy',
      price,
      filledPrice: fillPrice,
      quantity: shares,
      status: 'filled',
      fees: {
        commission,
        stampTax: 0,
        slippage: gross - price * shares,
        total: commission + (gross - price * shares),
      },
      createdAt: now,
    })
  }

  if (positions.length === 0) {
    throw new Error(
      `[portfolioStore] 无法为候选快照 ${candidateSnapshotId} 建仓（无可用价格，已跳过 ${skipped} 只）`,
    )
  }

  const positionValue = positions.reduce(
    (s, p) => s + (p.currentPrice ?? p.avgCost) * p.shares,
    0,
  )
  const portfolio: PaperPortfolio = {
    id: portfolioId,
    name: name?.trim() || `候选组合 ${snapshot.asOfDate}`,
    runId: runId ?? snapshot.runId,
    candidateSnapshotId: snapshot.id,
    asOfDate: snapshot.asOfDate,
    createdAt: now,
    positions,
    orders,
    cash: Math.max(0, cash),
    initialCapital,
    totalValue: Math.max(0, cash) + positionValue,
    realizedPnL: 0,
  }
  saveList([...parseList(readRaw()), portfolio])
  return portfolio
}

// ── 交易 ─────────────────────────────────────────────────────

/** 按订单历史推导 T+1 锁定股数：当日买入成交 - 当日卖出成交 */
function lockedSharesOf(
  orders: PortfolioOrder[],
  code: string,
  today: string,
): number {
  let bought = 0
  let sold = 0
  for (const o of orders) {
    if (o.code !== code || o.status !== 'filled') continue
    if (o.createdAt.slice(0, 10) !== today) continue
    if (o.side === 'buy') bought += o.quantity
    else sold += o.quantity
  }
  return Math.max(0, bought - sold)
}

function recalc(portfolio: PaperPortfolio): void {
  const positionValue = portfolio.positions.reduce(
    (s, p) => s + (p.currentPrice ?? p.avgCost) * p.shares,
    0,
  )
  portfolio.totalValue = portfolio.cash + positionValue
}

function clonePortfolio(p: PaperPortfolio): PaperPortfolio {
  return JSON.parse(JSON.stringify(p)) as PaperPortfolio
}

/**
 * 下单：处理成交/费用/T+1锁定/资金校验（独立实现，借鉴 simTrade.executeBuy 逻辑）。
 * 返回更新后的组合（已持久化）；被拒订单同样写入 orders 并带 rejectReason。
 */
export function placeOrder(
  portfolioId: string,
  input: PlaceOrderInput,
): PaperPortfolio {
  const list = parseList(readRaw())
  const idx = list.findIndex((p) => p.id === portfolioId)
  if (idx < 0) throw new Error(`[portfolioStore] 组合不存在: ${portfolioId}`)

  const pf = clonePortfolio(list[idx])
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const { code, name, side, price, quantity } = input
  if (!price || price <= 0 || !quantity || quantity <= 0) {
    throw new Error('[portfolioStore] 委托价格与数量必须为正数')
  }

  const reject = (reason: string): PortfolioOrder => ({
    id: `ord-${uid()}`,
    portfolioId,
    code,
    name,
    side,
    price,
    filledPrice: 0,
    quantity,
    status: 'rejected',
    fees: { commission: 0, stampTax: 0, slippage: 0, total: 0 },
    rejectReason: reason,
    createdAt: now.toISOString(),
  })

  // 涨跌停检查（有 changePct 时执行）
  const limit = input.isStarMarket ? CONFIG.STAR_MARKET_LIMIT : CONFIG.DAILY_LIMIT
  if (input.changePct !== undefined) {
    if (side === 'buy' && input.changePct >= limit * 100) {
      pf.orders.push(reject('涨停板，无法买入'))
      saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
      return pf
    }
    if (side === 'sell' && input.changePct <= -limit * 100) {
      pf.orders.push(reject('跌停板，无法卖出'))
      saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
      return pf
    }
  }

  if (side === 'buy') {
    // 滑点 + 佣金
    const fillPrice = price * (1 + CONFIG.SLIPPAGE_RATE)
    const grossAmount = fillPrice * quantity
    const commission = Math.max(
      CONFIG.MIN_COMMISSION,
      grossAmount * CONFIG.COMMISSION_RATE,
    )
    const totalCost = grossAmount + commission

    if (pf.cash < totalCost) {
      pf.orders.push(
        reject(
          `资金不足：需要 ¥${totalCost.toFixed(2)}，可用 ¥${pf.cash.toFixed(2)}`,
        ),
      )
      saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
      return pf
    }

    pf.cash -= totalCost
    const pos = pf.positions.find((p) => p.code === code)
    if (pos) {
      const newTotal = pos.shares + quantity
      pos.avgCost = (pos.avgCost * pos.shares + fillPrice * quantity) / newTotal
      pos.shares = newTotal
      pos.currentPrice = price
    } else {
      pf.positions.push({
        id: `pos-${uid()}`,
        code,
        name,
        shares: quantity,
        avgCost: fillPrice,
        currentPrice: price,
        addedAt: now.toISOString(),
        realizedPnL: 0,
      })
    }
    pf.orders.push({
      id: `ord-${uid()}`,
      portfolioId,
      code,
      name,
      side: 'buy',
      price,
      filledPrice: fillPrice,
      quantity,
      status: 'filled',
      fees: {
        commission,
        stampTax: 0,
        slippage: grossAmount - price * quantity,
        total: commission + (grossAmount - price * quantity),
      },
      createdAt: now.toISOString(),
    })
  } else {
    // 卖出：T+1 与持仓校验
    const pos = pf.positions.find((p) => p.code === code)
    if (!pos) {
      pf.orders.push(reject(`无持仓：${code}`))
      saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
      return pf
    }
    const locked = lockedSharesOf(pf.orders, code, today)
    const available = Math.max(0, pos.shares - locked)
    if (quantity > available) {
      pf.orders.push(
        reject(
          `可卖股数不足：可用 ${available} 股，委托 ${quantity} 股（T+1 锁定 ${locked} 股）`,
        ),
      )
      saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
      return pf
    }

    // 滑点（卖出价略低）+ 佣金 + 印花税
    const fillPrice = price * (1 - CONFIG.SLIPPAGE_RATE)
    const grossAmount = fillPrice * quantity
    const commission = Math.max(
      CONFIG.MIN_COMMISSION,
      grossAmount * CONFIG.COMMISSION_RATE,
    )
    const stampTax = grossAmount * CONFIG.STAMP_TAX_RATE
    const totalFees = commission + stampTax
    const netAmount = grossAmount - totalFees

    const realized = netAmount - pos.avgCost * quantity
    pos.realizedPnL += realized
    pf.realizedPnL += realized
    pf.cash += netAmount
    pos.shares -= quantity
    if (pos.shares <= 0) {
      pf.positions = pf.positions.filter((p) => p.code !== code)
    }

    pf.orders.push({
      id: `ord-${uid()}`,
      portfolioId,
      code,
      name,
      side: 'sell',
      price,
      filledPrice: fillPrice,
      quantity,
      status: 'filled',
      fees: {
        commission,
        stampTax,
        slippage: price * quantity - grossAmount,
        total: totalFees,
      },
      createdAt: now.toISOString(),
    })
  }

  recalc(pf)
  saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
  return pf
}

/** 用最新价格更新持仓市价并重算总资产 */
export function markPortfolioToMarket(
  portfolioId: string,
  prices: PriceSource,
): PaperPortfolio {
  const list = parseList(readRaw())
  const idx = list.findIndex((p) => p.id === portfolioId)
  if (idx < 0) throw new Error(`[portfolioStore] 组合不存在: ${portfolioId}`)
  const pf = clonePortfolio(list[idx])
  for (const pos of pf.positions) {
    const price = lookupPrice(prices, pos.code)
    if (price !== undefined && price > 0) pos.currentPrice = price
  }
  recalc(pf)
  saveList([...list.slice(0, idx), pf, ...list.slice(idx + 1)])
  return pf
}
