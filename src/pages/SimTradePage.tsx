// ─────────────────────────────────────────────────────────────
// 模拟交易台 — 完整版：下单 / T+1 / 涨跌停 / 费用 / 持仓 / 历史
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  FolderPlus,
  History,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadUniverse } from '@/lib/marketData'
import type { UniverseStock } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { executeBuy, executeSell, loadAccount, markToMarket, resetAccount, saveAccount } from '@/lib/simTrade'
import type { SimAccount, SimOrder } from '@/lib/simTrade'
import { getCandidateSnapshot, listRuns } from '@/lib/experimentRun'
import {
  createPaperPortfolioFromCandidate,
  deletePortfolio,
  listPortfolios,
  markPortfolioToMarket,
  subscribePortfolios,
} from '@/lib/portfolioStore'
import type { PaperPortfolio } from '@/lib/types'

// ═══════════════════════════════════════════════════════════════
// 账户摘要卡片
// ═══════════════════════════════════════════════════════════════

function AccountSummary({ account }: { account: SimAccount }) {
  const totalPnL = account.totalValue - account.initialCapital
  const pnlPct = account.initialCapital > 0 ? (totalPnL / account.initialCapital) * 100 : 0

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] text-gray-400">总资产</div>
        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-gray-900">¥{fmtNum(account.totalValue, 0)}</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] text-gray-400">可用资金</div>
        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-gray-900">¥{fmtNum(account.cash, 0)}</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] text-gray-400">持仓市值</div>
        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-gray-900">
          ¥{fmtNum(account.totalValue - account.cash, 0)}
        </div>
      </div>
      <div className={`rounded-lg border p-4 ${totalPnL >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
        <div className="text-[11px] text-gray-400">累计盈亏</div>
        <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {fmtPct(pnlPct)}
        </div>
        <div className={`text-xs ${totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
          ¥{totalPnL >= 0 ? '+' : ''}{fmtNum(totalPnL, 0)}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 下单面板
// ═══════════════════════════════════════════════════════════════

function TradePanel({
  universe, account, onTrade,
}: {
  universe: UniverseStock[]
  account: SimAccount
  onTrade: () => void
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [stockQuery, setStockQuery] = useState('')
  const [selectedStock, setSelectedStock] = useState<UniverseStock | null>(null)
  const [quantity, setQuantity] = useState('100')
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showResults, setShowResults] = useState(false)

  const stockMatches = useMemo(() => {
    if (stockQuery.length < 1) return []
    const q = stockQuery.toLowerCase()
    return universe.filter((s) => s.code.includes(q) || s.name.toLowerCase().includes(q)).slice(0, 10)
  }, [stockQuery, universe])

  const handleSubmit = () => {
    if (!selectedStock || !quantity) return
    const qty = parseInt(quantity)
    if (isNaN(qty) || qty < 100 || qty % 100 !== 0) {
      setResult({ success: false, message: '股数必须为 100 的整数倍' })
      return
    }

    let res: { order: SimOrder }
    if (side === 'buy') {
      res = executeBuy(account, { code: selectedStock.code, name: selectedStock.name, price: selectedStock.price, changePct: selectedStock.changePct, isStarMarket: selectedStock.code.startsWith('688') || selectedStock.code.startsWith('300') }, qty)
    } else {
      res = executeSell(account, { code: selectedStock.code, name: selectedStock.name, price: selectedStock.price, changePct: selectedStock.changePct, isStarMarket: selectedStock.code.startsWith('688') || selectedStock.code.startsWith('300') }, qty)
    }

    if (res.order.status === 'filled') {
      const sideLabel = side === 'buy' ? '买入' : '卖出'
      setResult({ success: true, message: `${sideLabel} ${selectedStock.name} ${qty}股 @ ¥${res.order.filledPrice.toFixed(2)} — 佣金 ¥${res.order.fees.commission.toFixed(2)}` })
      onTrade()
    } else {
      setResult({ success: false, message: res.order.rejectReason ?? '委托失败' })
    }

    setTimeout(() => setResult(null), 5000)
  }

  // 快速计算
  const q = parseInt(quantity) || 0
  const estAmount = selectedStock ? selectedStock.price * q : 0
  const estCommission = Math.max(5, estAmount * 0.00025)
  const estTotal = side === 'buy' ? estAmount + estCommission : estAmount - estCommission - estAmount * 0.0005

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <DollarSign className="h-4 w-4 text-amber-500" />下单
      </h3>

      {/* 买卖切换 */}
      <div className="mb-3 flex rounded-lg border border-gray-200 p-0.5">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${side === 'buy' ? 'bg-rose-100 text-rose-700' : 'text-gray-400 hover:text-gray-600'}`}
        >买入</button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${side === 'sell' ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400 hover:text-gray-600'}`}
        >卖出</button>
      </div>

      {/* 股票搜索 */}
      <div className="relative mb-3">
        <div className="flex items-center gap-2 rounded border border-gray-300 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <Input className="flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
            placeholder="搜索股票…"
            value={selectedStock ? `${selectedStock.name} (${selectedStock.code}) ¥${fmtNum(selectedStock.price)}` : stockQuery}
            onChange={(e) => { setStockQuery(e.target.value); setSelectedStock(null); setShowResults(true) }}
            onFocus={() => setShowResults(true)} />
          {selectedStock && <button onClick={() => setSelectedStock(null)}><X className="h-3.5 w-3.5 text-gray-400" /></button>}
        </div>
        {showResults && stockMatches.length > 0 && !selectedStock && (
          <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
            {stockMatches.map((s) => (
              <button key={s.code} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-amber-50"
                onClick={() => { setSelectedStock(s); setShowResults(false) }}>
                <span className="font-medium text-gray-900">{s.name}</span>
                <span className="font-mono text-gray-400">{s.code}</span>
                <span className="ml-auto font-mono tabular-nums">¥{fmtNum(s.price)} <span className={pctColor(s.changePct)}>{fmtPct(s.changePct)}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 数量 */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-gray-500">数量（100 股整数倍）</label>
        <div className="flex items-center gap-2">
          <Input className="flex-1 text-xs" type="number" min={100} step={100} value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
          {selectedStock && (
            <div className="flex gap-1 text-[10px]">
              {side === 'buy' && <button onClick={() => setQuantity(String(Math.floor(account.cash / selectedStock.price / 100) * 100))} className="rounded border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50">最大</button>}
              <button onClick={() => setQuantity(String(parseInt(quantity || '0') + 100))} className="rounded border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50">+100</button>
              <button onClick={() => setQuantity(String(Math.max(100, parseInt(quantity || '0') - 100)))} className="rounded border border-gray-200 px-1.5 py-0.5 hover:bg-gray-50">-100</button>
            </div>
          )}
        </div>
      </div>

      {/* 费用预估 */}
      {selectedStock && q > 0 && (
        <div className="mb-3 rounded bg-gray-50 p-2 text-[11px] text-gray-500 space-y-0.5">
          <div className="flex justify-between"><span>预估成交价</span><span className="font-mono">¥{selectedStock.price.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>预估金额</span><span className="font-mono">¥{fmtNum(estAmount, 0)}</span></div>
          <div className="flex justify-between"><span>佣金（万2.5）</span><span className="font-mono">¥{estCommission.toFixed(2)}</span></div>
          {side === 'sell' && <div className="flex justify-between"><span>印花税（万5）</span><span className="font-mono">¥{(estAmount * 0.0005).toFixed(2)}</span></div>}
          <div className="flex justify-between font-medium text-gray-700"><span>{side === 'buy' ? '应付' : '应收'}</span><span className="font-mono">¥{fmtNum(estTotal, 0)}</span></div>
        </div>
      )}

      <Button onClick={handleSubmit} disabled={!selectedStock || !quantity}
        className={`w-full ${side === 'buy' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'} text-white`}>
        {side === 'buy' ? '买入' : '卖出'} {selectedStock?.name ?? ''}
      </Button>

      {result && (
        <div className={`mt-2 rounded p-2 text-xs ${result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {result.message}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 持仓列表
// ═══════════════════════════════════════════════════════════════

function PositionList({ account }: { account: SimAccount }) {
  if (account.positions.length === 0) {
    return <div className="rounded border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">暂无持仓</div>
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
            <th className="px-3 py-2 font-medium">股票</th>
            <th className="px-3 py-2 text-right font-medium">持仓</th>
            <th className="px-3 py-2 text-right font-medium">成本</th>
            <th className="px-3 py-2 text-right font-medium">现价</th>
            <th className="px-3 py-2 text-right font-medium">市值</th>
            <th className="px-3 py-2 text-right font-medium">盈亏</th>
            <th className="px-3 py-2 text-right font-medium">盈亏%</th>
            <th className="px-3 py-2 text-center font-medium">T+1</th>
          </tr>
        </thead>
        <tbody>
          {account.positions.map((p) => (
            <tr key={p.code} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">{p.name}<br /><span className="font-mono text-[10px] text-gray-400">{p.code}</span></td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{p.shares}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">¥{p.avgCost.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">¥{p.currentPrice.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">¥{fmtNum(p.marketValue, 0)}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${p.unrealizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {p.unrealizedPnL >= 0 ? '+' : ''}¥{fmtNum(p.unrealizedPnL, 0)}
              </td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${p.unrealizedPnLPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {fmtPct(p.unrealizedPnLPct)}
              </td>
              <td className="px-3 py-2 text-center">
                {p.lockedShares > 0 ? (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-600 text-[10px]">
                    锁定 {p.lockedShares} 股
                  </Badge>
                ) : <span className="text-emerald-500">✓</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 委托历史
// ═══════════════════════════════════════════════════════════════

function OrderHistory({ orders }: { orders: SimOrder[] }) {
  const recent = [...orders].reverse().slice(0, 50)
  if (recent.length === 0) {
    return <div className="rounded border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">暂无委托记录</div>
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200 max-h-96 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50">
          <tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">股票</th>
            <th className="px-3 py-2 text-center font-medium">方向</th>
            <th className="px-3 py-2 text-right font-medium">数量</th>
            <th className="px-3 py-2 text-right font-medium">成交价</th>
            <th className="px-3 py-2 text-right font-medium">金额</th>
            <th className="px-3 py-2 text-right font-medium">费用</th>
            <th className="px-3 py-2 text-center font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((o) => (
            <tr key={o.id} className={`border-b border-gray-50 ${o.status === 'rejected' ? 'bg-rose-50/30' : ''}`}>
              <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">{new Date(o.createdAt).toLocaleString('zh-CN')}</td>
              <td className="px-3 py-2 font-medium text-gray-900">{o.name}<br /><span className="font-mono text-[10px] text-gray-400">{o.code}</span></td>
              <td className="px-3 py-2 text-center">
                <Badge variant="outline" className={o.side === 'buy' ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-emerald-300 bg-emerald-50 text-emerald-600'}>
                  {o.side === 'buy' ? '买入' : '卖出'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{o.quantity}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">¥{o.filledPrice.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">¥{fmtNum(o.filledPrice * o.quantity, 0)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">¥{o.fees.total.toFixed(2)}</td>
              <td className="px-3 py-2 text-center">
                {o.status === 'filled' ? (
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-600">✓ 成交</Badge>
                ) : (
                  <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-600" title={o.rejectReason}>✗ 拒绝</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 交易统计
// ═══════════════════════════════════════════════════════════════

function TradeStats({ account }: { account: SimAccount }) {
  const s = account.stats
  if (s.totalTrades === 0) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <History className="h-4 w-4 text-amber-500" />交易统计
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded bg-gray-50 p-2 text-center">
          <div className="text-[10px] text-gray-400">总交易</div>
          <div className="font-mono text-sm font-bold text-gray-800">{s.totalTrades}</div>
        </div>
        <div className="rounded bg-gray-50 p-2 text-center">
          <div className="text-[10px] text-gray-400">胜率</div>
          <div className="font-mono text-sm font-bold text-gray-800">{s.winRate.toFixed(0)}%</div>
        </div>
        <div className="rounded bg-gray-50 p-2 text-center">
          <div className="text-[10px] text-gray-400">最佳交易</div>
          <div className="font-mono text-sm font-bold text-emerald-600">¥{fmtNum(s.bestTrade, 0)}</div>
        </div>
        <div className="rounded bg-gray-50 p-2 text-center">
          <div className="text-[10px] text-gray-400">最差交易</div>
          <div className="font-mono text-sm font-bold text-rose-600">¥{fmtNum(Math.abs(s.worstTrade), 0)}</div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 模拟组合（V2）— 从候选快照创建等权组合（独立于 legacy simTrade 引擎）
// ═══════════════════════════════════════════════════════════════

function PaperPortfolioPanel({ universe }: { universe: UniverseStock[] }) {
  const portfolios = useSyncExternalStore(subscribePortfolios, listPortfolios)
  const [runOptions, setRunOptions] = useState<{ runId: string; label: string }[]>([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const [pfName, setPfName] = useState('')
  const [capital, setCapital] = useState('1000000')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const opts = listRuns()
      .filter((r) => r.candidateSnapshotId)
      .map((r) => ({ runId: r.id, label: `${r.originalQuery.raw}（${r.asOfDate}）` }))
    setRunOptions(opts)
    if (opts.length > 0) setSelectedRunId((prev) => prev || opts[0].runId)
  }, [])

  const handleCreate = () => {
    setMsg(null)
    if (!selectedRunId) return setMsg({ ok: false, text: '没有可用的候选快照（需先完成筛选）' })
    const snap = getCandidateSnapshot(selectedRunId)
    if (!snap) return setMsg({ ok: false, text: '候选快照读取失败' })
    const cap = Number(capital)
    if (!cap || cap <= 0) return setMsg({ ok: false, text: '请输入有效的初始资金' })
    const prices = new Map(universe.map((s) => [s.code, s.price]))
    try {
      const pf = createPaperPortfolioFromCandidate(
        snap.runId,
        snap.id,
        pfName.trim() || `候选组合 ${snap.asOfDate}`,
        cap,
        prices,
      )
      setMsg({ ok: true, text: `已创建「${pf.name}」：${pf.positions.length} 只持仓，总资产 ¥${fmtNum(pf.totalValue, 0)}` })
      setPfName('')
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '创建失败' })
    }
  }

  const handleDelete = (id: string) => {
    if (confirm('确认删除该模拟组合？')) deletePortfolio(id)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <FolderPlus className="h-4 w-4 text-amber-500" />模拟组合（V2 · 独立于下方模拟账户）
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-[11px] text-gray-400">候选快照（已筛选的 Run）</label>
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-800"
          >
            {runOptions.length === 0 && <option value="">暂无候选快照</option>}
            {runOptions.map((o) => (
              <option key={o.runId} value={o.runId}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="mb-1 block text-[11px] text-gray-400">组合名称</label>
          <Input className="h-7 text-xs" placeholder="如 等权组合" value={pfName} onChange={(e) => setPfName(e.target.value)} />
        </div>
        <div className="w-32">
          <label className="mb-1 block text-[11px] text-gray-400">初始资金</label>
          <Input className="h-7 font-mono text-xs" type="number" min={1} value={capital} onChange={(e) => setCapital(e.target.value)} />
        </div>
        <Button size="sm" onClick={handleCreate} className="h-7 text-xs">从候选快照创建</Button>
      </div>
      {msg && (
        <div className={`mt-2 rounded p-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      )}
      {portfolios.length > 0 && (
        <div className="mt-3 space-y-2">
          {portfolios.map((pf) => (
            <div key={pf.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{pf.name}</span>
                  <span className="font-mono text-[10px] text-gray-400">{pf.asOfDate}</span>
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-600">
                    {pf.positions.length} 只持仓
                  </Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-gray-400">
                  总资产 <span className="font-mono text-gray-600">¥{fmtNum(pf.totalValue, 0)}</span>
                  · 现金 <span className="font-mono text-gray-600">¥{fmtNum(pf.cash, 0)}</span>
                  · 已实现盈亏{' '}
                  <span className={`font-mono ${pf.realizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {pf.realizedPnL >= 0 ? '+' : ''}{fmtNum(pf.realizedPnL, 0)}
                  </span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(pf.id)} className="text-gray-400 hover:text-rose-500">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function SimTradePage() {
  const universeState = useAsync(loadUniverse)
  const [account, setAccount] = useState(() => {
    let acct = loadAccount()
    // 更新市价
    if (universeState.data) {
      const prices = new Map(universeState.data.map((s) => [s.code, s.price]))
      acct = markToMarket(acct, prices)
    }
    return acct
  })
  const [tab, setTab] = useState('trade')

  const handleTrade = () => {
    const acct = loadAccount()
    if (universeState.data) {
      const prices = new Map(universeState.data.map((s) => [s.code, s.price]))
      setAccount(markToMarket(acct, prices))
      // 同步刷新 V2 模拟组合市价
      for (const pf of listPortfolios()) {
        try { markPortfolioToMarket(pf.id, prices) } catch { /* 单个组合失败不影响其余 */ }
      }
    } else {
      setAccount(acct)
    }
  }

  const handleReset = () => {
    if (confirm('确认重置模拟账户？所有持仓和交易记录将被清除。')) {
      setAccount(resetAccount())
    }
  }

  if (universeState.loading) return <LoadingBlock text="行情数据加载中…" />
  if (universeState.error) return <ErrorBlock error={universeState.error} onRetry={universeState.reload} />

  const universe = universeState.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="h-5 w-5 text-amber-500" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">模拟交易（独立引擎）</h1>
            <p className="text-xs text-gray-400">完整版：T+1 · 涨跌停 · 万2.5佣金 · 万5印花税 · 滑点 · 初始资金 ¥1,000,000</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset} className="text-xs text-gray-400">重置账户</Button>
      </div>

      {/* V2 模拟组合：从候选快照创建（独立引擎） */}
      <PaperPortfolioPanel universe={universe} />

      {/* 账户摘要 */}
      <AccountSummary account={account} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 下单面板 */}
        <TradePanel universe={universe} account={account} onTrade={handleTrade} />

        {/* 持仓 + 历史 */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="trade" className="gap-1.5 text-xs">
                <TrendingUp className="h-3.5 w-3.5" />持仓
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5 text-xs">
                <History className="h-3.5 w-3.5" />委托历史
              </TabsTrigger>
            </TabsList>
            <TabsContent value="trade" className="mt-3"><PositionList account={account} /></TabsContent>
            <TabsContent value="history" className="mt-3"><OrderHistory orders={account.orders} /></TabsContent>
          </Tabs>
        </div>
      </div>

      {/* 交易统计 */}
      <TradeStats account={account} />
    </div>
  )
}
