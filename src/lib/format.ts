// A 股配色约定：红涨绿跌
export function pctColor(pct: number): string {
  if (pct > 0) return 'text-red-500'
  if (pct < 0) return 'text-green-500'
  return 'text-gray-500'
}

export function pctBg(pct: number): string {
  if (pct > 0) return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  if (pct < 0) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  return 'bg-slate-500/10 text-gray-500 border-slate-500/20'
}

export function fmtPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
