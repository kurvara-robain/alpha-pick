// ─────────────────────────────────────────────────────────────
// V2 研究/证据链/全局PIT/因子证据等级 单元测试
// 覆盖：研究项目+证据+结论链路 / 无证据强制模型推断 / 报告绑定 /
//       全局 PIT asOfDate / 框架来源说明
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createResearchProject,
  addEvidenceItem,
  addResearchClaim,
  generateReport,
  listProjects,
  getProject,
  getReport,
  getClaims,
} from '../lib/researchProjectStore'
import {
  registerDataSnapshot,
  getPitContext,
  getActiveSnapshot,
  setActivePit,
  listSnapshots,
} from '../lib/dataSnapshotStore'
import { getFrameworkNote, RESEARCH_FRAMEWORKS } from '../lib/researchFrameworks'
import type { DataSnapshot } from '../lib/types'

function makeSnapshot(over: Partial<DataSnapshot> = {}): Omit<DataSnapshot, 'id' | 'createdAt'> {
  return {
    batchId: '2026-08-08',
    asOfDate: '2026-08-08',
    dataDate: '2026-08-08',
    publishDate: '2026-08-08',
    source: 'tushare',
    stockCount: 5000,
    klineDays: 250,
    qualityChecks: [{ name: 'c1', passed: true, detail: 'ok' }],
    failureCount: 0,
    syncStatus: 'synced',
    snapshotId: 'snap-001',
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('V2 研究项目与证据链', () => {
  it('(a) createResearchProject + addEvidenceItem + addResearchClaim 链路完整', () => {
    const proj = createResearchProject('贵州茅台估值与质量分析', '600519', '贵州茅台')
    expect(proj.id).toBeTruthy()
    expect(proj.stockCode).toBe('600519')
    expect(proj.status).toBe('active')

    const ev = addEvidenceItem(proj.id, {
      kind: 'analysis',
      source: '框架维度: 盈利质量',
      summary: 'ROE 领先同类',
    })
    expect(ev.projectId).toBe(proj.id)
    expect(ev.capturedAt).toBeTruthy()
    expect(ev.id).toBeTruthy()

    const claim = addResearchClaim(proj.id, '综合评分 75/100', [ev.id], 'medium')
    expect(claim.evidenceIds).toContain(ev.id)
    expect(claim.isModelInference).toBe(false)
    expect(getClaims(proj.id)).toHaveLength(1)

    expect(getProject(proj.id)?.id).toBe(proj.id)
    expect(listProjects()).toHaveLength(1)
  })

  it('(b) 无证据的 claim 强制 isModelInference=true', () => {
    const proj = createResearchProject('q', '000001', '平安银行')
    const claim = addResearchClaim(proj.id, '模型生成的叙述性判断', [], 'low')
    expect(claim.isModelInference).toBe(true)
    expect(claim.evidenceIds).toEqual([])
    // 引用了不存在的证据 id 同样视为无证据
    const claim2 = addResearchClaim(proj.id, '引用失效证据', ['nonexistent-ev'], 'low')
    expect(claim2.isModelInference).toBe(true)
    expect(claim2.evidenceIds).toEqual([])
  })

  it('(c) generateReport 绑定 projectId / asOfDate / claims', () => {
    const proj = createResearchProject('q', '600519', '贵州茅台')
    const ev = addEvidenceItem(proj.id, { kind: 'data', source: '行情', summary: 'PE 30' })
    addResearchClaim(proj.id, '结论A', [ev.id], 'medium')
    const report = generateReport(proj.id)
    expect(report.projectId).toBe(proj.id)
    expect(report.stockCode).toBe('600519')
    expect(report.asOfDate).toBeTruthy()
    expect(report.claims.length).toBeGreaterThan(0)
    expect(report.claims).toContain(getClaims(proj.id)[0].id)
    expect(getReport(proj.id)?.id).toBe(report.id)
    // 报告生成后项目标记 completed
    expect(getProject(proj.id)?.status).toBe('completed')
  })

  it('同一股票未完成项目复用（首次创建）', () => {
    const p1 = createResearchProject('q1', '600519', '贵州茅台')
    const p2 = createResearchProject('q2', '600519', '贵州茅台')
    expect(p2.id).toBe(p1.id)
    expect(listProjects()).toHaveLength(1)
  })
})

describe('V2 全局 PIT 与数据快照', () => {
  it('(d) registerDataSnapshot + getPitContext 全局 asOfDate', () => {
    const snap = registerDataSnapshot(makeSnapshot())
    expect(snap.id).toMatch(/^ds-/)
    const pit = getPitContext()
    expect(pit.active).toBe(true)
    expect(pit.asOfDate).toBe('2026-08-08')
    expect(pit.dataSnapshotId).toBe(snap.id)
    expect(pit.pitCapable).toBe(true)
    expect(getActiveSnapshot()?.id).toBe(snap.id)
    expect(listSnapshots()).toHaveLength(1)

    // setActivePit 切换全局基准
    const snap2 = registerDataSnapshot(
      makeSnapshot({ batchId: '2026-07-01', asOfDate: '2026-07-01', dataDate: '2026-07-01', snapshotId: 'snap-002' }),
    )
    const pit2 = setActivePit('2026-07-01', snap2.id)
    expect(pit2.asOfDate).toBe('2026-07-01')
    expect(pit2.pitCapable).toBe(true)
    expect(getActiveSnapshot()?.id).toBe(snap2.id)
  })

  it('无快照的日期 → PIT 能力不足标记 approximate', () => {
    registerDataSnapshot(makeSnapshot())
    const pit = setActivePit('2025-01-01', null)
    expect(pit.active).toBe(true)
    expect(pit.asOfDate).toBe('2025-01-01')
    expect(pit.pitCapable).toBe(false)
    expect(getActiveSnapshot()).toBeNull()
  })

  it('数据晚于基准日（前视风险）→ pitCapable=false', () => {
    // dataDate 晚于 asOfDate → 存在前视风险，PIT 能力不足
    const snap = registerDataSnapshot(
      makeSnapshot({ dataDate: '2026-08-10', asOfDate: '2026-08-08', batchId: '2026-08-08' }),
    )
    expect(getPitContext().pitCapable).toBe(false)
    expect(getPitContext().active).toBe(true)
    expect(snap.id).toMatch(/^ds-/)
  })

  it('退出 PIT 模式回到实时', () => {
    registerDataSnapshot(makeSnapshot())
    const pit = setActivePit(null, null)
    expect(pit.active).toBe(false)
    expect(pit.asOfDate).toBeNull()
    expect(pit.pitCapable).toBe(false)
  })
})

describe('V2 框架来源说明（规则21）', () => {
  it('(e) getFrameworkNote 返回「参考公开研究方法整理」', () => {
    expect(RESEARCH_FRAMEWORKS.length).toBeGreaterThan(0)
    for (const fw of RESEARCH_FRAMEWORKS) {
      expect(fw.note).toBe('参考公开研究方法整理')
      expect(getFrameworkNote(fw)).toBe('参考公开研究方法整理')
    }
  })
})
