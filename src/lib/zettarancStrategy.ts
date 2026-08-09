// ─────────────────────────────────────────────────────────────
// Zettaranc 知行体系 — 第 7 套投研框架 + 4 套策略 DSL
// ─────────────────────────────────────────────────────────────

import type { ResearchFramework } from './researchTypes'
import type { StrategyDSL } from './strategyDSL'

// ═══════════════════════════════════════════════════════════════
// 投研框架
// ═══════════════════════════════════════════════════════════════

export const zettarancFramework: ResearchFramework = {
  id: 'zettaranc',
  name: '知行体系',
  institution: 'Zettaranc (Z哥)',
  description: '规则驱动、纪律优先的 A 股短线/波段交易系统。包含 B1 建仓波、少妇战法、坑口战法、双枪战法等经典战法，强调守株待兔式买入与严格的止损纪律。',
  version: '1.0',
  dimensions: [
    { id: 'b1_signal', name: 'B1 建仓波信号', weight: 0.30, description: 'KDJ J<13 黄金买点 + 两个30%原则 + 3天纪律' },
    { id: 'shaofu', name: '少妇战法', weight: 0.25, description: '缩量极致 + 低位 + 均线粘合三合一共振' },
    { id: 'kengkou', name: '坑口战法', weight: 0.20, description: '颈线突破 + 回踩确认 + 带量上攻' },
    { id: 'risk', name: '风险预警', weight: 0.25, description: '背离检测 + 出货特征 + 高位警示' },
  ],
  indicators: {
    b1_signal: [
      { field: 'kdjJ', label: 'KDJ J值', scoreType: 'percentile', direction: -1 },
      { field: 'b1Score', label: 'B1 综合评分', scoreType: 'percentile', direction: 1 },
      { field: 'decline20d', label: '20日跌幅', scoreType: 'percentile', direction: -1 },
    ],
    shaofu: [
      { field: 'shaofuScore', label: '少妇战法评分', scoreType: 'percentile', direction: 1 },
      { field: 'volumeRatio', label: '量比', scoreType: 'percentile', direction: -1 },
      { field: 'maStickiness', label: '均线粘合度', scoreType: 'percentile', direction: -1 },
    ],
    kengkou: [
      { field: 'kengkouScore', label: '坑口评分', scoreType: 'percentile', direction: 1 },
      { field: 'mom5', label: '5日动量（突破确认）', scoreType: 'percentile', direction: 1 },
      { field: 'volumeRatio', label: '量比（放量突破）', scoreType: 'percentile', direction: 1 },
    ],
    risk: [
      { field: 'macdDivergence', label: 'MACD背离', scoreType: 'direction', direction: 1 },
      { field: 'kdjDivergence', label: 'KDJ背离', scoreType: 'direction', direction: 1 },
      { field: 'volumeRatio', label: '异常放量', scoreType: 'direction', direction: -1 },
    ],
  },
}

// ═══════════════════════════════════════════════════════════════
// 策略 DSL（4 套 Zettaranc 战法）
// ═══════════════════════════════════════════════════════════════

export const zettarancDSLStrategies: StrategyDSL[] = [
  {
    schema_version: 1,
    name: 'Zettaranc B1 建仓波',
    universe: { market: 'A_SHARE', as_of: 'runtime', exclude: ['ST', 'suspended', 'listed_days_lt:120'] },
    filters: [
      { field: 'kdj_j', operator: 'less_than', value: 13 },
      { field: 'turnover', operator: 'less_than', value: 3 },
    ],
    signals: [{ factor: 'b1_score', direction: 'descending', weight: 1.0 }],
    portfolio: { method: 'equal_weight', top_n: 20, rebalance: 'weekly' },
    execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
    meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
  },
  {
    schema_version: 1,
    name: 'Zettaranc 少妇战法',
    universe: { market: 'A_SHARE', as_of: 'runtime', exclude: ['ST', 'suspended'] },
    filters: [
      { field: 'volume_ratio', operator: 'less_than', value: 0.5 },
      { field: 'ma_stickiness', operator: 'less_than', value: 4 },
      { field: 'position_vs_ma60', operator: 'less_than', value: -5 },
    ],
    signals: [{ factor: 'shaofu_score', direction: 'descending', weight: 1.0 }],
    portfolio: { method: 'equal_weight', top_n: 15, rebalance: 'weekly' },
    execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
    meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
  },
  {
    schema_version: 1,
    name: 'Zettaranc 坑口战法',
    universe: { market: 'A_SHARE', as_of: 'runtime', exclude: ['ST', 'suspended'] },
    filters: [
      { field: 'breakout_rate', operator: 'greater_than', value: 2 },
      { field: 'volume_surge', operator: 'greater_than', value: 1.5 },
    ],
    signals: [{ factor: 'kengkou_score', direction: 'descending', weight: 1.0 }],
    portfolio: { method: 'equal_weight', top_n: 10, rebalance: 'weekly' },
    execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
    meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
  },
  {
    schema_version: 1,
    name: 'Zettaranc 综合超市（多战法共振）',
    universe: { market: 'A_SHARE', as_of: 'runtime', exclude: ['ST', 'suspended'] },
    filters: [
      { field: 'zettaranc_score', operator: 'greater_than', value: 50 },
    ],
    signals: [
      { factor: 'zettaranc_score', direction: 'descending', weight: 0.5 },
      { factor: 'b1_score', direction: 'descending', weight: 0.3 },
      { factor: 'shaofu_score', direction: 'descending', weight: 0.2 },
    ],
    portfolio: { method: 'equal_weight', top_n: 25, rebalance: 'weekly' },
    execution: { market: 'CN_A', t_plus_one: true, price: 'next_tradable_open' },
    meta: { source: 'manual', createdAt: new Date().toISOString(), version: 1 },
  },
]
