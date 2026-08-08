import { BrainCircuit } from 'lucide-react'

const NAV_ITEMS = [
  { label: '选股榜单', href: '#ranking' },
  { label: '因子筛选', href: '#screener' },
  { label: '组合回测', href: '#backtest' },
  { label: '关于', href: '#about' },
]

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_18px_rgba(245,158,11,0.35)]">
            <BrainCircuit className="h-4.5 w-4.5 text-white" size={18} />
          </span>
          <span className="text-base font-bold tracking-wide text-gray-900">
            AlphaMind <span className="text-amber-500">AI 选股</span>
          </span>
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-gray-500 transition-colors hover:text-amber-500"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-emerald-300">AI 引擎运行中</span>
        </div>
      </div>
    </header>
  )
}
