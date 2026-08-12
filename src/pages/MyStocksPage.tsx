// ─────────────────────────────────────────────────────────────
// 我的自选 v6 — 左自选 + 右持仓
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Trash2, ChevronDown, ChevronUp, BarChart3, Activity } from 'lucide-react'
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fmtNum, fmtPct, pctColor } from '@/lib/format'
import { loadKline, loadUniverse, type KlineData } from '@/lib/marketData'
import { getWatchlist, addToWatchlist, removeFromWatchlist, computeSnapshots, type TrackedStockSnapshot } from '@/lib/watchlistStore'
import { getPositions, addPosition, removePosition, computePositionSnapshots, type PositionSnapshot } from '@/lib/positionStore'

// ═══════ 指标 ═══════
function sma(a: number[], n: number) { return a.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; return s / n }) }
function ema(a: number[], n: number) { const r = [a[0]], k = 2 / (n + 1); for (let i = 1; i < a.length; i++) r.push(a[i] * k + r[i - 1] * (1 - k)); return r }
function kdj(h: number[], l: number[], c: number[]) { const n = 9, k: number[] = [], d: number[] = [], j: number[] = []; let pk = 50, pd = 50; for (let i = 0; i < c.length; i++) { if (i < n - 1) { k.push(pk); d.push(pd); j.push(3 * pk - 2 * pd); continue } const wh = Math.max(...h.slice(i - n + 1, i + 1)), wl = Math.min(...l.slice(i - n + 1, i + 1)), rsv = wh === wl ? 50 : ((c[i] - wl) / (wh - wl)) * 100, ck = (2 * pk + rsv) / 3, cd = (2 * pd + ck) / 3; pk = ck; pd = cd; k.push(ck); d.push(cd); j.push(3 * ck - 2 * cd) } return { k, d, j } }
function macd(c: number[]) { const e12 = ema(c, 12), e26 = ema(c, 26), dif = e12.map((v, i) => v - e26[i]), dea = ema(dif, 9); return { dif, dea, m: dif.map((v, i) => (v - dea[i]) * 2) } }

function StockChart({ kline }: { kline: KlineData }) {
  const c = kline.closes, h = kline.highs ?? c, l = kline.lows ?? c
  const [ind, setInd] = useState<'ma' | 'kdj' | 'macd'>('ma')
  const st = Math.max(0, c.length - 120)
  const ma5 = useMemo(() => sma(c, 5), [c]), ma10 = useMemo(() => sma(c, 10), [c]), ma20 = useMemo(() => sma(c, 20), [c]), ma60 = useMemo(() => sma(c, 60), [c])
  const _kdj = useMemo(() => kdj(h, l, c), [h, l, c]), _macd = useMemo(() => macd(c), [c])
  const data = useMemo(() => c.slice(st).map((_, i) => { const idx = st + i; return { date: kline.dates[idx]?.slice(5) ?? '', close: c[idx], ma5: ma5[idx], ma10: ma10[idx], ma20: ma20[idx], ma60: ma60[idx], k: +_kdj.k[idx].toFixed(1), d: +_kdj.d[idx].toFixed(1), j: +_kdj.j[idx].toFixed(1), dif: +_macd.dif[idx].toFixed(2), dea: +_macd.dea[idx].toFixed(2), mbar: +_macd.m[idx].toFixed(2) } }), [st, c, kline.dates, ma5, ma10, ma20, ma60, _kdj, _macd])
  return (<div className="mt-2 border-t border-gray-100 pt-2">
    <div className="flex gap-1 mb-2">{['ma', 'kdj', 'macd'].map(k => <button key={k} onClick={() => setInd(k as any)} className={cn('px-2 py-0.5 text-[10px] rounded border', ind === k ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-500')}>{k.toUpperCase()}</button>)}</div>
    <ResponsiveContainer width="100%" height={180}><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis yAxisId="p" tick={{ fontSize: 9 }} domain={['auto', 'auto']} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} /><Line yAxisId="p" type="monotone" dataKey="close" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="收盘" />{ind === 'ma' && <><Line yAxisId="p" type="monotone" dataKey="ma5" stroke="#3b82f6" dot={false} strokeWidth={0.8} name="MA5" /><Line yAxisId="p" type="monotone" dataKey="ma10" stroke="#8b5cf6" dot={false} strokeWidth={0.8} name="MA10" /><Line yAxisId="p" type="monotone" dataKey="ma20" stroke="#ec4899" dot={false} strokeWidth={0.8} name="MA20" /><Line yAxisId="p" type="monotone" dataKey="ma60" stroke="#10b981" dot={false} strokeWidth={0.8} name="MA60" /></>}<Legend wrapperStyle={{ fontSize: 10 }} /></ComposedChart></ResponsiveContainer>
    {ind === 'kdj' && <ResponsiveContainer width="100%" height={60}><ComposedChart data={data}><Line type="monotone" dataKey="k" stroke="#3b82f6" dot={false} strokeWidth={1} name="K" /><Line type="monotone" dataKey="d" stroke="#f59e0b" dot={false} strokeWidth={1} name="D" /><Line type="monotone" dataKey="j" stroke="#ef4444" dot={false} strokeWidth={1} name="J" /></ComposedChart></ResponsiveContainer>}
    {ind === 'macd' && <ResponsiveContainer width="100%" height={60}><ComposedChart data={data}><Line type="monotone" dataKey="dif" stroke="#3b82f6" dot={false} strokeWidth={1} name="DIF" /><Line type="monotone" dataKey="dea" stroke="#f59e0b" dot={false} strokeWidth={1} name="DEA" /><Bar dataKey="mbar" fill="#ef4444" opacity={0.5} name="MACD" /></ComposedChart></ResponsiveContainer>}
  </div>)
}

// ═══════ 智能搜索（自选添加） ═══════
type UE = { code: string; name: string; price: number }
let _uc: UE[] | null = null
let _ucVer = 0  // universe 加载完成时 +1，SmartInput 用此触发重新搜索

const PINYIN_MAP: Record<string, string> = (() => { const m: Record<string, string> = {}; const a = (k: string, v: string) => { m[k] = v }
  for (let i = 65; i <= 90; i++) a(String.fromCharCode(i), String.fromCharCode(i))
  a('茅','M');a('台','T');a('伊','Y');a('利','L');a('格','G');a('力','L');a('美','M');a('的','D');a('海','H');a('尔','E')
  a('平','P');a('安','A');a('招','Z');a('商','S');a('银','Y');a('行','H');a('万','W');a('科','K');a('恒','H');a('瑞','R')
  a('药','Y');a('五','W');a('粮','L');a('液','Y');a('贵','G');a('州','Z');a('长','C');a('江','J');a('电','D');a('比','B')
  a('亚','Y');a('迪','D');a('宁','N');a('德','D');a('时','S');a('代','D');a('隆','L');a('基','J');a('立','L');a('讯','X')
  a('中','Z');a('国','G');a('华','H');a('信','X');a('化','H');a('新','X');a('能','N');a('源','Y');a('科','K');a('技','J')
  a('石','S');a('油','Y');a('工','G');a('农','N');a('建','J');a('保','B');a('险','X');a('证','Z');a('券','Q');a('网','W')
  a('络','L');a('汽','Q');a('车','C');a('医','Y');a('疗','L');a('航','H');a('空','K');a('军','J');a('大','D');a('北','B')
  a('京','J');a('上','S');a('南','N');a('西','X');a('东','D');a('天','T');a('太','T');a('阳','Y');a('光','G');a('伏','F')
  a('储','C');a('风','F');a('力','L');a('紫','Z');a('金','J');a('矿','K');a('三','S');a('一','Y');a('重','Z');a('联','L')
  a('合','H');a('通','T');a('移','Y');a('动','D');a('飞','F');a('凯','K');a('盛','S');a('英','Y');a('特','T');a('尔','E')
  a('韦','W');a('中','Z');a('创','C');a('赣','G');a('锋','F');a('齐','Q');a('锂','L');a('天','T');a('蓝','L');a('芯','X')
  a('迈','M');a('瑞','R');a('富','F');a('维','W');a('奥','A');a('拓','T');a('康','K');a('泰','T');a('福','F');a('成','C')
  a('明','M');a('日','R');a('月','Y');a('正','Z');a('泰','T');a('集','J');a('团','T');a('股','G');a('份','F');a('有','Y')
  a('限','X');a('公','G');a('司','S');a('科','K');a('达','D');a('汇','H');a('顶','D');a('微','W');a('半','B');a('导','D')
  a('体','T');a('广','G');a('核','H');a('水','S');a('泥','N');a('钢','G');a('铁','T');a('有','Y');a('色','S');a('煤','M')
  a('炭','T');a('纺','F');a('织','Z');a('服','F');a('装','Z');a('建','J');a('材','C');a('房','F');a('地','D');a('产','C')
  a('消','X');a('费','F');a('食','S');a('品','P');a('饮','Y');a('料','L');a('家','J');a('电','D');a('造','Z');a('纸','Z')
  a('包','B');a('妆','Z');a('印','Y');a('刷','S');a('环','H');a('境','J');a('设','S');a('备','B');a('能','N')
  a('茅台','MT');a('宁德','ND');a('比亚迪','BYD');a('伊利','YL');a('格力','GL');a('美的','MD');a('海尔','HE');a('平安','PA')
  a('招商','ZS');a('万科','WK');a('保利','BL');a('兴业','XY');a('浦发','PF');a('华泰','HT');a('海通','HT');a('中国','ZG')
  a('中信','ZX');a('光大','GD');a('华夏','HX');a('绿地','LD');a('泸州','LZ');a('老窖','LJ');a('山西','SX');a('汾酒','FJ')
  a('洋河','YH');a('赣锋','GF');a('天齐','TQ');a('韦尔','WE');a('兆易','ZY');a('北方','BF');a('华创','HC');a('中芯','ZX')
  a('工业','GY');a('富联','FL');a('传音','CY');a('汇川','HC');a('阳光','YG');a('晶盛','JS');a('先导','XD');a('恩捷','EJ')
  a('璞泰','PT');a('天赐','TC');a('当升','DS');a('容百','RB');a('德方','DF');a('杉杉','SS');a('石大','SD');a('新宙','XZ')
  return m })()

function pyInit(s: string): string {
  let r = ''
  for (let i = 0; i < s.length; i++) {
    if (i + 1 < s.length && PINYIN_MAP[s.slice(i, i + 2)]) { r += PINYIN_MAP[s.slice(i, i + 2)]; i++; continue }
    r += PINYIN_MAP[s[i]] ?? s[i].toUpperCase()
  }
  return r.toUpperCase()
}

function searchU(q: string, limit = 10): UE[] {
  if (!_uc || q.length < 1) return []
  const upper = q.toUpperCase()
  const r: UE[] = []
  for (const u of _uc) {
    if (u.code.includes(upper)) { r.push(u); continue }
    if (u.name.includes(q)) { r.push(u); continue }
    if (pyInit(u.name).includes(upper) && upper.length >= 2) { r.push(u); continue }
  }
  return r.slice(0, limit)
}

const SmartInput = React.memo(function SmartInput({ onAdd, placeholder, loaded }: { onAdd: () => void; placeholder?: string; loaded?: boolean }) {
  const [val, setVal] = useState('')
  const [sug, setSug] = useState<UE[]>([])
  const [show, setShow] = useState(false)

  const search = (v: string) => { const m = searchU(v); setSug(m); setShow(m.length > 0) }
  const hc = (v: string) => { setVal(v); if (v.trim()) search(v.trim()); else setShow(false) }
  const hs = (item: UE) => { addToWatchlist(item.code, item.name, item.price); setVal(''); setShow(false); onAdd() }

  // universe 异步加载完成后重新搜索
  useEffect(() => { if (loaded && val.trim()) search(val.trim()) }, [loaded]) // eslint-disable-line

  return (<div className="relative">
    <Input className="h-7 w-48 text-xs" placeholder={placeholder ?? '代码/名称/拼音…'} value={val} onChange={e => hc(e.target.value)}
      onFocus={() => val.trim() && searchU(val.trim()).length > 0 && setShow(true)}
      onBlur={() => setTimeout(() => setShow(false), 200)} onKeyDown={e => e.key === 'Escape' && setShow(false)} />
    {show && sug.length > 0 && (<div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
      {sug.map(item => (<button key={item.code} className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-amber-50 text-left"
        onMouseDown={e => { e.preventDefault(); hs(item) }}><span><span className="font-mono text-gray-500 mr-2">{item.code}</span><span className="text-gray-800">{item.name}</span></span><span className="text-gray-400 font-mono">¥{item.price}</span></button>))}
    </div>)}
  </div>)
})

// ═══════ 添加持仓表单（复刻自选搜索逻辑） ═══════
const AddPositionForm = React.memo(function AddPositionForm({ onAdd, loaded }: { onAdd: () => void; loaded?: boolean }) {
  const [code, setCode] = useState('')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [sug, setSug] = useState<UE[]>([])
  const [show, setShow] = useState(false)

  const handleSearch = (v: string) => {
    setCode(v.toUpperCase())
    if (v.trim()) { const m = searchU(v.trim()); setSug(m); setShow(m.length > 0) } else setShow(false)
  }
  const selectStock = (item: UE) => { setCode(item.code); setPrice(String(item.price)); setSug([]); setShow(false) }

  // universe 加载完成后重新搜索
  useEffect(() => { if (loaded && code.trim()) { const m = searchU(code.trim()); setSug(m); setShow(m.length > 0) } }, [loaded]) // eslint-disable-line

  const submit = () => {
    const c = code.trim().toUpperCase()
    if (c.length < 6 || !parseFloat(price) || !parseInt(qty)) return
    const name = sug.length > 0 ? sug[0].name : c
    addPosition(c, name, parseFloat(price), parseInt(qty))
    setCode(''); setPrice(''); setQty(''); setSug([]); onAdd()
  }

  return (<div className="flex items-center gap-1.5 flex-wrap">
    <div className="relative">
      <Input className="h-7 w-36 text-xs" placeholder="代码/名称/拼音…" value={code} onChange={e => handleSearch(e.target.value)}
        onFocus={() => code.trim() && searchU(code.trim()).length > 0 && setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        onKeyDown={e => e.key === 'Enter' && submit()} />
      {show && sug.length > 0 && (<div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
        {sug.map(item => (<button key={item.code} className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-blue-50 text-left"
          onMouseDown={e => { e.preventDefault(); selectStock(item) }}><span><span className="font-mono text-gray-500 mr-2">{item.code}</span><span className="text-gray-800">{item.name}</span></span><span className="text-gray-400 font-mono">¥{item.price}</span></button>))}
      </div>)}
    </div>
    <Input className="h-7 w-18 text-xs" placeholder="买入价" value={price} onChange={e => setPrice(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
    <Input className="h-7 w-16 text-xs" placeholder="数量" value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
    <Button size="sm" className="h-7 text-[10px]" onClick={submit}>添加</Button>
  </div>)
})

// ═══════ 主页面 ═══════
export default function MyStocksPage() {
  const [wsnaps, setWsnaps] = useState<TrackedStockSnapshot[]>([])
  const [psnaps, setPsnaps] = useState<PositionSnapshot[]>([])
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [klineData, setKlineData] = useState<Record<string, KlineData>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    loadUniverse().then(u => {
      _uc = u.map(x => ({ code: x.code, name: x.name, price: x.price }))
      _ucVer++
      setLoaded(true)
      setWsnaps(computeSnapshots(getWatchlist(), u))
      setPsnaps(computePositionSnapshots(getPositions(), u))
    })
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])
  const handleRemoveW = (code: string) => { removeFromWatchlist(code); if (expandedCode === code) setExpandedCode(null); refresh() }
  const handleRemoveP = (code: string) => { removePosition(code); refresh() }

  const toggleExpand = useCallback(async (code: string) => {
    if (expandedCode === code) { setExpandedCode(null); return }
    setExpandedCode(code)
    if (!klineData[code]) { try { const kl = await loadKline(code); if (kl) setKlineData(p => ({ ...p, [code]: kl })) } catch {} }
  }, [expandedCode, klineData])

  // 自选统计
  const wstats = useMemo(() => {
    const t = wsnaps.reduce((s, x) => s + (x.totalReturn ?? 0), 0)
    return { avg: wsnaps.length > 0 ? t / wsnaps.length : 0 }
  }, [wsnaps])

  // 持仓统计
  const pstats = useMemo(() => ({
    totalCost: psnaps.reduce((s, x) => s + x.cost, 0),
    totalMv: psnaps.reduce((s, x) => s + x.marketValue, 0),
    totalPnl: psnaps.reduce((s, x) => s + x.pnl, 0),
  }), [psnaps])

  const wl = getWatchlist()

  if (wl.length === 0 && psnaps.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center">
        <BarChart3 size={40} className="text-gray-300 mb-4" />
        <p className="text-sm text-gray-500 mb-1">还没有自选股和持仓</p>
        <p className="text-xs text-gray-400 mb-4">在左侧添加自选观察，右侧添加实际持仓</p>
        <SmartInput onAdd={refresh} placeholder="搜索添加自选股…" loaded={loaded} />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* ── 左侧：自选股 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
          <h2 className="text-sm font-bold text-gray-900">自选股</h2>
          <SmartInput onAdd={refresh} placeholder="添加自选…" loaded={loaded} />
        </div>
        <div className="text-[10px] text-gray-400 mb-1">{wl.length} 只 · 平均收益 <span className={cn('font-mono', pctColor(wstats.avg))}>{fmtPct(wstats.avg)}</span></div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] text-gray-400">
                <th className="py-1.5 px-2 text-left"></th><th className="py-1.5 px-2 text-left">代码</th><th className="py-1.5 px-2 text-left">名称</th>
                <th className="py-1.5 px-2 text-right">现价</th><th className="py-1.5 px-2 text-right">日涨跌</th><th className="py-1.5 px-2 text-right">收益</th>
                <th className="py-1.5 px-2 text-center"></th>
              </tr></thead>
              <tbody>
                {wsnaps.map(s => (<React.Fragment key={s.code}>
                  <tr className={cn('border-b border-gray-50 hover:bg-amber-50/20 cursor-pointer', expandedCode === s.code && 'bg-amber-50/30')}
                    onClick={() => toggleExpand(s.code)}>
                    <td className="py-1 px-2">{expandedCode === s.code ? <ChevronUp size={12} className="text-amber-500"/> : <ChevronDown size={12} className="text-gray-400"/>}</td>
                    <td className="py-1 px-2 font-mono text-gray-700">{s.code}</td><td className="py-1 px-2 text-gray-600">{s.name}<span className="ml-1.5 rounded border border-gray-200 bg-gray-50 px-1 py-px text-[9px] text-gray-400">来自:自选</span></td>
                    <td className="py-1 px-2 text-right font-mono">{s.currentPrice ? fmtNum(s.currentPrice) : '—'}</td>
                    <td className={cn('py-1 px-2 text-right font-mono', pctColor(s.dailyChange ?? 0))}>{s.dailyChange != null ? fmtPct(s.dailyChange) : '—'}</td>
                    <td className={cn('py-1 px-2 text-right font-mono font-semibold', pctColor(s.totalReturn ?? 0))}>{s.totalReturn != null ? fmtPct(s.totalReturn) : '—'}</td>
                    <td className="py-1 px-2 text-center"><button onClick={e => { e.stopPropagation(); handleRemoveW(s.code) }} className="text-gray-300 hover:text-rose-500"><Trash2 size={12}/></button></td>
                  </tr>
                  {expandedCode === s.code && (<tr><td colSpan={7} className="px-3 pb-2 bg-gray-50/30">
                    {klineData[s.code] ? <StockChart kline={klineData[s.code]}/> : <div className="flex items-center justify-center h-24"><Activity size={14} className="animate-spin text-amber-500 mr-2"/><span className="text-[10px] text-gray-400">加载K线…</span></div>}
                  </td></tr>)}
                </React.Fragment>))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ── 右侧：持仓 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
          <h2 className="text-sm font-bold text-gray-900">持仓</h2>
          <AddPositionForm onAdd={refresh} loaded={loaded} />
        </div>
        <div className="text-[10px] text-gray-400 mb-1">
          成本 {fmtNum(pstats.totalCost)} · 市值 {fmtNum(pstats.totalMv)} · 盈亏{' '}
          <span className={cn('font-mono font-semibold', pstats.totalPnl >= 0 ? 'text-red-500' : 'text-green-500')}>
            {pstats.totalPnl >= 0 ? '+' : ''}{fmtNum(pstats.totalPnl)}
          </span>
        </div>
        {psnaps.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] text-gray-400">
                  <th className="py-1.5 px-2 text-left">代码</th><th className="py-1.5 px-2 text-left">名称</th>
                  <th className="py-1.5 px-2 text-right">现价</th><th className="py-1.5 px-2 text-right">成本</th>
                  <th className="py-1.5 px-2 text-right">数量</th><th className="py-1.5 px-2 text-right">市值</th>
                  <th className="py-1.5 px-2 text-right">盈亏</th><th className="py-1.5 px-2 text-right">占比</th>
                  <th className="py-1.5 px-2 text-center"></th>
                </tr></thead>
                <tbody>
                  {psnaps.map(p => (<tr key={p.code} className="border-b border-gray-50 hover:bg-blue-50/20">
                    <td className="py-1 px-2 font-mono text-gray-700">{p.code}</td><td className="py-1 px-2 text-gray-600">{p.name}<span className="ml-1.5 rounded border border-gray-200 bg-gray-50 px-1 py-px text-[9px] text-gray-400">来自:持仓(旧)</span></td>
                    <td className="py-1 px-2 text-right font-mono">{p.currentPrice > 0 ? fmtNum(p.currentPrice) : '—'}</td>
                    <td className="py-1 px-2 text-right font-mono text-gray-500">{fmtNum(p.entryPrice)}</td>
                    <td className="py-1 px-2 text-right font-mono">{p.quantity}股</td>
                    <td className="py-1 px-2 text-right font-mono">{fmtNum(p.marketValue)}</td>
                    <td className={cn('py-1 px-2 text-right font-mono font-semibold', p.pnlPct >= 0 ? 'text-red-500' : 'text-green-500')}>
                      <div>{p.pnl >= 0 ? '+' : ''}{fmtNum(p.pnl)}</div>
                      <div className="text-[9px]">{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%</div>
                    </td>
                    <td className="py-1 px-2 text-right text-gray-400">{p.weightPct.toFixed(1)}%</td>
                    <td className="py-1 px-2 text-center"><button onClick={() => handleRemoveP(p.code)} className="text-gray-300 hover:text-rose-500"><Trash2 size={12}/></button></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center text-xs text-gray-400">暂无持仓，输入代码/买入价/数量添加</Card>
        )}
      </div>
    </div>
  )
}
