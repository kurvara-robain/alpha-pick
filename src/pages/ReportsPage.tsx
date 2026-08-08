// P8 研究报告：每日自动生成的晨报/复盘报告（生成、展示、历史存档）
import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  Newspaper,
  NotebookPen,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getDB, subscribeDB, updateDB } from '@/lib/store'
import { generateReport } from '@/lib/api'
import type { DailyReport } from '@/lib/types'

function useDB() {
  return useSyncExternalStore(subscribeDB, getDB)
}

function todayStr(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function Section({
  icon,
  title,
  tone = 'default',
  children,
}: {
  icon: React.ReactNode
  title: string
  tone?: 'default' | 'danger'
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-gray-200 pt-5">
      <h3
        className={`mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide ${
          tone === 'danger' ? 'text-rose-400' : 'text-amber-500'
        }`}
      >
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function ReportView({ report }: { report: DailyReport }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 md:p-8">
      {/* 报头 */}
      <header className="pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-amber-500" />
              <h2 className="text-xl font-bold text-gray-900 md:text-2xl">AlphaMind 每日研究报告</h2>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-400">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">{report.date}</span> · 晨报 / 盘后复盘
            </p>
          </div>
          <Badge variant="outline" className="border-cyan-500/30 bg-amber-100 text-amber-500">
            系统自动生成
          </Badge>
        </div>
      </header>

      <div className="space-y-6">
        {/* 市场概览 */}
        <Section icon={<ClipboardList className="h-4 w-4" />} title="一、当日市场概览">
          <p className="text-sm leading-7 text-gray-700">{report.marketSummary}</p>
        </Section>

        {/* 策略信号变化 */}
        <Section icon={<Sparkles className="h-4 w-4" />} title="二、策略信号变化">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <ArrowUpRight className="h-3.5 w-3.5" />
                新入选
              </div>
              <ul className="mt-2 space-y-1.5">
                {report.signalChanges.added.map((s, i) => (
                  <li key={i} className="text-sm leading-relaxed text-gray-700">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-400">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                剔除
              </div>
              <ul className="mt-2 space-y-1.5">
                {report.signalChanges.removed.map((s, i) => (
                  <li key={i} className="text-sm leading-relaxed text-gray-700">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">{report.signalChanges.note}</p>
        </Section>

        {/* 推荐股票名单 */}
        <Section icon={<FileText className="h-4 w-4" />} title="三、当日推荐股票名单">
          <div className="space-y-2.5">
            {report.recommendations.map((r, i) => (
              <div
                key={r.code}
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3.5 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="flex shrink-0 items-center gap-2.5 sm:w-44">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 font-mono text-xs font-semibold text-amber-500">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{r.name}</div>
                    <div className="font-mono text-[11px] text-gray-400">{r.code}</div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-gray-700">
                  <span className="mr-1.5 rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                    入选逻辑
                  </span>
                  {r.logic}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* 持仓提示 */}
        <Section icon={<Wallet className="h-4 w-4" />} title="四、持仓提示">
          <ul className="space-y-1.5">
            {report.holdingNotes.map((n, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/70" />
                {n}
              </li>
            ))}
          </ul>
        </Section>

        {/* 风险提示 */}
        <Section icon={<AlertTriangle className="h-4 w-4" />} title="五、风险提示" tone="danger">
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3.5">
            <ul className="space-y-1.5">
              {report.risks.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-rose-200/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </article>
  )
}

export default function ReportsPage() {
  const db = useDB()
  const today = todayStr()
  const sorted = useMemo(
    () => [...db.reports].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [db.reports],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')

  const todayReport = sorted.find((r) => r.date === today)
  const current =
    (selectedId ? sorted.find((r) => r.id === selectedId) : undefined) ?? sorted[0] ?? null

  const onGenerate = async () => {
    setNotice('')
    if (todayReport) {
      setSelectedId(todayReport.id)
      setNotice(`今日（${today}）研报已生成，已为您切换到该报告。`)
      return
    }
    setLoading(true)
    try {
      const report = await generateReport(today)
      updateDB((d) => {
        d.reports.push(report)
      })
      setSelectedId(report.id)
    } catch (e) {
      setNotice(e instanceof Error ? `研报生成失败：${e.message}` : '研报生成失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* 顶部操作区 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 md:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <NotebookPen className="h-4 w-4 text-amber-500" />
            每日研究报告
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            每日自动生成晨报 / 复盘报告，汇总市场概览、策略信号、推荐名单与持仓提示
          </p>
        </div>
        <Button
          onClick={onGenerate}
          disabled={loading}
          className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-4 w-4" />
          )}
          {loading ? '汇总各模块数据中…' : todayReport ? '查看今日研报' : '生成今日研报'}
        </Button>
      </div>
      {notice && (
        <div className="rounded-lg border border-cyan-500/30 bg-amber-100 px-4 py-2.5 text-sm text-amber-500">
          {notice}
        </div>
      )}

      {/* 报告正文 / 空状态 */}
      {current ? (
        <ReportView report={current} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/40 p-12 text-center">
          <Newspaper className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-4 text-sm font-medium text-gray-700">还没有任何研究报告</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-gray-400">
            点击上方「生成今日研报」，系统将汇总市场概览、策略信号、备选清单与持仓数据，生成当日的晨报 / 复盘报告。
          </p>
          <Button
            onClick={onGenerate}
            disabled={loading}
            className="mt-5 bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {loading ? '汇总各模块数据中…' : '立即生成'}
          </Button>
        </div>
      )}

      {/* 历史存档 */}
      {sorted.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <CalendarDays className="h-4 w-4 text-amber-500" />
            历史存档
            <span className="font-mono text-xs font-normal text-gray-400">
              共 {sorted.length} 份
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {sorted.map((r) => {
              const active = current?.id === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedId(r.id)
                    setNotice('')
                  }}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-cyan-500/50 bg-amber-100'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-400'
                  }`}
                >
                  <div
                    className={`font-mono text-sm tabular-nums ${
                      active ? 'text-amber-500' : 'text-gray-700'
                    }`}
                  >
                    {r.date}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                    {r.date === today && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 px-1 py-0 text-[10px] text-emerald-400"
                      >
                        今日
                      </Badge>
                    )}
                    推荐 {r.recommendations.length} 只
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
