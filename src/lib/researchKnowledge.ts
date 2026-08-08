// ─────────────────────────────────────────────────────────────
// 投研知识库 — 上传研报存储 + 检索
// localStorage 持久化，key = alphamind_research_library_v1
// ─────────────────────────────────────────────────────────────

export interface ResearchDocument {
  id: string
  title: string
  source: string // "华夏基金" / "中金公司" / "雪球" / 用户自定义
  sourceType: 'fund' | 'brokerage' | 'platform' | 'personal'
  keyPoints: string[] // 核心观点摘要
  tags: string[] // 标签：行业/风格/方法论
  rawText?: string // 原始文本（手动粘贴或OCR提取）
  fileName?: string // 上传文件名
  uploadedAt: string
}

export interface KnowledgeBase {
  documents: ResearchDocument[]
  version: number
}

const KEY = 'alphamind_research_library_v1'

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getKB(): KnowledgeBase {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as KnowledgeBase
  } catch { /* fallthrough */ }
  return { documents: [], version: 1 }
}

function saveKB(kb: KnowledgeBase): void {
  localStorage.setItem(KEY, JSON.stringify(kb))
}

export function addDocument(doc: Omit<ResearchDocument, 'id' | 'uploadedAt'>): ResearchDocument {
  const kb = getKB()
  const full: ResearchDocument = { ...doc, id: uid(), uploadedAt: new Date().toISOString() }
  kb.documents.push(full)
  saveKB(kb)
  return full
}

export function removeDocument(id: string): void {
  const kb = getKB()
  kb.documents = kb.documents.filter((d) => d.id !== id)
  saveKB(kb)
}

export function listDocuments(): ResearchDocument[] {
  return getKB().documents
}

/** 按关键词检索研报（标题+标签+观点全文） */
export function searchDocuments(query: string): ResearchDocument[] {
  const q = query.toLowerCase()
  return getKB().documents.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      d.source.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q)) ||
      d.keyPoints.some((p) => p.toLowerCase().includes(q)),
  )
}

/** 获取知识库摘要（用于投研上下文） */
export function getKnowledgeContext(): string {
  const docs = getKB().documents
  if (docs.length === 0) return ''
  const lines = docs.slice(0, 10).map((d) => `[${d.source}] ${d.title}: ${d.keyPoints.slice(0, 3).join('；')}`)
  return `投研知识库（共${docs.length}篇）：\n${lines.join('\n')}`
}
