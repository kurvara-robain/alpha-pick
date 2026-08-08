import { ScanSearch, Loader2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ALL_FACTORS } from '@/lib/mockData'
import { cn } from '@/lib/utils'

export interface FilterState {
  mktCapRange: [number, number] // 亿元
  peRange: [number, number]
  minScore: number
  factors: string[] // 命中的因子（OR）
}

export const DEFAULT_FILTERS: FilterState = {
  mktCapRange: [0, 20000],
  peRange: [0, 130],
  minScore: 0,
  factors: [],
}

interface ScreenerProps {
  filters: FilterState
  onChange: (f: FilterState) => void
  onRun: () => void
  scanning: boolean
}

export default function Screener({ filters, onChange, onRun, scanning }: ScreenerProps) {
  const toggleFactor = (f: string) => {
    const next = filters.factors.includes(f)
      ? filters.factors.filter((x) => x !== f)
      : [...filters.factors, f]
    onChange({ ...filters, factors: next })
  }

  return (
    <section id="screener" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-12 sm:px-6">
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">因子筛选</h2>
            <p className="mt-0.5 text-xs text-gray-400">调整条件后点击「运行 AI 选股」，引擎将重新扫描全市场</p>
          </div>
          <ScanSearch className="h-5 w-5 text-amber-500" />
        </div>

        <div className="grid gap-6 lg:grid-cols-4">
          {/* 市值范围 */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-gray-500">总市值（亿元）</span>
              <span className="font-mono tabular-nums text-amber-500">
                {filters.mktCapRange[0].toLocaleString()} - {filters.mktCapRange[1].toLocaleString()}
              </span>
            </div>
            <Slider
              min={0}
              max={20000}
              step={100}
              value={filters.mktCapRange}
              onValueChange={(v) => onChange({ ...filters, mktCapRange: [v[0], v[1]] })}
            />
          </div>

          {/* PE 范围 */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-gray-500">市盈率 PE</span>
              <span className="font-mono tabular-nums text-amber-500">
                {filters.peRange[0]} - {filters.peRange[1]}
              </span>
            </div>
            <Slider
              min={0}
              max={130}
              step={1}
              value={filters.peRange}
              onValueChange={(v) => onChange({ ...filters, peRange: [v[0], v[1]] })}
            />
          </div>

          {/* 最低 AI 评分 */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-gray-500">最低 AI 评分</span>
              <span className="font-mono tabular-nums text-amber-500">{filters.minScore}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[filters.minScore]}
              onValueChange={(v) => onChange({ ...filters, minScore: v[0] })}
            />
          </div>

          {/* 因子开关 */}
          <div>
            <div className="mb-2 text-xs text-gray-500">命中因子（多选，任一即可）</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_FACTORS.map((f) => {
                const active = filters.factors.includes(f)
                return (
                  <button key={f} type="button" onClick={() => toggleFactor(f)}>
                    <Badge
                      variant="outline"
                      className={cn(
                        'cursor-pointer transition-all',
                        active
                          ? 'border-amber-400 bg-amber-100 text-amber-500 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                          : 'border-gray-300 text-gray-400 hover:border-slate-500 hover:text-gray-700',
                      )}
                    >
                      {f}
                    </Badge>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <Button
            onClick={onRun}
            disabled={scanning}
            className="bg-gradient-to-r from-amber-400 to-amber-600 font-semibold text-white hover:from-cyan-400 hover:to-blue-500"
          >
            {scanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                AI 引擎计算样本股信号…
              </>
            ) : (
              <>
                <ScanSearch className="mr-2 h-4 w-4" />
                运行 AI 选股
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="text-xs text-gray-400 underline-offset-4 hover:text-gray-700 hover:underline"
          >
            重置条件
          </button>
        </div>
      </div>
    </section>
  )
}
