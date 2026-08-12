// ─────────────────────────────────────────────────────────────
// 个股研究项目存储 (V2)
// ResearchProject / EvidenceItem / ResearchClaim / ResearchReportV2 CRUD
// localStorage 持久化，key = alphamind_research_v1
// 规则19：关键结论必须绑定 EvidenceItem；无证据的结论 isModelInference=true
// 规则20：研究报告必须绑定 ResearchProject / DataSnapshot / asOfDate
// ─────────────────────────────────────────────────────────────
import type {
  ResearchProject,
  EvidenceItem,
  ResearchClaim,
  ResearchReportV2,
} from './types'
import { getPitContext } from './dataSnapshotStore'

export interface ResearchStoreV1 {
  projects: ResearchProject[]
  evidence: EvidenceItem[]
  claims: ResearchClaim[]
  reports: ResearchReportV2[]
}

const KEY = 'alphamind_research_v1'

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getDB(): ResearchStoreV1 {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as ResearchStoreV1
      if (db && Array.isArray(db.projects) && Array.isArray(db.evidence)) return db
    }
  } catch {
    /* fallthrough → 默认空库 */
  }
  return { projects: [], evidence: [], claims: [], reports: [] }
}

function saveDB(db: ResearchStoreV1): void {
  localStorage.setItem(KEY, JSON.stringify(db))
}

/**
 * 创建个股研究项目。
 * 同一股票已有未完成（draft/active）项目时复用，否则首次创建新项目。
 */
export function createResearchProject(
  originalQuery: string,
  stockCode: string,
  stockName: string,
): ResearchProject {
  const db = getDB()
  const existing = db.projects
    .filter((p) => p.stockCode === stockCode && p.status !== 'completed')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  if (existing) {
    const updated: ResearchProject = {
      ...existing,
      originalQuery: originalQuery || existing.originalQuery,
      status: 'active',
      updatedAt: new Date().toISOString(),
    }
    db.projects = db.projects.map((p) => (p.id === updated.id ? updated : p))
    saveDB(db)
    return updated
  }
  const now = new Date().toISOString()
  const proj: ResearchProject = {
    id: uid(),
    originalQuery,
    stockCode,
    stockName,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  db.projects.push(proj)
  saveDB(db)
  return proj
}

/** 追加证据条目（自动绑定项目 + 捕获时间 + 全局 PIT 基准） */
export function addEvidenceItem(
  projectId: string,
  item: Omit<EvidenceItem, 'id' | 'projectId' | 'capturedAt'>,
): EvidenceItem {
  const db = getDB()
  const pit = getPitContext()
  const ev: EvidenceItem = {
    ...item,
    id: uid(),
    projectId,
    capturedAt: new Date().toISOString(),
    asOfDate: item.asOfDate ?? pit.asOfDate ?? undefined,
    dataSnapshotId: item.dataSnapshotId ?? pit.dataSnapshotId ?? undefined,
  }
  db.evidence.push(ev)
  saveDB(db)
  return ev
}

/**
 * 写入研究结论（规则19）。
 * 无证据（evidenceIds 为空或全部失效）的结论强制 isModelInference=true。
 */
export function addResearchClaim(
  projectId: string,
  claim: string,
  evidenceIds: string[],
  confidence: 'high' | 'medium' | 'low',
): ResearchClaim {
  const db = getDB()
  const validEvidence = evidenceIds.filter((id) =>
    db.evidence.some((e) => e.id === id && e.projectId === projectId),
  )
  const c: ResearchClaim = {
    id: uid(),
    projectId,
    claim,
    evidenceIds: validEvidence,
    confidence,
    isModelInference: validEvidence.length === 0,
    conflicts: [],
    createdAt: new Date().toISOString(),
  }
  db.claims.push(c)
  saveDB(db)
  return c
}

/**
 * 生成研究报告 V2（规则20：绑定 projectId / asOfDate / dataSnapshotId / claims）。
 * 完成后项目标记为 completed。
 */
export function generateReport(projectId: string): ResearchReportV2 {
  const db = getDB()
  const proj = db.projects.find((p) => p.id === projectId)
  if (!proj) throw new Error(`ResearchProject not found: ${projectId}`)
  const pit = getPitContext()
  const asOfDate =
    proj.asOfDate ?? pit.asOfDate ?? new Date().toISOString().slice(0, 10)
  const claimIds = db.claims
    .filter((c) => c.projectId === projectId)
    .map((c) => c.id)
  const report: ResearchReportV2 = {
    id: uid(),
    projectId,
    runId: proj.runId,
    dataSnapshotId: proj.dataSnapshotId ?? pit.dataSnapshotId ?? undefined,
    asOfDate,
    stockCode: proj.stockCode,
    stockName: proj.stockName,
    generatedAt: new Date().toISOString(),
    conclusion: proj.originalQuery || `${proj.stockName} 个股研究报告`,
    claims: claimIds,
  }
  db.reports.push(report)
  db.projects = db.projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          status: 'completed',
          asOfDate,
          dataSnapshotId: report.dataSnapshotId,
          updatedAt: new Date().toISOString(),
        }
      : p,
  )
  saveDB(db)
  return report
}

export function listProjects(): ResearchProject[] {
  return [...getDB().projects].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getProject(projectId: string): ResearchProject | null {
  return getDB().projects.find((p) => p.id === projectId) ?? null
}

export function getReport(projectId: string): ResearchReportV2 | null {
  return getDB().reports.find((r) => r.projectId === projectId) ?? null
}

export function getEvidence(projectId: string): EvidenceItem[] {
  return getDB()
    .evidence.filter((e) => e.projectId === projectId)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1))
}

export function getClaims(projectId: string): ResearchClaim[] {
  return getDB()
    .claims.filter((c) => c.projectId === projectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
}
