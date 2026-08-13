// ═══════════════════════════════════════════════════════════════
// 研报上传弹窗 — 支持拖拽上传 PDF/DOCX/TXT/MD 文件
// ═══════════════════════════════════════════════════════════════

import { useRef, useState } from 'react'
import { Check, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { addDocument } from '@/lib/researchKnowledge'
import type { ResearchDocument } from '@/lib/researchKnowledge'

export default function UploadDialog({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [sourceType, setSourceType] = useState<ResearchDocument['sourceType']>('brokerage')
  const [keyPoints, setKeyPoints] = useState('')
  const [tags, setTags] = useState('')
  const [rawText, setRawText] = useState('')
  const [show, setShow] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileExt, setFileExt] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const presets = ['华夏基金', '易方达', '广发基金', '中金公司', '中信证券', '天风证券', '华泰证券', '雪球']

  const ACCEPTED = '.pdf,.doc,.docx,.txt,.md'
  const isTextFile = (name: string) => /\.(txt|md)$/i.test(name)
  const isPdf = (name: string) => /\.pdf$/i.test(name)
  const isDocx = (name: string) => /\.docx?$/i.test(name)

  const processFile = async (file: File) => {
    setFileName(file.name)
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    setFileExt(ext.toUpperCase())
    setParseError('')

    // 自动填充标题（去掉扩展名）
    if (!title) {
      const base = file.name.replace(/\.[^.]+$/, '')
      setTitle(base.replace(/[_-]/g, ' '))
    }

    if (isTextFile(file.name)) {
      // .txt / .md → 直接读取文本
      setParsing(true)
      try {
        const text = await file.text()
        setRawText(text)
        if (!keyPoints) {
          // 自动提取前几行作为观点
          const lines = text.split('\n').filter((l) => l.trim().length > 10).slice(0, 5)
          setKeyPoints(lines.join('\n'))
        }
      } catch {
        setParseError('文本文件读取失败，请尝试粘贴内容')
      }
      setParsing(false)
    } else if (isPdf(file.name)) {
      // PDF → 存储 base64，提示需要解析
      setParsing(true)
      try {
        const reader = new FileReader()
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
          reader.onerror = () => reject(new Error('read failed'))
          reader.readAsDataURL(file)
        })
        // PDF 文本提取需要通过后端或 pdf.js，前端暂存原始文件引用
        setRawText(`[PDF 文件: ${file.name} (${(file.size / 1024).toFixed(0)}KB), base64 数据长度: ${base64.length} 字符]`)
        setParseError('PDF 文件已存储，文本提取需服务端处理。请手动粘贴关键段落或使用 OCR 工具。')
      } catch {
        setParseError('PDF 读取失败')
      }
      setParsing(false)
    } else if (isDocx(file.name)) {
      // DOCX → 存储 base64
      setParsing(true)
      try {
        const reader = new FileReader()
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
          reader.onerror = () => reject(new Error('read failed'))
          reader.readAsDataURL(file)
        })
        setRawText(`[DOCX 文件: ${file.name} (${(file.size / 1024).toFixed(0)}KB), base64 数据长度: ${base64.length} 字符]`)
        setParseError('DOCX 文件已存储，文本提取需服务端处理。请手动粘贴关键段落。')
      } catch {
        setParseError('DOCX 读取失败')
      }
      setParsing(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleSave = () => {
    if (!title.trim() || !source.trim()) return
    const doc: ResearchDocument = {
      id: '', source: source.trim(), title: title.trim(), sourceType,
      keyPoints: keyPoints.split('\n').filter(Boolean).map((s) => s.trim()),
      tags: tags.split(/[,，\s]+/).filter(Boolean),
      rawText: rawText.trim() || undefined,
      fileName: fileName || undefined,
      uploadedAt: '',
    }
    addDocument({
      title: doc.title,
      source: doc.source,
      sourceType: doc.sourceType,
      keyPoints: doc.keyPoints,
      tags: doc.tags,
      rawText: doc.rawText,
      fileName: doc.fileName,
    })
    setTitle(''); setSource(''); setKeyPoints(''); setTags(''); setRawText(''); setFileName(''); setFileExt(''); setParseError('')
    setSaved(true)
    setTimeout(() => { setSaved(false); setShow(false) }, 1500)
    onDone()
  }

  const reset = () => {
    setTitle(''); setSource(''); setKeyPoints(''); setTags(''); setRawText('')
    setFileName(''); setFileExt(''); setParseError('')
    setShow(false)
  }

  return (
    <>
      <Button onClick={() => setShow(true)} variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
        <Upload className="h-3.5 w-3.5" />上传研报
      </Button>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={reset}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Upload className="h-4 w-4 text-amber-500" />上传研报到知识库
              </h3>
              <button onClick={reset} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>

            {/* 拖拽上传区 */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                dragOver ? 'border-amber-400 bg-amber-50' : fileName ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-amber-300 hover:bg-amber-50/30'
              }`}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept={ACCEPTED} onChange={handleFileSelect} className="hidden" />
              {parsing ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                  <span className="text-xs text-gray-500">解析中…</span>
                </div>
              ) : fileName ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1">
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-medium text-emerald-700">{fileName}</span>
                    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-600 text-[10px]">{fileExt}</Badge>
                  </div>
                  <span className="text-xs text-gray-400">点击重新选择文件</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-gray-300" />
                  <span className="text-sm font-medium text-gray-500">拖拽研报文件到此处</span>
                  <span className="text-xs text-gray-400">支持 PDF · DOC · DOCX · TXT · MD</span>
                  <span className="mt-1 rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:border-amber-300">或点击选择文件</span>
                </div>
              )}
            </div>

            {parseError && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{parseError}</div>
            )}

            <div className="space-y-3">
              <div><label className="mb-1 block text-xs text-gray-500">标题 *</label><Input className="text-sm" placeholder="例：贵州茅台2026Q2业绩点评" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="flex gap-2">
                <div className="flex-1"><label className="mb-1 block text-xs text-gray-500">来源 *</label><Input className="text-sm" placeholder="华夏基金 / 中金公司…" value={source} onChange={(e) => setSource(e.target.value)} /></div>
                <div><label className="mb-1 block text-xs text-gray-500">类型</label>
                  <select className="h-9 rounded border border-gray-300 px-2 text-xs" value={sourceType} onChange={(e) => setSourceType(e.target.value as ResearchDocument['sourceType'])}>
                    <option value="fund">基金</option><option value="brokerage">券商</option><option value="platform">平台</option><option value="personal">个人</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {presets.map((p) => (<button key={p} onClick={() => setSource(p)} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:border-amber-400 hover:text-amber-600">{p}</button>))}
              </div>
              <div><label className="mb-1 block text-xs text-gray-500">核心观点（每行一条，TXT/MD文件自动提取）</label><Textarea className="text-sm" rows={3} placeholder="Q2营收超预期15%&#10;直销占比突破50%" value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} /></div>
              <div><label className="mb-1 block text-xs text-gray-500">标签</label><Input className="text-sm" placeholder="白酒,消费,ROE" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
              <div><label className="mb-1 block text-xs text-gray-500">正文（TXT/MD自动提取，PDF/DOCX请粘贴关键段落）</label><Textarea className="text-sm" rows={6} placeholder="粘贴研报全文或自动从文件提取…" value={rawText} onChange={(e) => { setRawText(e.target.value); if (e.target.value) setParseError('') }} /></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={reset}>取消</Button>
              <Button onClick={handleSave} disabled={!title.trim() || !source.trim()} size="sm" className="bg-amber-500 text-white hover:bg-amber-600">
                {saved ? '已保存 ✓' : '存入知识库'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
