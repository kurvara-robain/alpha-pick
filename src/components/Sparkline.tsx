interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  positive: boolean
}

// 轻量 SVG 迷你走势图（用于榜单行内）
export default function Sparkline({ data, width = 96, height = 28, positive }: SparklineProps) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`)
    .join(' ')
  const color = positive ? '#fb7185' : '#34d399' // 红涨绿跌

  return (
    <svg width={width} height={height} className="block" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2} r="2" fill={color} />
    </svg>
  )
}
