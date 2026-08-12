// ─────────────────────────────────────────────────────────────
// V2.0 Agent Graph 可视化
// 展示多 Agent 研究工作流拓扑：Intent → DSL → Data → Execute →
// Risk → Evidence → Critic → Report → Approve
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  AlertTriangle,
  Workflow,
  Search,
  Shield,
  Layers,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

// ═══════════════════════════════════════════════════════════════
// Agent Graph 节点定义
// ═══════════════════════════════════════════════════════════════

interface AgentNode {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  inputExample: string
  outputExample: string
  color: string
}

const WORKFLOW_NODES: AgentNode[][] = [
  // Layer 1: Intent → DSL
  [
    { id: 'intent', name: '意图识别', icon: BrainCircuit, description: '识别任务类型与用户水平', status: 'completed', inputExample: '用户输入: "找低估值高ROE的股票"', outputExample: '任务类型: 选股 · 难度: 普通', color: 'border-amber-400 bg-amber-50' },
    { id: 'dsl', name: 'DSL 编译', icon: Layers, description: '生成结构化策略，不直接执行', status: 'completed', inputExample: 'NL 输入 + 用户确认', outputExample: 'StrategyDSL v1 (3 filters + 2 signals)', color: 'border-blue-400 bg-blue-50' },
  ],
  // Layer 2: Data → Execute
  [
    { id: 'data', name: '数据检查', icon: Database, description: '确认数据需求、截止时间、覆盖率', status: 'completed', inputExample: 'DSL 数据依赖清单', outputExample: '数据批次 2026-08-08 · 覆盖率 99.9% · 通过门禁', color: 'border-emerald-400 bg-emerald-50' },
    { id: 'quant', name: '因子方案', icon: Activity, description: '提出因子方案与实验设计', status: 'completed', inputExample: '数据批次 + DSL signals', outputExample: '选用因子: low_vol_20d, roe_ttm, mom_20d', color: 'border-violet-400 bg-violet-50' },
    { id: 'execute', name: '执行计算', icon: Workflow, description: '调用选股/回测引擎', status: 'completed', inputExample: '因子截面 + DSL filters', outputExample: '备选池 25 只 · 回测 Sharpe 1.2', color: 'border-cyan-400 bg-cyan-50' },
  ],
  // Layer 3: Risk → Evidence → Critic
  [
    { id: 'risk', name: '风险检查', icon: Shield, description: '暴露、容量、流动性、异常收益', status: 'completed', inputExample: '组合权重表', outputExample: '行业集中度 35% · 单票上限 8% · VaR 2.3%', color: 'border-orange-400 bg-orange-50' },
    { id: 'evidence', name: '证据检索', icon: Search, description: '财报、公告、研报、产业数据', status: 'pending', inputExample: '股票池 25 只代码', outputExample: '[华夏基金] Q2 白酒营收超预期 · [公告] 贵州茅台直销占比突破50%', color: 'border-pink-400 bg-pink-50' },
    { id: 'critic', name: '批判审查', icon: XCircle, description: '寻找前视偏差、过拟合、矛盾证据', status: 'pending', inputExample: '回测结果 + 证据清单', outputExample: '⚠ 回测区间包含未来财报 · ⚠ ROE 因子高度依赖医药行业', color: 'border-rose-400 bg-rose-50' },
  ],
  // Layer 4: Report → Approve
  [
    { id: 'report', name: '报告生成', icon: FileText, description: '基于结构化结果与引用生成报告', status: 'pending', inputExample: '全部节点输出', outputExample: '投研报告 (含 8 项引用, 5 项风险, 置信度 B)', color: 'border-indigo-400 bg-indigo-50' },
    { id: 'approve', name: '人工审批', icon: CheckCircle2, description: '用户确认/修改/驳回', status: 'pending', inputExample: '完整报告', outputExample: '✓ 已确认 · 保存至研究记录', color: 'border-teal-400 bg-teal-50' },
  ],
]

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2,
  running: Clock,
  pending: Clock,
  failed: AlertTriangle,
}

const statusColors: Record<string, string> = {
  completed: 'text-emerald-500',
  running: 'text-amber-500 animate-pulse',
  pending: 'text-gray-300',
  failed: 'text-rose-500',
}

// ═══════════════════════════════════════════════════════════════
// 单节点渲染
// ═══════════════════════════════════════════════════════════════

function GraphNode({ node, selected, onClick }: { node: AgentNode; selected: boolean; onClick: () => void }) {
  const StatusIcon = statusIcons[node.status]
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all w-[150px] ${
        node.color
      } ${selected ? 'ring-2 ring-amber-400 scale-105' : 'hover:scale-102'}`}
    >
      <node.icon className="h-5 w-5" />
      <span className="text-xs font-semibold text-gray-800">{node.name}</span>
      <StatusIcon className={`h-3.5 w-3.5 ${statusColors[node.status]}`} />
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default function AgentGraph() {
  const [selectedNode, setSelectedNode] = useState<AgentNode | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-amber-300 transition-colors"
      >
        <Workflow className="h-5 w-5 text-amber-500" />
        <div>
          <div className="text-sm font-semibold text-gray-900">Agent Graph 研究流水线</div>
          <div className="text-xs text-gray-400">10 节点 · 4 阶段 · 展开查看拓扑</div>
        </div>
        <Badge variant="outline" className="ml-auto border-gray-200 text-gray-400">V2.0</Badge>
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Workflow className="h-4 w-4 text-amber-500" />Agent Graph 研究流水线
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">节点: {WORKFLOW_NODES.flat().length} · 阶段: {WORKFLOW_NODES.length}</span>
          <button onClick={() => setExpanded(false)} className="text-xs text-gray-400 hover:text-gray-600">收起</button>
        </div>
      </div>

      {/* 图拓扑 */}
      <div className="space-y-6">
        {WORKFLOW_NODES.map((layer, layerIdx) => (
          <div key={layerIdx}>
            <div className="mb-2 text-[10px] font-medium uppercase text-gray-400">
              阶段 {layerIdx + 1}: {layerIdx === 0 ? '意图→策略' : layerIdx === 1 ? '数据→执行' : layerIdx === 2 ? '验证→审查' : '输出→审批'}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {layer.map((node, nodeIdx) => (
                <span key={node.id} className="flex items-center gap-2">
                  <GraphNode
                    node={node}
                    selected={selectedNode?.id === node.id}
                    onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                  />
                  {nodeIdx < layer.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-gray-300 shrink-0" />
                  )}
                </span>
              ))}
            </div>
            {layerIdx < WORKFLOW_NODES.length - 1 && (
              <div className="my-3 flex justify-center">
                <ArrowRight className="h-5 w-5 rotate-90 text-gray-200" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 选中节点详情 */}
      {selectedNode && (
        <div className={`mt-4 rounded-lg border-2 p-4 ${selectedNode.color}`}>
          <div className="flex items-center gap-2 mb-2">
            <selectedNode.icon className="h-5 w-5" />
            <span className="font-semibold text-gray-900">{selectedNode.name}</span>
            <Badge variant="outline" className={selectedNode.status === 'completed' ? 'border-emerald-300 text-emerald-600' : selectedNode.status === 'running' ? 'border-amber-300 text-amber-600' : 'border-gray-300 text-gray-400'}>
              {selectedNode.status === 'completed' ? '已完成' : selectedNode.status === 'running' ? '运行中' : selectedNode.status === 'failed' ? '失败' : '等待'}
            </Badge>
          </div>
          <p className="text-xs text-gray-600 mb-3">{selectedNode.description}</p>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded bg-white/60 p-2">
              <span className="font-medium text-gray-500">输入:</span>
              <span className="ml-1 text-gray-700">{selectedNode.inputExample}</span>
            </div>
            <div className="rounded bg-white/60 p-2">
              <span className="font-medium text-gray-500">输出:</span>
              <span className="ml-1 text-gray-700">{selectedNode.outputExample}</span>
            </div>
          </div>
        </div>
      )}

      {/* 图执行能力说明 */}
      <div className="mt-4 rounded border border-gray-100 bg-gray-50 p-3 text-[10px] text-gray-500 space-y-1">
        <div className="font-medium text-gray-600 mb-1">Runtime 能力（规划中）:</div>
        <div>✓ 幂等节点 · ✓ 检查点与断点续跑 · ✓ 超时/重试/熔断</div>
        <div>✓ 人工确认节点 · ✓ 指定节点重放 · ✓ 全链路日志</div>
        <div>✓ 确定性 Fake Tool/Fake Model 测试模式</div>
      </div>
    </div>
  )
}
