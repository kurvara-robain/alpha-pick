// ─────────────────────────────────────────────────────────────
// 数据源面板 — 管理 API 连接（Tushare/AkShare 为数据源，非券商）+ 同步持仓
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { Database, Link2, RefreshCw, Settings, Upload, Check, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getBrokerStatus, syncBrokerAccount, saveBrokerConfig, importBrokerToHoldings } from '@/lib/brokerClient'
import type { BrokerConfig, BrokerAccount } from '@/lib/brokerClient'

export default function BrokerPanel() {
  const [brokers, setBrokers] = useState<BrokerConfig[]>([])
  const [syncing, setSyncing] = useState('')
  const [importing, setImporting] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [token, setToken] = useState('')
  const [syncResult, setSyncResult] = useState<{ broker: string; success: boolean; message: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const status = await getBrokerStatus()
      setBrokers(status)
    } catch { /* offline */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSync = async (type: string) => {
    setSyncing(type)
    setSyncResult(null)
    try {
      const account = await syncBrokerAccount(type as any)
      setSyncResult({ broker: type, success: true, message: `同步完成: ${account.positions.length} 只持仓` })
      if (account.positions.length > 0) {
        setImporting(true)
        importBrokerToHoldings(account)
        setSyncResult({ broker: type, success: true, message: `已导入 ${account.positions.length} 只股票到持仓` })
        setTimeout(() => setImporting(false), 1500)
      }
    } catch (e) {
      setSyncResult({ broker: type, success: false, message: e instanceof Error ? e.message : '同步失败' })
    }
    setSyncing('')
  }

  const handleSaveConfig = async () => {
    if (!token.trim()) return
    await saveBrokerConfig({ type: 'tushare', token: token.trim() })
    await refresh()
    setShowConfig(false)
    setToken('')
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Link2 className="h-4 w-4 text-amber-500" />数据源（Tushare/AkShare）
        </h3>
        <Button onClick={() => setShowConfig(!showConfig)} variant="outline" size="sm" className="text-xs">
          <Settings className="h-3 w-3 mr-1" />
          {showConfig ? '关闭' : '配置'}
        </Button>
      </div>

      {/* 配置面板 */}
      {showConfig && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 text-xs font-medium text-amber-800">Tushare Pro 配置</div>
          <div className="flex gap-2">
            <Input className="text-xs flex-1" type="password" placeholder="输入 Tushare Token"
              value={token} onChange={(e) => setToken(e.target.value)} />
            <Button onClick={handleSaveConfig} size="sm" className="bg-amber-500 text-white text-xs hover:bg-amber-600">保存</Button>
          </div>
          <div className="mt-1 text-[10px] text-amber-600">
            Token 仅存储在本地服务器，不会上传到浏览器。获取: tushare.pro → 个人主页 → 接口TOKEN
          </div>
        </div>
      )}

      {/* 券商列表 */}
      <div className="space-y-2">
        {brokers.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 py-4 text-center text-xs text-gray-400">
            点击「配置」添加数据源连接
          </div>
        ) : (
          brokers.map((b) => (
            <div key={b.type} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <Database className={`h-3.5 w-3.5 ${b.enabled ? 'text-emerald-500' : 'text-gray-300'}`} />
                <div>
                  <span className="text-sm font-medium text-gray-900">{b.name}</span>
                  {b.lastSyncAt && (
                    <span className="ml-2 text-[10px] text-gray-400">
                      上次: {new Date(b.lastSyncAt).toLocaleString('zh-CN')}
                    </span>
                  )}
                </div>
                <Badge variant="outline" className={b.enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-600 text-[10px]' : 'border-gray-300 bg-gray-50 text-gray-400 text-[10px]'}>
                  {b.enabled ? '已配置' : '未配置'}
                </Badge>
                {b.error && (
                  <span className="text-[10px] text-rose-500">{b.error}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {b.enabled && (
                  <Button onClick={() => handleSync(b.type)} disabled={syncing === b.type}
                    variant="outline" size="sm" className="text-xs gap-1">
                    {syncing === b.type ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : importing && b.type === syncResult?.broker ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {syncing === b.type ? '同步中' : importing && b.type === syncResult?.broker ? '已导入' : '同步'}
                  </Button>
                )}
                {b.type === 'manual' && (
                  <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">
                    <Upload className="h-3 w-3 mr-0.5" />CSV
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 同步结果 */}
      {syncResult && (
        <div className={`mt-3 rounded p-2 text-xs ${syncResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {syncResult.success ? <Check className="inline h-3 w-3 mr-1" /> : <AlertTriangle className="inline h-3 w-3 mr-1" />}
          {syncResult.message}
        </div>
      )}
    </div>
  )
}
