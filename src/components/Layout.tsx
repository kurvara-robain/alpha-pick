import { Link, NavLink, Outlet } from 'react-router'
import {
  BarChart3,
  BrainCircuit,
  Clock,
  FlaskConical,
  Gauge,
  LayoutList,
  LineChart,
  Newspaper,
  SlidersHorizontal,
  Wallet,
  FileSearch,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'

export const NAV_ITEMS = [
  { to: '/market', label: '市场全览', icon: Gauge },
  { to: '/strategies', label: '策略池', icon: LayoutList },
  { to: '/factors', label: '因子实验室', icon: FlaskConical },
  { to: '/workbench', label: '组合工作台', icon: SlidersHorizontal },
  { to: '/watchlist', label: '备选清单', icon: LineChart },
  { to: '/backtest', label: '回测分析', icon: BarChart3 },
  { to: '/holdings', label: '持仓诊股', icon: Wallet },
  { to: '/reports', label: '研究报告', icon: Newspaper },
  { to: '/research', label: '个股投研', icon: FileSearch },
  { to: '/simtrade', label: '模拟交易', icon: TrendingUp },
  { to: '/pit', label: '时间旅行', icon: Clock },
] as const

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
      {/* Bloomberg-style top navigation bar */}
      <header className="sticky top-0 z-40 border-b border-gray-700 bg-[#1A1A2E]">
        <div className="mx-auto flex h-11 max-w-7xl items-center gap-1 px-4">
          {/* Brand */}
          <Link to="/" className="mr-4 flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-amber-500">
              <BrainCircuit size={14} className="text-[#1A1A2E]" />
            </span>
            <span className="text-sm font-bold tracking-wide text-white">
              AlphaMind<span className="ml-1 text-amber-500">量化选股</span>
            </span>
          </Link>

          {/* Navigation links */}
          <nav className="flex h-full items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 rounded-t-sm px-3 py-2 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-b-2 border-amber-500 bg-white/10 text-amber-400'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right side placeholder */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] text-gray-500">
              {new Date().toLocaleDateString('zh-CN', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <Outlet />
      </main>

      {/* Disclaimer footer */}
      <footer className="border-t border-gray-200 bg-white py-2 text-center text-[10px] text-gray-400">
        行情为真实数据；评分、信号与回测为演示模型输出，不构成投资建议
      </footer>

      <Toaster richColors position="top-center" />
    </div>
  )
}
