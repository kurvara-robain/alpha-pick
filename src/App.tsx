import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { mergeCollectedFactors } from './lib/store'
import MarketPage from './pages/MarketPage'
import HomePage from './pages/HomePage'
import StrategiesPage from './pages/StrategiesPage'
import FactorsPage from './pages/FactorsPage'
import WorkbenchPage from './pages/WorkbenchPage'
import WatchlistPage from './pages/WatchlistPage'
import BacktestPage from './pages/BacktestPage'
import HoldingsPage from './pages/HoldingsPage'
import ReportsPage from './pages/ReportsPage'
import ResearchPage from './pages/ResearchPage'
import SimTradePage from './pages/SimTradePage'
import PITPage from './pages/PITPage'

export default function App() {
  useEffect(() => { void mergeCollectedFactors() }, [])

  return (
    <ErrorBoundary>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/factors" element={<FactorsPage />} />
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/holdings" element={<HoldingsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/simtrade" element={<SimTradePage />} />
        <Route path="/pit" element={<PITPage />} />
        <Route path="*" element={<Navigate to="/market" replace />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  )
}
