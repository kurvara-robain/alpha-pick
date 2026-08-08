// 异步数据加载 / 错误状态的通用展示块
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function LoadingBlock({ text = '数据加载中…' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white py-20">
      <Spinner className="size-6 text-amber-500" />
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  )
}

export function ErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 py-16 text-center">
      <p className="max-w-md text-sm leading-relaxed text-rose-600">{error}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
      >
        <RefreshCw className="size-3.5" />
        重试
      </Button>
    </div>
  )
}
