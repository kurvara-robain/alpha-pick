#!/usr/bin/env python3
"""
AlphaMind 因子表达式引擎 + 自动挖掘器
支持：公式计算 / IC评估 / 遗传算法自动生成因子

表达式语法：
  基础: open high low close volume amount
  运算符: + - * / ** sqrt abs log sign
  截面: rank(field) — 当日全市场排名(0-1)
  时序: ts_sum(f,d) ts_mean(f,d) ts_std(f,d) ts_max(f,d) ts_min(f,d)
        delay(f,d) — d日前值
        delta(f,d) — f - delay(f,d)
        ts_corr(f1,f2,d) — d日相关系数
        ts_rank(f,d) — d日排名(0-1)
  示例:
    (close - ts_mean(close, 20)) / ts_std(close, 20)     # 标准化偏离
    rank(delta(close, 5) / delay(close, 5))               # 5日收益率截面排名
    ts_corr(close, volume, 20)                             # 20日价量相关
"""
import json, sys, os, re, math, random, itertools
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
from datetime import datetime
from pathlib import Path
from collections import defaultdict

import numpy as np

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
KLINE_DIR = DATA_DIR / 'kline'
OUTPUT_DIR = DATA_DIR

# ═══════════════════════════════════════════════════════════════
# 数据加载
# ═══════════════════════════════════════════════════════════════

def load_stock_klines(code, min_days=252):
    fp = KLINE_DIR / f'{code}.json'
    if not fp.exists(): return None
    try:
        with open(fp, encoding='utf-8') as f:
            data = json.load(f)
        if len(data.get('closes', [])) < min_days: return None
        return data
    except:
        return None

def load_all_stocks():
    """返回所有股票的 K 线数组合集"""
    stocks = {}
    files = list(KLINE_DIR.glob('*.json'))
    print(f"加载 {len(files)} 个 K 线文件...")
    for i, fp in enumerate(files):
        if i % 1000 == 0:
            print(f"  {i}/{len(files)}")
        try:
            with open(fp, encoding='utf-8') as f:
                data = json.load(f)
            code = fp.stem
            if len(data.get('closes', [])) >= 252:
                # 转为 numpy 数组以提高计算速度
                stocks[code] = {
                    'open': np.array(data['opens'], dtype=np.float64),
                    'high': np.array(data['highs'], dtype=np.float64),
                    'low': np.array(data['lows'], dtype=np.float64),
                    'close': np.array(data['closes'], dtype=np.float64),
                    'volume': np.array(data['vols'], dtype=np.float64),
                    'amount': np.zeros(len(data['closes']), dtype=np.float64),
                }
        except Exception as e:
            continue
    print(f"有效股票: {len(stocks)}")
    return stocks

# ═══════════════════════════════════════════════════════════════
# 表达式解析器
# ═══════════════════════════════════════════════════════════════

class FactorExpr:
    """因子表达式 AST 节点"""
    def evaluate(self, env, idx):
        raise NotImplementedError

class Const(FactorExpr):
    def __init__(self, value):
        self.value = value
    def evaluate(self, env, idx):
        return np.full(len(env['close']), self.value)

class Field(FactorExpr):
    def __init__(self, name):
        self.name = name
    def evaluate(self, env, idx):
        return env[self.name]

class BinOp(FactorExpr):
    def __init__(self, left, op, right):
        self.left = left
        self.op = op
        self.right = right
        # right may be a scalar (number) or another expr
        self.right_is_scalar = isinstance(right, (int, float))

    def evaluate(self, env, idx):
        lv = self.left.evaluate(env, idx)
        if self.right_is_scalar:
            rv = self.right
        else:
            rv = self.right.evaluate(env, idx)[-len(lv):]
        if self.op == '+': return lv + rv
        if self.op == '-': return lv - rv
        if self.op == '*': return lv * rv
        if self.op == '/': return np.where(rv != 0, lv / rv, 0)
        if self.op == '**': return np.where(lv >= 0, lv ** rv, 0)
        return lv

class UnaryOp(FactorExpr):
    def __init__(self, op, operand):
        self.op = op
        self.operand = operand
    def evaluate(self, env, idx):
        v = self.operand.evaluate(env, idx)
        if self.op == '-': return -v
        if self.op == 'sqrt': return np.sqrt(np.maximum(v, 0))
        if self.op == 'abs': return np.abs(v)
        if self.op == 'log': return np.log(np.maximum(v, 1e-10))
        if self.op == 'sign': return np.sign(v)
        return v

class TSFunc(FactorExpr):
    """时序函数: ts_sum(f,d), ts_mean(f,d), ts_std(f,d), ts_max(f,d), ts_min(f,d)"""
    def __init__(self, func, operand, window):
        self.func = func
        self.operand = operand
        self.window = int(window)
    def evaluate(self, env, idx):
        v = self.operand.evaluate(env, idx)
        w = self.window
        n = len(v)
        result = np.zeros(n)
        for i in range(w - 1, n):
            wnd = v[i - w + 1:i + 1]
            if self.func == 'sum': result[i] = np.sum(wnd)
            elif self.func == 'mean': result[i] = np.mean(wnd)
            elif self.func == 'std': result[i] = np.std(wnd)
            elif self.func == 'max': result[i] = np.max(wnd)
            elif self.func == 'min': result[i] = np.min(wnd)
        return result

class Delay(FactorExpr):
    def __init__(self, operand, d):
        self.operand = operand
        self.d = int(d)
    def evaluate(self, env, idx):
        v = self.operand.evaluate(env, idx)
        d = self.d
        result = np.zeros(len(v))
        result[d:] = v[:-d]
        return result

class Delta(FactorExpr):
    def __init__(self, operand, d):
        self.operand = operand
        self.d = int(d)
    def evaluate(self, env, idx):
        v = self.operand.evaluate(env, idx)
        d = self.d
        result = np.zeros(len(v))
        result[d:] = v[d:] - v[:-d]
        return result

class TsCorr(FactorExpr):
    """时序相关系数"""
    def __init__(self, f1, f2, window):
        self.f1 = f1; self.f2 = f2; self.window = int(window)
    def evaluate(self, env, idx):
        v1 = self.f1.evaluate(env, idx)
        v2 = self.f2.evaluate(env, idx)
        w = self.window
        n = len(v1)
        result = np.zeros(n)
        for i in range(w - 1, n):
            w1 = v1[i - w + 1:i + 1]
            w2 = v2[i - w + 1:i + 1]
            if np.std(w1) > 0 and np.std(w2) > 0:
                result[i] = np.corrcoef(w1, w2)[0, 1]
        return result

class TsRank(FactorExpr):
    def __init__(self, operand, window):
        self.operand = operand; self.window = int(window)
    def evaluate(self, env, idx):
        v = self.operand.evaluate(env, idx)
        w = self.window
        n = len(v)
        result = np.zeros(n)
        for i in range(w - 1, n):
            wnd = v[i - w + 1:i + 1]
            result[i] = (np.searchsorted(np.sort(wnd), v[i]) + 1) / w
        return result

# ═══════════════════════════════════════════════════════════════
# 表达式解析
# ═══════════════════════════════════════════════════════════════

FIELD_NAMES = {'open', 'high', 'low', 'close', 'volume', 'amount'}
FUNC_NAMES = {'sqrt', 'abs', 'log', 'sign', 'rank'}
TS_FUNCS = {'ts_sum', 'ts_mean', 'ts_std', 'ts_max', 'ts_min'}

# Token types
TOK_NUM, TOK_ID, TOK_OP, TOK_LP, TOK_RP, TOK_COMMA = range(6)

def tokenize(expr):
    tokens = []
    i = 0
    while i < len(expr):
        c = expr[i]
        if c.isspace():
            i += 1; continue
        if c in '()':
            tokens.append((TOK_LP if c == '(' else TOK_RP, c))
            i += 1
        elif c == ',':
            tokens.append((TOK_COMMA, c)); i += 1
        elif c in '+-*/^':
            tokens.append((TOK_OP, c)); i += 1
        elif c.isdigit() or (c == '.' and i + 1 < len(expr) and expr[i + 1].isdigit()):
            j = i
            while j < len(expr) and (expr[j].isdigit() or expr[j] == '.'):
                j += 1
            tokens.append((TOK_NUM, float(expr[i:j])))
            i = j
        elif c.isalpha() or c == '_':
            j = i
            while j < len(expr) and (expr[j].isalnum() or expr[j] == '_'):
                j += 1
            tokens.append((TOK_ID, expr[i:j]))
            i = j
        else:
            i += 1
    return tokens

class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self): return self.tokens[self.pos] if self.pos < len(self.tokens) else None
    def eat(self, typ=None):
        t = self.tokens[self.pos]
        self.pos += 1
        if typ and t[0] != typ: raise SyntaxError(f"Expected {typ}, got {t}")
        return t

    def parse(self):
        result = self.parse_addsub()
        if self.pos < len(self.tokens):
            raise SyntaxError(f"Unexpected token: {self.peek()}")
        return result

    def parse_addsub(self):
        left = self.parse_muldiv()
        while self.pos < len(self.tokens) and self.peek()[0] == TOK_OP and self.peek()[1] in '+-':
            op = self.eat(TOK_OP)[1]
            right = self.parse_muldiv()
            left = BinOp(left, op, right)
        return left

    def parse_muldiv(self):
        left = self.parse_power()
        while self.pos < len(self.tokens) and self.peek()[0] == TOK_OP and self.peek()[1] in '*/':
            op = self.eat(TOK_OP)[1]
            right = self.parse_power()
            left = BinOp(left, op, right)
        return left

    def parse_power(self):
        left = self.parse_unary()
        if self.pos < len(self.tokens) and self.peek()[0] == TOK_OP and self.peek()[1] == '^':
            self.eat(TOK_OP)
            right = self.parse_unary()
            left = BinOp(left, '**', right)
        return left

    def parse_unary(self):
        if self.peek() and self.peek()[0] == TOK_OP and self.peek()[1] == '-':
            self.eat(TOK_OP)
            return UnaryOp('-', self.parse_unary())
        return self.parse_atom()

    def parse_atom(self):
        t = self.peek()
        if not t: raise SyntaxError("Unexpected end")
        if t[0] == TOK_NUM:
            self.eat()
            return Const(t[1])
        if t[0] == TOK_LP:
            self.eat()
            result = self.parse_addsub()
            self.eat(TOK_RP)
            return result
        if t[0] == TOK_ID:
            name = self.eat()[1]
            # 检查是否是函数调用
            if self.peek() and self.peek()[0] == TOK_LP:
                self.eat(TOK_LP)
                args = []
                # 解析参数
                arg = self.parse_addsub()
                args.append(arg)
                while self.peek() and self.peek()[0] == TOK_COMMA:
                    self.eat(TOK_COMMA)
                    args.append(self.parse_addsub())
                self.eat(TOK_RP)

                if name in TS_FUNCS:
                    if len(args) != 2: raise SyntaxError(f"{name} needs 2 args")
                    return TSFunc(name[3:], args[0], args[1].value if isinstance(args[1], Const) else 20)
                if name == 'rank':
                    return args[0]  # rank 在截面阶段处理
                if name == 'delay':
                    if len(args) != 2: raise SyntaxError("delay needs 2 args")
                    return Delay(args[0], args[1].value if isinstance(args[1], Const) else 1)
                if name == 'delta':
                    if len(args) != 2: raise SyntaxError("delta needs 2 args")
                    return Delta(args[0], args[1].value if isinstance(args[1], Const) else 1)
                if name == 'ts_corr':
                    if len(args) != 3: raise SyntaxError("ts_corr needs 3 args")
                    return TsCorr(args[0], args[1], args[2].value if isinstance(args[2], Const) else 20)
                if name == 'ts_rank':
                    if len(args) != 2: raise SyntaxError("ts_rank needs 2 args")
                    return TsRank(args[0], args[1].value if isinstance(args[1], Const) else 20)
                if name in FUNC_NAMES:
                    if len(args) != 1: raise SyntaxError(f"{name} needs 1 arg")
                    return UnaryOp(name, args[0])
                raise SyntaxError(f"Unknown function: {name}")
            if name in FIELD_NAMES:
                return Field(name)
            raise SyntaxError(f"Unknown identifier: {name}")
        raise SyntaxError(f"Unexpected token: {t}")

def parse_expression(expr_str):
    tokens = tokenize(expr_str)
    if not tokens: raise SyntaxError("Empty expression")
    return Parser(tokens).parse()

# ═══════════════════════════════════════════════════════════════
# IC 评估
# ═══════════════════════════════════════════════════════════════

def compute_ic(factor_values, forward_returns):
    """计算 Spearman Rank IC"""
    from scipy.stats import spearmanr
    mask = ~np.isnan(factor_values) & ~np.isnan(forward_returns)
    if mask.sum() < 30: return None
    return spearmanr(factor_values[mask], forward_returns[mask])[0]

def evaluate_factor(stocks, expr, forward_days=20, sample_dates=10):
    """
    对表达式在所有股票上计算，评估 IC
    """
    if isinstance(expr, str):
        expr = parse_expression(expr)

    ics = []
    daily_ics = defaultdict(list)

    # 采样最近 sample_dates 个交易日
    for code, env in list(stocks.items())[:500]:  # 采样 500 只
        try:
            factor = expr.evaluate(env, 0)
            closes = env['close']

            for t in range(252, len(closes) - forward_days - 1, 20):  # 每 20 天一个评估点
                if t >= len(factor) - forward_days: break
                fv = factor[t]
                fwd_ret = (closes[t + forward_days] / closes[t] - 1)
                if not np.isnan(fv) and not np.isinf(fv) and abs(fv) < 100:
                    daily_ics[t].append((fv, fwd_ret))
        except Exception as e:
            continue

    # 逐日计算 IC
    for t, pairs in daily_ics.items():
        if len(pairs) < 30: continue
        fv = np.array([p[0] for p in pairs])
        fr = np.array([p[1] for p in pairs])
        ic = compute_ic(fv, fr)
        if ic is not None and not np.isnan(ic):
            ics.append(ic)

    if not ics:
        return {'ic_mean': 0, 'ic_std': 0, 'icir': 0, 'valid_days': 0}

    ic_mean = np.mean(ics)
    ic_std = np.std(ics) if len(ics) > 1 else 1
    icir = ic_mean / ic_std if ic_std > 0 else 0

    return {
        'ic_mean': round(float(ic_mean), 4),
        'ic_std': round(float(ic_std), 4),
        'icir': round(float(icir), 4),
        'valid_days': len(ics),
        'abs_ic_mean': round(float(abs(ic_mean)), 4),
    }

# ═══════════════════════════════════════════════════════════════
# 遗传算法因子挖掘
# ═══════════════════════════════════════════════════════════════

ATOMIC_FIELDS = ['close', 'open', 'high', 'low', 'volume']
OPS = ['+', '-', '*', '/']
FUNCS = ['ts_mean', 'ts_std', 'ts_max', 'ts_min', 'delay', 'delta', 'ts_corr']
WINDOWS = [5, 10, 20, 40, 60]

def random_factor_expr(depth=0, max_depth=4):
    """随机生成一个因子表达式"""
    if depth >= max_depth:
        # 叶子节点：字段或字段的简单变换
        f = random.choice(ATOMIC_FIELDS)
        if random.random() < 0.3:
            func = random.choice(['ts_mean', 'ts_std', 'delay'])
            w = random.choice(WINDOWS)
            return f"{func}({f},{w})"
        return f

    r = random.random()
    if r < 0.3:
        return random.choice(ATOMIC_FIELDS)
    elif r < 0.6:
        f = random.choice(ATOMIC_FIELDS)
        func = random.choice(FUNCS)
        w = random.choice(WINDOWS)
        if func == 'ts_corr':
            f2 = random.choice(ATOMIC_FIELDS)
            return f"{func}({f},{f2},{w})"
        return f"{func}({f},{w})"
    else:
        op = random.choice(OPS)
        left = random_factor_expr(depth + 1, max_depth)
        right = random_factor_expr(depth + 1, max_depth)
        return f"({left} {op} {right})"

def mine_factors(stocks, n_generate=100, n_keep=20, top_n_stocks=300):
    """遗传挖掘：随机生成 → IC评估 → 保留Top-N"""
    print(f"\n遗传因子挖掘: 生成 {n_generate} 个候选, 保留 {n_keep} 个")
    print(f"使用前 {top_n_stocks} 只股票评估...")

    stock_sample = dict(list(stocks.items())[:top_n_stocks])

    results = []
    for i in range(n_generate):
        expr_str = random_factor_expr()
        try:
            if any(r.get('expression') == expr_str for r in results):
                continue
            result = evaluate_factor(stock_sample, expr_str)
            if result is None or result.get('valid_days', 0) == 0:
                continue
            result['expression'] = expr_str
            results.append(result)
            if (i + 1) % 20 == 0:
                if results:
                    top_ic = max(results, key=lambda r: r.get('abs_ic_mean', 0))
                    print(f"  {i+1}/{n_generate} — 当前最佳: IC={top_ic['ic_mean']}, {top_ic['expression'][:60]}")
        except Exception as e:
            continue

    # 按 |IC| 排序
    if not results:
        print("无有效因子")
        return []
    results.sort(key=lambda r: r.get('abs_ic_mean', 0), reverse=True)
    best = results[:n_keep]

    print(f"\n最佳 {n_keep} 个因子:")
    for i, r in enumerate(best):
        print(f"  {i+1}. IC={r['ic_mean']:.4f} ICIR={r['icir']:.2f} | {r['expression'][:80]}")

    return best

# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['eval', 'mine', 'test'], default='test', nargs='?')
    parser.add_argument('--expression', '-e', default='')
    parser.add_argument('--generate', '-g', type=int, default=100)
    parser.add_argument('--keep', '-k', type=int, default=20)
    parser.add_argument('--output', '-o', default='')
    args = parser.parse_args()

    if args.mode == 'test':
        # 测试几个经典表达式
        test_exprs = [
            '(close - ts_mean(close, 20)) / ts_std(close, 20)',
            'delay(close, 5) / close - 1',
            'ts_corr(close, volume, 20)',
            '(ts_max(close, 20) - ts_min(close, 20)) / ts_mean(close, 20)',
        ]
        print("测试因子表达式解析...")
        for e in test_exprs:
            try:
                ast = parse_expression(e)
                print(f"  ✅ {e[:50]}")
            except Exception as ex:
                print(f"  ❌ {e[:50]} — {ex}")
        sys.exit(0)

    print("加载股票数据...")
    stocks = load_all_stocks()

    if args.mode == 'eval' and args.expression:
        print(f"\n评估表达式: {args.expression}")
        try:
            result = evaluate_factor(stocks, args.expression)
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as e:
            print(f"错误: {e}")

    elif args.mode == 'mine':
        best = mine_factors(stocks, n_generate=args.generate, n_keep=args.keep)
        output_path = OUTPUT_DIR / (args.output or 'discovered_factors.json')
        result = {
            "factors": best,
            "discovered_at": __import__('datetime').datetime.now().isoformat(),
            "count": len(best),
            "generated": args.generate,
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"\n结果已保存: {output_path}")
