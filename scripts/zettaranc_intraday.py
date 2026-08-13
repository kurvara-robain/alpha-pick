#!/usr/bin/env python3
"""
Zettaranc 盘中异动扫描 + 盘后计划生成 — Cron Job
运行时间：10:00 / 14:00 (盘中扫描) + 16:00 (盘后计划)
"""
import json, os, sys
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
from datetime import datetime
from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
KLINE_DIR = DATA_DIR / 'kline'
NOW = datetime.now()

def load_klines(code, days=120):
    fp = KLINE_DIR / f'{code}.json'
    if not fp.exists():
        return None
    try:
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        n = len(data.get('closes', []))
        if n < days:
            return None
        return {
            'code': code,
            'closes': np.array(data['closes'][-days:], dtype=np.float64),
            'highs': np.array(data['highs'][-days:], dtype=np.float64),
            'lows': np.array(data['lows'][-days:], dtype=np.float64),
            'opens': np.array(data['opens'][-days:], dtype=np.float64),
            'vols': np.array(data['vols'][-days:], dtype=np.float64),
        }
    except:
        return None

def is_st(code):
    return 'ST' in code or '*ST' in code

def calc_kdj(kl):
    n = 9
    k, d, j = [], [], []
    pk, pd = 50, 50
    closes = kl['closes']; highs = kl['highs']; lows = kl['lows']
    for i in range(len(closes)):
        if i < n - 1:
            k.append(pk); d.append(pd); j.append(3*pk-2*pd); continue
        wh = np.max(highs[i-n+1:i+1])
        wl = np.min(lows[i-n+1:i+1])
        rsv = 50 if wh == wl else (closes[i]-wl)/(wh-wl)*100
        ck = (2*pk+rsv)/3; cd = (2*pd+ck)/3; cj = 3*ck-2*cd
        k.append(ck); d.append(cd); j.append(cj)
        pk, pd = ck, cd
    return k, d, j

def scan_anomalies(stocks):
    """异动选股法扫描"""
    results = []
    for code, kl in stocks.items():
        last = len(kl['closes']) - 1
        if last < 5:
            continue
        chg = (kl['closes'][last] / kl['closes'][last-1] - 1) * 100
        if not (5 < chg < 9.5):
            continue
        avg_vol = np.mean(kl['vols'][last-5:last]) if last >= 5 else kl['vols'][last]
        vr = kl['vols'][last] / (avg_vol or 1)
        if vr > 2:
            results.append((code, round(chg, 1), round(vr, 1)))
    results.sort(key=lambda x: x[1], reverse=True)
    return results

def scan_b1_signals(stocks):
    """B1建仓波扫描"""
    results = []
    for code, kl in stocks.items():
        last = len(kl['closes']) - 1
        if last < 20:
            continue
        _, _, j = calc_kdj(kl)
        j_val = j[last]
        if j_val < 13:
            # 判断跌幅
            d5 = (kl['closes'][last] / kl['closes'][last-5] - 1) * 100 if last >= 5 else 0
            d20 = (kl['closes'][last] / kl['closes'][last-20] - 1) * 100
            score = 50 if j_val < 0 else 40
            if d5 < -5: score += 15
            if d20 < 0: score += 10
            # 缩量
            avg_vol = np.mean(kl['vols'][last-5:last]) if last >= 5 else kl['vols'][last]
            vr = kl['vols'][last] / (avg_vol or 1)
            if vr < 0.7: score += 15
            results.append((code, round(j_val, 1), score, round(d5, 1)))
    results.sort(key=lambda x: x[2], reverse=True)
    return results

def scan_shaofu(stocks):
    """少妇战法扫描"""
    results = []
    for code, kl in stocks.items():
        last = len(kl['closes']) - 1
        if last < 60:
            continue
        # 缩量
        avg_vol = np.mean(kl['vols'][last-5:last]) if last >= 5 else kl['vols'][last]
        vr = kl['vols'][last] / (avg_vol or 1)
        if vr > 0.5:
            continue
        # 低位
        ma60 = np.mean(kl['closes'][last-59:last+1])
        pos = (kl['closes'][last] / ma60 - 1) * 100
        if pos > -5:
            continue
        # 均线粘合
        ma5 = np.mean(kl['closes'][last-4:last+1])
        ma10 = np.mean(kl['closes'][last-9:last+1])
        ma20 = np.mean(kl['closes'][last-19:last+1])
        mean_ma = (ma5 + ma10 + ma20) / 3
        stickiness = np.std([ma5, ma10, ma20]) / mean_ma * 100 if mean_ma > 0 else 100
        if stickiness > 4:
            continue
        score = int((1 - vr) * 30 + abs(pos) * 1.5 + (5 - stickiness) * 5)
        results.append((code, round(pos, 1), round(vr, 2), round(stickiness, 1), score))
    results.sort(key=lambda x: x[4], reverse=True)
    return results

def main():
    files = sorted(KLINE_DIR.glob('*.json'))
    stocks = {}
    for fp in files:
        code = fp.stem
        if is_st(code):
            continue
        kl = load_klines(code)
        if kl:
            stocks[code] = kl

    if not stocks:
        print("无可用数据")
        return

    print(f"📊 Zettaranc 盘中扫描 — {NOW.strftime('%Y-%m-%d %H:%M')}")
    print("=" * 55)

    # 异动扫描
    anomalies = scan_anomalies(stocks)
    print(f"\n🔥 异动选股法（涨>5%+量比>2，非涨停）: {len(anomalies)} 只")
    if anomalies:
        for code, chg, vr in anomalies[:10]:
            print(f"   {code:<12} +{chg}%  量比:{vr}")

    # B1信号
    b1_list = scan_b1_signals(stocks)
    print(f"\n📉 B1建仓波（J<13）: {len(b1_list)} 只")
    if b1_list:
        for code, j_val, score, d5 in b1_list[:10]:
            tag = "🟢" if score >= 60 else "🟡"
            print(f"   {tag} {code:<12} J={j_val}  评分:{score}  5日:{d5:+.1f}%")

    # 少妇战法
    shaofu_list = scan_shaofu(stocks)
    print(f"\n👰 少妇战法（缩量+低位+均线粘合）: {len(shaofu_list)} 只")
    if shaofu_list:
        for code, pos, vr, stick, score in shaofu_list[:10]:
            print(f"   {code:<12} 偏离60均:{pos:.0f}%  量比:{vr}  粘合度:{stick}  评分:{score}")

    # 盘后计划
    print(f"\n{'=' * 55}")
    print("📋 次日候选池（综合评分 Top 15）:")
    all_candidates = []
    seen = set()
    for code, j_val, score, d5 in b1_list[:10]:
        if code not in seen:
            all_candidates.append((code, score, f"B1 J={j_val}"))
            seen.add(code)
    for code, pos, vr, stick, score in shaofu_list[:10]:
        if code not in seen:
            all_candidates.append((code, score, f"少妇 pos={pos:.0f}%"))
            seen.add(code)
    all_candidates.sort(key=lambda x: x[1], reverse=True)
    for i, (code, score, reason) in enumerate(all_candidates[:15], 1):
        print(f"   {i:>2}. {code:<12}  {reason:<25} 评分:{score}")

    print(f"\n💡 Z哥铁律：一年 255 天，200 天空仓都没关系，只抓看得懂的机会。")

if __name__ == '__main__':
    main()
