#!/usr/bin/env python3
"""
Qlib vs AlphaMind 基线对比测试
策略：直接用 pandas 加载 AlphaMind K线 → 算因子 → LightGBM → 回测
绕过了 Qlib 数据格式层，聚焦模型本身对比
"""
import json
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# LightGBM 依赖 libomp（macOS 可能需要单独安装），优先使用，
# 不可用时回退到 sklearn HistGradientBoosting（同算法、无额外依赖）
try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except (ImportError, OSError):
    HAS_LIGHTGBM = False
    from sklearn.ensemble import HistGradientBoostingRegressor

PROJECT_DIR = Path(__file__).parent.parent
KLINE_DIR = PROJECT_DIR / 'public' / 'data' / 'kline'
OUTPUT_FILE = PROJECT_DIR / 'public' / 'data' / 'qlib_baseline_result.json'
TARGET_PERIOD = 20  # 预测周期（与AlphaMind同口径：20日）


def load_klines(n_stocks=None):
    """加载K线，返回合并 DataFrame"""
    files = sorted(KLINE_DIR.glob('*.json'))
    if n_stocks:
        files = files[:n_stocks]
    
    all_dfs = []
    total = len(files)
    for i, fp in enumerate(files):
        if i % 1000 == 0:
            print(f"  加载 {i}/{total}", flush=True)
        try:
            with open(fp, encoding='utf-8') as f:
                data = json.load(f)
            df = pd.DataFrame({
                'date': pd.to_datetime(data['dates']),
                'open': data['opens'],
                'high': data['highs'],
                'low': data['lows'],
                'close': data['closes'],
                'volume': data['vols'],
                'adjclose': data.get('closesHfq', data['closes']),
            })
            df['instrument'] = fp.stem
            all_dfs.append(df)
        except:
            continue
    print(f"  加载完成: {len(all_dfs)} 只", flush=True)
    return pd.concat(all_dfs, ignore_index=True)


def compute_factors(df):
    """计算 Alpha 因子"""
    print("  计算因子...", flush=True)
    df = df.sort_values(['instrument', 'date']).copy()
    
    grouped = df.groupby('instrument')
    
    # 收益类
    df['ret_1d'] = grouped['adjclose'].pct_change()
    df['ret_5d'] = grouped['adjclose'].pct_change(5)
    df['ret_10d'] = grouped['adjclose'].pct_change(10)
    df['ret_20d'] = grouped['adjclose'].pct_change(20)
    df['ret_60d'] = grouped['adjclose'].pct_change(60)
    
    # 均线类
    df['ma_5'] = grouped['adjclose'].transform(lambda x: x.rolling(5).mean())
    df['ma_10'] = grouped['adjclose'].transform(lambda x: x.rolling(10).mean())
    df['ma_20'] = grouped['adjclose'].transform(lambda x: x.rolling(20).mean())
    df['ma_60'] = grouped['adjclose'].transform(lambda x: x.rolling(60).mean())
    df['ma5_div_ma20'] = df['ma_5'] / (df['ma_20'] + 1e-8)
    df['ma20_div_ma60'] = df['ma_20'] / (df['ma_60'] + 1e-8)
    
    # 波动率
    df['volatility_5d'] = grouped['ret_1d'].transform(lambda x: x.rolling(5).std())
    df['volatility_20d'] = grouped['ret_1d'].transform(lambda x: x.rolling(20).std())
    
    # 量价
    df['volume_ma5'] = grouped['volume'].transform(lambda x: x.rolling(5).mean())
    df['volume_ma20'] = grouped['volume'].transform(lambda x: x.rolling(20).mean())
    df['volume_ratio'] = df['volume'] / (df['volume_ma5'] + 1)
    df['turnover'] = df['volume'] / (df['volume_ma20'] + 1)
    
    # 价格位置
    df['high_low_ratio'] = (df['close'] - df['low']) / (df['high'] - df['low'] + 1e-8)
    df['close_ma20_ratio'] = df['close'] / (df['ma_20'] + 1e-8)
    
    # 动量（AlphaMind 风格）
    df['mom_5d_rank'] = grouped['ret_5d'].transform(lambda x: x.rank(pct=True))
    df['mom_20d_rank'] = grouped['ret_20d'].transform(lambda x: x.rank(pct=True))
    
    # Label: 未来20日收益（AlphaMind 同口径）
    df['label'] = grouped['adjclose'].shift(-TARGET_PERIOD) / df['adjclose'] - 1
    
    # 日期间的数字编码（帮助模型抓住时间趋势）
    df['date_num'] = (df['date'] - pd.Timestamp('2015-01-01')).dt.days
    
    df.dropna(inplace=True)
    print(f"  因子计算完成: {len(df)} 条有效样本", flush=True)
    return df


def train_and_backtest(df):
    """训练 LightGBM 并回测"""
    feature_cols = [
        'ret_1d', 'ret_5d', 'ret_10d', 'ret_20d', 'ret_60d',
        'ma5_div_ma20', 'ma20_div_ma60',
        'volatility_5d', 'volatility_20d',
        'volume_ratio', 'turnover',
        'high_low_ratio', 'close_ma20_ratio',
        'mom_5d_rank', 'mom_20d_rank',
        'date_num',
    ]
    
    # 时间切分
    train_end = '2024-12-31'
    valid_end = '2025-06-30'
    test_start = '2025-07-01'
    test_end = '2026-07-01'
    
    train_mask = df['date'] <= train_end
    valid_mask = (df['date'] > train_end) & (df['date'] <= valid_end)
    test_mask = (df['date'] > valid_end) & (df['date'] <= test_end)
    
    X_train = df.loc[train_mask, feature_cols]
    y_train = df.loc[train_mask, 'label']
    X_valid = df.loc[valid_mask, feature_cols]
    y_valid = df.loc[valid_mask, 'label']
    
    print(f"\n  训练集: {len(X_train):,} ({df.loc[train_mask,'date'].min().date()} ~ {df.loc[train_mask,'date'].max().date()})")
    print(f"  验证集: {len(X_valid):,}")
    print(f"  特征数: {len(feature_cols)}")
    print(f"  模型: {'LightGBM' if HAS_LIGHTGBM else 'sklearn HistGradientBoosting'}")
    
    if HAS_LIGHTGBM:
        # ── LightGBM 路径 ──
        train_data = lgb.Dataset(X_train, label=y_train)
        valid_data = lgb.Dataset(X_valid, label=y_valid, reference=train_data)
        
        params = {
            'objective': 'regression',
            'metric': 'rmse',
            'boosting_type': 'gbdt',
            'num_leaves': 64,
            'max_depth': 7,
            'learning_rate': 0.05,
            'feature_fraction': 0.8,
            'bagging_fraction': 0.8,
            'bagging_freq': 5,
            'lambda_l1': 1,
            'lambda_l2': 1,
            'min_data_in_leaf': 100,
            'verbose': -1,
            'num_threads': 4,
            'seed': 42,
        }
        
        print("\n  训练 LightGBM...")
        model = lgb.train(
            params,
            train_data,
            valid_sets=[valid_data],
            num_boost_round=500,
            callbacks=[
                lgb.early_stopping(50),
                lgb.log_evaluation(100),
            ],
        )
        print(f"  ✅ best_iteration={model.best_iteration}, best_score={model.best_score:.4f}")
        
        # 特征重要性
        importance = pd.DataFrame({
            'feature': feature_cols,
            'importance': model.feature_importance(importance_type='gain'),
        }).sort_values('importance', ascending=False)
    
    else:
        # ── sklearn HistGradientBoosting 路径 ──
        model = HistGradientBoostingRegressor(
            loss='squared_error',
            learning_rate=0.05,
            max_iter=500,
            max_depth=7,
            max_leaf_nodes=64,
            min_samples_leaf=100,
            l2_regularization=1.0,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=50,
            random_state=42,
            verbose=0,
        )
        
        print("\n  训练 HistGradientBoosting...")
        model.fit(X_train, y_train)
        print(f"  ✅ n_iter_={model.n_iter_}, train_score={model.train_score_[-1]:.4f}")
        
        # 特征重要性
        try:
            importances = model.feature_importances_
        except AttributeError:
            # 旧版 sklearn 回退
            importances = np.ones(len(feature_cols)) / len(feature_cols)
        importance = pd.DataFrame({
            'feature': feature_cols,
            'importance': importances,
        }).sort_values('importance', ascending=False)
    print(f"\n  Top 5 特征:")
    for _, row in importance.head(5).iterrows():
        print(f"    {row['feature']:20s} {row['importance']:>10.0f}")
    
    # ── 回测 ──
    print(f"\n  回测区间: {test_start} ~ {test_end}")
    
    test_data = df.loc[test_mask].copy()
    X_test = test_data[feature_cols]
    test_data['pred'] = model.predict(X_test)
    
    # IC 评估
    dates = sorted(test_data['date'].unique())
    ic_list = []
    for date in dates:
        day_data = test_data[test_data['date'] == date]
        if len(day_data) < 50:
            continue
        ic = day_data['pred'].corr(day_data['label'])
        if not np.isnan(ic):
            ic_list.append(ic)
    
    ic_mean = np.mean(ic_list) if ic_list else 0
    ic_ir = ic_mean / (np.std(ic_list) + 1e-8) if ic_list else 0
    print(f"  IC均值: {ic_mean:.4f}, IC_IR: {ic_ir:.2f}, 观察日: {len(ic_list)}")
    
    # 模拟组合回测（等权 Top 25）
    capital = 1_000_000
    cash = capital
    positions = {}
    nav_history = []
    benchmark_history = []
    
    initial_bench = None
    
    for i, date in enumerate(dates[:-TARGET_PERIOD]):
        day_data = test_data[test_data['date'] == date]
        if len(day_data) < 25:
            continue
        
        # Top 25 预测最高
        top_stocks = day_data.nlargest(25, 'pred')
        
        next_date = dates[i + 1]
        next_data = test_data[test_data['date'] == next_date]
        next_prices = next_data.set_index('instrument')[['open', 'close']].to_dict('index')
        next_closes = {k: v['close'] for k, v in next_prices.items()}
        next_opens = {k: v['open'] for k, v in next_prices.items()}
        
        # 基准（等权全市场）
        if initial_bench is None and len(next_closes) > 0:
            initial_bench = np.mean(list(next_closes.values()))
        bench_val = np.mean(list(next_closes.values())) if next_closes else initial_bench
        if initial_bench and bench_val:
            benchmark_history.append({
                'date': str(next_date),
                'bench_nav': bench_val / initial_bench,
            })
        
        # 平仓
        for inst, shares in list(positions.items()):
            price = next_opens.get(inst)
            if price:
                cash += price * shares * 0.9985  # 0.15% 双边费用
        positions.clear()
        
        # 建仓
        if len(top_stocks) > 0:
            per_stock = cash / len(top_stocks)
            for _, row in top_stocks.iterrows():
                inst = row['instrument']
                price = next_opens.get(inst)
                if price and price > 0:
                    shares = int(per_stock * 0.99 / price / 100) * 100
                    if shares >= 100:
                        cost = price * shares * 1.0015
                        if cost <= cash:
                            cash -= cost
                            positions[inst] = shares
        
        # 记录净值
        position_value = sum(
            next_closes.get(inst, next_opens.get(inst, 0)) * shares
            for inst, shares in positions.items()
        )
        total_value = cash + position_value
        nav_history.append({
            'date': str(next_date),
            'nav': total_value,
        })
    
    if not nav_history:
        print("❌ 回测无交易日")
        return None
    
    # 指标计算
    initial_nav = capital
    final_nav = nav_history[-1]['nav']
    total_return = (final_nav / initial_nav - 1) * 100
    years = len(nav_history) / 252
    annual_return = ((final_nav / initial_nav) ** (1 / max(years, 0.01)) - 1) * 100
    
    peak = nav_history[0]['nav']
    max_dd = 0
    for n in nav_history:
        peak = max(peak, n['nav'])
        dd = (n['nav'] / peak - 1) * 100
        max_dd = min(max_dd, dd)
    
    daily_rets = []
    for j in range(1, len(nav_history)):
        daily_rets.append(nav_history[j]['nav'] / nav_history[j-1]['nav'] - 1)
    mean_ret = np.mean(daily_rets) if daily_rets else 0
    std_ret = np.std(daily_rets) if daily_rets else 0
    sharpe = (mean_ret / std_ret * np.sqrt(252)) if std_ret > 0 else 0
    
    wins = sum(1 for r in daily_rets if r > 0)
    win_rate = wins / len(daily_rets) * 100 if daily_rets else 0
    
    # 基准对比
    bench_return = 0
    if benchmark_history:
        bench_final = benchmark_history[-1]['bench_nav']
        bench_return = (bench_final - 1) * 100
    
    result = {
        'model': 'LightGBM' if HAS_LIGHTGBM else 'sklearn HistGradientBoosting',
        'framework': 'lightgbm/sklearn (同Qlib核心算法)',
        'features': len(feature_cols),
        'feature_names': feature_cols,
        'top_features': importance.head(10).to_dict('records'),
        'train_samples': len(X_train),
        'valid_samples': len(X_valid),
        'test_samples': len(test_data),
        'best_iteration': model.best_iteration if HAS_LIGHTGBM else model.n_iter_,
        'best_valid_rmse': model.best_score if HAS_LIGHTGBM else model.train_score_[-1],
        'metrics': {
            'totalReturn': round(total_return, 2),
            'annualReturn': round(annual_return, 2),
            'benchReturn': round(bench_return, 2),
            'maxDrawdown': round(max_dd, 2),
            'sharpe': round(sharpe, 2),
            'winRate': round(win_rate, 1),
            'icMean': round(ic_mean, 4),
            'icIR': round(ic_ir, 2),
        },
        'navHistory': nav_history[::max(1, len(nav_history)//50)],
        'benchmarkHistory': benchmark_history[::max(1, len(benchmark_history)//50)],
        'generatedAt': datetime.now().isoformat(),
        'testPeriod': f"{test_start} ~ {test_end}",
        'sharpeWarning': '⚠️ 夏普>3，请检查过拟合' if sharpe > 3 else '',
    }
    
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--stocks', type=int, default=1000, help='股票数量（默认1000，全量需大内存）')
    args = parser.parse_args()
    
    print("=" * 60)
    print(f"Qlib / LightGBM 基线测试 — AlphaMind 数据 ({args.stocks}只)")
    print("=" * 60)
    
    # 加载数据
    df = load_klines(n_stocks=args.stocks)
    print(f"  总行数: {len(df):,}")
    
    # 计算因子
    df = compute_factors(df)
    
    # 训练+回测
    result = train_and_backtest(df)
    if result is None:
        sys.exit(1)
    
    # 输出
    print(f"\n{'='*60}")
    print("📊 回测结果")
    print(f"{'='*60}")
    m = result['metrics']
    print(f"  测试区间:     {result['testPeriod']}")
    print(f"  累计收益:     {m['totalReturn']:.2f}%")
    print(f"  年化收益:     {m['annualReturn']:.2f}%")
    print(f"  基准收益:     {m['benchReturn']:.2f}%")
    print(f"  最大回撤:     {m['maxDrawdown']:.2f}%")
    print(f"  夏普比率:     {m['sharpe']:.2f}")
    print(f"  胜率:        {m['winRate']:.1f}%")
    print(f"  IC均值:      {m['icMean']:.4f}")
    print(f"  IC_IR:       {m['icIR']:.2f}")
    if result['sharpeWarning']:
        print(f"  {result['sharpeWarning']}")
    
    # 保存
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)
    print(f"\n💾 结果已保存: {OUTPUT_FILE}")
    
    # ── 对比 AlphaMind 现有 ML 结果 ──
    print(f"\n{'='*60}")
    print("📊 对比: Qlib基线 vs AlphaMind现有ML")
    print(f"{'='*60}")
    
    am_metrics = {
        'totalReturn': 8425.0,
        'annualReturn': 67.9,
        'maxDrawdown': -29.1,
        'sharpe': 2.21,
        'winRate': 60.6,
        'icMean': 0.0825,
    }
    
    print(f"{'指标':<16} {'Qlib基线':>10} {'AlphaMind ML':>12} {'差异':>10}")
    print(f"{'-'*50}")
    comparisons = [
        ('累计收益%', m['totalReturn'], am_metrics['totalReturn']),
        ('年化收益%', m['annualReturn'], am_metrics['annualReturn']),
        ('最大回撤%', m['maxDrawdown'], am_metrics['maxDrawdown']),
        ('夏普比率', m['sharpe'], am_metrics['sharpe']),
        ('胜率%', m['winRate'], am_metrics['winRate']),
        ('IC均值', m['icMean'], am_metrics['icMean']),
    ]
    for label, qlib_val, am_val in comparisons:
        diff = qlib_val - am_val
        sign = '+' if diff > 0 else ''
        print(f"{label:<16} {qlib_val:>10.2f} {am_val:>12.2f} {sign}{diff:>9.2f}")
    
    print(f"\n{'='*60}")
    note = (
        "注意: Qlib基线=1000只股票+15个通用因子+LightGBM\n"
        "      AlphaMind ML=全量5540只+ML复合因子+PIT防偏+多模型集成\n"
        "      回测区间不同，绝对值不可直接比，关注相对结构差异"
    )
    print(note)
    print(f"{'='*60}")
    
    return result


if __name__ == '__main__':
    main()
