// ─────────────────────────────────────────────────────────────
// 自选股追踪 — localStorage 持久化
// 支持：添加/删除/批量导入 + 实时计算收益
// ─────────────────────────────────────────────────────────────

export interface TrackedStock {
  code: string       // '000001.SZ'
  name: string       // '平安银行'
  addedAt: string    // ISO 时间戳
  addedPrice: number // 添加时的价格
}

export interface TrackedStockSnapshot extends TrackedStock {
  currentPrice: number | null
  dailyChange: number | null    // 当日涨跌幅 %
  totalReturn: number | null    // 自添加以来累计收益 %
  holdingDays: number           // 持有天数
}

interface WatchlistStore {
  stocks: TrackedStock[]
  version: number
}

const KEY = 'alphamind_my_watchlist_v1'

function getStore(): WatchlistStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as WatchlistStore
  } catch { /* fallthrough */ }
  return { stocks: [], version: 1 }
}

function saveStore(s: WatchlistStore): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** 添加自选股 */
export function addToWatchlist(code: string, name: string, addedPrice: number): TrackedStock {
  const s = getStore()
  // 去重
  const exist = s.stocks.find(st => st.code === code)
  if (exist) {
    // 更新价格和时间
    exist.addedPrice = addedPrice
    exist.addedAt = new Date().toISOString()
    saveStore(s)
    return exist
  }
  const stock: TrackedStock = {
    code,
    name: name || code,
    addedAt: new Date().toISOString(),
    addedPrice,
  }
  s.stocks.push(stock)
  saveStore(s)
  return stock
}

/** 删除自选股 */
export function removeFromWatchlist(code: string): void {
  const s = getStore()
  s.stocks = s.stocks.filter(st => st.code !== code)
  saveStore(s)
}

/** 获取全部自选股（仅存储数据，不含行情） */
export function getWatchlist(): TrackedStock[] {
  return getStore().stocks
}

/** 检查是否已在自选 */
export function isInWatchlist(code: string): boolean {
  return getStore().stocks.some(st => st.code === code)
}

/** 获取自选股数量 */
export function getWatchlistCount(): number {
  return getStore().stocks.length
}

/** 清空自选股 */
export function clearWatchlist(): void {
  saveStore({ stocks: [], version: 1 })
}

// ═══════════════════════════════════════════════════════════════
// 行情快照 — 从 UniverseStock / K线计算
// ═══════════════════════════════════════════════════════════════

/**
 * 从市场全量数据中匹配自选股的当前价格
 * universe: loadUniverse() 返回的 UniverseStock[]
 */
export function computeSnapshots(
  watchlist: TrackedStock[],
  universe: { code: string; price: number; changePct: number }[],
): TrackedStockSnapshot[] {
  const priceMap = new Map(universe.map(u => [u.code, u]))
  return watchlist.map(st => {
    const snap = priceMap.get(st.code)
    const currentPrice = snap?.price ?? null
    const dailyChange = snap?.changePct ?? null
    const totalReturn = currentPrice ? ((currentPrice / st.addedPrice) - 1) * 100 : null
    const holdingDays = Math.max(1, Math.floor((Date.now() - new Date(st.addedAt).getTime()) / 86400000))
    return { ...st, currentPrice, dailyChange, totalReturn, holdingDays }
  })
}
