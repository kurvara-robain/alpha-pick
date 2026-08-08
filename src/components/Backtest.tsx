import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BACKTEST, BACKTEST_METRICS, MONTHLY_BARS } from '@/lib/mockData'

const METRICS = [
  { label: '年化收益率', value: `+${BACKTEST_METRICS.annualReturn}%`, accent: 'text-rose-400' },
  { label: '夏普比率', value: BACKTEST_METRICS.sharpe.toFixed(2), accent: 'text-amber-500' },
  { label: '最大回撤', value: `${BACKTEST_METRICS.maxDrawdown}%`, accent: 'text-emerald-400' },
  { label: '月度胜率', value: `${BACKTEST_METRICS.winRate}%`, accent: 'text-amber-300' },
  { label: '超额收益', value: `+${BACKTEST_METRICS.excessReturn}%`, accent: 'text-rose-400' },
]

const tooltipStyle = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: 12,
}

export default function Backtest() {
  return (
    <section id="backtest" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-12 sm:px-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">组合回测</h2>
        <p className="mt-0.5 text-xs text-gray-400">AlphaMind 策略 vs 沪深300 基准 · 近 12 个月 · 月度调仓（模拟演示，非真实业绩）</p>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-400">{m.label}</div>
            <div className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${m.accent}`}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        {/* 累计净值曲线 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">累计净值走势</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={BACKTEST} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => Number(value).toFixed(3)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="strategy" name="AlphaMind 策略" stroke="#22d3ee" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="benchmark" name="沪深300 基准" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 月度收益柱状图 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">月度收益（%）</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MONTHLY_BARS} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1e293b', opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="strategy" name="策略" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                <Bar dataKey="benchmark" name="基准" fill="#475569" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  )
}
