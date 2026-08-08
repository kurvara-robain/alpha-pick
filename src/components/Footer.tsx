import { BrainCircuit, ShieldAlert } from 'lucide-react'

export default function Footer() {
  return (
    <footer id="about" className="mt-16 border-t border-gray-200 bg-gray-100">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600">
                <BrainCircuit size={15} className="text-white" />
              </span>
              <span className="text-sm font-bold text-gray-900">
                AlphaMind <span className="text-amber-500">AI 选股</span>
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              基于 React + TypeScript + Tailwind CSS + shadcn/ui + Recharts 构建的
              AI 选股系统演示站点。六大因子模型、全市场扫描、组合回测一应俱全。
            </p>
          </div>

          <div className="max-w-md rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              免责声明
            </div>
            <p className="mt-2 text-xs leading-relaxed text-amber-200/60">
              行情数据来源于腾讯财经公开行情接口（真实数据，可能有延迟）；
              AI 评分、信号、胜率与回测结果均为演示模型输出，不构成任何投资建议。
              市场有风险，投资需谨慎。
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-gray-200/60 pt-4 text-center text-[11px] text-gray-300">
          AlphaMind AI 选股 · Demo · 行情为真实数据，评分为演示模型输出，不构成投资建议
        </div>
      </div>
    </footer>
  )
}
