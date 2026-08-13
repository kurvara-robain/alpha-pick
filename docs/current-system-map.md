# AlphaMind 当前系统盘点

> 审计日期：2026-08-13  
> 审计范围：14 页面 × 29 库 × 19 Python 脚本 × 2 Vite 插件  
> 代码位置：`src/`

---

## 1. 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 19 + TypeScript |
| 路由 | react-router v7 (`react-router`) |
| 构建 | Vite 6 |
| UI 组件 | shadcn/ui (Radix + Tailwind) |
| 图标 | lucide-react |
| 状态管理 | localStorage + 自定义 EventTarget (`alphamind-db`) |
| HTTP API | Vite dev server 中间件 (`vite-plugins/task-api.ts`) |
| 后端计算 | Python 3.11 (`scripts/*.py`) |
| 数据格式 | JSON 文件 (`public/data/`) |
| 自动化 | Hermes cron jobs |

---

## 2. 目录结构

```
src/
├── App.tsx                    # 路由注册 + mergeCollectedFactors
├── main.tsx                   # 入口
├── pages/                     # 14 个页面
│   ├── HomePage.tsx           # /
│   ├── MarketPage.tsx         # /market
│   ├── StrategiesPage.tsx     # /strategies
│   ├── FactorsPage.tsx        # /factors
│   ├── WorkbenchPage.tsx      # /workbench
│   ├── WatchlistPage.tsx      # /watchlist
│   ├── BacktestPage.tsx       # /backtest
│   ├── HoldingsPage.tsx       # /holdings
│   ├── ReportsPage.tsx        # /reports
│   ├── ResearchPage.tsx       # /research
│   ├── SimTradePage.tsx       # /simtrade
│   ├── PITPage.tsx            # /pit
│   ├── ZettarancPage.tsx      # /zettaranc
│   └── MyStocksPage.tsx       # /my-stocks
├── components/                # 共享组件
│   ├── Layout.tsx             # 导航框架（5 任务域）
│   ├── Backtest.tsx           # 回测结果视图
│   ├── BrokerPanel.tsx        # 券商连接
│   ├── CSVImport.tsx          # CSV 导入
│   ├── DiscoveredFactors.tsx  # 自动发现因子面板
│   ├── FactorRanking.tsx      # 因子排行榜
│   ├── ...
├── lib/                       # 核心库
│   ├── store.ts               # 主存储层 (localStorage key: alphamind_db_v2)
│   ├── types.ts               # 共享类型
│   ├── marketData.ts          # 数据加载(JSON fetch)
│   ├── watchlistStore.ts      # 自选股追踪 (localStorage key: alphamind_my_watchlist_v1)
│   ├── positionStore.ts       # 持仓管理 (localStorage key: alphamind_positions_v1)
│   ├── simTrade.ts            # 模拟交易引擎 (localStorage key: alphamind_simtrade_v2)
│   ├── researchEngine.ts      # 研究引擎
│   ├── researchFrameworks.ts  # 7 套研究框架
│   ├── researchNL.ts          # NL 报告生成
│   ├── researchKnowledge.ts   # 知识库
│   ├── zettarancFactors.ts    # Zettaranc 因子引擎
│   ├── zettarancKnowledge.ts  # Zettaranc 知识引用
│   ├── zettarancStrategy.ts   # Zettaranc 策略 DSL
│   ├── strategyDSL.ts         # 策略 DSL Schema
│   ├── versionMetadata.ts     # 版本元数据
│   ├── brokerClient.ts        # 券商客户端
│   ├── taskClient.ts          # 任务 API 客户端
│   ├── alerts.ts              # 提醒系统
│   ├── autoRefresh.ts         # 自动刷新 hook
│   ├── chan.ts                # 缠论分析
│   ├── format.ts              # 格式化
│   ├── api.ts                 # API 函数
│   ├── utils.ts               # 工具
│   ├── useAsync.ts            # 异步状态 hook
│   ├── reactGuard.ts          # React 无限循环检测
│   └── refreshApi.ts          # 刷新 API
```

---

## 3. 数据存储全景

AlphaMind 使用 **4 个独立的 localStorage key**，各自管理不同生命周期：

| Key | 管理模块 | 内容 | 读写页面 |
|-----|---------|------|---------|
| `alphamind_db_v2` | `store.ts` | strategies, factors, factorPool, watchlists, backtests, holdings, reports | 几乎所有页面 |
| `alphamind_my_watchlist_v1` | `watchlistStore.ts` | TrackedStock[] (手动自选) | MyStocksPage, ZettarancPage |
| `alphamind_positions_v1` | `positionStore.ts` | Position[] (持仓头寸) | MyStocksPage |
| `alphamind_simtrade_v2` | `simTrade.ts` | SimOrder[], SimPosition[] | SimTradePage |

---

## 4. 页面级数据依赖

### 4.1 / — HomePage
- **文件**: `src/pages/HomePage.tsx`
- **读取**: `getDB()` → DB (仅用于 `buildDataVersion` 元数据)
- **写入**: 无
- **API**: `/data/universe.json`, `/data/meta.json`
- **NL 输入流**: 纯关键词匹配（`navigate('/strategies')`, `navigate('/research')` 等）
- **跨页传递**: **无** — 搜索词 `query` 不传递到目标页面

### 4.2 /market — MarketPage
- **文件**: `src/pages/MarketPage.tsx`
- **读取**: 无 store（纯行情展示）
- **API**: `/data/universe.json`, `/data/indices.json`, `/data/meta.json`
- **说明**: 唯一不依赖 store 的页面

### 4.3 /strategies — StrategiesPage
- **文件**: `src/pages/StrategiesPage.tsx`
- **读取**: `getDB()` → strategies
- **写入**: `updateDB()` → strategies 增删
- **订阅**: `subscribeDB` 监听变更
- **跨页传递**: 策略 ID 通过 `db.strategies[]` 在所有页面间共享

### 4.4 /factors — FactorsPage
- **文件**: `src/pages/FactorsPage.tsx`
- **读取**: `getDB()` → factors, factorPool
- **写入**: `updateDB()` → toggle factorPool
- **API**: `/data/factor-research.json`, `/data/discovered_factors.json`
- **跨页传递**: factorPool 是全局选择池，被 WorkbenchPage 消费

### 4.5 /workbench — WorkbenchPage
- **文件**: `src/pages/WorkbenchPage.tsx`
- **读取**: `getDB()` → strategies, factors, factorPool, watchlists
- **写入**: `updateDB()` → watchlists.push(新清单)
- **订阅**: `subscribeDB` 监听
- **跨页传递**: 
  - 消费 factorPool（来自 FactorsPage 的选择）
  - 产出 watchlists（被 WatchlistPage 消费）
  - 消费 strategies（来自 StrategiesPage）

### 4.6 /watchlist — WatchlistPage
- **文件**: `src/pages/WatchlistPage.tsx`
- **读取**: `getDB()` → watchlists
- **写入**: 无（仅删除操作通过 `updateDB`）
- **API**: `/data/universe.json`, `/data/kline/{code}.json`
- **跨页传递**: 展示 WorkbenchPage 产出的 watchlists

### 4.7 /backtest — BacktestPage
- **文件**: `src/pages/BacktestPage.tsx`
- **读取**: `getDB()` → backtests, strategies, factorPool
- **写入**: `updateDB()` → backtests.push(结果)
- **API**: `/api/tasks/backtest` (POST 提交, GET 轮询)
- **跨页传递**: 
  - 消费 strategies + factorPool（来自 StrategiesPage + FactorsPage）
  - 产出 backtests（存储但无页面消费）

### 4.8 /holdings — HoldingsPage
- **文件**: `src/pages/HoldingsPage.tsx`
- **读取**: `getDB()` → holdings
- **写入**: `updateDB()` → holdings 增删
- **API**: `/data/universe.json`, `/data/kline/{code}.json`
- **跨页传递**: holdings 存在 DB 中但无其他页面消费

### 4.9 /reports — ReportsPage
- **文件**: `src/pages/ReportsPage.tsx`
- **读取**: `getDB()` → reports, strategies
- **写入**: `updateDB()` → reports 生成
- **跨页传递**: 消费 strategies（生成报告用）

### 4.10 /research — ResearchPage
- **文件**: `src/pages/ResearchPage.tsx`
- **读取**: 无 store
- **API**: `/data/universe.json`, `/data/kline/{code}.json`
- **说明**: 纯研究工具，不读写 store，使用 `useState` 管理临时状态
- **NL 输入流**: 无 — 有 NL 输入框但仅在页面内用于报告生成

### 4.11 /simtrade — SimTradePage
- **文件**: `src/pages/SimTradePage.tsx`
- **读取**: `getSimOrders()`, `getSimPositions()` (来自 `simTrade.ts`, key: `alphamind_simtrade_v2`)
- **写入**: `placeOrder()`
- **说明**: 完全独立的数据层，不与 store.ts 交互

### 4.12 /pit — PITPage
- **文件**: `src/pages/PITPage.tsx`
- **读取**: 无 store
- **API**: `/api/pit/snapshot`
- **说明**: 独立页面，不与其他页面共享状态

### 4.13 /zettaranc — ZettarancPage
- **文件**: `src/pages/ZettarancPage.tsx`
- **读取**: 
  - `getWatchlist()` (watchlistStore, key: `alphamind_my_watchlist_v1`)
  - `getDB()` → watchlists (store.ts, key: `alphamind_db_v2`)
- **API**: `/data/universe.json`, `/data/kline/{code}.json`
- **说明**: 读取两个不同 key 下的自选股数据

### 4.14 /my-stocks — MyStocksPage
- **文件**: `src/pages/MyStocksPage.tsx`
- **读取**: 
  - `getWatchlist()` (watchlistStore)
  - `getPositions()` (positionStore)
- **写入**: `addToWatchlist()`, `removeFromWatchlist()`, `addPosition()`, `removePosition()`
- **说明**: 同时操作两个独立的 localStorage key

---

## 5. 核心领域类型

| 类型 | 位置 | 字段 |
|------|------|------|
| `Strategy` | `types.ts:16` | id, name, conditions[], enabled, source, createdAt |
| `StrategyCondition` | `types.ts:6` | field, op, value, raw |
| `Factor` | `types.ts:30` | id, name, source, origin, category, definition, rule? |
| `WatchList` | `types.ts:56` | id, name, strategyIds[], factorIds[], items[] |
| `WatchItem` | `types.ts:50` | code, name, reasons[] |
| `BacktestResult` | `types.ts:80+` | (未完整读取) |
| `Holding` | `types.ts:100+` | (未完整读取) |
| `DB` | `store.ts:22` | strategies[], factors[], factorPool[], watchlists[], backtests[], holdings[], reports[] |
| `TrackedStock` | `watchlistStore.ts:6` | code, name, addedAt, addedPrice |
| `TrackedStockSnapshot` | `watchlistStore.ts:13` | TrackedStock + currentPrice, dailyChange, totalReturn, holdingDays |
| `Position` | `positionStore.ts:8` | code, name, entryPrice, quantity, addedAt |
| `PositionSnapshot` | `positionStore.ts:17` | Position + currentPrice, dailyChange, cost, marketValue, pnl, pnlPct, weightPct |
| `SimOrder` | `simTrade.ts` | (未完整读取) |
| `SimPosition` | `simTrade.ts` | (未完整读取) |
| `ResearchFramework` | `researchTypes.ts` | id, name, institution, dimensions[], indicators |
| `ExperimentRun` | **不存在** | — |
| `BacktestConfig` | `types.ts:67` | (未完整读取) |
| `BacktestCredibility` | `types.ts` | 'simulation' \| 'research' |

---

## 6. 三条核心流程

### 6.1 首页 NL 输入流

```
HomePage 输入框 → 纯关键词匹配 (src/pages/HomePage.tsx:46-51)
  ├── '持仓' → /holdings
  ├── '策略'/'回测' → /strategies
  ├── '因子' → /factors
  ├── '板块' → /market
  └── 其他 → /research
```

**发现**: 搜索词 `query` 不传递到目标页面。用户输入"找低Pe高ROE股票"，系统只路由到 `/research`，但 ResearchPage 不会收到这个搜索词。

### 6.2 策略选股流

```
StrategiesPage (创建/选择策略)
  ↓ (getDB().strategies[] — 全局共享)
WorkbenchPage (选中策略+因子 → 生成候选)
  ↓ (updateDB().watchlists.push())
WatchlistPage (展示候选清单)
  ↓ (无自动衔接)
BacktestPage (需要手动重新选择策略和因子)
```

**发现**:
1. 策略通过 `db.strategies[]` 全局共享 ✅
2. 因子通过 `db.factorPool[]` 全局共享 ✅
3. 备选清单通过 `db.watchlists[]` 全局共享 ✅
4. **回测页不继承组合工作台的策略/因子选择** — 用户必须在回测页重新选择
5. 组合工作台生成的 watchlist 包含 `strategyIds` 和 `factorIds`，但回测页 `BacktestPage.tsx` 不使用这些数据
6. 无"下一步"显式引导按钮（仅组合工作台有隐含的工作台→备选清单的链接）

### 6.3 持仓与自选股流

```
四个独立数据源:
  DB.holdings[]          (store.ts, key: alphamind_db_v2)
    → HoldingsPage 读取/写入
    → 无其他页面消费
  
  TrackedStock[]         (watchlistStore.ts, key: alphamind_my_watchlist_v1)
    → MyStocksPage 读取/写入
    → ZettarancPage 读取（作为扫描源之一）
  
  Position[]             (positionStore.ts, key: alphamind_positions_v1)
    → MyStocksPage 读取/写入
    → 无其他页面消费
  
  SimOrder[]/SimPosition[] (simTrade.ts, key: alphamind_simtrade_v2)
    → SimTradePage 读取/写入
    → 无其他页面消费
```

**发现**:
1. **持仓被建模了三次**: `DB.holdings` (store.ts), `Position` (positionStore.ts), `SimPosition` (simTrade.ts)
2. **自选被建模了两次**: `WatchItem` (store.ts → watchlists[].items[]), `TrackedStock` (watchlistStore.ts)
3. HoldingsPage 和 MyStocksPage 使用不同的数据源，修改一处的持仓不影响另一处
4. SimTradePage 的模拟持仓与其他持仓系统完全不互通

---

## 7. 跨页传递能力

| 数据 | 传递方式 | 有效范围 |
|------|---------|---------|
| strategies[] | `store.ts` global | 全站 |
| factors[] | `store.ts` global | 全站 |
| factorPool[] | `store.ts` global | 全站 |
| watchlists[] | `store.ts` global | 全站 |
| backtests[] | `store.ts` global | 全站（仅 BacktestPage 写入） |
| holdings[] | `store.ts` global | 仅 HoldingsPage |
| reports[] | `store.ts` global | 仅 ReportsPage |
| TrackedStock[] | `watchlistStore.ts` | MyStocksPage, ZettarancPage |
| Position[] | `positionStore.ts` | 仅 MyStocksPage |
| SimOrder[] | `simTrade.ts` | 仅 SimTradePage |
| NL 搜索词 | **不传递** | 输入后丢失 |

---

## 8. 跳转后丢失的输入

| 输入 | 来源 | 目标 | 是否传递 |
|------|------|------|---------|
| HomePage 搜索词 | HomePage | research/strategies/... | ❌ 丢失 |
| ResearchPage NL 需求 | ResearchPage | 仅页内使用 | ❌ 无法跨页 |
| DSLEditor 构建的策略 | StrategiesPage | 页内 | ✅ 写入 store |
| WorkbenchPage 的策略×因子组合 | WorkbenchPage → BacktestPage | ❌ 需重新选择 |
| 模拟交易持仓 | SimTradePage | 其他页面 | ❌ 隔离 |

---

## 9. 重复建模

| 概念 | 建模次数 | 位置 |
|------|---------|------|
| **持仓** | 3 | `DB.holdings` (store.ts), `Position` (positionStore.ts), `SimPosition` (simTrade.ts) |
| **自选股** | 2 | `WatchItem` (store.ts watchlists[].items[]), `TrackedStock` (watchlistStore.ts) |
| **股票代码+名称** | 多次 | 几乎每个页面独立从 universe.json 加载 |

---

## 10. 关键不存在项

| 项 | 状态 |
|----|------|
| `ExperimentRun` 类型 | **不存在** |
| 跨页实验/回测追踪 | **不存在** |
| 策略→因子→回测的显式工作流状态 | **不存在** |
| PIT 穿越对其他页面的影响说明 | **不存在** |
| 统一的用户工作进程对象 | **不存在** |
| 回测结果页面复用 | **不存在** (仅 BacktestPage 展示、无其他入口) |

---

## 11. 发现摘要

1. **HomePage NL 输入不传递**: 首页搜索词仅用于路由关键词匹配，目标页面收不到搜索词 (`src/pages/HomePage.tsx:46-51`)。

2. **ResearchPage NL 输入不跨页**: 个股投研的 NL 需求仅页内使用，无法从首页跳转带入 (`src/pages/ResearchPage.tsx:98`)。

3. **持仓三重建模**: `DB.holdings`、`positionStore.Position`、`simTrade.SimPosition` 是三个独立数据结构，互不同步 (`src/lib/store.ts:28`, `src/lib/positionStore.ts:8`, `src/lib/simTrade.ts`)。

4. **自选股二重建模**: `store.ts` 的 `WatchItem` (在 watchlists 中) 与 `watchlistStore.ts` 的 `TrackedStock` 是不同的 key 和结构 (`src/lib/types.ts:50`, `src/lib/watchlistStore.ts:6`)。

5. **回测页不继承工作台结果**: 组合工作台生成的 watchlist 包含 `strategyIds` 和 `factorIds`，但回测页 `BacktestPage.tsx` 重新从 store 读取策略/因子选择，不使用 watchlist 中的关联信息。

6. **MyStocksPage 操作两个独立 key**: 手动自选用 `alphamind_my_watchlist_v1`，持仓用 `alphamind_positions_v1`，两者无联动 (`src/pages/MyStocksPage.tsx`)。

7. **模拟交易数据完全隔离**: `simTrade.ts` 使用独立的 `alphamind_simtrade_v2` key，与 `db.holdings` 和 `positionStore` 不互通。

8. **ZettarancPage 双重读取自选股**: 同时从 `watchlistStore.getWatchlist()` 和 `store.getDB().watchlists` 读取两个不同来源的自选股数据 (`src/pages/ZettarancPage.tsx:44-56`)。

9. **策略/因子种子与联网挖掘因子混存**: `store.ts` 的 `seedFactors()` 和 `mergeCollectedFactors()` 以及 `DiscoveredFactors` 面板都向 `db.factors` 写入，无区分标记 (`src/lib/store.ts:37-170`, `src/components/DiscoveredFactors.tsx:53-60`)。

10. **不存在 ExperimentRun** 或类似的工作进程追踪对象，无法跨页面追踪"一个完整选股研究任务"的开始到结束状态。
