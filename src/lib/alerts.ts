// ─────────────────────────────────────────────────────────────
// 提醒系统 — 本地通知 + 策略信号变更提醒
// ─────────────────────────────────────────────────────────────
import { getDB } from './store'

export interface Alert {
  id: string
  type: 'signal_change' | 'price_alert' | 'risk_warning'
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  createdAt: string
  read: boolean
  action?: { label: string; url: string }
}

const STORAGE_KEY = 'alphamind_alerts'

function uid(): string {
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function getAlerts(): Alert[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveAlerts(alerts: Alert[]): void {
  // 只保留最近 100 条
  const trimmed = alerts.slice(-100)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
}

export function addAlert(alert: Omit<Alert, 'id' | 'createdAt' | 'read'>): void {
  const alerts = getAlerts()
  alerts.push({ ...alert, id: uid(), createdAt: new Date().toISOString(), read: false })
  saveAlerts(alerts)
  // 触发浏览器通知
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(alert.title, { body: alert.message })
  }
}

export function markAlertsRead(ids?: string[]): void {
  const alerts = getAlerts()
  if (ids) {
    alerts.forEach((a) => { if (ids.includes(a.id)) a.read = true })
  } else {
    alerts.forEach((a) => { a.read = true })
  }
  saveAlerts(alerts)
}

export function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/** 检查策略信号变更 */
export function checkSignalChanges(): number {
  const db = getDB()
  const alerts = getAlerts()
  const now = new Date()

  // 检查最近24小时内的信号变更（从 backtests 推断）
  const recentResults = db.backtests.filter((b) => {
    if (!b.id) return false
    const created = new Date(b.config?.startDate || 0)
    return now.getTime() - created.getTime() < 24 * 3600 * 1000
  })

  let added = 0
  for (const result of recentResults.slice(0, 3)) {
    // 避免重复提醒
    const exists = alerts.some((a) => a.message.includes(result.id))
    if (exists) continue

    addAlert({
      type: 'signal_change',
      title: '策略信号更新',
      message: `策略 "${result.config?.moduleName}" 产生了新的选股信号`,
      severity: 'info',
      action: { label: '查看', url: '/backtest' },
    })
    added++
  }

  return added
}

/** 价格预警 */
export function addPriceAlert(code: string, name: string, targetPrice: number, direction: 'above' | 'below'): void {
  addAlert({
    type: 'price_alert',
    title: `价格预警: ${name}`,
    message: direction === 'above'
      ? `${name}(${code}) 目标价: 突破 ¥${targetPrice}`
      : `${name}(${code}) 目标价: 跌破 ¥${targetPrice}`,
    severity: 'warning',
    action: { label: '查看', url: `/market?code=${code}` },
  })
}
