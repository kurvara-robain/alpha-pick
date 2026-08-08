import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import Layout from './components/Layout'
import { mergeCollectedFactors } from './lib/store'
import MarketPage from './pages/MarketPage'
import StrategiesPage from './pages/StrategiesPage'
import FactorsPage from './pages/FactorsPage'
import WorkbenchPage from './pages/WorkbenchPage'
import WatchlistPage from './pages/WatchlistPage'
import BacktestPage from './pages/BacktestPage'
import HoldingsPage from './pages/HoldingsPage'
import ReportsPage from './pages/ReportsPage'

export default function App() {
  // 应用初始化时合并联网收集因子进因子库（幂等、只追加；有变更时派发事件驱动页面刷新）
  useEffect(() => {
    void mergeCollectedFactors()
  }, [])

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/market" replace />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/factors" element={<FactorsPage />} />
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/holdings" element={<HoldingsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/market" replace />} />
      </Route>
    </Routes>
  )
}
