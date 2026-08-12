// ─────────────────────────────────────────────────────────────
// 本地数据层（localStorage 持久化，模拟后端数据库）
// 所有页面通过本模块读写共享状态，并通过 'alphamind-db' 事件感知变更
// ─────────────────────────────────────────────────────────────
import type {
  BacktestResult,
  BacktestRunRecord,
  CandidateSnapshot,
  DailyReport,
  ExperimentRun,
  Factor,
  Holding,
  Strategy,
  WatchList,
} from './types'
import { loadCollectedFactors } from './marketData'
import type { CollectedFactor } from './marketData'

const KEY = 'alphamind_db_v2'
const EVENT = 'alphamind-db'

/** 种子数据版本：种子因子/策略结构变化时递增，用于老用户 localStorage 数据的迁移扩展 */
const SEED_VERSION = 5

export interface DB {
  strategies: Strategy[]
  factors: Factor[]
  factorPool: string[] // 因子选择池（factor id）
  watchlists: WatchList[]
  backtests: BacktestResult[]
  holdings: Holding[]
  reports: DailyReport[]
  runs: ExperimentRun[] // v5：ExperimentRun 集合
  candidateSnapshots: CandidateSnapshot[] // v5：独立候选快照集合
  backtestRunRecords: BacktestRunRecord[] // v5：回测运行记录集合
  seedVersion?: number // 已合并到的种子版本（老数据可能缺失）
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function seedFactors(): Factor[] {
  const pub = (
    id: string,
    name: string,
    origin: string,
    category: string,
    definition: string,
    applicable: string,
    notes: string,
    performance: string,
  ): Factor => ({ id, name, source: 'public', origin, category, definition, applicable, notes, performance })
  // 带可执行筛选规则（rule）的因子：topPct 统一 30，参与策略工作台的实际过滤
  const pubRule = (
    id: string,
    name: string,
    origin: string,
    category: string,
    definition: string,
    applicable: string,
    notes: string,
    performance: string,
    field: string,
    dir: 'asc' | 'desc',
  ): Factor => ({
    id, name, source: 'public', origin, category, definition, applicable, notes, performance,
    rule: { field, dir, topPct: 30 },
  })
  return [
    pub('f-a101-1', 'Alpha#1 动量反转', 'WorldQuant Alpha101', '动量',
      'rank(ts_argmax(signedpower(returns<0?stddev(returns,20):close, 2), 5)) - 0.5，捕捉短期价格极值后的反转。',
      '流动性好的大盘股；震荡市效果优于单边市。',
      '信号衰减快，建议日频调仓；需结合交易成本评估。',
      '论文样本内 IC 约 0.03，A 股迁移后需重新检验。'),
    pub('f-a101-6', 'Alpha#6 量价背离', 'WorldQuant Alpha101', '量价',
      '-1 × correlation(open, volume, 10)：开盘价与成交量 10 日相关的负值，量涨价跌时得分高。',
      '全市场；放量下跌后的修复行情。',
      '对异常成交（复牌、公告）敏感，需做极值处理。',
      '社区复现 RankIC 约 0.04（月度）。'),
    pub('f-ff-smb', 'SMB 规模因子', 'Fama-French', '规模',
      '小市值组合收益减去大市值组合收益，捕捉规模溢价。',
      '全市场长周期配置；A 股小票流动性需评估。',
      '作为风险因子解释收益，而非直接交易信号。',
      'A 股 2010-2020 规模效应显著，近年弱化。'),
    pub('f-ff-hml', 'HML 价值因子', 'Fama-French', '价值',
      '高 BP（低 PB）组合收益减去低 BP 组合收益，捕捉价值溢价。',
      '价值风格占优期；金融、周期行业区分度高。',
      '需行业中性化，否则暴露银行地产。',
      'A 股 BP 因子长期有效，但回撤期长。'),
    pub('f-gtja-trend', 'GTJA 趋向因子', '国泰君安191', '动量',
      '基于价格序列的趋向类指标族（均线斜率、通道突破等）。',
      '趋势明确的单边市场。',
      '震荡市假信号多，建议与波动因子联用。',
      '研报样本内多空年化约 8%。'),
    pub('f-jq-roc', 'ROC-20 动量', '聚宽社区热门', '动量',
      '(close / close.shift(20) - 1)，20 日价格变动率。',
      '中短期趋势跟踪；题材股弹性大。',
      '需剔除一字涨跌停日；与反转因子对冲使用。',
      '社区回测月度 IC 约 0.05。'),
    pub('f-jq-turnover', '换手率因子', '聚宽社区热门', '量价',
      '过去 20 日平均换手率，低换手组合长期跑赢（异常低波动异象）。',
      '全市场；小市值中区分度更高。',
      '注意换手率与市值的相关性，建议中性化。',
      'A 股低换手组合年化超额约 5-8%。'),
    pub('f-mk-north', '北向资金因子', '米筐社区热门', '资金流',
      '北向资金持股比例变化（5/20 日），跟踪聪明钱流向。',
      '沪深股通标的；大市值白马。',
      '数据 T+1 披露；极端行情下北向也会踩踏。',
      '2017-2021 有效性高，近年波动加大。'),
    pub('f-low-vol', '低波异象因子', '学术经典', '波动',
      '过去 60 日收益波动率，低波动组合风险调整后收益更优。',
      '防御型配置；熊市与震荡市。',
      '牛市中显著跑输；适合作为组合稳定器。',
      '全球多市场验证，A 股 RankIC 稳定为负。'),
    pubRule('f-vol20', '低波动率', '中金研究', '波动',
      '20 日年化收益波动率，低波异象：低波动股票长期风险调整后收益更优。',
      '防御型配置；熊市与震荡市表现更好。',
      '牛市中可能跑输高波组合；建议与动量类因子联用平衡进攻性。',
      '中金金工量价因子手册，低波组合年化超额约 5-8%。',
      'vol20', 'asc'),
    pubRule('f-cpv20', '量价背离 CPV', '东吴金工', '量价',
      '20 日收盘价与成交量相关系数，量价背离（负相关）预示未来收益更好。',
      '全市场；流动性充足的标的区分度更高。',
      '本因子为东吴 CPV 的日频近似；分钟级因子（理想反转/聪明钱/APM/理想振幅）需分钟数据，暂未纳入。',
      '东吴证券《量价相关性 CPV 因子》，月频 RankIC -0.053，多空年化 19.3%，IR 3.03。',
      'cpv20', 'asc'),
    pubRule('f-vcv20', '量能稳定度', '东吴金工', '量价',
      '20 日成交量变异系数（换手率波动近似），量能平稳的股票拥挤度低。',
      '全市场；中小市值中拥挤度区分更明显。',
      '对突发放量（公告、复牌）敏感，截面取前 30% 可自然过滤异常标的。',
      '东吴金工换手率波动率因子，rankIC 约 -0.05。',
      'vcv20', 'asc'),
    pubRule('f-ret5-rev', '短期反转', '中金研究', '动量',
      '5 日涨幅取反，A 股短期反转效应显著，前期涨幅小的未来收益更高。',
      '震荡市与轮动行情；高换手市场环境中效果更强。',
      '与趋势/动量因子方向相反，联用时需注意信号对冲。',
      '中金/海通金工，A 股短期反转 RankIC 约 -0.06。',
      'ret5', 'asc'),
    pubRule('f-sharpe20', '动量质量 Sharpe', '开源金工', '动量',
      '20 日年化收益/波动，"有质量的动量"比单纯涨幅更可持续。',
      '趋势延续期；机构持仓较重的标的。',
      '极端单边市中与纯动量相关性高，分散效果有限。',
      '开源证券金工动量质量类因子，多头年化超额约 8%。',
      'sharpe20', 'desc'),
    pubRule('f-maxdd60', '回撤控制', '本系统', '波动',
      '60 日最大回撤，回撤小的股票持有体验与后续弹性更好。',
      '全市场；作为风控类辅助条件与其他因子联用。',
      '低回撤不等于低波动，强势股回调后可能排名失真；不建议单独使用。',
      '本系统实测，作为风控类辅助因子。',
      'maxdd60', 'asc'),
    pubRule('f-roe', 'ROE 质量', 'Fama-French', '价值',
      '最新一期加权 ROE，盈利能力是五因子模型中的核心质量维度。',
      '全市场中长期配置；盈利稳定行业区分度更高。',
      '亏损或数据缺失（roe 为 null）的股票自动被过滤；季报披露后口径可能跳变。',
      'Fama-French 五因子模型 RMW 盈利因子，A 股年化溢价约 6%。',
      'roe', 'desc'),
    pubRule('f-vol60', '中期波动', '中金研究', '波动',
      '60 日年化波动率，中长期低波更稳健。',
      '防御型配置；长周期组合稳定器。',
      '与 20 日低波因子相关性较高，联用时注意冗余。',
      '中金金工低波异象研究。',
      'vol60', 'asc'),
    pubRule('f-cpv10', '量价背离 CPV(10日)', '本系统自研', '量价',
      '10 日收盘价与成交量相关系数，CPV 的短窗口自研变体，量价背离（负相关）预示未来收益更好。',
      '全市场；短线调仓（周频）场景区分度优于 20 日版。',
      '本系统自研实测晋升：方向化 IC20 +0.060，优于 20 日版（+0.057）；与 CPV20 联用时注意信号重叠。',
      '本系统全A近1年实测：方向化 IC20 +0.060，t 值显著；母因子东吴 CPV 月频 RankIC -0.053。',
      'cpv10', 'asc'),
    pubRule('f-mom20-rev', '中期反转（20日）', '本系统自研', '动量',
      '20 日涨幅取小（反转方向），A 股中期维度反转效应强于动量效应，前期涨幅低的股票未来收益更高。',
      '全市场；震荡市与风格再平衡阶段更优。',
      '本系统自研实测晋升：与 ROC-20 动量共用 mom20 字段但方向相反；实测显示 A 股 20 日维度应做反转而非动量。',
      '本系统全A近1年实测：方向化 IC20 +0.046（同窗口 ROC-20 动量方向为 -0.046）。',
      'mom20', 'asc'),
    pubRule('ml-composite', 'ML 合成信号', '本系统自研', '合成',
      '梯度提升树（HistGradientBoosting 300 树）对 15 个实测有效因子（量能稳定/量价背离/乖离/回撤/峰度等）做非线性合成，输出 0-100 分。',
      '全市场；作为多因子综合打分的硬过滤条件，取截面最高分的前 10%。',
      '分数依赖 ml-scores.json 周度更新；无分数的股票自动被过滤。与单因子联用时注意特征重叠带来的冗余。',
      '梯度提升树合成15因子，样本外IC=0.082、ICIR=0.95（截至2026-07-24实测）。',
      'mlScore', 'desc'),
    pubRule('vcv60', '量能稳定度60日', '本系统自研', '量价',
      '60 日成交量变异系数，长窗口量能平稳的股票拥挤度低，未来收益更优。',
      '全市场；中线持仓场景的拥挤度过滤。',
      '与 20 日版（vcv20）方向一致、窗口互补，联用时注意信号重叠。',
      '本系统全A实测：方向化 IC20 +0.060。',
      'vcv60', 'asc'),
    pubRule('vr2060', '量能比20/60', '本系统自研', '量价',
      '20 日均量与 60 日均量之比，短期缩量（比值小）的股票抛压衰竭，未来收益更优。',
      '全市场；缩量回调后的再启动场景。',
      '对突发放量敏感，截面取前 30% 可自然过滤异常标的。',
      '本系统全A实测：方向化 IC20 +0.055。',
      'vr2060', 'asc'),
    pubRule('bias60', '60日乖离率', '本系统自研', '动量',
      '现价相对 60 日均线的乖离率，负乖离（超跌）的股票中期修复空间更大。',
      '全市场；超跌反弹与均值回归场景。',
      '单边下跌趋势中可能持续负乖离，建议与量能类因子联用确认企稳。',
      '本系统全A实测：方向化 IC20 +0.054。',
      'bias60', 'asc'),
    pubRule('park20', 'Parkinson波动率', '本系统自研', '波动',
      '基于日内高低价的 Parkinson 波动率（20 日），比收盘价波动率信息效率更高，低波股票风险调整后收益更优。',
      '全市场；防御型配置与组合稳定器。',
      '依赖 OHLC 数据完整性；与经典低波因子（vol20）相关性较高，联用注意冗余。',
      '本系统全A实测：方向化 IC20 +0.052。',
      'park20', 'asc'),
    pubRule('bigup20', '暴涨计数', '本系统自研', '动量',
      '近 20 日单日涨幅 >5% 的天数，暴涨天数少的股票 latent 抛压与拥挤度更低。',
      '全市场；规避短期过热标的的反向筛选。',
      '本质是彩票偏好异象的反向利用；强势股可能因此被误滤，宜作辅助条件。',
      '本系统全A实测：方向化 IC20 +0.046。',
      'bigup20', 'asc'),
    pubRule('kurt20', '收益峰度', '本系统自研', '波动',
      '20 日收益分布的超额峰度，峰度低（尾部风险小）的股票未来收益更优。',
      '全市场；尾部风险过滤的辅助因子。',
      '统计量对样本长度敏感，20 日窗口估计噪声较大，建议与其他波动类因子联用。',
      '本系统全A实测：方向化 IC20 +0.029。',
      'kurt20', 'asc'),
    { id: 'f-self-lhb', name: '龙虎榜情绪因子', source: 'self', origin: '本系统', category: '情绪',
      definition: '统计个股近 20 日登上龙虎榜的次数与席位净买入方向，构建情绪强度分。',
      applicable: '活跃题材股；短线交易场景。',
      notes: '数据覆盖不全，仅上榜日有观测。',
      status: '测试中' },
    { id: 'f-self-sector', name: '板块联动强度', source: 'self', origin: '本系统', category: '动量',
      definition: '个股与所属同花顺板块指数的 20 日收益相关性 × 板块动量，衡量"借势"能力。',
      applicable: '板块轮动行情；主题投资。',
      notes: '板块口径变更时需重新计算历史序列。',
      status: '挖掘中' },
    { id: 'f-self-volbrk', name: '缩量回踩突破', source: 'self', origin: '本系统', category: '技术形态',
      definition: '前期放量突破平台后，缩量回踩不破平台上沿，再次放量时触发。',
      applicable: '趋势中继场景；流动性充足标的。',
      notes: '样本较少，正在扩样验证。',
      performance: '内部小样本胜率约 62%（2025 年以来）。',
      status: '已验证' },
    { id: 'f-self-skew', name: '高频偏度因子', source: 'self', origin: '本系统', category: '波动',
      definition: '分钟收益分布的偏度，负偏组合预期收益更高（彩票偏好反向）。',
      applicable: '高频数据可得的全市场。',
      notes: '数据量大、计算成本高；IC 不稳定。',
      status: '已弃用' },
  ]
}

function seed(): DB {
  const now = new Date().toISOString()
  return {
    strategies: [
      {
        id: 's-value',
        name: '低估值价值策略',
        description: '低 PE、低 PB、剔除 ST 的价值型选股',
        kind: 'fixed',
        enabled: true,
        conditions: [
          { field: 'pe', op: '<', value: 20, raw: '市盈率低于20倍' },
          { field: 'pb', op: '<', value: 3, raw: '市净率低于3倍' },
          { field: 'exclude_st', op: '=', value: true, raw: '剔除ST' },
        ],
        unsupported: [],
        source: 'seed',
        createdAt: now,
      },
      {
        id: 's-mom',
        name: '动量趋势策略',
        description: '追逐近 20 日强势且有量能配合的股票',
        kind: 'fixed',
        enabled: true,
        conditions: [
          { field: 'mom_rank', op: 'top_pct', value: 30, window: 20, raw: '近20个交易日涨幅排名前30%' },
          { field: 'turnover', op: '>', value: 1, raw: '换手率大于1%' },
        ],
        unsupported: [],
        source: 'seed',
        createdAt: now,
      },
    ],
    factors: seedFactors(),
    factorPool: ['f-low-vol'],
    watchlists: [],
    backtests: [],
    holdings: [],
    reports: [],
    runs: [],
    candidateSnapshots: [],
    backtestRunRecords: [],
    seedVersion: SEED_VERSION,
  }
}

/**
 * 老用户数据迁移：按 id 补齐种子库中缺失的种子因子并更新种子版本。
 * 只做追加合并——绝不覆盖或删除用户自建/修改过的因子与策略；
 * 幂等：重复加载时无缺失因子则不产生任何写入。
 * 返回是否有变更（需要持久化）。
 */
function migrateDB(db: DB): boolean {
  // 结构兜底：可解析但缺字段的旧数据/手工改坏的数据，补齐空数组，避免页面访问 undefined 白屏
  db.strategies ??= []
  db.factors ??= []
  db.factorPool ??= []
  db.watchlists ??= []
  db.backtests ??= []
  db.holdings ??= []
  db.reports ??= []
  // v5：新增集合初始化（旧数据 → 空数组，不伪造 ExperimentRun）
  db.runs ??= []
  db.candidateSnapshots ??= []
  db.backtestRunRecords ??= []
  const upgrading = (db.seedVersion ?? 0) < SEED_VERSION
  const existingIds = new Set(db.factors.map((f) => f.id))
  const missing = seedFactors().filter((f) => !existingIds.has(f.id))
  if (missing.length > 0) db.factors.push(...missing)
  let changed = missing.length > 0 || upgrading
  // v3 迁移：ROC-20 动量实测方向反了（方向化 IC20 = -0.046），仅在跨版本升级时撤出默认选择池。
  // 因子本体保留在因子库中（卡片实测徽标显示红色反向，起警示作用）；
  // 用户升级后手动重新加入则不再干预。
  if (upgrading && (db.seedVersion ?? 0) < 3) {
    const i = db.factorPool.indexOf('f-jq-roc')
    if (i >= 0) {
      db.factorPool.splice(i, 1)
      changed = true
    }
  }
  db.seedVersion = SEED_VERSION
  return changed
}

let cache: DB | null = null

export function getDB(): DB {
  if (cache) return cache // 缓存引用，保证 useSyncExternalStore 的 getSnapshot 稳定
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      cache = JSON.parse(raw) as DB
      // 老数据迁移：补齐缺失的种子因子并持久化（幂等，无变更时不写入）
      if (migrateDB(cache)) {
        localStorage.setItem(KEY, JSON.stringify(cache))
      }
      return cache
    }
  } catch {
    // 无法解析的旧数据：返回全新内存 DB，但绝不覆盖 localStorage 原始字符串。
    // 原始数据保留在 localStorage 中以便诊断，用户可手动清除后重建。
    cache = seed()
    return cache
  }
  cache = seed()
  localStorage.setItem(KEY, JSON.stringify(cache))
  return cache
}

/** 仅供测试：清空内存缓存与 localStorage（不填充缓存，下一次 getDB 重新读取） */
export function resetDBForTest(): void {
  cache = null
  localStorage.removeItem(KEY)
}

// ── 持仓本地文件同步（fire-and-forget，供缠论监控自动化读取）────
// 通过 vite dev server 中间件 POST /api/alphamind-sync 写入项目根目录
// .alphamind-sync.json；仅 dev 浏览器环境执行，按内容序列化字符串节流。
let lastSyncedHoldingsJson: string | null = null

function syncHoldingsToFile(db: DB): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const holdingsJson = JSON.stringify(db.holdings)
  if (holdingsJson === lastSyncedHoldingsJson) return // 内容没变不打请求
  lastSyncedHoldingsJson = holdingsJson
  fetch('/api/alphamind-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings: db.holdings, updatedAt: new Date().toISOString() }),
  })
    .then((r) => {
      if (!r.ok) lastSyncedHoldingsJson = null // 失败允许下次重试
    })
    .catch(() => {
      lastSyncedHoldingsJson = null
    })
}

export function saveDB(db: DB): void {
  // 深克隆打破引用稳定性，确保 subscribeDB 回调中 setDb(getDB()) 能触发 React 重渲染
  cache = JSON.parse(JSON.stringify(db))
  localStorage.setItem(KEY, JSON.stringify(db))
  window.dispatchEvent(new Event(EVENT))
  syncHoldingsToFile(db)
}

/** 读取 db 并在变更时触发组件重渲染 */
export function subscribeDB(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

// ── 便捷修改器 ────────────────────────────────────────────────

export function updateDB(mutate: (db: DB) => void): DB {
  const db = getDB()
  mutate(db)
  saveDB(db)
  return db
}

// ── 联网收集因子合并 ────────────────────────────────────────────

/** factors-collected.json 条目 → Factor（source 取 'public'，notes 前缀「联网收集 · 」） */
function collectedToFactor(c: CollectedFactor): Factor {
  return {
    id: c.id,
    name: c.name,
    source: 'public',
    origin: c.origin,
    category: c.category,
    definition: c.definition,
    applicable: c.applicable,
    notes: `联网收集 · ${c.notes}`,
    performance: c.performance,
    sourceUrl: c.sourceUrl,
    rule: c.rule,
  }
}

/**
 * 合并联网收集因子进因子库：把 factors-collected.json 中 id 尚不存在的因子追加进 db.factors。
 * 幂等：重复执行不产生重复；只追加，绝不覆盖/删除用户已有因子。
 * 合并是异步的（fetch 静态 JSON），由根组件挂载时的 useEffect 触发；
 * 有变更时通过 saveDB 落盘并派发 'alphamind-db' 事件驱动页面刷新。
 */
export async function mergeCollectedFactors(): Promise<boolean> {
  const collected = await loadCollectedFactors()
  if (collected.length === 0) return false
  const db = getDB()
  const existingIds = new Set(db.factors.map((f) => f.id))
  const missing = collected.filter((c) => !existingIds.has(c.id))
  if (missing.length === 0) return false
  db.factors.push(...missing.map(collectedToFactor))
  saveDB(db)
  return true
}
