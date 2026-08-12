// ─────────────────────────────────────────────────────────────
// 数据可信度标签 — 实时/历史/演示/模型/估算
// ─────────────────────────────────────────────────────────────
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Credibility = 'realtime' | 'historical' | 'model' | 'demo' | 'stale'

interface CredibilityBadgeProps {
  type: Credibility
  className?: string
}

const META: Record<Credibility, { label: string; color: string }> = {
  realtime:  { label: '实时',   color: 'border-emerald-400 text-emerald-600 bg-emerald-50' },
  historical:{ label: '历史',   color: 'border-blue-400 text-blue-600 bg-blue-50' },
  model:     { label: '模型',   color: 'border-amber-400 text-amber-600 bg-amber-50' },
  demo:      { label: '演示',   color: 'border-gray-300 text-gray-500 bg-gray-50' },
  stale:     { label: '数据过期', color: 'border-rose-400 text-rose-600 bg-rose-50' },
}

export function CredibilityBadge({ type, className }: CredibilityBadgeProps) {
  const m = META[type]
  return (
    <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 leading-none font-normal', m.color, className)}>
      {m.label}
    </Badge>
  )
}

/** 根据数据新鲜度自动判断可信度 */
export function freshnessCredibility(latestDate: string | null): Credibility {
  if (!latestDate) return 'stale'
  const d = new Date(latestDate)
  const now = new Date()
  const diffDays = (now.getTime() - d.getTime()) / 86400000
  if (diffDays <= 1) return 'realtime'
  if (diffDays <= 7) return 'historical'
  return 'stale'
}
