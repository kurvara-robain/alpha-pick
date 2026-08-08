// ─────────────────────────────────────────────────────────────
// 券商 CSV 导入器 — 拖拽上传持仓/成交记录 CSV
// ─────────────────────────────────────────────────────────────
import { useState, useRef } from 'react'
import { Upload, FileText, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { importCSV } from '@/lib/taskClient'

interface CSVImportProps {
  onImported: (data: { headers: string[]; rows: Record<string, string>[] }) => void
}

export default function CSVImport({ onImported }: CSVImportProps) {
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = async (f: File) => {
    setFile(f)
    setError('')
    setParsing(true)
    try {
      const text = await f.text()
      const result = await importCSV(text)
      if (result.result && typeof result.result === 'object') {
        const r = result.result as { headers?: string[]; normalized?: Record<string, string>[] }
        if (r.headers && r.normalized) {
          setPreview({ headers: r.headers, rows: r.normalized })
        } else {
          setError('CSV 格式无法识别，请确保包含代码/名称/持仓等列')
        }
      } else {
        setError('解析失败')
      }
    } catch {
      setError('文件读取失败')
    }
    setParsing(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) processFile(f)
    else setError('仅支持 .csv 文件')
  }

  const handleConfirm = () => {
    if (preview) {
      onImported({ headers: preview.headers, rows: preview.rows })
      setPreview(null)
      setFile(null)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Upload className="h-4 w-4 text-amber-500" />导入券商数据
      </h3>
      <p className="mb-3 text-xs text-gray-400">
        从券商 APP 导出持仓/成交记录 CSV，拖入此处自动解析。支持同花顺/东方财富/华泰等格式。
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
          dragOver ? 'border-amber-400 bg-amber-50' : preview ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 hover:border-amber-300'
        }`}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        {parsing ? (
          <span className="text-xs text-gray-500">解析中…</span>
        ) : preview ? (
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-700">{file?.name}</span>
            <Badge variant="outline" className="border-emerald-300 text-emerald-600">{preview.rows.length} 行</Badge>
          </div>
        ) : (
          <>
            <FileText className="h-8 w-8 text-gray-300" />
            <span className="text-sm text-gray-500">拖拽 CSV 文件到此处</span>
            <span className="text-xs text-gray-400">或点击选择文件</span>
          </>
        )}
      </div>

      {error && <div className="mt-2 rounded bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{error}</div>}

      {preview && (
        <div className="mt-3">
          <div className="mb-2 text-xs font-medium text-gray-500">
            预览（前 5 行）— 列：{preview.headers.slice(0, 6).join(', ')}
          </div>
          <div className="max-h-40 overflow-auto rounded border border-gray-200">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  {preview.headers.slice(0, 6).map((h) => (
                    <th key={h} className="px-2 py-1 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {preview.headers.slice(0, 6).map((h) => (
                      <td key={h} className="px-2 py-1 text-gray-700">{row[h] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={handleConfirm} size="sm" className="bg-amber-500 text-white text-xs hover:bg-amber-600">
              <Check className="h-3 w-3 mr-1" />确认导入
            </Button>
            <Button onClick={() => { setPreview(null); setFile(null) }} variant="outline" size="sm" className="text-xs">
              <X className="h-3 w-3 mr-1" />取消
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
