#!/usr/bin/env python3
"""
Zettaranc 盘前扫描 — Cron Job
运行时间：每个交易日 9:20
步骤：①竞价看盘 + ②昨日涨停回顾 → 输出盘前简报
"""
import json, os, sys
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
KLINE_DIR = DATA_DIR / 'kline'
NOW = datetime.now()

def load_klines(code):
    """加载K线数据"""
    fp = KLINE_DIR / f'{code}.json'
    if not fp.exists():
        return None
    try:
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        if len(data.get('closes', [])) < 20:
            return None
        return {
            'code': code,
            'close': np.array(data['closes'][-60:], dtype=np.float64),
            'high': np.array(data['highs'][-60:], dtype=np.float64),
            'low': np.array(data['lows'][-60:], dtype=np.float64),
            'vol': np.array(data['vols'][-60:], dtype=np.float64),
        }
    except:
        return None

def is_st(code):
    return 'ST' in code or '*ST' in code

def main():
    # 只采样最近有数据的股票
    files = sorted(KLINE_DIR.glob('*.json'))
    stocks = {}
    for fp in files:
        code = fp.stem
        if is_st(code):
            continue
        k = load_klines(code)
        if k:
            stocks[code] = k

    if not stocks:
        print("无可用K线数据")
        return

    print(f"📊 Zettaranc 盘前简报 — {NOW.strftime('%Y-%m-%d %H:%M')}")
    print("=" * 50)

    # ① 竞价看盘（模拟：用最近交易日的量价判断）
    # 计算全市场近5日活跃市值变化
    total_vol_5d = 0
    total_vol_20d = 0
    count = 0
    for k in stocks.values():
        if len(k['vol']) >= 20:
            total_vol_5d += np.sum(k['vol'][-5:])
            total_vol_20d += np.sum(k['vol'][-20:])
            count += 1

    if count > 0 and total_vol_20d > 0:
        active_mkt_change = (total_vol_5d / (total_vol_20d / 4) - 1) * 100
        if active_mkt_change > 5:
            env = "🟢 多头环境（活跃市值扩大 {:.1f}%）".format(active_mkt_change)
        elif active_mkt_change > 0:
            env = "🟡 温和偏多（活跃市值 +{:.1f}%）".format(active_mkt_change)
        elif active_mkt_change > -3:
            env = "🟠 震荡偏弱（活跃市值 {:.1f}%）".format(active_mkt_change)
        else:
            env = "🔴 空头环境（活跃市值大幅收缩 {:.1f}%）".format(active_mkt_change)
    else:
        env = "⚪ 数据不足，无法判断"

    print(f"\n① 竞价看盘 — 环境判断")
    print(f"   {env}")
    print(f"   扫描股票数: {count}")

    # ② 涨停回顾：找最近交易日涨>9.5%的票
    print(f"\n② 涨停回顾 — 昨日涨停延续性")
    gap_ups = []
    for code, k in stocks.items():
        if len(k['close']) >= 2:
            chg = (k['close'][-2] / k['close'][-3] - 1) * 100 if len(k['close']) >= 3 else 0
            if chg > 9.5:
                # 检查今天（最新日）的表现
                today_chg = (k['close'][-1] / k['close'][-2] - 1) * 100
                gap_ups.append((code, chg, today_chg))

    gap_ups.sort(key=lambda x: x[2], reverse=True)
    if gap_ups:
        continued = sum(1 for _, _, c in gap_ups if c > 0)
        print(f"   昨日涨停: {len(gap_ups)} 只，今日延续上涨: {continued} 只")
        print(f"   Top 5 延续性:")
        for code, prev_chg, today_chg in gap_ups[:5]:
            tag = "✅" if today_chg > 3 else "➖" if today_chg > 0 else "❌"
            print(f"     {tag} {code} 昨+{prev_chg:.1f}% → 今{today_chg:+.1f}%")
    else:
        print("   昨日无涨停票")

    # ③ 异动快速扫描
    print(f"\n③ 异动速扫 — 涨>5%+放量")
    anomalies = []
    for code, k in stocks.items():
        if len(k['close']) < 5:
            continue
        chg = (k['close'][-1] / k['close'][-2] - 1) * 100
        if not (5 < chg < 9.5):  # 涨5%-9.5%非涨停
            continue
        avg_vol = np.mean(k['vol'][-6:-1]) if len(k['vol']) >= 6 else k['vol'][-1]
        vr = k['vol'][-1] / (avg_vol or 1)
        if vr > 2:
            anomalies.append((code, round(chg, 1), round(vr, 1)))

    anomalies.sort(key=lambda x: x[1], reverse=True)
    if anomalies:
        print(f"   异动票: {len(anomalies)} 只")
        for code, chg, vr in anomalies[:8]:
            print(f"     🔥 {code}  +{chg}%  量比:{vr}")
    else:
        print("   无异动票")

    print(f"\n{'=' * 50}")
    print("⚠️ 盘前简报为数据扫描结果，不构成投资建议。")
    print("Z哥铁律：择时大于选股。空头环境宁可空仓。")

if __name__ == '__main__':
    main()
