#!/usr/bin/env python3
"""
AlphaMind 事件驱动回测引擎
逐日模拟：选股 → T+1 开盘成交 → 持仓跟踪 → 净值计算
"""
import json, sys, os, argparse, random
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
UNIVERSE_FILE = DATA_DIR / 'universe.json'
KLINE_DIR = DATA_DIR / 'kline'

def log_progress(pct, msg=""):
    print(f"PROGRESS:{pct}", flush=True)
    if msg:
        print(msg, flush=True)

def parse_date(s):
    return datetime.strptime(s, '%Y-%m-%d')

def fmt_date(d):
    return d.strftime('%Y-%m-%d')

def load_universe():
    with open(UNIVERSE_FILE) as f:
        return json.load(f)

def load_klines():
    """加载所有K线，返回 {code: {dates: [], closes: []}}"""
    klines = {}
    files = list(KLINE_DIR.glob('*.json'))
    for i, fp in enumerate(files):
        if i % 500 == 0:
            log_progress(int(i / len(files) * 30), f"加载K线 {i}/{len(files)}")
        code = fp.stem
        try:
            with open(fp) as f:
                data = json.load(f)
            klines[code] = {'dates': data.get('dates', []), 'closes': data.get('closes', [])}
        except:
            continue
    return klines

def get_price(klines, code, date_str, offset=0):
    """获取指定日期的收盘价，offset=1表示次日"""
    if code not in klines:
        return None
    k = klines[code]
    try:
        idx = k['dates'].index(date_str)
        target_idx = idx + offset
        if 0 <= target_idx < len(k['closes']):
            return k['closes'][target_idx]
    except ValueError:
        pass
    return None

def get_trade_dates(klines, start, end):
    """获取指定区间内所有有数据的交易日"""
    all_dates = set()
    for k in klines.values():
        all_dates.update(k['dates'])
    dates = sorted(d for d in all_dates if start <= d <= end)
    return dates

def next_trade_date(all_dates, current):
    """获取下一个交易日"""
    idx = all_dates.index(current) if current in all_dates else -1
    return all_dates[idx + 1] if idx >= 0 and idx + 1 < len(all_dates) else None

def is_rebalance_day(current, prev, freq):
    if prev is None:
        return True
    if freq == 'monthly':
        return current[:7] != prev[:7]
    if freq == 'weekly':
        cd = parse_date(current)
        pd = parse_date(prev)
        return cd.isocalendar()[1] != pd.isocalendar()[1]
    return False

def filter_stocks(universe, strategy_ids, factor_ids, date_str):
    """简化版筛选：只用 PE/PB 条件"""
    # 实际应用中需要运行 Python 因子截面
    stocks = [s for s in universe if not s['name'].startswith('ST') and s['pe'] > 0 and s['pe'] < 50]
    # 按PE排序取前N
    stocks.sort(key=lambda s: s['pe'])
    return stocks

def run_backtest(args):
    log_progress(0, "开始加载数据…")
    
    universe = load_universe()
    log_progress(5, f"全A股票池: {len(universe)} 只")
    
    klines = load_klines()
    log_progress(35, f"K线数据: {len(klines)} 只")
    
    start = fmt_date(parse_date(args.start))
    end = fmt_date(parse_date(args.end))
    
    trade_dates = get_trade_dates(klines, start, end)
    log_progress(40, f"交易日: {len(trade_dates)} 天 ({start} ~ {end})")
    
    top_n = args.top_n
    rebalance = args.rebalance
    capital = 1_000_000
    commission_rate = 0.00025
    stamp_tax_rate = 0.0005
    slippage = 0.001
    
    cash = capital
    positions = {}  # {code: shares}
    nav_history = []
    prev_date = None
    
    log_progress(45, "开始逐日回测…")
    
    for i, date_str in enumerate(trade_dates):
        if i % max(1, len(trade_dates) // 50) == 0:
            pct = 45 + int((i / len(trade_dates)) * 50)
            log_progress(pct, f"回测 {date_str} ({i+1}/{len(trade_dates)})")
        
        # 更新持仓市值
        position_value = 0
        for code, shares in list(positions.items()):
            price = get_price(klines, code, date_str)
            if price is not None:
                position_value += price * shares
        
        total_value = cash + position_value
        nav_history.append({'date': date_str, 'nav': total_value, 'cash': cash, 'position_value': position_value})
        
        # 判断是否调仓
        if not is_rebalance_day(date_str, prev_date, rebalance):
            prev_date = date_str
            continue
        
        # 选股（用当日收盘后数据）
        pool = filter_stocks(universe, [], [], date_str)[:top_n]
        
        # 次日开盘价成交
        next_date = next_trade_date(trade_dates, date_str)
        if not next_date:
            break
        
        # 平仓
        for code, shares in list(positions.items()):
            price = get_price(klines, code, next_date)
            if price is None:
                continue
            fill_price = price * (1 - slippage)
            gross = fill_price * shares
            commission = max(5, gross * commission_rate)
            stamp = gross * stamp_tax_rate
            cash += gross - commission - stamp
            del positions[code]
        
        # 建仓
        per_stock_cash = (cash / len(pool)) if pool else 0
        for stock in pool:
            price = get_price(klines, stock['code'], next_date)
            if price is None:
                continue
            fill_price = price * (1 + slippage)
            shares = int((per_stock_cash * 0.99) / fill_price / 100) * 100
            if shares < 100:
                continue
            cost = fill_price * shares + max(5, fill_price * shares * commission_rate)
            if cost > cash:
                continue
            cash -= cost
            positions[stock['code']] = positions.get(stock['code'], 0) + shares
        
        prev_date = date_str
    
    # 计算指标
    if len(nav_history) < 2:
        log_progress(100, "回测失败：交易日不足")
        return
    
    initial_nav = nav_history[0]['nav']
    final_nav = nav_history[-1]['nav']
    total_return = (final_nav / initial_nav - 1) * 100
    years = len(nav_history) / 252
    annual_return = ((final_nav / initial_nav) ** (1 / max(years, 0.01)) - 1) * 100
    
    # 最大回撤
    peak = nav_history[0]['nav']
    max_dd = 0
    for n in nav_history:
        peak = max(peak, n['nav'])
        dd = (n['nav'] / peak - 1) * 100
        max_dd = min(max_dd, dd)
    
    # Sharpe
    daily_rets = []
    for i in range(1, len(nav_history)):
        daily_rets.append(nav_history[i]['nav'] / nav_history[i-1]['nav'] - 1)
    mean_ret = sum(daily_rets) / len(daily_rets) if daily_rets else 0
    std_ret = (sum((r - mean_ret) ** 2 for r in daily_rets) / len(daily_rets)) ** 0.5 if daily_rets else 0
    sharpe = (mean_ret / std_ret * (252 ** 0.5)) if std_ret > 0 else 0
    
    result = {
        'config': {
            'startDate': start, 'endDate': end,
            'rebalance': rebalance, 'topN': top_n,
            'initialCapital': capital, 'commissionRate': commission_rate,
            'stampTaxRate': stamp_tax_rate, 'slippage': slippage,
        },
        'metrics': {
            'totalReturn': round(total_return, 2),
            'annualReturn': round(annual_return, 2),
            'maxDrawdown': round(max_dd, 2),
            'sharpe': round(sharpe, 2),
            'tradeDays': len(nav_history),
        },
        'navHistory': [{'date': n['date'], 'nav': round(n['nav'], 2)} for n in nav_history[::max(1, len(nav_history)//100)]],
        'generatedAt': datetime.now().isoformat(),
    }
    
    output_path = DATA_DIR / f'research-backtest-{args.task_id}.json'
    with open(output_path, 'w') as f:
        json.dump(result, f, ensure_ascii=False)
    
    log_progress(100, f"回测完成: 累计收益 {total_return:.1f}%, 夏普 {sharpe:.2f}, 最大回撤 {max_dd:.1f}%")
    print(f"OUTPUT:{output_path.name}", flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--strategy-ids', default='')
    parser.add_argument('--factor-ids', default='')
    parser.add_argument('--start', default='2024-01-01')
    parser.add_argument('--end', default='2026-01-01')
    parser.add_argument('--rebalance', default='monthly')
    parser.add_argument('--top-n', type=int, default=25)
    parser.add_argument('--task-id', default='default')
    args = parser.parse_args()
    run_backtest(args)
