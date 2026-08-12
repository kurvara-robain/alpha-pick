// ─────────────────────────────────────────────────────────────
// 数据快照与全局 PIT 上下文 (V2)
// DataSnapshot 管理 + 全局 PitContext（规则8：所有模块共用同一 asOfDate）
// localStorage 持久化，key = alphamind_datasnapshot_v1
// 规则9：PIT 能力不足的数据必须标记 approximate/unavailable，不得宣称无前视偏差
// ─────────────────────────────────────────────────────────────
import type { DataSnapshot, PitContext } from './types'

export interface SnapshotStoreV1 {
  snapshots: DataSnapshot[]
  pit: PitContext
}

const KEY = 'alphamind_datasnapshot_v1'

const DEFAULT_PIT: PitContext = {
  active: false,
  asOfDate: null,
  dataSnapshotId: null,
  pitCapable: false,
}

function getDB(): SnapshotStoreV1 {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as SnapshotStoreV1
      if (db && Array.isArray(db.snapshots) && db.pit) return db
    }
  } catch {
    /* fallthrough → 默认空库 */
  }
  return { snapshots: [], pit: { ...DEFAULT_PIT } }
}

function saveDB(db: SnapshotStoreV1): void {
  localStorage.setItem(KEY, JSON.stringify(db))
}

/**
 * 注册数据快照（同 batchId + asOfDate 视为同一批次，更新而非重复注册）。
 * 若当前无活动 PIT 基准，自动将该快照设为全局基准。
 */
export function registerDataSnapshot(
  snap: Omit<DataSnapshot, 'id' | 'createdAt'>,
): DataSnapshot {
  const db = getDB()
  const existing = db.snapshots.find(
    (s) => s.batchId === snap.batchId && s.asOfDate === snap.asOfDate,
  )
  if (existing) {
    const updated: DataSnapshot = { ...existing, ...snap, id: existing.id, createdAt: existing.createdAt }
    db.snapshots = db.snapshots.map((s) => (s.id === existing.id ? updated : s))
    saveDB(db)
    return updated
  }
  const seq = db.snapshots.length + 1
  const id = `ds-${snap.asOfDate.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
  const full: DataSnapshot = { ...snap, id, createdAt: new Date().toISOString() }
  db.snapshots.push(full)
  // 无活动 PIT 时自动激活（规则9：dataDate 晚于 asOfDate 存在前视风险 → 能力不足）
  if (!db.pit.active) {
    db.pit = {
      active: true,
      asOfDate: full.asOfDate,
      dataSnapshotId: full.id,
      pitCapable: full.dataDate <= full.asOfDate,
    }
  }
  saveDB(db)
  return full
}

/** 当前活动 PIT 对应的数据快照（无则 null） */
export function getActiveSnapshot(): DataSnapshot | null {
  const db = getDB()
  const id = db.pit.dataSnapshotId
  return id ? db.snapshots.find((s) => s.id === id) ?? null : null
}

/** 全局 PIT 上下文（规则8：Run/筛选/回测/报告共用同一 asOfDate） */
export function getPitContext(): PitContext {
  return { ...getDB().pit }
}

export function listSnapshots(): DataSnapshot[] {
  return [...getDB().snapshots].sort((a, b) => (a.asOfDate < b.asOfDate ? 1 : -1))
}

export function getSnapshot(id: string): DataSnapshot | null {
  return getDB().snapshots.find((s) => s.id === id) ?? null
}

/**
 * 设置全局 PIT 基准（规则8）。
 * asOfDate=null 时退出 PIT 模式回到实时数据。
 * 规则9：仅当存在快照且 dataDate ≤ asOfDate（数据不晚于基准日，无前视）时
 * pitCapable=true，否则标记为近似/不可用。
 */
export function setActivePit(asOfDate: string | null, snapshotId: string | null): PitContext {
  const db = getDB()
  let pitCapable = false
  if (asOfDate && snapshotId) {
    const snap = db.snapshots.find((s) => s.id === snapshotId)
    pitCapable = !!snap && snap.dataDate <= asOfDate
  }
  db.pit = {
    active: !!asOfDate,
    asOfDate,
    dataSnapshotId: snapshotId,
    pitCapable,
  }
  saveDB(db)
  return { ...db.pit }
}
