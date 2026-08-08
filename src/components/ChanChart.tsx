// ─────────────────────────────────────────────────────────────
// 缠论结构图：closes 细线 + 笔折线（violet）+ 中枢阴影带 + 买卖点标记
// 降级：K线缺 OHLC / 无笔数据 / 加载失败时返回 null（不渲染，不报错）
// ─────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { loadKline } from '@/lib/marketData'
import { useAsync } from '@/lib/useAsync'
import type { ChanAnalysis } from '@/lib/types'

const WINDOW = 150 // 展示最近 N 根日K（可调）

interface Row {
  date: string // MM-DD
  fullDate: string // YYYY-MM-DD（跨年比较用，MM-DD 字符串无法跨元年比较）
  close: number
  stroke: number | null // 笔端点价格（非端点日为 null，配合 connectNulls 画折笔）
}

/** 买卖点文案简写：三买/三卖/一二买/一二卖；颜色按「买」「卖」判定 */
function pointMark(text: string): { label: string; color: string } {
  const isBuy = text.includes('买')
  let label = isBuy ? '买' : '卖'
  if (text.includes('第三类')) label = isBuy ? '三买' : '三卖'
  else if (text.includes('第一类')) label = isBuy ? '一二买' : '一二卖'
  return { label, color: isBuy ? '#34d399' : '#fb7185' }
}

export default function ChanChart({ code, analysis }: { code: string; analysis: ChanAnalysis }) {
  // loadKline 模块级缓存：analyzeChan 刚拉过同一份数据，此处无额外请求
  const { data: kline } = useAsync(() => loadKline(code).catch(() => null), [code])

  const rows = useMemo<Row[]>(() => {
    if (!kline || !kline.highs || !kline.lows || !analysis.strokes || analysis.strokes.length === 0) {
      return []
    }
    const n = kline.dates.length
    if (n < 20) return []
    const start = Math.max(0, n - WINDOW)
    const dates = kline.dates.slice(start)
    const closes = kline.closes.slice(start)
    const inWindow = new Set(dates)
    // 笔端点 → 日期对齐的稀疏数组（同一天多个端点取最后落笔价）
    const endpoint = new Map<string, number>()
    for (const s of analysis.strokes) {
      if (inWindow.has(s.from)) endpoint.set(s.from, s.fromPrice)
      if (inWindow.has(s.to)) endpoint.set(s.to, s.toPrice)
    }
    return dates.map((d, i) => ({
      date: d.slice(5), // MM-DD
      fullDate: d,
      close: closes[i],
      stroke: endpoint.get(d) ?? null,
    }))
  }, [kline, analysis.strokes])

  const domain = useMemo<[number, number]>(() => {
    if (rows.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const r of rows) {
      min = Math.min(min, r.close)
      max = Math.max(max, r.close)
    }
    if (analysis.zhongshu) {
      min = Math.min(min, analysis.zhongshu.zd)
      max = Math.max(max, analysis.zhongshu.zg)
    }
    const pad = (max - min || max || 1) * 0.05
    return [Number((min - pad).toFixed(2)), Number((max + pad).toFixed(2))]
  }, [rows, analysis.zhongshu])

  if (rows.length === 0) return null

  const zs = analysis.zhongshu
  const firstDate = rows[0].date
  const lastRow = rows[rows.length - 1]
  // 中枢起点早于窗口时钳到窗口首日，终点画到窗口末尾（按完整日期比较，避免跨年 MM-DD 误判）
  const zsX1 = zs && zs.startDate >= rows[0].fullDate ? zs.startDate.slice(5) : firstDate
  const mark = analysis.buySellPoint ? pointMark(analysis.buySellPoint) : null

  return (
    <div className="mt-3 h-[280px] w-full rounded-lg border border-violet-500/20 bg-gray-50 p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#1e293b' }}
            minTickGap={48}
          />
          <YAxis
            domain={domain}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value, name) => [
              typeof value === 'number' ? value.toFixed(2) : '-',
              name === 'stroke' ? '笔端点' : '收盘价',
            ]}
          />
          {zs && (
            <ReferenceArea
              x1={zsX1}
              x2={lastRow.date}
              y1={zs.zd}
              y2={zs.zg}
              fill="#8b5cf6"
              fillOpacity={0.12}
              stroke="#8b5cf6"
              strokeOpacity={0.35}
              label={{ value: '中枢', fill: '#a78bfa', fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="close"
            stroke="#64748b"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="stroke"
            stroke="#a78bfa"
            strokeWidth={2.5}
            connectNulls
            dot={{ r: 2.5, fill: '#a78bfa', strokeWidth: 0 }}
            activeDot={{ r: 3.5 }}
            isAnimationActive={false}
          />
          {mark && (
            <ReferenceDot
              x={lastRow.date}
              y={lastRow.close}
              r={5}
              fill={mark.color}
              stroke="#0f172a"
              strokeWidth={1.5}
              label={{ value: mark.label, fill: mark.color, fontSize: 11, fontWeight: 600, position: 'top' }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
