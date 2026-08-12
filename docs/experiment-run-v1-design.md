# AlphaMind ExperimentRun V1 架构设计

> 状态：设计文档  
> 版本：V1  
> 分支：next-major  
> 基于：`docs/current-system-map.md` 审计结果  
> 约束：不修改业务代码，不实现，不设计全站架构

---

## 1. V1 问题定义

### 1.1 上下文丢失的具体位置

根据 `docs/current-system-map.md` 第 6 节，当前流程存在以下断裂点：

| 断裂位置 | 代码位置 | 丢失内容 |
|----------|---------|---------|
| HomePage → 目标页 | `src/pages/HomePage.tsx:46-51` | 用户搜索词 `query` 被丢弃，目标页不知道用户想找什么 |
| Workbench → Backtest | `src/pages/WorkbenchPage.tsx:57-60` vs `src/pages/BacktestPage.tsx` | watchlist 包含 `strategyIds` + `factorIds`，但回测页重新从 `db.strategies` / `db.factorPool` 读取，联配关系丢失 |
| Workbench → Watchlist | `src/pages/WorkbenchPage.tsx:405-437` → `src/pages/WatchlistPage.tsx` | watchlist 保存了 `strategyIds` 和 `factorIds`，但 WatchlistPage 不读取这些字段用于后续操作 |

### 1.2 可复用的现有类型

| 类型 | 位置 | 复用方式 |
|------|------|---------|
| `Strategy` | `src/lib/types.ts:16` | 快照其 `conditions`, `name`, `source`, `id` |
| `Factor` | `src/lib/types.ts:30` | 快照其 `id`, `name`, `category`, `rule` |
| `WatchList` | `src/lib/types.ts:56` | 已有 `strategyIds[]` 和 `factorIds[]`，ExperimentRun 引用 watchlist ID |
| `BacktestResult` | `src/lib/types.ts:93` | 已有 `config: BacktestConfig` 包含 strategyIds/factorIds，ExperimentRun 引用 backtest ID |
| `BacktestConfig` | `src/lib/types.ts:67` | 已有 `moduleName`, `strategyIds`, `factorIds`, `startDate`, `endDate`, `rebalance` |
| `DB` | `src/lib/store.ts:22` | 新增 `runs: ExperimentRun[]` 字段 |

### 1.3 必须新增的类型

| 类型 | 原因 |
|------|------|
| `ExperimentRun` | 主键，串联全流程，研究配置与结果的**唯一事实来源** |
| `StrategySnapshot` | 不可变快照，防止策略被修改后历史 Run 数据变化 |
| `FactorSnapshot` | 同上 |
| `CandidateSnapshot` | **独立持久化对象**（非 WatchList 引用），候选结果不可变 |
| `BacktestSpec` | 回测开始前冻结的完整回测配置 |
| `BacktestRunRecord` | 回测结果与 runId、configHash、attempt 历史的关联 |
| `ResearchQuestion` | 用户原始问题（draft 阶段即保存） |
| `ExperimentRunQuery` | 轻量级 DTO，仅用于 Run 列表展示 |

### 1.4 为什么 ExperimentRun 是最小改造主键

当前系统已有完整的单页功能（创建策略、选择因子、生成候选、运行回测），缺失的是一个**跨页面的"信封"**把这些动作串联起来。ExperimentRun 就是这个信封——它不改变任何现有页面的内部逻辑，只是：

1. 在首页创建时记录用户的原始问题
2. 在每个步骤完成后更新状态
3. 让后续页面能读取前序页面的配置
4. 在 localStorage 中持久化，刷新不丢

**关键定位修正（闸门1 结论）**：ExperimentRun 不是"附加在旧页面上的引用信封"，而是**研究配置与结果的唯一事实来源**。有 runId 时，Workbench 的筛选配置与 Backtest 的回测配置**必须全部从 Run 快照读取**，不得从 `db.strategies` / `db.factorPool` 重新组装。旧页面流程仅在无 runId 时作为 legacy 兼容路径保留。

---

## 2. 数据模型

### 2.1 核心类型定义

```typescript
// ── src/lib/types.ts 新增 ──

/** 用户原始研究问题 */
export interface ResearchQuestion {
  raw: string                    // 用户输入的原始文本，如 "找低PE高ROE的股票"
  parsedIntent?: string          // 意图识别结果（V1 可为空字符串）
  extractedEntities?: string[]   // 提取的实体词（V1 可为空数组）
}

/** 策略不可变快照 */
export interface StrategySnapshot {
  strategyId: string             // 来源策略的 ID（对应 db.strategies[].id）
  name: string                   // 快照时的策略名称
  conditions: StrategyCondition[] // 快照时的条件列表（深拷贝）
  source: Strategy['source']     // 快照时的来源
  capturedAt: string             // 快照 ISO 时间戳
}

/** 因子不可变快照 */
export interface FactorSnapshot {
  factorId: string               // 来源因子的 ID（对应 db.factors[].id）
  name: string                   // 快照时的因子名称
  category: string               // 快照时的类别
  rule?: Factor['rule']          // 快照时的筛选规则（深拷贝）
  capturedAt: string             // 快照 ISO 时间戳
}

/** 组合逻辑描述 */
export interface CombinationLogic {
  mode: 'and' | 'weighted'       // 策略间逻辑
  description: string            // 人类可读描述，如 "低PE AND 动量趋势"
}

/** 单只候选股（不可变） */
export interface CandidateItem {
  stockCode: string
  stockName: string
  rank: number                   // 截面排名（1=最优）
  included: boolean              // 是否最终入选
  strategyMatches: string[]      // 命中的策略快照 ID
  factorScores: Record<string, number>  // 因子快照 ID → 得分
  compositeScore: number         // 综合得分
  exclusionReasons?: string[]    // 排除原因（未入选时）
  inclusionReasons?: string[]    // 入选原因（入选时）
  marketDataTimestamp: string    // 行情数据时间戳
}

/**
 * 独立候选快照（闸门2）
 * 持久化对象，不依赖 WatchList 存在。
 * WatchList 只引用 CandidateSnapshot.id，不能充当 CandidateSnapshot 本身。
 */
export interface CandidateSnapshot {
  id: string
  runId: string
  asOfDate: string
  createdAt: string
  universeSnapshot: {            // 股票池定义（冻结）
    scope: string                // 如 "全A" | "沪深300" | "自定义"
    stockCount: number
    source: string               // 数据源描述
  }
  dataSnapshotId: string         // 数据批次 ID（对应 versionMetadata）
  candidates: CandidateItem[]
  configHash: string             // 产生该快照的可执行配置哈希（见闸门6）
}

/**
 * 完整可执行配置快照（闸门3）
 * 覆盖一次筛选可重放所需的所有字段。
 * V1 不支持的字段显式写 'unsupported' 或 'none'，不得隐式省略。
 */
export interface ScreeningSpec {
  universe: { scope: string; stockCount: number; source: string }
  asOfDate: string
  strategyConditions: StrategyCondition[][]  // 每个策略一组条件
  combination: 'intersection' | 'union' | 'score'
  factorDirections: Record<string, 'asc' | 'desc'>
  factorWeights: Record<string, number>
  normalization: 'zscore' | 'rank' | 'none'
  missingValuePolicy: 'drop' | 'fill_mean' | 'none'
  extremeValuePolicy: 'winsorize_99' | 'none'
  neutralization: { byIndustry: boolean; bySize: boolean }
  topN: number                   // 持仓数量
  rebalance: 'weekly' | 'monthly'
  rankTieBreaker: 'code' | 'name' | 'none'
  dataSnapshotId: string
  methodVersion: string          // 筛选引擎版本，如 "v1.0"
}

/**
 * 回测规格（闸门4）
 * 回测开始前冻结，BacktestResult 内嵌此快照。
 */
export interface BacktestSpec {
  startDate: string
  endDate: string
  benchmark: string              // 如 "000300.SH"
  rebalance: 'weekly' | 'monthly'
  portfolioConstruction: 'equal_weight' | 'score_weight'
  signalDelay: 't0' | 't1'
  executionPrice: 'open' | 'close'
  commission: number             // 万分之
  stampDuty: number              // 卖出印花税 %
  slippage: number               // 滑点 %
  limitUpDownHandling: 'skip' | 'block'
  suspensionHandling: 'skip' | 'hold'
  configHash: string             // 该规格的哈希
}

/** ExperimentRun 状态 */
export type ExperimentRunStatus =
  | 'draft'
  | 'ready'
  | 'running_screen'
  | 'screened'
  | 'running_backtest'
  | 'completed'
  | 'failed'

/** 核心类型 */
export interface ExperimentRun {
  id: string                     // uid()
  originalQuery: ResearchQuestion
  status: ExperimentRunStatus
  asOfDate: string               // 研究基准日期 yyyy-MM-dd

  // 不可变执行配置（闸门1：唯一事实来源）
  screeningSpec: ScreeningSpec
  strategySnapshots: StrategySnapshot[]
  factorSnapshots: FactorSnapshot[]
  combinationLogic: CombinationLogic

  // 产出引用（独立持久化对象，非内嵌）
  candidateSnapshotId?: string   // 指向 DB.candidateSnapshots[].id
  backtestRunId?: string         // 指向 DB.backtestRuns[].id

  // 元数据
  createdAt: string
  updatedAt: string
  failureReason?: string         // failed 状态时记录原因
  failureAt?: string             // ISO
  attempt: number                // 失败重试次数（从 0 开始）
  attempts: AttemptRecord[]      // 每次尝试的历史（闸门5）
}

/** 失败重试历史（闸门5） */
export interface AttemptRecord {
  attempt: number
  startedAt: string
  endedAt: string
  status: 'screened' | 'failed' | 'completed'
  failureReason?: string
  candidateSnapshotId?: string
  backtestRunId?: string
}

/** 回测运行记录（闸门4/5） */
export interface BacktestRunRecord {
  id: string
  runId: string
  spec: BacktestSpec             // 内嵌不可变规格快照
  configHash: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  failureReason?: string
  createdAt: string
  completedAt?: string
  backtestResultId?: string      // 指向 db.backtests[].id（成功后）
}
```

### 2.2 不可变快照方案选择

**方案 A（推荐）：Run 内嵌不可变快照**

```
ExperimentRun.strategySnapshots = [
  { strategyId: "s-123", name: "低PE策略", conditions: [...], capturedAt: "..." }
]
```

**方案 B：独立版本表 + versionId 引用**

```
StrategyVersion { id, strategyId, version, conditions, createdAt }
ExperimentRun.strategyVersionIds = ["sv-456"]
```

**V1 选择方案 A，原因：**

1. **localStorage 无 JOIN 能力** — 方案 B 需要在查询时遍历两个数组做 ID 匹配，localStorage 不支持复杂度高的查询。
2. **读写比例极高偏向读** — Run 创建后快照只写入一次（capture 时），之后只读。方案 B 的写时分离优势在这里不成立。
3. **快照数据量可控** — 单个 Run 的策略快照 ≤ 5 个，因子快照 ≤ 10 个，总 JSON 体积 < 10KB。
4. **无微服务/数据库迁移预期** — V1 阶段 ≤ localStorage，不需要为未来的 SQL 做架构让步。
5. **迁移安全** — 内嵌快照可以随 Run 一起删除，不存在"Run 删了但版本表还有孤儿引用"的问题。

### 2.3 DB Schema 升级

```typescript
// ── src/lib/store.ts 修改 ──

const SEED_VERSION = 5  // 从 4 升级到 5

export interface DB {
  strategies: Strategy[]
  factors: Factor[]
  factorPool: string[]
  watchlists: WatchList[]
  backtests: BacktestResult[]
  holdings: Holding[]
  reports: DailyReport[]
  runs: ExperimentRun[]              // ← 新增
  candidateSnapshots: CandidateSnapshot[]  // ← 新增（闸门2）
  backtestRuns: BacktestRunRecord[]        // ← 新增（闸门4）
  seedVersion?: number
}
```

### 2.4 闸门5：不可变边界

| 状态 | 可修改字段 | 禁止修改字段 |
|------|-----------|-------------|
| `draft` | `screeningSpec`（完整重写）、`strategySnapshots`、`factorSnapshots`、`combinationLogic`、`originalQuery`、`asOfDate` | `candidateSnapshotId`、`backtestRunId`、`status`（仅通过状态函数变更） |
| `ready` | `attempts`、`updatedAt` | **所有研究配置字段**（screeningSpec / strategySnapshots / factorSnapshots / combinationLogic / originalQuery / asOfDate） |
| `running_screen` | `updatedAt` | 同上 |
| `screened` | `candidateSnapshotId`、`attempts`、`updatedAt` | 研究配置字段；**不允许直接重新筛选覆盖** |
| `running_backtest` | `backtestRunId`、`updatedAt` | 研究配置字段、`candidateSnapshotId` |
| `completed` | `updatedAt`（仅） | 一切 |
| `failed` | `failureReason`、`failureAt`、`attempts`、`updatedAt` | 研究配置字段 |

**规则**：
- ready 以后研究配置不可修改。
- 用户修改策略或因子时：**创建新 Run 或新 revision**，不得覆盖原 Run。V1 采用"创建新 Run"（revision 链留待 V2）。
- screened 后不允许直接重新筛选。需要重筛 → 创建新 Run。
- 失败重试复用原 Run：`attempt` +1，写入 `attempts[]` 历史，快照保留。

### 2.5 闸门6：配置哈希规范

**参与哈希的字段**（按固定顺序序列化）：

```
1. screeningSpec.universe (scope, stockCount, source)
2. screeningSpec.asOfDate
3. screeningSpec.strategyConditions（每个策略的 conditions 数组，condition 内按 field, op, value, window 排序）
4. screeningSpec.combination
5. screeningSpec.factorDirections（按键排序）
6. screeningSpec.factorWeights（按键排序）
7. screeningSpec.normalization
8. screeningSpec.missingValuePolicy
9. screeningSpec.extremeValuePolicy
10. screeningSpec.neutralization (byIndustry, bySize)
11. screeningSpec.topN
12. screeningSpec.rebalance
13. screeningSpec.rankTieBreaker
14. screeningSpec.dataSnapshotId
15. screeningSpec.methodVersion
16. strategySnapshots (id, name, conditions)
17. factorSnapshots (id, name, category, rule)
18. combinationLogic (mode)
```

**排除字段**：
- `createdAt`、`updatedAt`、`status`、`attempt`、`attempts[]`、`failureReason`、`failureAt`
- `candidateSnapshotId`、`backtestRunId`（产出引用，非配置）

**规范化规则**：
- 所有对象键按字典序排序
- 数组按元素自然序排序（conditions 内 field/op 优先序）
- 数字统一 `toFixed(6)` 去除浮点噪声
- 序列化 → `hash('sha256')` → 取前 16 位 hex 作为 `configHash`

**用途**：
- 检测历史配置被意外改变：`hash(current) !== run.configHash` → 标记 "配置已被外部修改"
- 检测相同配置重复提交：相同哈希 → 可提示 "该配置已存在"

---

## 3. 状态机

### 3.1 合法转换

```
                    ┌─────────────────────────┐
                    │                         │
                    ▼                         │
  ┌───────┐  configure  ┌───────┐  start   ┌──────────────┐
  │ draft │────────────→│ ready │─────────→│running_screen│
  └───┬───┘             └───┬───┘          └──────┬───────┘
      │                     │                     │
      │                     │ fail         ┌──────┴───────┐
      │                     │ (配置无效)    │              │
      │                     ▼              ▼              ▼
      │                 ┌───────┐    ┌──────────┐   ┌───────┐
      │                 │ failed│    │ screened │   │ failed│
      │                 └───────┘    └────┬─────┘   └───────┘
      │                                  │ start
      │                                  │ backtest
      │                                  ▼
      │                           ┌──────────────┐
      │                           │running_backtest│
      │                           └──────┬───────┘
      │                                  │
      │                           ┌──────┴───────┐
      │                           │              │
      │                           ▼              ▼
      │                       ┌──────────┐   ┌───────┐
      │                       │completed │   │ failed│
      │                       └──────────┘   └───────┘
      │                                           │
      └──────────────────── retry ────────────────┘
```

### 3.2 转换明细

| 当前状态 | 触发动作 | 目标状态 | 条件 |
|---------|---------|---------|------|
| `draft` | `updateRunConfiguration()` | `draft` | 仅更新快照，状态不变 |
| `draft` | `markRunReady()` | `ready` | strategySnapshots 非空 |
| `ready` | `startScreening()` | `running_screen` | ready 状态 |
| `running_screen` | `completeScreening()` | `screened` | 筛选成功，产出 watchlistId |
| `running_screen` | `failScreening()` | `failed` | 筛选异常，记录 failureReason |
| `screened` | `startBacktest()` | `running_backtest` | 存在 candidateSnapshot |
| `running_backtest` | `completeBacktest()` | `completed` | 回测成功，记录 backtestResultId |
| `running_backtest` | `failBacktest()` | `failed` | 回测异常，记录 failureReason |
| `failed` | `retryFromFailed()` | `draft` | 清除 failureReason，保留快照，重置后续 |

### 3.3 非法转换

| 尝试 | 行为 |
|------|------|
| draft → startScreening | 拒绝，必须先 markRunReady |
| draft → startBacktest | 拒绝 |
| ready → completeScreening | 拒绝，必须先 startScreening |
| screened → completeBacktest | 拒绝，必须先 startBacktest |
| completed → 任何状态 | 只读，拒绝所有状态变更 |
| running_* → 状态停留超 30 分钟 | 自动标记 `failed`，`failureReason = "任务超时"` |

### 3.4 失败后重试

- **重试复用原 Run**：`retryFromFailed()` 将状态回退到 `draft`，`attempt` +1，写入 `attempts[]` 历史（记录失败原因与时间），清除 `failureReason`、`candidateSnapshotId`、`backtestRunId`。**策略/因子快照不变**，仅重新执行筛选和回测。
- **attempt 历史**：每次失败/成功都追加 `AttemptRecord`。`attempts[].failureReason` 保留可诊断信息。
- **创建新 Run**：用户主动修改研究配置时（非失败重试），创建新 Run，不覆盖旧 Run（闸门5 规则）。

### 3.5 闸门1：唯一事实来源（运行时规则）

| 场景 | 数据来源 |
|------|---------|
| 有 runId 的 Workbench 筛选 | **Run.screeningSpec + strategySnapshots + factorSnapshots**（只读） |
| 有 runId 的 Backtest 回测 | **Run.screeningSpec + Run.backtestSpec 派生**（只读，见闸门4） |
| 无 runId 的旧流程（legacy） | `db.strategies` + `db.factorPool`（现有逻辑不变） |

- 有 runId 时，**禁止**从 `db.strategies` / `db.factorPool` 重新组装配置（当前 `BacktestPage.tsx:212,216` 的行为只允许出现在 legacy 路径）。
- Run 快照与当前策略池不一致时，**以 Run 快照为准**。
- 页面不得直接修改已 ready 的 Run 配置（闸门5 强制）。

---

## 4. 存储方案

### 4.1 Schema 版本升级

```
升级路径: SEED_VERSION 4 → 5
触发条件: db.seedVersion < 5 时自动迁移
```

### 4.2 新增集合

```typescript
DB.runs: ExperimentRun[]  // 初始化为 []
```

### 4.3 存储 key

**不新增 localStorage key**。`ExperimentRun[]` 存储在现有 `alphamind_db_v2` 内。

理由：
- 保持单一事实源（Single Source of Truth）
- 避免 Run 与其他 DB 数据（strategies/watchlists/backtests）分离导致的引用完整性风险
- 现有 `saveDB()` 的深克隆机制天然保证写入一致性

### 4.4 迁移逻辑

```typescript
// ── src/lib/store.ts 修改 ──

function migrateDB(db: DB): boolean {
  let changed = false
  // ... 现有 v2-v4 迁移逻辑不变 ...

  // v5 迁移：添加 runs / candidateSnapshots / backtestRuns 集合
  if ((db.seedVersion ?? 0) < 5) {
    if (!Array.isArray(db.runs)) db.runs = []
    if (!Array.isArray(db.candidateSnapshots)) db.candidateSnapshots = []
    if (!Array.isArray(db.backtestRuns)) db.backtestRuns = []
    changed = true
  }

  db.seedVersion = SEED_VERSION
  return changed
}
```

### 4.7 闸门7：旧数据兼容（legacy）

现有 `WatchList` 和 `BacktestResult` 没有 `runId`。规则：

| 规则 | 说明 |
|------|------|
| **不得伪造证据链** | 旧 watchlist/backtest 不创建虚假的 ExperimentRun。它们保持无 runId，标注 `legacy: true`。 |
| **legacy 标记** | 迁移时对无 runId 的旧记录不做任何写入，仅当读取展示时由 UI 判断：`watchlist.runId === undefined` → 显示 "历史清单"；`backtestResult.runId === undefined` → 显示 "历史回测"。**不修改数据本身**。 |
| **旧记录只读** | legacy 记录不允许被 Run 流程引用、修改或删除（保留用户手动删除能力，但 Run 流程不触碰）。 |
| **复制为 Draft Run** | 用户可将旧 watchlist 的 `strategyIds`/`factorIds` 导入为新 Run：读取旧记录 → `createDraftRun` → `updateRunConfiguration` 填充快照。新 Run 独立存在，与旧记录无引用关系。 |
| **删除新 Run 不影响旧记录** | Run 只读旧记录做展示，不持有引用；删除 Run 不级联删除旧 watchlist/backtest。 |
| **迁移失败回退** | `getDB()` catch 块返回 `seed()` 全新 DB，**不覆盖 localStorage 原值**。用户删除 key 后可重建，或保留原数据等待重试。**禁止在迁移异常时清空 localStorage**。 |
| **不静默删除** | 任何迁移路径都不删除 strategies/factors/factorPool/watchlists/backtests/holdings/reports。 |

### 4.5 迁移安全

- ❌ 不删除 `strategies`, `factors`, `factorPool`, `watchlists`, `backtests`, `holdings`, `reports`
- ✅ `db.runs = []` 仅追加空数组
- ✅ `migrateDB()` 幂等：多次调用不重复初始化
- ✅ 迁移失败 → `getDB()` catch 块返回 `seed()`（全新 DB），不破坏 localStorage 原有数据（用户可删除 key 重试）

### 4.6 旧 Run 清理策略

V1 不做自动清理。原因：
- localStorage 5MB 限制下，单个 Run ~10KB，500 个 Run = 5MB 刚好到上限
- 实际用户可能创建 ≤ 50 个 Run
- 未来 V2 可增加 `runs.slice(-100)` 保留最近 100 个策略

---

## 5. 服务接口

```typescript
// ── src/lib/experimentRunStore.ts (新文件) ──

import { getDB, saveDB } from './store'
import type { ExperimentRun, ResearchQuestion, StrategySnapshot, FactorSnapshot } from './types'

// ── 创建 ──

/** 从首页搜索创建 Draft Run */
function createDraftRun(query: ResearchQuestion): ExperimentRun
// 输入: { raw: "找低PE高ROE的股票" }
// 返回: 新建的 draft 状态 ExperimentRun
// 前置: 无
// 后置: db.runs.push(run); saveDB(db)
// 失败: 不抛出，返回 run（仅内存操作）

// ── 配置 ──

/** 更新 Run 的策略/因子配置（重写快照）— 仅 draft 状态允许 */
function updateRunConfiguration(
  runId: string,
  screeningSpec: ScreeningSpec,
  strategySnapshots: StrategySnapshot[],
  factorSnapshots: FactorSnapshot[],
  logic: CombinationLogic,
): ExperimentRun | null
// 输入: runId + 完整可执行配置
// 返回: 更新后的 Run，或 null（runId 不存在 / 状态非 draft）
// 前置: run.status === 'draft'（闸门5：ready 后禁止）
// 后置: 快照重写; updatedAt = now
// 失败: 状态非 draft → null；同时计算并保存 configHash

/** 标记 Run 就绪 — 冻结配置 */
function markRunReady(runId: string): ExperimentRun | null
// 前置: run.status === 'draft' 且 strategySnapshots.length > 0
// 后置: run.status = 'ready'; run.configHash = computeConfigHash(run)（冻结）; updatedAt = now
// 失败: strategySnapshots 为空时返回 null

/** 从 Run 快照重建可执行筛选配置（闸门1：唯一事实来源） */
function getExecutableConfig(runId: string): ScreeningConfig | null
// 输入: runId
// 返回: { screeningSpec, strategySnapshots, factorSnapshots, combinationLogic } 只读视图
// 失败: runId 不存在 → null

// ── 筛选 ──

function startScreening(runId: string): ExperimentRun | null
// 前置: run.status === 'ready'
// 后置: run.status = 'running_screen'

function completeScreening(runId: string, candidateSnapshot: CandidateSnapshot): ExperimentRun | null
// 前置: run.status === 'running_screen'
// 后置:
//   db.candidateSnapshots.push(candidateSnapshot)  // 独立持久化（闸门2）
//   run.candidateSnapshotId = candidateSnapshot.id
//   run.status = 'screened'

function failScreening(runId: string, reason: string): ExperimentRun | null
// 前置: run.status === 'running_screen'
// 后置: run.status = 'failed'; run.failureReason = reason; run.failureAt = now
//   attempts.push({ attempt, status: 'failed', failureReason: reason })

function getCandidateSnapshot(runId: string): CandidateSnapshot | null
// 输入: runId
// 返回: 独立候选快照（即使 WatchList 被删除仍完整可读，闸门2）
// 失败: 无 → null

// ── 回测 ──

/** 阶段1：从 Run 派生研究配置，仅接受执行层设置，冻结为 pending 记录（修正1） */
function prepareBacktest(runId: string, executionSettings: BacktestExecutionSettings): BacktestRunRecord
// 输入: runId + 执行层设置（不含策略/因子/股票池/组合/rebalance）
// 前置: run.status === 'screened' 且存在 candidateSnapshotId
// 后置:
//   db.backtestRunRecords.push({ id, runId, spec: { ...executionSettings, rebalance: run.screeningSpec.rebalance }, configHash, status: 'pending' })
//   run.backtestRunId = record.id
//   run.status 不变（仍为 screened）
// 失败: rebalance 由 Run 派生，调用方无法覆盖

/** 阶段2：启动已冻结的 BacktestRunRecord */
function startBacktest(runId: string, backtestRunRecordId: string): BacktestRunRecord
// 前置: run.status === 'screened' 且 run.backtestRunId === backtestRunRecordId 且 record.status === 'pending'
// 后置: record.status = 'running'; run.status = 'running_backtest'
// 失败: record 不属于本 Run → ExperimentRunError(INVALID_TRANSITION)
//   record 非 pending → ExperimentRunError(INVALID_TRANSITION)

function completeBacktest(runId: string, backtestResultId: string): ExperimentRun | null
// 前置: run.status === 'running_backtest' 且存在 backtestRunId
// 后置: backtestRunRecord.status = 'completed'; completedAt = now
//   backtestRunRecord.backtestResultId = backtestResultId
//   run.status = 'completed'
//   attempts.push({ attempt, status: 'completed' })

function failBacktest(runId: string, reason: string): ExperimentRun | null
// 前置: run.status === 'running_backtest'
// 后置: backtestRunRecord.status = 'failed'; failureReason = reason
//   run.status = 'failed'; run.failureReason = reason
//   attempts.push({ attempt, status: 'failed', failureReason: reason })

// ── 查询 ──

function getRun(runId: string): ExperimentRun | null
function listRuns(status?: ExperimentRunStatus): ExperimentRun[]
function getActiveRun(): ExperimentRun | null  // 最近一个非 completed/failed 的 Run
function computeConfigHash(run: ExperimentRun): string  // 闸门6 规范实现
function verifyConfigIntegrity(runId: string): boolean  // hash(run) === run.configHash

// ── 重试 ──

function retryFromFailed(runId: string): ExperimentRun | null
// 前置: run.status === 'failed'
// 后置:
//   run.attempt += 1
//   run.status = 'draft'
//   清除 failureReason / candidateSnapshotId / backtestRunId
//   配置快照保留（闸门5：重试不改变配置）
```

**所有函数**：
- 读写 `alphamind_db_v2`
- 通过 `getDB()` → 修改 → `saveDB(db)` 完成持久化
- 不涉及网络请求（筛选和回测的实际执行仍由 `WorkbenchPage` 和 `BacktestPage` 的现有逻辑处理）

---

## 6. 页面接入方式

### 6.1 HomePage (`/`)

**最小改造**：

```typescript
// 在 handleSearch 中增加 createDraftRun
const handleSearch = () => {
  if (!query.trim()) return
  // 新增：创建 Draft Run
  const run = createDraftRun({ raw: query })
  const lower = query.toLowerCase()
  if (lower.includes('策略') || lower.includes('回测')) {
    navigate(`/strategies?runId=${run.id}`)
  } else {
    navigate(`/research?runId=${run.id}&q=${encodeURIComponent(query)}`)
  }
}
```

- `runId` 通过 URL query string 传递
- 不改变现有关键词匹配逻辑
- 没有 runId 时：页面按现有行为运行（兼容旧流程）

### 6.2 StrategiesPage (`/strategies`)

**最小改造**：

```typescript
// 读取 URL 中的 runId
const [searchParams] = useSearchParams()
const runId = searchParams.get('runId') ?? undefined

// 如果存在 runId，在策略被创建/修改后，更新 Run 的快照
// 在 "一键添加" 种子策略时：updateRunConfiguration(runId, snapshots, [])
// 在手动创建策略后：同上
```

- 不改变页面 UI 结构
- 无 runId 时：行为不变
- 刷新后：URL query 中的 `runId` 仍然存在，Run 从 localStorage 恢复

### 6.3 FactorsPage (`/factors`)

**最小改造**：

```typescript
// 读取 URL 中的 runId（与 StrategiesPage 相同模式）
const [searchParams] = useSearchParams()
const runId = searchParams.get('runId') ?? undefined

// factorPool 变更后更新 Run 的因子快照
// 在 "加入选择池" 后更新
```

### 6.4 WorkbenchPage (`/workbench`)

**最小改造**：

```typescript
const [searchParams] = useSearchParams()
const runId = searchParams.get('runId') ?? undefined

// 步骤 1: 如果有 runId 且 Run 是 draft → 调用 markRunReady
useEffect(() => {
  if (runId) {
    const run = getRun(runId)
    if (run?.status === 'draft' && run.strategySnapshots.length > 0) {
      markRunReady(runId)
    }
  }
}, [runId])

// 步骤 2: "生成备选清单" 时 → startScreening(runId)
// 步骤 3: 筛选完成后 → completeScreening(runId, watchlistId, results.length)

// 步骤 4: "保存清单" 后的跳转：从 navigate(`/watchlist`) 改为：
navigate(`/watchlist?runId=${runId}`)

// 如果没有 runId，所有流程不变（兼容旧行为）
// 筛选失败 → failScreening(runId, errorMessage)
```

### 6.5 WatchlistPage (`/watchlist`)

**最小改造**：

```typescript
const [searchParams] = useSearchParams()
const runId = searchParams.get('runId') ?? undefined

// 如果有 runId，读取 Run 的状态以展示上下文
const run = runId ? getRun(runId) : null
// 显示 "研究进度：已完成筛选，共 {n} 只候选 → 下一步：回测"
// 提供 "运行回测" 按钮：
navigate(`/backtest?runId=${runId}`)
```

### 6.6 BacktestPage (`/backtest`)

**最小改造**：

```typescript
const [searchParams] = useSearchParams()
const runId = searchParams.get('runId') ?? undefined

// 如果有 runId（闸门1：唯一事实来源）：
// 1. const run = getRun(runId)
// 2. const spec = deriveBacktestSpec(run.screeningSpec)  // 从 Run 冻结配置派生回测规格
// 3. startBacktest(runId, spec) → 运行回测
// 4. completeBacktest(runId, backtestId) / failBacktest(runId, reason)
// 5. 展示与提交均使用 Run 快照，禁止读取 db.strategies / db.factorPool（BacktestPage.tsx:212,216 的现有行为只保留在 legacy 路径）

// 没有 runId（legacy 兼容）：保持现有手动选择逻辑，UI 标注 "历史模式（未关联研究 Run）"
```

### 6.6b 闸门7：legacy 页面兼容

| 页面 | 无 runId 行为 | 标注 |
|------|-------------|------|
| HomePage | 关键词路由（不变） | — |
| StrategiesPage | 正常创建/编辑策略（不变） | — |
| FactorsPage | 正常选择因子（不变） | — |
| WorkbenchPage | 生成 watchlist（不含 runId，不变） | 保存时 `watchlist.runId = undefined` |
| WatchlistPage | 展示清单（不变） | 无 runId 清单显示 "历史清单" |
| BacktestPage | 手动配置回测（不变） | 结果显示 "历史回测（未关联 Run）" |

- 无 runId 时所有页面走现有逻辑，`legacy` 仅影响展示标注，不影响功能。
- 用户可将 legacy watchlist 复制为新 Draft Run（闸门7 表第4行）。

### 6.7 URL 持久化总结

```
/home → 搜索 → /strategies?runId=r_abc123
                → /workbench?runId=r_abc123
                → /watchlist?runId=r_abc123
                → /backtest?runId=r_abc123
```

- `runId` 通过 URL query 传递
- 刷新页面：从 URL 读取 runId，从 localStorage 恢复 Run 数据
- 没有 runId：所有页面走现有逻辑（向后兼容）
- `runId` 在 Step 间逐页传递，不跨越（不污染 MarketPage、HoldingsPage 等非流程页面）

---

## 7. 文件级实施计划

### 7.1 新增文件

| 文件 | 目的 | 风险 |
|------|------|------|
| `src/lib/experimentRunStore.ts` | Run CRUD + 状态机 + configHash + 不可变边界强制 | 无，纯新增 |
| `src/lib/__tests__/experimentRunStore.test.ts` | 单元测试（12 项基础 + 10 项闸门验收） | 无 |

### 7.2 修改文件（按依赖顺序）

| 顺序 | 文件 | 修改目的 | 涉及内容 | 迁移风险 | 兼容方式 |
|------|------|---------|---------|---------|---------|
| 1 | `src/lib/types.ts` | 新增类型 | ExperimentRun / CandidateSnapshot / BacktestSpec / BacktestRunRecord / ScreeningSpec / AttemptRecord 等 | 无 | 仅追加，不修改现有类型 |
| 2 | `src/lib/store.ts` | DB 和迁移 | `DB.runs` / `DB.candidateSnapshots` / `DB.backtestRuns`, `SEED_VERSION=5`, `migrateDB` | 低 | 迁移仅追加空数组，legacy 记录不改写 |
| 3 | `src/lib/experimentRunStore.ts` | Run CRUD + 状态机 + configHash | 全部服务接口（闸门5/6 强制） | 无 | 新文件，不触碰旧逻辑 |
| 4 | `src/pages/HomePage.tsx` | 创建 Draft Run | `handleSearch` 增加 `createDraftRun` + URL query | 无 | 无 query 时不变 |
| 5 | `src/pages/StrategiesPage.tsx` | 读取 runId，draft 快照 | `useSearchParams`；draft 状态写快照 | 无 | 无 runId 时不变 |
| 6 | `src/pages/FactorsPage.tsx` | 读取 runId，draft 快照 | 同上 | 无 | 无 runId 时不变 |
| 7 | `src/pages/WorkbenchPage.tsx` | 驱动状态机（唯一事实来源） | ready→running_screen→screened；筛选配置从 Run 读取 | 低 | 无 runId 时 legacy 逻辑不变 |
| 8 | `src/pages/WatchlistPage.tsx` | 下一步引导 + legacy 标注 | 显示 Run 状态 + 回测链接；无 runId 显示"历史清单" | 无 | 无 runId 时不变 |
| 9 | `src/pages/BacktestPage.tsx` | 回测继承 Run 冻结配置 | 有 runId 时从 `deriveBacktestSpec(run.screeningSpec)` 派生，禁止读 db.strategies/db.factorPool | 中 | 无 runId 时 legacy 手动配置不变 |

### 7.3 不修改的文件

以下页面**不在** ExperimentRun V1 范围内：
- `MarketPage.tsx`, `HoldingsPage.tsx`, `ReportsPage.tsx`, `ResearchPage.tsx`
- `SimTradePage.tsx`, `PITPage.tsx`, `ZettarancPage.tsx`, `MyStocksPage.tsx`
- `Layout.tsx`（导航结构不变）

---

## 8. 自动化验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| 1 | 首页问题被完整保存到 Draft Run | `getRun(runId).originalQuery.raw === query` |
| 2 | Draft Run 刷新后仍存在 | `localStorage.getItem('alphamind_db_v2')` 包含 runs |
| 3 | 策略保存为不可变快照 | 修改 `db.strategies[0].name` 后，`getRun(id).strategySnapshots[0].name` 不变 |
| 4 | 筛选结果包含 runId | `completeScreening` 后 `run.candidateSnapshotId` 指向独立 `CandidateSnapshot` |
| 5 | 候选清单能恢复对应 Run | WatchlistPage 通过 `?runId=` 读取 `getRun(id)` |
| 6 | 候选清单进入回测时自动继承配置 | BacktestPage 通过 `?runId=` 从 Run 快照派生 spec（非 db.strategies） |
| 7 | 回测结果包含 runId | `completeBacktest` 后 `run.backtestRunId` → `BacktestRunRecord.runId === run.id` |
| 8 | 修改当前策略后旧 Run 不变化 | strategy snapshots 深拷贝；`verifyConfigIntegrity(runId) === true` |
| 9 | 筛选失败产生可诊断的 failed 状态 | `run.status === 'failed'` 且 `run.failureReason` 非空 |
| 10 | 旧 localStorage 数据迁移后不丢失 | 迁移前存在的 strategies/watchlists 仍在 DB 中 |
| 11 | 无 runId 的旧入口仍能工作 | 所有页面在 `runId === undefined` 时走原逻辑 |
| 12 | 完整集成测试 | Query → Draft → Ready → Screening → Candidate → Backtest → Completed |

### 8.1 闸门新增验收测试

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| G1 | 修改当前策略后，历史 Run 快照不变化 | 修改 `db.strategies[0].conditions` → `getRun(id).strategySnapshots[0].conditions` 不变 |
| G2 | 删除当前因子后，历史 Run 仍可读取该因子配置 | `db.factorPool.splice(删除)` → `getRun(id).factorSnapshots` 仍含该因子完整快照 |
| G3 | 删除 WatchList 后，CandidateSnapshot 仍完整 | 删除 `db.watchlists[i]` → `db.candidateSnapshots[run.candidateSnapshotId]` 完整可读 |
| G4 | Backtest 只能使用 Run 中冻结的配置 | `startBacktest` 的 spec 必须来自 `deriveBacktestSpec(run.screeningSpec)`；传其他 spec 返回 null |
| G5 | ready 状态直接修改配置必须失败 | `run.status = 'ready'` 后调用 `updateRunConfiguration` → 返回 null，快照不变 |
| G6 | 修改配置会创建新 Run 或 revision | `updateRunConfiguration(readyRunId)` 失败后，`createDraftRun` 新 Run 独立存在 |
| G7 | 相同规范化配置产生相同 configHash | 两次相同配置的 `computeConfigHash` 结果一致 |
| G8 | 运行状态或时间戳变化不改变 configHash | 修改 `status`/`createdAt`/`attempt` 后 hash 不变；修改任一配置字段后 hash 变化 |
| G9 | 旧 WatchList 和 Backtest 记录迁移后仍可读取 | 迁移前后 `db.watchlists` / `db.backtests` 逐条比对 |
| G10 | 无法完整迁移的旧记录必须标记 legacy，不得伪造证据链 | 无 runId 旧记录 `runId === undefined`，不创建虚假 ExperimentRun |

---

## 9. 非目标

本阶段明确不处理：

- ❌ 持仓模型合并（`DB.holdings` vs `positionStore` vs `simTrade`）
- ❌ 模拟账户与实盘联动
- ❌ PIT 全局化（跨页面时间旅行）
- ❌ 自动研报生成与 Run 联动
- ❌ 因子证据等级与可靠性评分
- ❌ UI 重设计
- ❌ 数据库或云同步
- ❌ Zettaranc 知行体系重构
- ❌ ExperimentRun 的列表/历史页面（V1 不建 UI 列表）

---

## 10. 待决策问题

| # | 问题 | 当前代码能确认的结论 |
|---|------|-------------------|
| 1 | **Run 列表是否需要在 UI 中展示？** | V1 不需要。用户通过 URL 中的 `runId` 在各页面间流转。Run 列表是 V2 功能。 |
| 2 | **`asOfDate` 使用哪个数据源的日期？** | `src/lib/marketData.ts` 中 `loadMeta()` 返回 `{ latestDataDate }`。ExperimentRun 创建时调用 `loadMeta()` 获取当前最新数据日期作为 `asOfDate`。 |
| 3 | **快照时机：什么时候 capture StrategySnapshot？** | 在 `WorkbenchPage` 调用 `markRunReady()` 时，从 `db.strategies` 和 `db.factors` 深拷贝快照。选择这个时机因为：draft 阶段策略可能还在编辑，ready 意味着"确认配置，开始筛选"。 |
| 4 | **runId 是否应从 URL 移到 sessionStorage？** | 不建议。URL 中的 `runId` 支持分享链接、多标签独立 Run、以及刷新恢复。sessionStorage 会在标签关闭后丢失。 |
| 5 | **backtestResultId 指向的回测结果如果被用户手动删除怎么办？** | V1 不做级联删除检测。`getRun(id).backtestResultId` 是纯字符串，如果对应的 backtest 被删除，展示层显示 "回测结果已删除"。不阻塞，不抛异常。 |

---

## 设计摘要

1. `ExperimentRun` 是研究配置与结果的**唯一事实来源**（闸门1），不是附加引用信封。有 runId 时，筛选与回测全部从 Run 快照读取，禁止从 `db.strategies`/`db.factorPool` 重新组装。
2. 策略和因子保存为**不可变快照**（方案 A）；`ready` 以后配置不可修改（闸门5），修改配置 = 创建新 Run。
3. 候选结果独立持久化为 `CandidateSnapshot`（闸门2），即使 WatchList 被删除仍完整可读；WatchList 只引用其 id。
4. 回测前冻结 `BacktestSpec`（闸门4），`BacktestRunRecord` 记录 spec 快照、configHash、状态与失败原因。
5. `ScreeningSpec` 覆盖一次筛选可重放的所有配置（闸门3），不支持的字段显式 `'unsupported'`/`'none'`。
6. `configHash`（闸门6）对规范化配置做 sha256，排除时间戳与运行状态，用于检测配置被意外修改。
7. 旧记录按 legacy 兼容（闸门7）：不伪造 Run、不静默删除、只读标注，可复制为新的 Draft Run。
8. 状态机 7 状态 + attempt 历史；失败重试复用原 Run，配置快照保留。
9. 存储沿用 `alphamind_db_v2`，新增 `runs`/`candidateSnapshots`/`backtestRuns` 三集合，SEED_VERSION=5。
10. 需新增 1 个文件、修改 9 个文件；12 项基础验收 + 10 项闸门验收（G1-G10）。

---

> **仅修订设计文档，未修改业务代码。停止。**
