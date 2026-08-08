import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Stock } from '@/lib/mockData'
import { RADAR_LABELS } from '@/lib/mockData'
import { fmtPct, pctColor } from '@/lib/format'
import { Sparkles } from 'lucide-react'

interface StockDetailProps {
  stock: Stock | null
  onClose: () => void
}

export default function StockDetail({ stock, onClose }: StockDetailProps) {
  const chartData =
    stock?.series.map((v, i) => ({ day: i + 1, price: v })) ?? []
  const radarData =
    stock?.radar.map((v, i) => ({ factor: RADAR_LABELS[i], value: v })) ?? []
  const up = (stock?.changePct ?? 0) >= 0

  return (
    <Sheet open={stock !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-gray-200 bg-[#0b1120] text-gray-800 sm:max-w-xl">
        {stock && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <SheetTitle className="text-xl text-slate-50">{stock.name}</SheetTitle>
                <span className="font-mono text-sm text-gray-400">{stock.code}</span>
                <Badge variant="outline" className="border-cyan-500/40 bg-amber-100 text-amber-500">
                  AI {stock.aiScore}
                </Badge>
              </div>
              <SheetDescription className="flex items-baseline gap-3 text-gray-500">
                <span className="font-mono text-2xl font-bold tabular-nums text-gray-900">
                  {stock.price.toFixed(2)}
                </span>
                <span className={`font-mono tabular-nums ${pctColor(stock.changePct)}`}>
                  {fmtPct(stock.changePct)}
                </span>
                <span className="text-xs">{stock.industry}</span>
              </SheetDescription>
            </SheetHeader>

            {/* 60 日走势 */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">近 60 日走势</h3>
              <div className="h-48 rounded-xl border border-gray-200 bg-white/50 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={up ? '#fb7185' : '#34d399'} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={up ? '#fb7185' : '#34d399'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" hide />
                    <YAxis domain={['dataMin', 'dataMax']} hide />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value) => [`¥${Number(value).toFixed(2)}`, '收盘价']}
                      labelFormatter={(l) => `第 ${l} 个交易日`}
                    />
                    <Area type="monotone" dataKey="price" stroke={up ? '#fb7185' : '#34d399'} strokeWidth={2} fill="url(#priceGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 因子雷达 */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">六维因子雷达</h3>
              <div className="h-56 rounded-xl border border-gray-200 bg-white/50 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="factor" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="value" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.25} strokeWidth={2} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 关键指标 */}
            <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {[
                { label: '总市值', value: `${stock.mktCap.toLocaleString()}亿` },
                { label: 'PE(TTM)', value: stock.pe.toFixed(1) },
                { label: 'PB', value: stock.pb.toFixed(1) },
                stock.roe != null
                  ? { label: 'ROE', value: `${stock.roe}%` }
                  : { label: '60日位置', value: `${stock.pos60 ?? '—'}%` },
                { label: '换手率', value: `${stock.turnover}%` },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-gray-200 bg-white/50 p-2.5 text-center">
                  <div className="text-[11px] text-gray-400">{m.label}</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-gray-800">{m.value}</div>
                </div>
              ))}
            </div>

            {/* AI 解读 */}
            <div className="mt-6 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-500">
                <Sparkles className="h-4 w-4" />
                AI 解读
              </div>
              <p className="text-sm leading-relaxed text-gray-700">{stock.aiText}</p>
              <p className="mt-3 text-[11px] text-gray-300">行情为真实数据，评分为演示模型输出，不构成投资建议</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
