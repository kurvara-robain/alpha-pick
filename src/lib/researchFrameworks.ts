// ─────────────────────────────────────────────────────────────
// 投研框架库 — 国内主流机构方法论模板（可插拔）
// 新增机构框架：在此文件追加配置即可，页面自动识别
// ─────────────────────────────────────────────────────────────
import type { ResearchFramework } from './researchTypes'

export const RESEARCH_FRAMEWORKS: ResearchFramework[] = [
  {
    id: 'cicc-quality',
    name: '质量成长框架',
    institution: '中金公司',
    description: '从盈利能力、成长性、估值安全边际三维度综合评估，侧重ROE-ROIC质量筛选，适合中长线价值发现。',
    version: '1.0',
    dimensions: [
      { id: 'quality', name: '盈利质量', weight: 0.35, description: 'ROE、毛利率、经营现金流等盈利可持续性指标' },
      { id: 'growth', name: '成长动能', weight: 0.30, description: '收入/利润增长率、动量与预期差' },
      { id: 'valuation', name: '估值安全边际', weight: 0.35, description: 'PE/PB分位、PEG、安全边际' },
    ],
    indicators: {
      quality: [
        { field: 'roe', label: 'ROE', scoreType: 'percentile', direction: 1 },
        { field: 'pe', label: '盈利稳定性(PE>0)', scoreType: 'direction', direction: 1 },
        { field: 'vol60', label: '股价稳定性', scoreType: 'percentile', direction: -1 },
      ],
      growth: [
        { field: 'mom20', label: '短期动量(20日)', scoreType: 'percentile', direction: 1 },
        { field: 'mom60', label: '中期动量(60日)', scoreType: 'percentile', direction: 1 },
        { field: 'sharpe20', label: '动量质量(Sharpe)', scoreType: 'percentile', direction: 1 },
      ],
      valuation: [
        { field: 'pe', label: 'PE(TTM)', scoreType: 'percentile', direction: -1 },
        { field: 'pb', label: 'PB', scoreType: 'percentile', direction: -1 },
        { field: 'mktCap', label: '市值规模', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
  {
    id: 'tf-industry',
    name: '产业链景气框架',
    institution: '天风证券',
    description: '从行业景气度、公司行业地位、产业链利润分配三维度入手，适合行业轮动与主题投资场景。',
    version: '1.0',
    dimensions: [
      { id: 'industry', name: '行业景气', weight: 0.40, description: '行业涨跌幅、资金流向、板块热度' },
      { id: 'position', name: '行业地位', weight: 0.30, description: '市值排名、盈利能力行业分位' },
      { id: 'momentum', name: '价格动能', weight: 0.30, description: '短中期价格趋势与量能配合' },
    ],
    indicators: {
      industry: [
        { field: 'changePct', label: '当日涨跌幅', scoreType: 'percentile', direction: 1 },
        { field: 'mom20', label: '20日动量', scoreType: 'percentile', direction: 1 },
        { field: 'turnover', label: '换手率(活跃度)', scoreType: 'percentile', direction: 1 },
      ],
      position: [
        { field: 'mktCap', label: '市值(行业地位)', scoreType: 'percentile', direction: 1 },
        { field: 'roe', label: 'ROE(盈利优势)', scoreType: 'percentile', direction: 1 },
        { field: 'pe', label: 'PE合理性', scoreType: 'percentile', direction: -1 },
      ],
      momentum: [
        { field: 'sharpe20', label: '动量质量', scoreType: 'percentile', direction: 1 },
        { field: 'cpv20', label: '量价健康度', scoreType: 'percentile', direction: -1 },
        { field: 'maxdd60', label: '回撤控制', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
  {
    id: 'citics-value',
    name: '价值发现框架',
    institution: '中信证券',
    description: '以安全边际为核心，结合DCF估值思维，从低估值、高股息、高质量三维度挖掘被低估标的。',
    version: '1.0',
    dimensions: [
      { id: 'deepvalue', name: '深度价值', weight: 0.40, description: '低PE、低PB、低PEG等估值洼地' },
      { id: 'safety', name: '安全边际', weight: 0.30, description: '低波动、低回撤、低换手的防御属性' },
      { id: 'catalyst', name: '反转催化', weight: 0.30, description: '超跌反弹、均值回归、量能企稳信号' },
    ],
    indicators: {
      deepvalue: [
        { field: 'pe', label: 'PE(低估值)', scoreType: 'percentile', direction: -1 },
        { field: 'pb', label: 'PB(破净风险)', scoreType: 'percentile', direction: -1 },
        { field: 'roe', label: 'ROE(盈利验证)', scoreType: 'percentile', direction: 1 },
      ],
      safety: [
        { field: 'vol60', label: '低波动', scoreType: 'percentile', direction: -1 },
        { field: 'maxdd60', label: '低回撤', scoreType: 'percentile', direction: -1 },
        { field: 'vcv20', label: '量能稳定', scoreType: 'percentile', direction: -1 },
      ],
      catalyst: [
        { field: 'bias60', label: '超跌程度', scoreType: 'percentile', direction: -1 },
        { field: 'ret5', label: '短期反转', scoreType: 'percentile', direction: -1 },
        { field: 'cpv20', label: '量价背离', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
  {
    id: 'cms-growth',
    name: '盈利动量框架',
    institution: '招商证券',
    description: '聚焦盈利超预期与趋势延续，结合估值修复空间，寻找成长与价值的共振点。',
    version: '1.0',
    dimensions: [
      { id: 'earnings', name: '盈利动能', weight: 0.35, description: 'ROE水平、盈利增长预期' },
      { id: 'trend', name: '趋势强度', weight: 0.35, description: '中期价格趋势与动量持续性' },
      { id: 'rational', name: '估值合理性', weight: 0.30, description: '成长股估值消化程度' },
    ],
    indicators: {
      earnings: [
        { field: 'roe', label: 'ROE', scoreType: 'percentile', direction: 1 },
        { field: 'mom60', label: '60日趋势', scoreType: 'percentile', direction: 1 },
        { field: 'sharpe20', label: '风险调整收益', scoreType: 'percentile', direction: 1 },
      ],
      trend: [
        { field: 'mom20', label: '短期强度', scoreType: 'percentile', direction: 1 },
        { field: 'mom60', label: '中期趋势', scoreType: 'percentile', direction: 1 },
        { field: 'turnover', label: '交投活跃', scoreType: 'percentile', direction: 1 },
      ],
      rational: [
        { field: 'pe', label: 'PE消化程度', scoreType: 'percentile', direction: -1 },
        { field: 'pb', label: 'PB水平', scoreType: 'percentile', direction: -1 },
        { field: 'vol20', label: '波动收敛', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
  {
    id: 'gtja-compare',
    name: '行业比较框架',
    institution: '国泰君安',
    description: '从行业相对强度、个股alpha、行业轮动信号三维度进行跨行业比较，适合自上而下配置。',
    version: '1.0',
    dimensions: [
      { id: 'relative', name: '相对强度', weight: 0.40, description: '相对行业/市场的超额收益' },
      { id: 'alpha', name: '个股Alpha', weight: 0.35, description: '剥离行业后的独立alpha' },
      { id: 'rotation', name: '轮动信号', weight: 0.25, description: '资金流向与风格转换信号' },
    ],
    indicators: {
      relative: [
        { field: 'mom20', label: '短期相对强度', scoreType: 'percentile', direction: 1 },
        { field: 'mom60', label: '中期相对强度', scoreType: 'percentile', direction: 1 },
        { field: 'changePct', label: '当日表现', scoreType: 'percentile', direction: 1 },
      ],
      alpha: [
        { field: 'sharpe20', label: '风险调整Alpha', scoreType: 'percentile', direction: 1 },
        { field: 'cpv20', label: '独立量价信号', scoreType: 'percentile', direction: -1 },
        { field: 'roe', label: '基本面Alpha', scoreType: 'percentile', direction: 1 },
      ],
      rotation: [
        { field: 'turnover', label: '资金关注度', scoreType: 'percentile', direction: 1 },
        { field: 'vcv20', label: '筹码稳定度', scoreType: 'percentile', direction: -1 },
        { field: 'bias60', label: '轮动位置', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
  {
    id: 'htsc-timing',
    name: '因子择时框架',
    institution: '华泰证券',
    description: '多因子动态权重配置，根据市场环境自适应调整因子暴露，兼顾进攻与防守。',
    version: '1.0',
    dimensions: [
      { id: 'trend', name: '趋势跟踪', weight: 0.30, description: '市场处于趋势市时暴露动量因子' },
      { id: 'meanrev', name: '均值回归', weight: 0.25, description: '震荡市暴露反转与价值因子' },
      { id: 'defense', name: '防御配置', weight: 0.25, description: '低波、低回撤、高质量防御因子' },
      { id: 'sentiment', name: '情绪择时', weight: 0.20, description: '量能、波动率等市场情绪信号' },
    ],
    indicators: {
      trend: [
        { field: 'mom60', label: '趋势强度', scoreType: 'percentile', direction: 1 },
        { field: 'sharpe20', label: '趋势质量', scoreType: 'percentile', direction: 1 },
      ],
      meanrev: [
        { field: 'bias60', label: '回归潜力', scoreType: 'percentile', direction: -1 },
        { field: 'ret5', label: '反转信号', scoreType: 'percentile', direction: -1 },
      ],
      defense: [
        { field: 'vol60', label: '低波防御', scoreType: 'percentile', direction: -1 },
        { field: 'maxdd60', label: '回撤保护', scoreType: 'percentile', direction: -1 },
      ],
      sentiment: [
        { field: 'vcv20', label: '拥挤度', scoreType: 'percentile', direction: -1 },
        { field: 'cpv20', label: '量价背离', scoreType: 'percentile', direction: -1 },
      ],
    },
  },
]
