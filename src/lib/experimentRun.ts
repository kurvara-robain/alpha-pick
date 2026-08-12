// ─────────────────────────────────────────────────────────────
// ExperimentRun V1 领域服务
// 依据 docs/experiment-run-v1-design.md 闸门设计实现
// 状态机、不可变边界、configHash、独立候选快照、回测记录
// ─────────────────────────────────────────────────────────────
import { getDB, saveDB, uid } from './store'
import type {
  BacktestExecutionSettings,
  BacktestRunRecord,
  BacktestSpec,
  CandidateSnapshot,
  CandidateStock,
  CombinationLogic,
  ExperimentAttempt,
  ExperimentRun,
  ExperimentRunStatus,
  FactorSnapshot,
  ResearchQuestion,
  ScreeningSpec,
  StrategySnapshot,
} from './types'

// ═══════════════════════════════════════════════════════════════
// 领域错误
// ═══════════════════════════════════════════════════════════════

export class ExperimentRunError extends Error {
  code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'CONFIG_FROZEN' | 'CONFIG_INCOMPLETE' | 'INVALID_ARGUMENT'
  constructor(
    message: string,
    code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'CONFIG_FROZEN' | 'CONFIG_INCOMPLETE' | 'INVALID_ARGUMENT',
  ) {
    super(message)
    this.name = 'ExperimentRunError'
    this.code = code
  }
}

// ═══════════════════════════════════════════════════════════════
// 纯 JS 同步 SHA-256（确定性、无依赖、同步）
// 用途：configHash（非加密安全场景，仅完整性检测）
// ═══════════════════════════════════════════════════════════════

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/**
 * 纯 JS 同步 SHA-256（修正3：完整 64 位输出，经标准向量 + Node crypto 对照验证）。
 * 导出仅为测试对照使用；浏览器生产代码不依赖 Node crypto。
 */
export function sha256Sync(input: string): string {
  // UTF-8 encode
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      // surrogate pair
      i++
      c = 0x10000 + (((c & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff))
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      )
    }
  }

  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / 2 ** (i * 8)) & 0xff)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const w = new Array<number>(64)
  for (let block = 0; block < bytes.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[block + i * 4] << 24) |
          (bytes[block + i * 4 + 1] << 16) |
          (bytes[block + i * 4 + 2] << 8) |
          bytes[block + i * 4 + 3]) >>>
        0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }

  const hex = (n: number) => n.toString(16).padStart(8, '0')
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7)
}

// ═══════════════════════════════════════════════════════════════
// 深拷贝与规范化
// ═══════════════════════════════════════════════════════════════

/** 深拷贝（JSON 序列化，去除 undefined / -0 / NaN → null） */
function deepClone<T>(v: T): T {
  if (v === undefined) return v
  return JSON.parse(JSON.stringify(v)) as T
}

// 哨兵前缀：canonicalize 输出的特殊标记，避免与用户字符串冲突
const NULL_SENTINEL = '\u0000NULL\u0000'
const UNDEFINED_SENTINEL = '\u0000UNDEFINED\u0000'
const NAN_SENTINEL = '\u0000NaN\u0000'
const INF_SENTINEL = '\u0000Infinity\u0000'
const NINF_SENTINEL = '\u0000-Infinity\u0000'

/**
 * 规范化数字：toFixed(6) 去浮点噪声。
 * -0 → '0'（与 +0 相同）；NaN/±Infinity → 哨兵（保留值且不与字符串冲突）
 */
function normNumber(n: number): string {
  if (Number.isNaN(n)) return NAN_SENTINEL
  if (n === Infinity) return INF_SENTINEL
  if (n === -Infinity) return NINF_SENTINEL
  if (Object.is(n, -0)) return '0'
  return n.toFixed(6)
}

/**
 * 递归规范化：键排序、数组保序、数字精度。
 * null/undefined/NaN/Infinity 用哨兵标记，与同名字符串明确区分。
 */
function canonicalize(value: unknown): unknown {
  if (value === null) return NULL_SENTINEL
  if (value === undefined) return UNDEFINED_SENTINEL
  if (typeof value === 'number') return normNumber(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k])
    }
    return out
  }
  return String(value)
}

// ═══════════════════════════════════════════════════════════════
// configHash（闸门6）
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Run 的配置字段计算 configHash。
 * 参与字段：screeningSpec、strategySnapshots、factorSnapshots、combinationLogic、originalQuery、asOfDate。
 * 排除：createdAt/updatedAt/status/attempt/attempts/failureReason/failureAt/candidateSnapshotId/backtestRunId/configHash 本身。
 */
export function computeConfigHash(run: Pick<
  ExperimentRun,
  | 'screeningSpec'
  | 'strategySnapshots'
  | 'factorSnapshots'
  | 'combinationLogic'
  | 'originalQuery'
  | 'asOfDate'
>): string {
  const payload = {
    asOfDate: run.asOfDate,
    originalQuery: run.originalQuery,
    screeningSpec: run.screeningSpec,
    strategySnapshots: run.strategySnapshots,
    factorSnapshots: run.factorSnapshots,
    combinationLogic: run.combinationLogic,
  }
  return sha256Sync(JSON.stringify(canonicalize(payload)))
}

/** 完整性检查：当前配置的哈希是否等于 Run 记录的 configHash */
export function verifyConfigIntegrity(runId: string): boolean {
  const run = findRun(runId)
  if (!run) return false
  return computeConfigHash(run) === run.configHash
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

function findRun(runId: string): ExperimentRun | null {
  return getDB().runs.find((r) => r.id === runId) ?? null
}

function saveRun(run: ExperimentRun): void {
  const db = getDB()
  const idx = db.runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) db.runs[idx] = run
  else db.runs.push(run)
  saveDB(db)
}

function assertStatus(run: ExperimentRun, allowed: ExperimentRunStatus[], op: string): void {
  if (!allowed.includes(run.status)) {
    throw new ExperimentRunError(
      `[${op}] 非法状态转换: ${run.status} → ${op}（允许: ${allowed.join('/')}）`,
      'INVALID_TRANSITION',
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// Clock（可替换，便于测试 attempt 时间线）
// ═══════════════════════════════════════════════════════════════

let nowProvider: () => Date = () => new Date()

/** 生产代码使用真实时钟；测试可注入固定/递增时钟（不引入依赖） */
export function setClockForTest(provider: (() => Date) | null): void {
  nowProvider = provider ?? (() => new Date())
}

function nowIso(): string {
  return nowProvider().toISOString()
}

function touch(run: ExperimentRun): void {
  run.updatedAt = nowIso()
}

/**
 * 打开一次尝试（修正2）：阶段区分 + startedAt 取本次操作时间。
 * 历史 attempt 绝不修改——只操作"当前活动 attempt"（最后一个 running）。
 */
function openAttempt(run: ExperimentRun, stage: 'screening' | 'backtest'): ExperimentAttempt {
  const attempt: ExperimentAttempt = {
    id: uid(),
    attempt: run.attempt,
    stage,
    startedAt: nowIso(),
    status: 'running',
  }
  run.attempts.push(attempt)
  return attempt
}

/**
 * 关闭当前活动 attempt（只关闭最后一个 running，不动历史）。
 * 找不到活动 attempt 时静默返回 null（防御，不抛错）。
 */
function closeAttempt(
  run: ExperimentRun,
  stage: 'screening' | 'backtest',
  status: 'screened' | 'failed' | 'completed',
  extra: Partial<Pick<ExperimentAttempt, 'failureReason' | 'candidateSnapshotId' | 'backtestRunId'>> = {},
): ExperimentAttempt | null {
  for (let i = run.attempts.length - 1; i >= 0; i--) {
    const a = run.attempts[i]
    if (a.stage === stage && a.status === 'running') {
      a.status = status
      a.endedAt = nowIso()
      if (extra.failureReason !== undefined) a.failureReason = extra.failureReason
      if (extra.candidateSnapshotId !== undefined) a.candidateSnapshotId = extra.candidateSnapshotId
      if (extra.backtestRunId !== undefined) a.backtestRunId = extra.backtestRunId
      return a
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 创建
// ═══════════════════════════════════════════════════════════════

/** 从首页搜索创建 Draft Run */
export function createDraftRun(query: ResearchQuestion, asOfDate: string): ExperimentRun {
  if (!query || !query.raw || !query.raw.trim()) {
    throw new ExperimentRunError('[createDraftRun] 研究问题不能为空', 'INVALID_ARGUMENT')
  }
  const now = nowIso()
  const run: ExperimentRun = {
    id: uid(),
    originalQuery: deepClone(query),
    status: 'draft',
    asOfDate,
    // draft 阶段使用空配置，待 updateRunConfiguration 填充
    screeningSpec: emptyScreeningSpec(asOfDate),
    strategySnapshots: [],
    factorSnapshots: [],
    combinationLogic: { mode: 'score', description: '' },
    configHash: '',
    createdAt: now,
    updatedAt: now,
    attempt: 0,
    attempts: [],
  }
  saveRun(run)
  return getRun(run.id) as ExperimentRun
}

/** 空的 ScreeningSpec（draft 占位，字段显式 none/unsupported） */
export function emptyScreeningSpec(asOfDate: string): ScreeningSpec {
  return {
    universe: { scope: '', stockCount: 0, source: 'none' },
    asOfDate,
    strategyConditions: [],
    combination: 'score',
    factorDirections: {},
    factorWeights: {},
    normalization: 'none',
    missingValuePolicy: 'unsupported',
    extremeValuePolicy: 'unsupported',
    neutralization: { byIndustry: false, bySize: false },
    topN: 0,
    rebalance: 'monthly',
    rankTieBreaker: 'none',
    dataSnapshotId: 'none',
    methodVersion: 'v1.0',
  }
}

// ═══════════════════════════════════════════════════════════════
// 查询（返回深拷贝，防止调用者修改持久化对象）
// ═══════════════════════════════════════════════════════════════

export function getRun(runId: string): ExperimentRun | null {
  const run = findRun(runId)
  return run ? deepClone(run) : null
}

export function listRuns(status?: ExperimentRunStatus): ExperimentRun[] {
  const runs = getDB().runs
  const filtered = status ? runs.filter((r) => r.status === status) : runs
  return deepClone(filtered)
}

/** 最近一个非 completed/failed 的 Run */
export function getActiveRun(): ExperimentRun | null {
  const runs = getDB().runs
  const active = runs.filter((r) => r.status !== 'completed' && r.status !== 'failed')
  if (active.length === 0) return null
  const last = active[active.length - 1]
  return deepClone(last)
}

// ═══════════════════════════════════════════════════════════════
// 配置（仅 draft 可修改，闸门5）
// ═══════════════════════════════════════════════════════════════

export function updateRunConfiguration(
  runId: string,
  screeningSpec: ScreeningSpec,
  strategySnapshots: StrategySnapshot[],
  factorSnapshots: FactorSnapshot[],
  combinationLogic: CombinationLogic,
): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[updateRunConfiguration] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['draft'], 'updateRunConfiguration')

  // 深拷贝快照：后续修改 db.strategies / db.factors 不影响 Run（闸门1/5）
  run.screeningSpec = deepClone(screeningSpec)
  run.strategySnapshots = deepClone(strategySnapshots)
  run.factorSnapshots = deepClone(factorSnapshots)
  run.combinationLogic = deepClone(combinationLogic)
  // draft 阶段 configHash 随配置刷新（ready 时正式冻结）
  run.configHash = computeConfigHash(run)
  touch(run)
  saveRun(run)
  return getRun(runId) as ExperimentRun
}

/** 标记 Run 就绪并冻结 configHash（闸门5/6） */
export function markRunReady(runId: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[markRunReady] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['draft', 'failed'], 'markRunReady')
  if (run.strategySnapshots.length === 0) {
    throw new ExperimentRunError('[markRunReady] 策略快照为空，无法就绪', 'CONFIG_INCOMPLETE')
  }
  run.status = 'ready'
  run.configHash = computeConfigHash(run) // 冻结
  touch(run)
  saveRun(run)
  return getRun(runId) as ExperimentRun
}

// ═══════════════════════════════════════════════════════════════
// 筛选
// ═══════════════════════════════════════════════════════════════

export function startScreening(runId: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[startScreening] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['ready'], 'startScreening')
  run.status = 'running_screen'
  openAttempt(run, 'screening') // 修正2：本次开始时间
  touch(run)
  saveRun(run)
  return getRun(runId) as ExperimentRun
}

/** 完成筛选：创建独立 CandidateSnapshot（深拷贝输入，不依赖 WatchList，闸门2） */
export function completeScreening(runId: string, candidates: CandidateStock[]): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[completeScreening] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['running_screen'], 'completeScreening')

  const snapshot: CandidateSnapshot = {
    id: uid(),
    runId: run.id,
    asOfDate: run.asOfDate,
    createdAt: nowIso(),
    universeSnapshot: deepClone(run.screeningSpec.universe),
    dataSnapshotId: run.screeningSpec.dataSnapshotId,
    candidates: deepClone(candidates), // 深拷贝：调用者后续修改原数组不影响快照
    configHash: run.configHash,
  }

  const db = getDB()
  db.candidateSnapshots.push(snapshot)
  run.candidateSnapshotId = snapshot.id
  run.status = 'screened'
  closeAttempt(run, 'screening', 'screened', { candidateSnapshotId: snapshot.id })
  touch(run)
  saveDB(db)
  return getRun(runId) as ExperimentRun
}

export function failScreening(runId: string, reason: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[failScreening] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['running_screen'], 'failScreening')
  failRun(run, `screening: ${reason}`, 'screening')
  return getRun(runId) as ExperimentRun
}

// ═══════════════════════════════════════════════════════════════
// 回测（闸门4：spec 由 Run 派生并冻结，两阶段接口，修正1）
// ═══════════════════════════════════════════════════════════════

/**
 * 阶段1：prepareBacktest
 * 从 Run 派生研究配置（策略/因子/股票池/组合/rebalance），
 * 仅接受执行层设置，冻结为 BacktestRunRecord（status: 'pending'）。
 * 不改变 Run.status（仍为 screened）。
 * 完整性：调用 verifyConfigIntegrity，Run 配置被篡改则拒绝。
 */
export function prepareBacktest(
  runId: string,
  executionSettings: BacktestExecutionSettings,
): BacktestRunRecord {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[prepareBacktest] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['screened'], 'prepareBacktest')
  if (!run.candidateSnapshotId) {
    throw new ExperimentRunError('[prepareBacktest] 无候选快照，必须先 completeScreening', 'CONFIG_INCOMPLETE')
  }
  // 修正1：完整性验证 — Run 配置被篡改（configHash 不匹配）则拒绝
  if (computeConfigHash(run) !== run.configHash) {
    throw new ExperimentRunError(
      '[prepareBacktest] Run 配置完整性校验失败（configHash 不匹配），拒绝派生回测配置',
      'CONFIG_FROZEN',
    )
  }

  // 白名单提取：只取 BacktestExecutionSettings 的已知执行字段，
  // 运行时传入的多余字段（universe/strategySnapshots/...）不会合并进 spec。
  const s = executionSettings
  const spec: BacktestSpec = {
    startDate: s.startDate,
    endDate: s.endDate,
    benchmark: s.benchmark,
    rebalance: run.screeningSpec.rebalance, // 研究配置：由 Run 派生，调用方不可覆盖
    portfolioConstruction: s.portfolioConstruction,
    signalDelay: s.signalDelay,
    executionPrice: s.executionPrice,
    commission: s.commission,
    stampDuty: s.stampDuty,
    slippage: s.slippage,
    limitUpDownHandling: s.limitUpDownHandling,
    suspensionHandling: s.suspensionHandling,
  }

  const record: BacktestRunRecord = {
    id: uid(),
    runId: run.id,
    spec: deepClone(spec), // 冻结：后续修改传入的 settings 不影响记录
    configHash: run.configHash, // 与 Run 的 configHash 一致（修正1）
    status: 'pending',
    createdAt: nowIso(),
  }
  const db = getDB()
  db.backtestRunRecords.push(record)
  run.backtestRunId = record.id
  touch(run)
  saveDB(db)
  return deepClone(record)
}

/**
 * 阶段2：startBacktest
 * 启动已冻结的 BacktestRunRecord。
 * 仅接受本 Run 的 backtestRunRecordId（防止启动其他 Run 的记录）。
 * 完整性：再次验证 Run 配置与 record.configHash 均未被篡改。
 */
export function startBacktest(runId: string, backtestRunRecordId: string): BacktestRunRecord {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[startBacktest] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['screened'], 'startBacktest')
  if (!run.backtestRunId || run.backtestRunId !== backtestRunRecordId) {
    throw new ExperimentRunError(
      `[startBacktest] backtestRunRecordId 不属于本 Run: ${backtestRunRecordId}（期望 ${run.backtestRunId ?? 'none'}）`,
      'INVALID_TRANSITION',
    )
  }
  // 修正1：完整性验证 — Run 配置被篡改则拒绝启动
  if (computeConfigHash(run) !== run.configHash) {
    throw new ExperimentRunError(
      '[startBacktest] Run 配置完整性校验失败（configHash 不匹配），拒绝启动回测',
      'CONFIG_FROZEN',
    )
  }
  const db = getDB()
  const record = db.backtestRunRecords.find((r) => r.id === backtestRunRecordId)
  if (!record) {
    throw new ExperimentRunError(`[startBacktest] 回测记录不存在: ${backtestRunRecordId}`, 'NOT_FOUND')
  }
  if (record.status !== 'pending') {
    throw new ExperimentRunError(`[startBacktest] 回测记录状态非法: ${record.status}（期望 pending）`, 'INVALID_TRANSITION')
  }
  // 修正1：record.configHash 必须等于 Run.configHash
  if (record.configHash !== run.configHash) {
    throw new ExperimentRunError(
      `[startBacktest] record.configHash 与 Run.configHash 不一致（${record.configHash} ≠ ${run.configHash}），拒绝启动`,
      'CONFIG_FROZEN',
    )
  }
  record.status = 'running'
  run.status = 'running_backtest'
  openAttempt(run, 'backtest') // 修正2：本次开始时间
  touch(run)
  saveDB(db)
  return deepClone(record)
}

export function completeBacktest(runId: string, backtestResultId: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[completeBacktest] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['running_backtest'], 'completeBacktest')
  const db = getDB()
  const record = db.backtestRunRecords.find((r) => r.id === run.backtestRunId)
  if (record) {
    record.status = 'completed'
    record.completedAt = nowIso()
    record.backtestResultId = backtestResultId
  }
  run.status = 'completed'
  closeAttempt(run, 'backtest', 'completed', { backtestRunId: run.backtestRunId })
  touch(run)
  saveDB(db)
  return getRun(runId) as ExperimentRun
}

export function failBacktest(runId: string, reason: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[failBacktest] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['running_backtest'], 'failBacktest')
  const db = getDB()
  const record = db.backtestRunRecords.find((r) => r.id === run.backtestRunId)
  if (record) {
    record.status = 'failed'
    record.failureReason = reason
  }
  failRun(run, `backtest: ${reason}`, 'backtest', db)
  return getRun(runId) as ExperimentRun
}

// ═══════════════════════════════════════════════════════════════
// 失败与重试
// ═══════════════════════════════════════════════════════════════

function failRun(
  run: ExperimentRun,
  reason: string,
  stage: 'screening' | 'backtest',
  db?: ReturnType<typeof getDB>,
): void {
  run.status = 'failed'
  run.failureReason = reason
  run.failureAt = nowIso()
  closeAttempt(run, stage, 'failed', {
    failureReason: reason,
    backtestRunId: run.backtestRunId,
  })
  touch(run)
  if (db) saveDB(db)
  else saveRun(run)
}

/** 失败重试：attempt+1，回退 draft，保留配置快照（闸门5） */
export function retryFromFailed(runId: string): ExperimentRun {
  const run = findRun(runId)
  if (!run) throw new ExperimentRunError(`[retryFromFailed] Run 不存在: ${runId}`, 'NOT_FOUND')
  assertStatus(run, ['failed'], 'retryFromFailed')
  run.attempt += 1
  run.status = 'draft'
  run.failureReason = undefined
  run.failureAt = undefined
  run.candidateSnapshotId = undefined
  run.backtestRunId = undefined
  // 配置快照保留（闸门5：重试不改变配置）
  touch(run)
  saveRun(run)
  return getRun(runId) as ExperimentRun
}

// ═══════════════════════════════════════════════════════════════
// 候选快照查询（闸门2）
// ═══════════════════════════════════════════════════════════════

export function getCandidateSnapshot(runId: string): CandidateSnapshot | null {
  const run = findRun(runId)
  if (!run?.candidateSnapshotId) return null
  const snap = getDB().candidateSnapshots.find((s) => s.id === run.candidateSnapshotId)
  return snap ? deepClone(snap) : null
}

export function getBacktestRunRecord(runId: string): BacktestRunRecord | null {
  const run = findRun(runId)
  if (!run?.backtestRunId) return null
  const rec = getDB().backtestRunRecords.find((r) => r.id === run.backtestRunId)
  return rec ? deepClone(rec) : null
}
