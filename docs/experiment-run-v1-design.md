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
| `ExperimentRun` | 主键，串联全流程 |
| `StrategySnapshot` | 不可变快照，防止策略被修改后历史 Run 数据变化 |
| `FactorSnapshot` | 同上 |
| `CandidateSnapshotRef` | 引用 watchlist ID + 筛选条件快照 |
| `ExperimentRunQuery` | 轻量级 DTO，仅用于 Run 列表展示 |

### 1.4 为什么 ExperimentRun 是最小改造主键

当前系统已有完整的单页功能（创建策略、选择因子、生成候选、运行回测），缺失的是一个**跨页面的"信封"**把这些动作串联起来。ExperimentRun 就是这个信封——它不改变任何现有页面的内部逻辑，只是：

1. 在首页创建时记录用户的原始问题
2. 在每个步骤完成后更新状态
3. 让后续页面能读取前序页面的配置
4. 在 localStorage 中持久化，刷新不丢

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

/** 候选清单引用 */
export interface CandidateSnapshotRef {
  watchlistId: string            // 对应 db.watchlists[].id
  itemCount: number              // 候选股数量
  strategySnapshotIds: string[]  // 当时使用的策略快照 ID 列表
  factorSnapshotIds: string[]    // 当时使用的因子快照 ID 列表
  generatedAt: string            // ISO
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
  universe?: string              // 股票池描述（如 "全A 5540只"）

  // 快照（不可变）
  strategySnapshots: StrategySnapshot[]
  factorSnapshots: FactorSnapshot[]
  combinationLogic?: CombinationLogic

  // 产出引用（通过 ID 关联，不内嵌完整数据）
  candidateSnapshot?: CandidateSnapshotRef
  backtestResultId?: string      // 对应 db.backtests[].id

  // 元数据
  createdAt: string
  updatedAt: string
  failureReason?: string         // failed 状态时记录原因
  failureAt?: string             // ISO
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
  runs: ExperimentRun[]       // ← 新增
  seedVersion?: number
}
```

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

- **重试复用原 Run**：`retryFromFailed()` 将状态回退到 `draft`，清除 `failureReason`、`candidateSnapshot`、`backtestResultId`，保留 `strategySnapshots` 和 `factorSnapshots`。策略/因子配置不变，仅重新执行筛选和回测。
- **创建新 Run**：用户主动从首页发起新搜索时创建新 Run，不覆盖旧 Run。

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

  // v5 迁移：添加 runs 集合
  if ((db.seedVersion ?? 0) < 5) {
    if (!Array.isArray(db.runs)) {
      db.runs = []           // 初始化，不删除任何现有数据
      changed = true
    }
  }

  db.seedVersion = SEED_VERSION
  return changed
}
```

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

/** 更新 Run 的策略/因子配置（重写快照） */
function updateRunConfiguration(
  runId: string,
  strategySnapshots: StrategySnapshot[],
  factorSnapshots: FactorSnapshot[],
  logic?: CombinationLogic,
): ExperimentRun | null
// 输入: runId + 快照数组
// 返回: 更新后的 Run，或 null（runId 不存在）
// 前置: run.status === 'draft'
// 后置: run.strategySnapshots = strategySnapshots; run.factorSnapshots = factorSnapshots; run.updatedAt = now
// 失败: 返回 null；状态不对返回 null

/** 标记 Run 就绪 */
function markRunReady(runId: string): ExperimentRun | null
// 前置: run.status === 'draft' 且 strategySnapshots.length > 0
// 后置: run.status = 'ready'; run.updatedAt = now
// 失败: strategySnapshots 为空时返回 null

// ── 筛选 ──

function startScreening(runId: string): ExperimentRun | null
// 前置: run.status === 'ready'
// 后置: run.status = 'running_screen'

function completeScreening(runId: string, watchlistId: string, itemCount: number): ExperimentRun | null
// 前置: run.status === 'running_screen'
// 后置: run.status = 'screened'; run.candidateSnapshot = { watchlistId, itemCount, ... }

function failScreening(runId: string, reason: string): ExperimentRun | null
// 前置: run.status === 'running_screen'
// 后置: run.status = 'failed'; run.failureReason = reason; run.failureAt = now

// ── 回测 ──

function startBacktest(runId: string): ExperimentRun | null
// 前置: run.status === 'screened'
// 后置: run.status = 'running_backtest'

function completeBacktest(runId: string, backtestResultId: string): ExperimentRun | null
// 前置: run.status === 'running_backtest'
// 后置: run.status = 'completed'; run.backtestResultId = backtestResultId

function failBacktest(runId: string, reason: string): ExperimentRun | null
// 前置: run.status === 'running_backtest'
// 后置: run.status = 'failed'; run.failureReason = reason

// ── 查询 ──

function getRun(runId: string): ExperimentRun | null
function listRuns(status?: ExperimentRunStatus): ExperimentRun[]
function getActiveRun(): ExperimentRun | null  // 返回最近一个非 completed/failed 的 Run

// ── 重试 ──

function retryFromFailed(runId: string): ExperimentRun | null
// 前置: run.status === 'failed'
// 后置: run.status = 'draft'; 清除 failureReason/candidateSnapshot/backtestResultId
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

// 如果有 runId：
// 1. 从 Run 的 strategySnapshots / factorSnapshots 反推出策略和因子 ID
// 2. 自动填充回测配置（战略选择 + 因子选择）
// 3. startBacktest(runId) → 运行回测 → completeBacktest(runId, backtestId)
// 4. 回测失败 → failBacktest(runId, errorMessage)

// 没有 runId：保持现有手动选择逻辑
```

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
| `src/lib/experimentRunStore.ts` | Run CRUD 操作 | 无，纯新增 |
| `src/lib/__tests__/experimentRunStore.test.ts` | 单元测试 | 无 |

### 7.2 修改文件（按依赖顺序）

| 顺序 | 文件 | 修改目的 | 涉及内容 | 迁移风险 | 兼容方式 |
|------|------|---------|---------|---------|---------|
| 1 | `src/lib/types.ts` | 新增类型 | ExperimentRun 等 7 个类型 | 无 | 仅追加，不修改现有类型 |
| 2 | `src/lib/store.ts` | DB 和迁移 | `DB.runs`, `SEED_VERSION=5`, `migrateDB` | 低 | 迁移仅追加空数组 |
| 3 | `src/pages/HomePage.tsx` | 创建 Draft Run | `handleSearch` 增加 `createDraftRun` + URL query | 无 | 无 query 时不变 |
| 4 | `src/pages/StrategiesPage.tsx` | 读取 runId | `useSearchParams` 读取 runId | 无 | 无 runId 时不变 |
| 5 | `src/pages/FactorsPage.tsx` | 读取 runId | 同上 | 无 | 无 runId 时不变 |
| 6 | `src/pages/WorkbenchPage.tsx` | 驱动状态机 | ready→running_screen→screened | 低 | 无 runId 时不变 |
| 7 | `src/pages/WatchlistPage.tsx` | 下一步引导 | 显示 Run 状态 + 回测链接 | 无 | 无 runId 时不变 |
| 8 | `src/pages/BacktestPage.tsx` | 继承配置 | 从 Run 填充策略/因子选择 | 中 | 无 runId 时手动选择 |

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
| 4 | 筛选结果包含 runId | `completeScreening` 后 `run.candidateSnapshot.watchlistId` 指向正确的 watchlist |
| 5 | 候选清单能恢复对应 Run | WatchlistPage 通过 `?runId=` 读取 `getRun(id)` |
| 6 | 候选清单进入回测时自动继承配置 | BacktestPage 通过 `?runId=` 预填策略和因子 |
| 7 | 回测结果包含 runId | `completeBacktest` 后 `run.backtestResultId` 指向正确的回测 |
| 8 | 修改当前策略后旧 Run 不变化 | strategy snapshots 是深拷贝，不随 `db.strategies` 修改 |
| 9 | 筛选失败产生可诊断的 failed 状态 | `run.status === 'failed'` 且 `run.failureReason` 非空 |
| 10 | 旧 localStorage 数据迁移后不丢失 | 迁移前存在的 strategies/watchlists 仍在 DB 中 |
| 11 | 无 runId 的旧入口仍能工作 | 所有页面在 `runId === undefined` 时走原逻辑 |
| 12 | 完整集成测试 | Query → Draft → Ready → Screening → Candidate → Backtest → Completed |

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

1. `ExperimentRun` 是跨页面"信封"，串联首页 NL → 策略 → 因子 → 候选 → 回测，不改变现有页面内部逻辑。
2. 策略和因子保存为**不可变快照**（方案 A），修改策略不影响历史 Run。
3. 状态机 7 个状态，draft → ready → running_screen → screened → running_backtest → completed，另有 failed 分支。
4. 存储沿用 `alphamind_db_v2`，新增 `DB.runs: ExperimentRun[]`，SEED_VERSION 升级到 5，迁移仅追加空数组。
5. `runId` 通过 **URL query string** 在流程页面间传递，刷新不丢，无 runId 时走旧逻辑。
6. 需新增 1 个文件、修改 8 个文件，不涉及 Market/Holdings/SimTrade/PIT/Zettaranc 等页面。
7. HomePage 创建 Draft Run，WorkbenchPage 驱动状态机，WatchlistPage 提供"下一步→回测"引导，BacktestPage 继承配置。
8. 12 项自动化验收标准覆盖完整集成测试路径。
9. 5 个待决策问题中 4 个已从代码确认结论，1 个（级联删除）推迟到 V2。
10. 未修改任何业务代码。

---

> **未修改业务代码。设计文档完成，停止。**
