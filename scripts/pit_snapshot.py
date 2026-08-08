#!/usr/bin/env python3
"""
PIT (Point-in-Time) 时间旅行引擎
对任意历史日期，重建当时可得的股票快照（无前视偏差）
"""
import json, sys, os, argparse
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
UNIVERSE_FILE = DATA_DIR / 'universe.json'
KLINE_DIR = DATA_DIR / 'kline'

def load_universe():
    with open(UNIVERSE_FILE) as f:
        return json.load(f)

def load_stock_kline(code):
    """加载单只股票的K线"""
    fp = KLINE_DIR / f'{code}.json'
    if not fp.exists():
        return None
    try:
        with open(fp) as f:
            return json.load(f)
    except:
        return None

def find_nearest_trade_date(kline, target_date):
    """找到 <= target_date 的最近交易日"""
    dates = kline.get('dates', [])
    closes = kline.get('closes', [])
    vols = kline.get('volumes', [])
    amps = kline.get('amplitudes', [])
    
    # 二分查找最近日期
    best_idx = -1
    for i, d in enumerate(dates):
        if d <= target_date:
            best_idx = i
        else:
            break
    
    if best_idx < 0:
        return None
    
    return {
        'date': dates[best_idx],
        'close': closes[best_idx] if best_idx < len(closes) else None,
        'volume': vols[best_idx] if best_idx < len(vols) else None,
        'amplitude': amps[best_idx] if best_idx < len(amps) else None,
    }

def compute_momentum(kline, target_date, days):
    """计算 N 日动量（截至 target_date）"""
    dates = kline.get('dates', [])
    closes = kline.get('closes', [])
    
    end_idx = -1
    for i, d in enumerate(dates):
        if d <= target_date:
            end_idx = i
        else:
            break
    
    if end_idx < 0:
        return None
    
    start_idx = max(0, end_idx - days)
    if start_idx >= end_idx:
        return None
    
    start_close = closes[start_idx] if start_idx < len(closes) else None
    end_close = closes[end_idx] if end_idx < len(closes) else None
    
    if start_close and end_close and start_close > 0:
        return (end_close / start_close - 1) * 100
    return None

def compute_ma(kline, target_date, days):
    """计算 N 日均线"""
    dates = kline.get('dates', [])
    closes = kline.get('closes', [])
    
    end_idx = -1
    for i, d in enumerate(dates):
        if d <= target_date:
            end_idx = i
        else:
            break
    
    if end_idx < 0:
        return None
    
    start_idx = max(0, end_idx - days + 1)
    window = closes[start_idx:end_idx + 1]
    if window:
        return sum(window) / len(window)
    return None

def build_pit_snapshot(target_date, top_n=100):
    """重建指定日期的全A快照"""
    universe = load_universe()
    snapshots = []
    
    for i, stock in enumerate(universe):
        if i % 500 == 0:
            print(f"PROGRESS:{int(i/len(universe)*100)}")
        
        code = stock.get('code', '')
        kline = load_stock_kline(code)
        if not kline:
            continue
        
        nearest = find_nearest_trade_date(kline, target_date)
        if not nearest or nearest['close'] is None:
            continue
        
        # 计算截至 target_date 的各类因子
        ma20 = compute_ma(kline, target_date, 20)
        ma60 = compute_ma(kline, target_date, 60)
        mom5 = compute_momentum(kline, target_date, 5)
        mom20 = compute_momentum(kline, target_date, 20)
        mom60 = compute_momentum(kline, target_date, 60)
        
        # 偏差率 (Bias)
        bias20 = None
        if ma20 and nearest['close'] > 0:
            bias20 = (nearest['close'] / ma20 - 1) * 100
        
        snapshot = {
            'code': code,
            'name': stock.get('name', ''),
            'industry': stock.get('industry', ''),
            'date': nearest['date'],
            'close': nearest['close'],
            'volume': nearest['volume'],
            'amplitude': nearest['amplitude'],
            # PIT 因子（截至 target_date，无未来数据）
            'ma20': round(ma20, 2) if ma20 else None,
            'ma60': round(ma60, 2) if ma60 else None,
            'mom5': round(mom5, 2) if mom5 else None,
            'mom20': round(mom20, 2) if mom20 else None,
            'mom60': round(mom60, 2) if mom60 else None,
            'bias20': round(bias20, 2) if bias20 else None,
            # 当时可得的基本面（从 universe 静态字段）
            'pe': stock.get('pe'),
            'pb': stock.get('pb'),
            'mktCap': stock.get('mktCap'),
            'roe': stock.get('roe'),
        }
        snapshots.append(snapshot)
    
    # 按代码排序
    snapshots.sort(key=lambda s: s['code'])
    
    return {
        'targetDate': target_date,
        'totalStocks': len(snapshots),
        'generatedAt': datetime.now().isoformat(),
        'snapshots': snapshots[:top_n],
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', required=True, help='YYYY-MM-DD')
    parser.add_argument('--top-n', type=int, default=100)
    parser.add_argument('--output', default='')
    args = parser.parse_args()
    
    result = build_pit_snapshot(args.date, args.top_n)
    
    if args.output:
        out_path = DATA_DIR / args.output
        with open(out_path, 'w') as f:
            json.dump(result, f, ensure_ascii=False)
        print(f"OUTPUT:{args.output}")
    
    # 输出摘要
    print(json.dumps({
        'date': args.date,
        'totalStocks': result['totalStocks'],
        'sampleSize': len(result['snapshots']),
    }, ensure_ascii=False))
