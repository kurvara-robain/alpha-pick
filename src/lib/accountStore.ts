// ─────────────────────────────────────────────────────────────
// 实际账户 store（V2 统一领域模型 · 规则15）
// localStorage key: alphamind_accounts_v1
// 兼容迁移：legacy DB.holdings → 默认实际账户（只读 legacy，不删除，幂等一次）
// ─────────────────────────────────────────────────────────────
import type { ActualAccount, PortfolioPosition } from './types'
import { getDB, uid } from './store'

const KEY = 'alphamind_accounts_v1'
const MIGRATED_FLAG = 'alphamind_accounts_migrated_v1'

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function parseList(raw: string | null): ActualAccount[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as ActualAccount[]) : []
  } catch (e) {
    console.warn('[accountStore] 账户数据解析失败，按空处理', e)
    return []
  }
}

function saveList(list: ActualAccount[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

/**
 * 兼容迁移（幂等，最多执行一次）：把 legacy DB.holdings 转为一个
 * 「默认账户（旧持仓迁移）」。只读取旧数据，不删除、不覆盖（规则23）。
 */
export function migrateLegacyHoldingsOnce(): ActualAccount | null {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') return null
    localStorage.setItem(MIGRATED_FLAG, '1')
  } catch {
    return null
  }
  const accounts = parseList(readRaw())
  if (accounts.length > 0) return null // 已有账户则不迁移
  let holdings: { id: string; code: string; name: string; cost: number; shares: number; addedAt: string }[] = []
  try {
    holdings = getDB().holdings ?? []
  } catch (e) {
    console.warn('[accountStore] 读取 legacy 持仓失败，跳过迁移', e)
    return null
  }
  if (holdings.length === 0) return null
  const positions: PortfolioPosition[] = holdings.map((h) => ({
    id: `legacy-${h.id}`,
    code: h.code,
    name: h.name,
    shares: h.shares,
    avgCost: h.cost,
    currentPrice: null,
    addedAt: h.addedAt,
    realizedPnL: 0,
  }))
  const account: ActualAccount = {
    id: `acct-${uid()}`,
    name: '默认账户（旧持仓迁移）',
    broker: 'legacy',
    positions,
    createdAt: new Date().toISOString(),
  }
  saveList([...accounts, account])
  return account
}

export function addActualAccount(input: {
  name: string
  broker: string
  positions?: PortfolioPosition[]
}): ActualAccount {
  if (!input.name?.trim()) throw new Error('[accountStore] 账户名称不能为空')
  const account: ActualAccount = {
    id: `acct-${uid()}`,
    name: input.name.trim(),
    broker: input.broker || 'manual',
    positions: input.positions ?? [],
    createdAt: new Date().toISOString(),
  }
  saveList([...parseList(readRaw()), account])
  return account
}

export function listAccounts(): ActualAccount[] {
  migrateLegacyHoldingsOnce()
  return parseList(readRaw())
}

export function getAccount(id: string): ActualAccount | null {
  return parseList(readRaw()).find((a) => a.id === id) ?? null
}
