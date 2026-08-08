import { TrendingDown, TrendingUp, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { loadIndices, loadMeta } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import { ErrorBlock, LoadingBlock } from '@/components/AsyncStatus'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'

export default function MarketOverview() {
  const indicesState = useAsync(loadIndices)
  const metaState = useAsync(loadMeta)

  const loading = indicesState.loading || metaState.loading
  const error = indicesState.error ?? metaState.error
  const retryAll = () => {
    indicesState.reload()
    metaState.reload()
  }

  if (loading) {
    return (
      <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <LoadingBlock text="行情数据加载中…" />
      </section>
    )
  }
  if (error || !indicesState.data || !metaState.data) {
    return (
      <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <ErrorBlock error={error ?? '行情数据加载失败，请稍后重试。'} onRetry={retryAll} />
      </section>
    )
  }

  const indices = indicesState.data.indices
  const meta = metaState.data

  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      {/* 标题区 */}
      <div className="mb-8 max-w-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-amber-500">
          AI-Powered Equity Screening
        </p>
        <h1 className="text-3xl font-bold leading-tight text-slate-50 sm:text-4xl">
          用真实行情
          <br />
          驱动<span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">今天的选股信号</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-500">
          动量 · 价值 · 成长 · 资金流 · 情绪 · 技术形态，六大因子基于真实行情实时计算，
          覆盖全市场 {meta.stockCount.toLocaleString('zh-CN')} 只 A 股，为每只候选股打出 0-100 的模型评分。
        </p>
      </div>

      {/* 指数卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {indices.map((idx) => (
          <div
            key={idx.name}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{idx.name}</span>
              {idx.changePct >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
            <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-gray-900">
              {fmtNum(idx.value)}
            </div>
            <div className={`mt-1 font-mono text-sm tabular-nums ${pctColor(idx.changePct)}`}>
              {fmtPct(idx.changePct)}
            </div>
          </div>
        ))}
      </div>

      {/* 市场统计条 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
        <span className="flex items-center gap-1.5 text-rose-400">
          <ArrowUpRight className="h-4 w-4" />
          全市场上涨 <span className="font-mono font-semibold tabular-nums">{meta.upCount.toLocaleString()}</span> 家
        </span>
        <span className="flex items-center gap-1.5 text-emerald-400">
          <ArrowDownRight className="h-4 w-4" />
          全市场下跌 <span className="font-mono font-semibold tabular-nums">{meta.downCount.toLocaleString()}</span> 家
        </span>
        <span className="text-gray-500">
          两市成交额 <span className="font-mono font-semibold tabular-nums text-amber-300">{meta.turnoverYi.toLocaleString()}</span> 亿元
        </span>
        <span className="ml-auto hidden text-xs text-gray-400 sm:block">
          数据源：{meta.source} · 截至 {meta.fetchedAt}
        </span>
      </div>
    </section>
  )
}
