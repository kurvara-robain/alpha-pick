#!/usr/bin/env python3
"""
Zettaranc 盘后持仓体检 — Cron Job
运行时间：每个交易日 15:30
检查持仓股：B1/S1信号 + 去弱留强 + 风险告警
"""
import json, os, sys
from datetime import datetime
from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
KLINE_DIR = DATA_DIR / 'kline'
SYNC_FILE = Path(__file__).parent.parent / '.alphamind-sync.json'
NOW = datetime.now()

def load_klines(code, days=120):
    fp = KLINE_DIR / f'{code}.json'
    if not fp.exists():
        return None
    try:
        with open(fp) as f:
            data = json.load(f)
        n = len(data.get('closes', []))
        if n < days:
            return None
        return {
            'closes': np.array(data['closes'][-days:], dtype=np.float64),
            'highs': np.array(data['highs'][-days:], dtype=np.float64),
            'lows': np.array(data['lows'][-days:], dtype=np.float64),
            'opens': np.array(data['opens'][-days:], dtype=np.float64),
            'vols': np.array(data['vols'][-days:], dtype=np.float64),
        }
    except:
        return None

def calc_kdj(kl):
    """计算KDJ (9,3,3)"""
    n = 9
    k, d, j = [], [], []
    pk, pd = 50, 50
    closes = kl['closes']
    highs = kl['highs']
    lows = kl['lows']
    for i in range(len(closes)):
        if i < n - 1:
            k.append(pk); d.append(pd); j.append(3*pk - 2*pd)
            continue
        wh = np.max(highs[i-n+1:i+1])
        wl = np.min(lows[i-n+1:i+1])
        rsv = 50 if wh == wl else (closes[i] - wl) / (wh - wl) * 100
        ck = (2*pk + rsv) / 3
        cd = (2*pd + ck) / 3
        cj = 3*ck - 2*cd
        k.append(ck); d.append(cd); j.append(cj)
        pk, pd = ck, cd
    return k, d, j

def calc_macd(kl):
    """MACD (12,26,9)"""
    closes = kl['closes']
    def ema(arr, n):
        r = [arr[0]]
        k = 2/(n+1)
        for v in arr[1:]:
            r.append(v*k + r[-1]*(1-k))
        return np.array(r)
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    dif = ema12 - ema26
    return dif

def detect_divergence(closes, indicator, lookback=20):
    """检测背离"""
    if len(closes) < lookback*2:
        return 0
    last = len(closes) - 1
    if closes[last] < closes[last-lookback] and indicator[last] > indicator[last-lookback]:
        return 1  # 底背离
    if closes[last] > closes[last-lookback] and indicator[last] < indicator[last-lookback]:
        return -1  # 顶背离
    return 0

def is_st(code):
    return 'ST' in code

def load_holdings():
    """从 alphamind-sync.json 读取持仓"""
    if not SYNC_FILE.exists():
        return {}
    try:
        with open(SYNC_FILE) as f:
            data = json.load(f)
    except:
        return {}
    # 简化：假设格式为 {"holdings": [{"code": "000001.SZ", "cost": 10.5, "shares": 1000}]}
    if isinstance(data, list):
        return {h['code']: h for h in data}
    if isinstance(data, dict) and 'holdings' in data:
        return {h['code']: h for h in data['holdings']}
    return {}

def main():
    holdings = load_holdings()
    if not holdings:
        print(f"📋 Zettaranc 持仓体检 — {NOW.strftime('%Y-%m-%d %H:%M')}")
        print("=" * 50)
        print("\n⚠️ 无持仓数据。请先在 AlphaMind 中录入持仓。")
        print("   持仓数据路径: .alphamind-sync.json")
        return

    print(f"📋 Zettaranc 持仓体检 — {NOW.strftime('%Y-%m-%d %H:%M')}")
    print("=" * 50)
    print(f"持仓股票数: {len(holdings)}")

    results = []
    for code, pos in holdings.items():
        if is_st(code):
            continue
        kl = load_klines(code)
        if not kl:
            results.append((code, pos, None, "数据不足"))
            continue

        last = len(kl['closes']) - 1
        k, d, j = calc_kdj(kl)
        dif = calc_macd(kl)
        
        j_val = j[last]
        macd_div = detect_divergence(kl['closes'], dif)

        # 信号判断
        signals = []
        alerts = []
        
        # B1
        if j_val < 13:
            signals.append(f"B1信号(J={j_val:.0f})")
        elif j_val < 0:
            signals.append(f"超级B1(J={j_val:.0f})")
        
        # S1
        if j_val > 80:
            chg_20d = (kl['closes'][last] / kl['closes'][last-20] - 1) * 100 if last >= 20 else 0
            if chg_20d > 20:
                alerts.append(f"⚠️ S1风险: J={j_val:.0f} + 20日涨{chg_20d:.0f}%")

        # 背离
        if macd_div == -1:
            alerts.append("MACD顶背离")
        elif macd_div == 1:
            signals.append("MACD底背离")

        # 计算浮盈
        cost = pos.get('cost', 0)
        current = kl['closes'][last]
        if cost > 0:
            profit = (current / cost - 1) * 100
        else:
            profit = 0

        # 去弱留强
        weak_flag = "🔴 弱" if profit < -10 else "🟡 关注" if profit < 0 else "🟢 强"

        results.append((code, {
            'profit': profit,
            'j': j_val,
            'signals': signals,
            'alerts': alerts,
            'weak_flag': weak_flag,
            'current': current,
            'macd_div': macd_div,
        }, kl, None))

    # 排序：浮盈从低到高
    results.sort(key=lambda x: x[1]['profit'])

    print(f"\n{'代码':<12} {'浮盈':>8} {'J值':>6} {'信号':<30} {'状态'}")
    print("-" * 70)
    for code, info, _, _ in results:
        sig_text = ', '.join(info['signals']) if info['signals'] else '-'
        alert_text = ', '.join(info['alerts']) if info['alerts'] else ''
        status = f"{info['weak_flag']}"
        if alert_text:
            status += f" {alert_text}"
        print(f"{code:<12} {info['profit']:>+7.1f}% {info['j']:>5.0f}  {sig_text:<30} {status}")

    # 综合建议
    weak_count = sum(1 for _, info, _, _ in results if info['profit'] < -10)
    alert_count = sum(1 for _, info, _, _ in results if info['alerts'])
    b1_count = sum(1 for _, info, _, _ in results if any('B1' in s for s in info['signals']))

    print(f"\n{'=' * 50}")
    print("📌 综合建议:")
    if weak_count > 0:
        print(f"   🗑️  去弱留强: {weak_count} 只浮亏>10%触发弱标记，考虑减仓换马")
    if alert_count > 0:
        print(f"   🚨 卖出告警: {alert_count} 只有S1/背离信号")
    if b1_count > 0:
        print(f"   ✅ B1信号: {b1_count} 只出现B1信号，可关注加仓时机")
    if weak_count == 0 and alert_count == 0:
        print("   ✅ 持仓健康，无异常信号")

    print("\n💡 Z哥铁律：底仓守信仰，动态仓守纪律。盈转亏必须走。")

if __name__ == '__main__':
    main()
