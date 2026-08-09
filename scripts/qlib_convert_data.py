#!/usr/bin/env python3
"""
AlphaMind → Qlib 数据转换
将 public/data/kline/*.json 转换为 Qlib 的 bin 格式
输出: public/data/qlib_data/
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# 路径
PROJECT_DIR = Path(__file__).parent.parent
KLINE_DIR = PROJECT_DIR / 'public' / 'data' / 'kline'
UNIVERSE_FILE = PROJECT_DIR / 'public' / 'data' / 'universe.json'
QLIB_DATA_DIR = PROJECT_DIR / 'public' / 'data' / 'qlib_data'


def load_klines(limit=None):
    """加载所有K线，返回 {code: DataFrame}"""
    files = list(KLINE_DIR.glob('*.json'))
    if limit:
        files = files[:limit]
    
    dfs = {}
    total = len(files)
    for i, fp in enumerate(files):
        if i % 500 == 0:
            print(f"  加载K线 {i}/{total}", flush=True)
        code = fp.stem
        try:
            with open(fp) as f:
                data = json.load(f)
            df = pd.DataFrame({
                'date': pd.to_datetime(data['dates']),
                'open': data['opens'],
                'high': data['highs'],
                'low': data['lows'],
                'close': data['closes'],
                'volume': data['vols'],
                'adjclose': data.get('closesHfq', data['closes']),  # 后复权收盘价
            })
            df.set_index('date', inplace=True)
            df.sort_index(inplace=True)
            df['instrument'] = code
            dfs[code] = df
        except Exception as e:
            continue
    print(f"  加载完成: {len(dfs)} 只股票", flush=True)
    return dfs


def convert_to_qlib_csv(dfs, output_dir):
    """
    转换为 Qlib 需要的 CSV 格式（features 目录下每天一个目录）
    结构: qlib_data/features/<instrument>/<date>.csv
    同时生成 calendars/day.txt 和 instruments/all.txt
    """
    feature_dir = output_dir / 'features'
    feature_dir.mkdir(parents=True, exist_ok=True)
    
    all_dates = set()
    all_instruments = set()
    
    total = len(dfs)
    for i, (code, df) in enumerate(dfs.items()):
        if i % 500 == 0:
            print(f"  转换 {i}/{total}", flush=True)
        
        inst_dir = feature_dir / code
        inst_dir.mkdir(parents=True, exist_ok=True)
        
        for idx, row in df.iterrows():
            date_str = idx.strftime('%Y-%m-%d')
            all_dates.add(date_str)
            all_instruments.add(code)
            
            csv_path = inst_dir / f"{date_str}.csv"
            # Qlib expects columns: open, high, low, close, volume, adjclose (or vwap, factor)
            row_data = {
                'open': row['open'],
                'high': row['high'],
                'low': row['low'],
                'close': row['close'],
                'volume': int(row['volume']),
                'adjclose': row['adjclose'],
                'factor': row['adjclose'] / row['close'] if row['close'] != 0 else 1.0,
            }
            pd.DataFrame([row_data]).to_csv(csv_path, index=False)
    
    print(f"  转换完成: {len(all_instruments)} 只股票, {len(all_dates)} 个交易日", flush=True)
    
    # 生成日历文件
    cal_dir = output_dir / 'calendars'
    cal_dir.mkdir(parents=True, exist_ok=True)
    sorted_dates = sorted(all_dates)
    with open(cal_dir / 'day.txt', 'w') as f:
        f.write('\n'.join(sorted_dates))
    
    # 生成股票列表
    inst_dir = output_dir / 'instruments'
    inst_dir.mkdir(parents=True, exist_ok=True)
    sorted_inst = sorted(all_instruments)
    with open(inst_dir / 'all.txt', 'w') as f:
        for inst in sorted_inst:
            # Qlib format: instrument, start_date, end_date
            first_date = dfs[inst].index[0].strftime('%Y-%m-%d')
            last_date = dfs[inst].index[-1].strftime('%Y-%m-%d')
            f.write(f"{inst}\t{first_date}\t{last_date}\n")
    
    # 保存元信息
    with open(output_dir / 'meta.json', 'w') as f:
        json.dump({
            'instruments': len(all_instruments),
            'dates': len(all_dates),
            'date_range': [sorted_dates[0], sorted_dates[-1]],
            'created': datetime.now().isoformat(),
        }, f, ensure_ascii=False, indent=2)
    
    return len(all_instruments), len(all_dates)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='AlphaMind → Qlib 数据转换')
    parser.add_argument('--limit', type=int, default=0, help='限制股票数量（0=全部）')
    parser.add_argument('--qd', type=str, default='', help='输出目录（默认 public/data/qlib_data/）')
    args = parser.parse_args()
    
    output_dir = Path(args.qd) if args.qd else QLIB_DATA_DIR
    limit = args.limit if args.limit > 0 else None
    
    print(f"AlphaMind → Qlib 数据转换", flush=True)
    print(f"  输出: {output_dir}", flush=True)
    
    print("步骤1: 加载K线数据...", flush=True)
    dfs = load_klines(limit=limit)
    
    print("步骤2: 转换为Qlib CSV格式...", flush=True)
    n_inst, n_dates = convert_to_qlib_csv(dfs, output_dir)
    
    print(f"\n✅ 转换完成: {n_inst} 只股票 × {n_dates} 个交易日", flush=True)
    print(f"   输出目录: {output_dir}", flush=True)


if __name__ == '__main__':
    main()
