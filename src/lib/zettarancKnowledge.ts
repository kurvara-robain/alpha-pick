// ─────────────────────────────────────────────────────────────
// Zettaranc 知识引用引擎
// 根据触发的信号类型 → 匹配概念页 → 返回规则摘要 + 解读
// ─────────────────────────────────────────────────────────────
import type { ZettarancFactors } from './zettarancFactors'

// ═══════════════════════════════════════════════════════════════
// 信号 → 概念页映射
// ═══════════════════════════════════════════════════════════════

const SIGNAL_KNOWLEDGE_MAP: Record<string, string> = {
  'B1建仓波': 'B1建仓波',
  '超级B1': '超级B1',
  'B2突破': 'B2突破',
  'B3回踩': 'B3买点',
  'SB1假摔': 'SB1假摔战法',
  '双枪战法': '双枪战法',
  '少妇战法': '少妇战法',
  '坑口战法': '坑口战法',
  'S1卖出⚠️': 'S1信号',
  'DSZ死亡之星⚠️': 'DSZ战法',
  '死亡K线⚠️': '十张死亡K线图',
  // 择时
  '多头环境': '活跃市值',
  '空头环境⚠️': '活跃市值',
  // 背离
  'MACD底背离': '顶底背离体系',
  'KDJ底背离': '顶底背离体系',
  'MACD顶背离⚠️': '顶底背离体系',
  'KDJ顶背离⚠️': '顶底背离体系',
}

// ═══════════════════════════════════════════════════════════════
// 引用接口
// ═══════════════════════════════════════════════════════════════

export interface KnowledgeCard {
  conceptName: string
  oneLiner: string
  rules: string[]
  layer: string
}

let knowledgeCache: Record<string, { oneLiner: string; rules: string[]; layer: string }> | null = null

async function loadKnowledge(): Promise<Record<string, { oneLiner: string; rules: string[]; layer: string }>> {
  if (knowledgeCache) return knowledgeCache
  try {
    const resp = await fetch('/data/zettaranc_knowledge.json')
    knowledgeCache = await resp.json()
    return knowledgeCache ?? {}
  } catch {
    return {}
  }
}

/** 给定触发的信号名列表，返回匹配的知识卡片 */
export async function getKnowledgeCards(signals: string[]): Promise<KnowledgeCard[]> {
  const kb = await loadKnowledge()
  const cards: KnowledgeCard[] = []
  const seen = new Set<string>()

  for (const sig of signals) {
    const conceptName = SIGNAL_KNOWLEDGE_MAP[sig]
    if (!conceptName || seen.has(conceptName)) continue
    seen.add(conceptName)

    const entry = kb[conceptName]
    if (entry) {
      cards.push({
        conceptName,
        oneLiner: entry.oneLiner,
        rules: entry.rules,
        layer: entry.layer,
      })
    }
  }
  return cards
}

/** 从完整的 ZettarancFactors 对象中提取已触发的信号 */
export function extractActiveSignals(factors: ZettarancFactors): string[] {
  return factors.matchedStrategies
}

/** 生成 "Z 哥会怎么看" 的自然语言解读 */
export function generateNarrative(factors: ZettarancFactors): string {
  const parts: string[] = []

  // 择时
  if (factors.marketTimingSignal === 1) {
    parts.push('当前多头环境，适合积极操作。')
  } else if (factors.marketTimingSignal === -1) {
    parts.push(`⚠️ 空头环境，活跃市值连续收缩，Z哥建议：宁可空仓等待，不逆势操作。`)
  } else {
    parts.push('震荡市，多看少动。')
  }

  // 买点
  if (factors.isB1Signal) {
    parts.push(`B1 建仓波触发（J=${factors.kdjJ}），需同时满足两个30%原则确认。买入后3天不涨必须走——这是Z哥铁律。`)
  }
  if (factors.isSuperB1) {
    parts.push(`超级B1出现（J=${factors.kdjJ}），日周月多周期共振低位，是主升浪前的终极洗盘信号。`)
  }
  if (factors.isB2Signal) {
    parts.push(`B2 突破确认，放量突破30日高点。注意：B2必须跟在B1后面才有效。`)
  }
  if (factors.isSB1Signal) {
    parts.push(`SB1 假摔信号！B1后假跌破再拉回，主力诱空结束——反手买入窗口。`)
  }
  if (factors.isShaofuCandidate) {
    parts.push(`少妇战法候选：缩量到极致+低位+均线粘合。需确认六步通关秘籍全部满足。`)
  }

  // 卖点
  if (factors.isS1Signal) {
    parts.push(`🚨 S1 卖出信号！高位放量滞涨，宁可信其有。先卖一半锁利，留一半观察。`)
  }
  if (factors.isDSZSignal) {
    parts.push(`🚨 DSZ 死亡之星！高位出现十字星/倒锤头，三条卖出铁律触发。`)
  }
  if (factors.isDeathKline) {
    parts.push(`🚨 十张死亡K线之一触发！保守第一，破位立刻走。`)
  }

  // 背离
  if (factors.kdjDivergence === -1 && factors.macdDivergence === -1) {
    parts.push('⚠️ MACD+KDJ 双顶背离共振，顶部信号强烈。')
  }

  // 风控
  if (factors.riskLevel === '极高') {
    parts.push(`⚠️ 风险极高：连续下跌${factors.consecutiveLossDays}天，20日回撤${factors.maxDrawdown20}%。严格执行四不原则。`)
  }

  if (factors.fourNoViolations.length > 0) {
    parts.push(`违反四不原则：${factors.fourNoViolations.join('、')}。`)
  }

  // 持仓建议
  if (factors.isWeakCut) {
    parts.push('去弱留强触发——浮亏>10%，考虑减仓换马。股票不是爱情，不涨就换。')
  }

  // 三波
  if (factors.wavePhase > 0) {
    const waveNames = ['', '建仓波(最安全)', '拉升波(谨慎追)', '冲刺波(别碰)']
    parts.push(`当前处于三波理论第${factors.wavePhase}波——${waveNames[factors.wavePhase] ?? ''}。`)
  }

  // 心法
  if (factors.divergenceConsensus > 1.5) {
    parts.push('市场分歧度偏高，分歧越大越要冷静。一致看多时警惕，一致看空时找机会。')
  }

  if (parts.length === 0) {
    parts.push('当前无明确信号。Z哥说：一年255个交易日，200天空仓都没关系，只抓看得懂的机会。')
  }

  return parts.join('\n\n')
}

/** 获取指定概念页的知识内容 */
export async function getConceptByName(name: string): Promise<KnowledgeCard | null> {
  const kb = await loadKnowledge()
  const entry = kb[name]
  if (!entry) return null
  return { conceptName: name, ...entry }
}
