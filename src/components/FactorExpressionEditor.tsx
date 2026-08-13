// ─────────────────────────────────────────────────────────────
// 因子表达式编辑器
// 输入公式 → API 计算 IC → 结果显示
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface EvalResult {
  ic_mean: number
  ic_std: number
  icir: number
  valid_days: number
  abs_ic_mean: number
}

const PRESET_EXPRESSIONS = [
  { label: '标准化偏离', expr: '(close - ts_mean(close, 20)) / ts_std(close, 20)' },
  { label: '5日收益率', expr: 'delay(close, 5) / close - 1' },
  { label: '价量相关', expr: 'ts_corr(close, volume, 20)' },
  { label: '波动率', expr: 'ts_std(close, 20) / ts_mean(close, 20)' },
  { label: '20日振幅', expr: '(ts_max(close, 20) - ts_min(close, 20)) / ts_mean(close, 20)' },
  { label: '量比', expr: 'volume / ts_mean(volume, 5) - 1' },
]

const GRAMMAR_HELP = `
字段: open high low close volume amount
运算符: + - * / ^
函数:
  ts_sum(f,d) — d日求和
  ts_mean(f,d) — d日均值
  ts_std(f,d) — d日标准差
  ts_max(f,d) — d日最大
  ts_min(f,d) — d日最小
  delay(f,d) — d日前值
  delta(f,d) — f-delay(f,d)
  ts_corr(f1,f2,d) — d日相关系数
  ts_rank(f,d) — d日排名（0-1）
  sqrt(f) abs(f) log(f) sign(f)
`

export default function FactorExpressionEditor() {
  const [expr, setExpr] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [error, setError] = useState('')

  const handleEval = async () => {
    if (!expr.trim()) return
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/factor/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: expr.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? '评估失败')
      }
      setResult(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误')
    }
    setLoading(false)
  }

  const icDisplay = (v: number) => {
    const color = Math.abs(v) > 0.05 ? 'text-emerald-600' : Math.abs(v) > 0.03 ? 'text-amber-600' : 'text-gray-500'
    return <span className={`font-mono font-bold tabular-nums ${color}`}>{v >= 0 ? '+' : ''}{v.toFixed(4)}</span>
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900">因子表达式引擎</h3>
        <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">Alpha158</Badge>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        输入因子计算公式，系统自动从 K 线数据计算并评估 IC/ICIR。支持算术运算、时序函数、截面排名。
      </p>

      {/* 快捷模板 */}
      <div className="mb-3 flex flex-wrap gap-1">
        {PRESET_EXPRESSIONS.map((p) => (
          <button key={p.label} onClick={() => setExpr(p.expr)}
            className="rounded-full border border-gray-200 px-2.5 py-0.5 text-[10px] text-gray-500 hover:border-amber-300 hover:text-amber-600">
            {p.label}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="flex gap-2">
        <Textarea className="flex-1 font-mono text-xs" rows={2} placeholder="例: (close - ts_mean(close, 20)) / ts_std(close, 20)"
          value={expr} onChange={(e) => setExpr(e.target.value)} />
        <Button onClick={handleEval} disabled={loading || !expr.trim()}
          className="shrink-0 bg-amber-500 text-white text-xs hover:bg-amber-600">
          {loading ? '计算中…' : <><Play className="h-3 w-3 mr-1" />评估 IC</>}
        </Button>
      </div>

      {error && <div className="mt-2 rounded bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{error}</div>}

      {/* 结果 */}
      {result && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="text-center">
            <div className="text-[10px] text-gray-400">IC 均值</div>
            <div className="mt-0.5">{icDisplay(result.ic_mean)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-400">ICIR</div>
            <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-gray-800">{result.icir.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-400">评估日</div>
            <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-gray-800">{result.valid_days}</div>
          </div>
          <div className="col-span-3 mt-1 text-center text-[10px] text-gray-400">
            |IC|={Math.abs(result.ic_mean).toFixed(4)} · σ={result.ic_std.toFixed(4)} · {' '}
            {Math.abs(result.ic_mean) > 0.05 ? '🟢 强因子' : Math.abs(result.ic_mean) > 0.03 ? '🟡 中等' : '⚪ 弱因子'}
          </div>
        </div>
      )}

      {/* 语法帮助 */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] text-gray-400">语法参考</summary>
        <pre className="mt-1 rounded bg-gray-50 p-2 text-[10px] text-gray-500">{GRAMMAR_HELP}</pre>
      </details>
    </div>
  )
}
