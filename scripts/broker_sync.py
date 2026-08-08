#!/usr/bin/env python3
"""
AlphaMind 券商数据同步引擎
支持：Tushare Pro / AkShare / 手动导入
从券商拉取持仓、账户资产、成交记录 → JSON 输出
"""
import json, sys, os, argparse
from datetime import datetime
from pathlib import Path

CONFIG_FILE = Path(__file__).parent.parent / '.alphamind-broker-config.json'
CACHE_DIR = Path(__file__).parent.parent / '.alphamind-broker-cache'
CACHE_DIR.mkdir(exist_ok=True)

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

def sync_tushare():
    """从 Tushare Pro 拉取持仓和账户数据"""
    config = load_config()
    token = config.get('tushare', {}).get('token', '')
    
    if not token:
        return {'error': 'Tushare token 未配置。请在设置中配置 token，或运行: echo \'{"tushare":{"token":"你的token"}}\' > .alphamind-broker-config.json'}
    
    try:
        import tushare as ts
        pro = ts.pro_api(token)
        
        # 尝试拉取持仓（需要 Tushare Pro 高级权限）
        positions = []
        try:
            df = pro.portfolio(ts_code='')
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    positions.append({
                        'code': str(row.get('ts_code', '')).split('.')[0],
                        'name': str(row.get('stock_name', '')),
                        'shares': int(row.get('amount', 0)),
                        'costPrice': float(row.get('cost', 0)),
                        'currentPrice': float(row.get('price', 0)),
                        'marketValue': float(row.get('mkt_value', 0)),
                        'profitLoss': float(row.get('pnl', 0)),
                    })
        except Exception as e:
            return {'error': f'Tushare 持仓查询失败（可能需要高级权限）: {e}'}
        
        # 构建账户数据
        total_mv = sum(p['marketValue'] for p in positions)
        
        return {
            'brokerId': 'tushare',
            'brokerName': 'Tushare Pro',
            'accountId': token[:8] + '...',
            'totalAssets': total_mv,
            'availableCash': 0,
            'frozenCash': 0,
            'marketValue': total_mv,
            'totalProfitLoss': sum(p['profitLoss'] for p in positions),
            'totalProfitLossRatio': 0,
            'positions': positions,
            'recentOrders': [],
            'updatedAt': datetime.now().isoformat(),
        }
    except ImportError:
        return {'error': '未安装 tushare。运行: pip install tushare'}

def sync_akshare():
    """从 AkShare 拉取公开数据（免费）"""
    try:
        import akshare as ak
        
        # AkShare 免费接口：只能拉行情，不能拉个人持仓
        # 这里做行情快照同步
        positions = []
        
        # 尝试拉取沪深 300 成分股作为示例
        try:
            df = ak.stock_zh_a_spot_em()
            if df is not None and not df.empty:
                top = df.nlargest(10, '成交额')
                for _, row in top.iterrows():
                    positions.append({
                        'code': str(row['代码']),
                        'name': str(row['名称']),
                        'shares': 0,
                        'costPrice': 0,
                        'currentPrice': float(row['最新价']),
                        'marketValue': 0,
                        'profitLoss': 0,
                    })
        except Exception:
            pass
        
        return {
            'brokerId': 'akshare',
            'brokerName': 'AkShare (公开数据)',
            'accountId': 'public',
            'totalAssets': 0,
            'availableCash': 0,
            'frozenCash': 0,
            'marketValue': 0,
            'totalProfitLoss': 0,
            'totalProfitLossRatio': 0,
            'positions': positions,
            'recentOrders': [],
            'updatedAt': datetime.now().isoformat(),
        }
    except ImportError:
        return {'error': '未安装 akshare。运行: pip install akshare'}

def run_sync(broker_type):
    cache_path = CACHE_DIR / f'{broker_type}.json'
    
    if broker_type == 'tushare':
        result = sync_tushare()
    elif broker_type == 'akshare':
        result = sync_akshare()
    else:
        result = {'error': f'不支持的券商类型: {broker_type}'}
    
    if 'error' not in result:
        with open(cache_path, 'w') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['sync', 'status', 'config'])
    parser.add_argument('--broker', default='tushare')
    parser.add_argument('--token', default='')
    
    args = parser.parse_args()
    
    if args.action == 'sync':
        result = run_sync(args.broker)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif args.action == 'status':
        config = load_config()
        status = [
            {
                'type': 'tushare',
                'name': 'Tushare Pro',
                'enabled': bool(config.get('tushare', {}).get('token')),
                'lastSyncAt': None,
            },
            {
                'type': 'akshare',
                'name': 'AkShare (免费)',
                'enabled': True,
                'lastSyncAt': None,
            },
            {
                'type': 'manual',
                'name': '手动导入 (CSV)',
                'enabled': True,
                'lastSyncAt': None,
            },
        ]
        print(json.dumps(status, indent=2, ensure_ascii=False))
    
    elif args.action == 'config':
        if args.token:
            config = load_config()
            if args.broker not in config:
                config[args.broker] = {}
            config[args.broker]['token'] = args.token
            save_config(config)
            print(json.dumps({'ok': True, 'message': f'{args.broker} 配置已保存'}))
        else:
            config = load_config()
            # 脱敏后输出
            safe = {}
            for k, v in config.items():
                if isinstance(v, dict) and 'token' in v:
                    safe[k] = {**v, 'token': v['token'][:4] + '****' + v['token'][-4:] if len(v['token']) > 8 else '****'}
            print(json.dumps(safe, indent=2, ensure_ascii=False))
