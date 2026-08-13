import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { BrainCircuit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'

interface NavGroup {
  label: string
  items: { to: string; label: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '市场',
    items: [
      { to: '/market', label: '市场全览' },
    ],
  },
  {
    label: '选股',
    items: [
      { to: '/strategies', label: '策略池' },
      { to: '/factors', label: '因子实验室' },
      { to: '/workbench', label: '组合工作台' },
      { to: '/watchlist', label: '备选清单' },
      { to: '/zettaranc', label: '知行体系' },
    ],
  },
  {
    label: '研究',
    items: [
      { to: '/research', label: '个股投研' },
      { to: '/backtest', label: '回测分析' },
      { to: '/pit', label: '时间旅行' },
      { to: '/reports', label: '研究报告' },
    ],
  },
  {
    label: '交易',
    items: [
      { to: '/simtrade', label: '模拟交易' },
      { to: '/holdings', label: '持仓诊股' },
    ],
  },
  {
    label: '我的',
    items: [
      { to: '/my-stocks', label: '自选与持仓' },
    ],
  },
]

export default function Layout() {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const menuRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const menuItemRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const { pathname } = useLocation()

  // 分页标题
  const pageTitle = useMemo(() => {
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        if (item.to === pathname || pathname.startsWith(item.to + '/')) {
          return `${item.label}｜AlphaMind 量化投研`
        }
      }
    }
    if (pathname === '/') return 'AlphaMind 量化投研'
    return 'AlphaMind 量化投研'
  }, [pathname])
  useEffect(() => { document.title = pageTitle }, [pageTitle])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    if (openGroup) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openGroup])

  // 菜单键盘导航
  const handleButtonKeyDown = (e: React.KeyboardEvent, label: string) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      setOpenGroup(label)
      // 聚焦首个菜单项
      setTimeout(() => {
        const firstKey = `${label}-0`
        menuItemRefs.current[firstKey]?.focus()
      }, 0)
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent, label: string, itemIndex: number, items: NavGroup['items']) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpenGroup(null)
      menuRefs.current[label]?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const nextIndex = ((itemIndex + delta) % items.length + items.length) % items.length
      menuItemRefs.current[`${label}-${nextIndex}`]?.focus()
    }
    if (e.key === 'Home') {
      e.preventDefault()
      menuItemRefs.current[`${label}-0`]?.focus()
    }
    if (e.key === 'End') {
      e.preventDefault()
      menuItemRefs.current[`${label}-${items.length - 1}`]?.focus()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
      <header className="sticky top-0 z-40 border-b border-gray-700 bg-[#1A1A2E]">
        <div className="mx-auto flex h-11 max-w-7xl items-center gap-0 px-4">
          {/* Brand */}
          <Link to="/" className="mr-3 flex shrink-0 items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-amber-500">
              <BrainCircuit size={14} className="text-[#1A1A2E]" />
            </span>
            <span className="text-sm font-bold tracking-wide text-white">
              AlphaMind<span className="ml-1 text-amber-500">量化投研</span>
            </span>
          </Link>

          {/* Navigation groups */}
          <nav ref={navRef} className="flex h-full items-center">
            {NAV_GROUPS.map((group) => {
              const isOpen = openGroup === group.label
              return (
                <div key={group.label} className="relative h-full">
                  {group.items.length === 1 ? (
                    <NavLink
                      to={group.items[0].to}
                      className={({ isActive }) =>
                        cn(
                          'flex h-full items-center gap-1 rounded-t-sm px-3 text-xs font-medium transition-colors',
                          isActive
                            ? 'border-b-2 border-amber-500 bg-white/10 text-amber-400'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                        )
                      }
                    >
                      {group.label}
                    </NavLink>
                  ) : (
                    <>
                      <button
                        className={cn(
                          'flex h-full items-center gap-1 rounded-t-sm px-3 text-xs font-medium transition-colors',
                          isOpen
                            ? 'border-b-2 border-amber-500 bg-white/10 text-amber-400'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                        )}
                        onClick={() => setOpenGroup(isOpen ? null : group.label)}
                        onKeyDown={(e) => handleButtonKeyDown(e, group.label)}
                        ref={(el) => { menuRefs.current[group.label] = el }}
                        aria-haspopup="menu"
                        aria-expanded={isOpen}
                      >
                        {group.label}
                        <svg className={cn('h-3 w-3 opacity-50 transition-transform', isOpen && 'rotate-180')} viewBox="0 0 10 6"><path d="M0 0l5 6 5-6z" fill="currentColor" /></svg>
                      </button>
                      {isOpen && (
                        <div className="absolute left-0 top-full min-w-[140px] rounded-b border border-t-0 border-gray-600 bg-[#1A1A2E] py-1 shadow-xl" role="menu">
                          {group.items.map((item, idx) => (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              onClick={() => setOpenGroup(null)}
                              onKeyDown={(e) => handleMenuKeyDown(e, group.label, idx, group.items)}
                              ref={(el) => { menuItemRefs.current[`${group.label}-${idx}`] = el }}
                              role="menuitem"
                              className={({ isActive }) =>
                                cn(
                                  'block px-3 py-1.5 text-xs transition-colors',
                                  isActive
                                    ? 'bg-amber-500/15 text-amber-400 font-medium'
                                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                                )
                              }
                            >
                              {item.label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </nav>

          {/* Right side */}
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
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> 行情:实时</span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> 因子/信号/回测:模型估算</span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-300" /> 评分/建议:演示参考</span>
        </span>
        <span className="ml-3 text-gray-300">不构成投资建议</span>
      </footer>

      <Toaster richColors position="top-center" />
    </div>
  )
}
