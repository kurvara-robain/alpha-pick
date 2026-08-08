import { lazy, Suspense } from 'react'

/** 策略调试器（V1.5） */
export const StrategyDebugger = lazy(() => import('./StrategyDebugger'))

/** 因子诊断仪表盘（V1.5） */
export const FactorDiagnostics = lazy(() => import('./FactorDiagnostics'))

/** 组合风险分析（V1.5） */
export const PortfolioRisk = lazy(() => import('./PortfolioRisk'))

/** Agent Graph 流水线（V2.0） */
export const AgentGraph = lazy(() => import('./AgentGraph'))

/** DSL 可视化编辑器（V1.5） */
export const DSLEditor = lazy(() => import('./DSLEditor'))
export function LazyLoader({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
        加载中…
      </div>
    }>
      {children}
    </Suspense>
  )
}
