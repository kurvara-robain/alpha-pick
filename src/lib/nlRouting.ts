// ─────────────────────────────────────────────────────────────
// NL 路由与日期辅助（纯函数，独立文件避免 react-refresh 限制）
// ─────────────────────────────────────────────────────────────

/**
 * 搜索意图 → 目标路由（纯函数，供测试直接验证）。
 * V2：选股/策略/因子/回测类查询进入 ExperimentRun 主链接线
 * （HomePage 会先 createDraftRun 再携带 runId 跳转）；持仓/板块等
 * 非筛选类查询走原路由，不创建 Run。
 */
export function searchRoute(query: string): string {
  const lower = query.toLowerCase()
  if (lower.includes('持仓')) return '/holdings'
  if (lower.includes('因子')) return '/factors'
  if (lower.includes('策略') || lower.includes('回测')) return '/strategies'
  if (lower.includes('板块')) return '/market'
  return '/workbench'
}

/** 研究基准日期（asOfDate）：本地当日（数据快照合同由 PIT 层负责） */
export function todayAsOfDate(): string {
  return new Date().toISOString().slice(0, 10)
}
