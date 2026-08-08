"""AlphaMind 因子引擎 v2（因子评估层，长期运行）。

标准多因子研究框架的「因子评估」环节：
- 约 55 个日频 OHLCV 技术因子（核心 + 自研候选），统一全市场截面 IC 实测
- 衰减分析：前瞻 5/10/20/40 日四档 IC
- 方向化 IC（dic）、ICIR（IC均值/标准差）、t 值、胜率、top30%-bottom30% 多空利差
- 结果累积写入 public/data/factor-research.json（history 保留 52 期）

方法：过去一年每隔 10 个交易日取评估日，计算全市场截面因子值与前瞻收益的
Spearman 秩相关。dir 为文献预期方向，dic 为方向化后的 IC（正=符合预期）。

同时暴露 compute_factor_arrays() / FACTORS，供 ml-composite.py（树模型合成）复用。
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
KLINE = DATA / "kline"
OUT = DATA / "factor-research.json"

STEP = 10
MIN_BARS = 280     # 需要 250 日动量/均线，提高最低 K 线数
FWD = (5, 10, 20, 40)
MAX_HIST = 52
MIN_OBS = 500      # 截面最少股票数

# ──────────────────────────────────────────────────────────────
# 因子注册表：(field, 名称, 预期方向, 类别)  asc=值小好 desc=值大好
# ──────────────────────────────────────────────────────────────
FACTORS = [
    # —— 核心（已在因子库）——
    ("vol20",   "低波动率(20日)",    "asc",  "core"),
    ("vol60",   "中期波动(60日)",    "asc",  "core"),
    ("cpv20",   "量价背离 CPV(20日)", "asc",  "core"),
    ("cpv10",   "量价背离 CPV(10日)", "asc",  "core"),
    ("vcv20",   "量能稳定度(20日)",  "asc",  "core"),
    ("ret5",    "短期反转(5日)",     "asc",  "core"),
    ("sharpe20", "动量质量 Sharpe",  "desc", "core"),
    ("maxdd60", "回撤控制(60日)",    "asc",  "core"),
    ("mom20",   "ROC-20 动量",       "desc", "core"),
    ("mom60",   "ROC-60 动量",       "desc", "core"),
    # —— 波动/风险类候选 ——
    ("vol120",  "长期波动(120日)",   "asc",  "candidate"),
    ("maxdd120", "回撤控制(120日)",  "asc",  "candidate"),
    ("atr14",   "ATR 真实波幅占比",  "asc",  "candidate"),
    ("range20", "日内振幅(20日均)",  "asc",  "candidate"),
    ("park20",  "Parkinson 波动率",  "asc",  "candidate"),
    ("dsvol20", "下行半波(20日)",    "asc",  "candidate"),
    ("skew20",  "收益偏度(20日)",    "asc",  "candidate"),
    ("kurt20",  "收益峰度(20日)",    "asc",  "candidate"),
    # —— 量价类候选 ——
    ("cpv60",   "量价背离 CPV(60日)", "asc",  "candidate"),
    ("vcv60",   "量能稳定度(60日)",  "asc",  "candidate"),
    ("vr560",   "量能比(5/60日)",    "asc",  "candidate"),
    ("vr2060",  "量能比(20/60日)",   "asc",  "candidate"),
    ("illiq20", "Amihud 非流动性",   "desc", "candidate"),
    ("mfi14",   "资金流量 MFI(14)",  "asc",  "candidate"),
    ("obv20",   "OBV 趋势(20日斜率)", "desc", "candidate"),
    ("clv20",   "收盘位置 CLV(20日)", "asc",  "candidate"),
    ("ushadow20", "上影线占比(20日)", "asc",  "candidate"),
    ("lshadow20", "下影线占比(20日)", "desc", "candidate"),
    # —— 动量/反转类候选 ——
    ("ret10",   "反转(10日)",        "asc",  "candidate"),
    ("ret20",   "反转(20日)",        "asc",  "candidate"),
    ("mom120",  "动量(120日)",       "desc", "candidate"),
    ("mom250",  "动量(250日)",       "desc", "candidate"),
    ("accel20", "动量加速度(20日)",  "desc", "candidate"),
    ("rsi6",    "RSI(6日)",          "asc",  "candidate"),
    ("rsi12",   "RSI(12日)",         "asc",  "candidate"),
    ("bias5",   "乖离率 BIAS(5日)",  "asc",  "candidate"),
    ("bias20",  "乖离率 BIAS(20日)", "asc",  "candidate"),
    ("bias60",  "乖离率 BIAS(60日)", "asc",  "candidate"),
    ("wr14",    "威廉指标 WR(14)",   "desc", "candidate"),
    ("cci14",   "CCI(14日)",         "asc",  "candidate"),
    ("kdjj",    "KDJ-J 值",          "asc",  "candidate"),
    ("bollb20", "布林带位置 %B(20)", "asc",  "candidate"),
    ("macdh",   "MACD 柱(DIF-DEA)",  "desc", "candidate"),
    ("sharpe60", "Sharpe(60日)",     "desc", "candidate"),
    # —— 结构/位置类候选 ——
    ("high250", "距 250 日高点",     "desc", "candidate"),
    ("low250",  "距 250 日低点",     "asc",  "candidate"),
    ("mabull",  "均线多头得分",      "desc", "candidate"),
    ("abovecnt", "站上均线计数(5/10/20/60)", "desc", "candidate"),
    ("consec",  "连续上涨天数",      "asc",  "candidate"),
    ("bigup20", "暴涨计数(20日>5%)", "asc",  "candidate"),
    ("bigdown20", "暴跌计数(20日<-5%)", "desc", "candidate"),
    ("gap20",   "跳空计数(20日>|2%|)", "asc",  "candidate"),
    # —— 资金流类（Tushare moneyflow 主力净流入，research-data/moneyflow/）——
    ("mfNet5",  "主力净流入占比(5日)",  "desc", "moneyflow"),
    ("mfNet10", "主力净流入占比(10日)", "desc", "moneyflow"),
    ("mfNet20", "主力净流入占比(20日)", "desc", "moneyflow"),
    ("mfElg20", "特大单净流入占比(20日)", "desc", "moneyflow"),
    ("mfTrend", "资金流趋势(20日差分)", "desc", "moneyflow"),
]

# ──────────────────────────────────────────────────────────────
# 底层工具
# ──────────────────────────────────────────────────────────────

def sw(a, w):
    if len(a) < w:
        return None
    return np.lib.stride_tricks.sliding_window_view(a, w)


def roll_mean(a, w):
    v = sw(a, w)
    return v.mean(axis=1) if v is not None else None


def roll_sum(a, w):
    v = sw(a, w)
    return v.sum(axis=1) if v is not None else None


def roll_std(a, w):
    v = sw(a, w)
    return v.std(axis=1) if v is not None else None


def roll_min(a, w):
    v = sw(a, w)
    return v.min(axis=1) if v is not None else None


def roll_max(a, w):
    v = sw(a, w)
    return v.max(axis=1) if v is not None else None


def roll_corr(x, y, w):
    if len(x) < w:
        return None
    xs = sw(x, w)
    ys = sw(y, w)
    xm = xs.mean(axis=1)
    ym = ys.mean(axis=1)
    cov = (xs * ys).mean(axis=1) - xm * ym
    vx = (xs * xs).mean(axis=1) - xm * xm
    vy = (ys * ys).mean(axis=1) - ym * ym
    den = np.sqrt(np.maximum(vx, 0) * np.maximum(vy, 0))
    out = np.full(len(xm), np.nan)
    ok = den > 1e-12
    out[ok] = cov[ok] / den[ok]
    return out


def roll_skew(a, w):
    v = sw(a, w)
    if v is None:
        return None
    m = v.mean(axis=1, keepdims=True)
    d = v - m
    m2 = (d ** 2).mean(axis=1)
    m3 = (d ** 3).mean(axis=1)
    return m3 / np.power(np.maximum(m2, 1e-18), 1.5)


def roll_kurt(a, w):
    v = sw(a, w)
    if v is None:
        return None
    m = v.mean(axis=1, keepdims=True)
    d = v - m
    m2 = (d ** 2).mean(axis=1)
    m4 = (d ** 4).mean(axis=1)
    return m4 / np.maximum(m2 * m2, 1e-18) - 3.0


def ema(a, span):
    alpha = 2.0 / (span + 1)
    out = np.empty(len(a))
    out[0] = a[0]
    for i in range(1, len(a)):
        out[i] = alpha * a[i] + (1 - alpha) * out[i - 1]
    return out


def pad(arr, n, w):
    """rolling valid 结果（长度 n-w+1）补 nan 到全长 n。"""
    if arr is None:
        return np.full(n, np.nan)
    out = np.full(n, np.nan)
    out[w - 1:] = arr
    return out


def safe_div(a, b):
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(np.abs(b) > 1e-12, a / np.where(np.abs(b) > 1e-12, b, 1), np.nan)


# ──────────────────────────────────────────────────────────────
# 因子计算：输入 OHLCV 数组，输出 {field: 全长因子序列（nan padding）}
# ──────────────────────────────────────────────────────────────

def compute_factor_arrays(c, o, h, l, v, mf=None):
    """mf：可选资金流三元组 (netMain, netElg, buyTotal)，须已对齐 K 线日期（等长、缺数据 NaN）。
    为 None 时 5 个 moneyflow 因子全 NaN（优雅降级；ml-composite 旧调用不受影响）。"""
    n = len(c)
    out = {}
    r = np.full(n, np.nan)
    r[1:] = c[1:] / c[:-1] - 1.0
    r0 = np.nan_to_num(r)
    rstd = {w: roll_std(r, w) for w in (5, 20, 60, 120)}
    rmean = {w: roll_mean(r, w) for w in (20, 60)}
    ann = math.sqrt(252) * 100

    # 波动/风险
    for w in (20, 60, 120):
        out[f"vol{w}"] = pad(rstd[w] * ann if rstd[w] is not None else None, n, w)
    dd = c / np.maximum.accumulate(c) - 1.0
    for w in (60, 120):
        out[f"maxdd{w}"] = pad(roll_min(dd, w), n, w) * 100
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = roll_mean(tr, 14)
    out["atr14"] = pad(safe_div(atr, c[13:] if atr is not None else atr), n, 14) * 100
    rng = safe_div(h - l, c)
    out["range20"] = pad(roll_mean(rng, 20), n, 20) * 100
    with np.errstate(invalid="ignore", divide="ignore"):
        loghl = np.log(h / np.maximum(l, 1e-9))
    park = roll_mean(loghl ** 2, 20)
    out["park20"] = pad(np.sqrt(np.maximum(park, 0) / (4 * math.log(2))) * ann if park is not None else None, n, 20)
    downside = np.where(r0 < 0, r0, 0.0)
    out["dsvol20"] = pad(roll_std(downside, 20), n, 20) * ann
    out["skew20"] = pad(roll_skew(r0, 20), n, 20)
    out["kurt20"] = pad(roll_kurt(r0, 20), n, 20)

    # 量价
    for w in (10, 20, 60):
        out[f"cpv{w}"] = pad(roll_corr(c, v, w), n, w)
    vmean = {w: roll_mean(v, w) for w in (5, 20, 60)}
    vstd = {w: roll_std(v, w) for w in (20, 60)}
    out["vcv20"] = pad(safe_div(vstd[20], vmean[20]), n, 20)
    out["vcv60"] = pad(safe_div(vstd[60], vmean[60]), n, 60)
    out["vr560"] = pad(safe_div(vmean[5][60 - 5:] if vmean[5] is not None else None, vmean[60]), n, 60)
    out["vr2060"] = pad(safe_div(vmean[20][60 - 20:] if vmean[20] is not None else None, vmean[60]), n, 60)
    illiq = np.abs(r0) / np.maximum(v, 1.0)
    out["illiq20"] = pad(roll_mean(illiq, 20), n, 20) * 1e9
    # MFI(14)
    tp = (h + l + c) / 3
    rmf = tp * v
    tpdiff = np.diff(tp, prepend=tp[0])
    pos = np.where(tpdiff > 0, rmf, 0.0)
    neg = np.where(tpdiff < 0, rmf, 0.0)
    mfr = safe_div(roll_mean(pos, 14), roll_mean(neg, 14))
    out["mfi14"] = pad(100 - 100 / (1 + mfr) if mfr is not None else None, n, 14)
    # OBV 20 日斜率（归一化）
    obv = np.cumsum(np.where(r0 > 0, v, np.where(r0 < 0, -v, 0.0)))
    obvm = roll_mean(obv, 20)
    slope = (obv - pad(obvm, n, 20)) / np.maximum(pad(roll_std(obv, 20), n, 20), 1e-9)
    out["obv20"] = slope
    # CLV（收盘在日内区间的位置，20 日均）
    clv = safe_div((c - l) - (h - c), h - l)
    out["clv20"] = pad(roll_mean(np.nan_to_num(clv), 20), n, 20)
    # 上下影线占比（相对实体+影线的全长）
    full = np.maximum(h - l, 1e-9)
    ush = (h - np.maximum(c, o)) / full
    lsh = (np.minimum(c, o) - l) / full
    out["ushadow20"] = pad(roll_mean(ush, 20), n, 20)
    out["lshadow20"] = pad(roll_mean(lsh, 20), n, 20)

    # 动量/反转
    def mom(w):
        m = np.full(n, np.nan)
        m[w:] = (c[w:] / c[:-w] - 1.0) * 100
        return m

    out["ret5"] = mom(5)
    out["ret10"] = mom(10)
    out["ret20"] = mom(20)
    out["mom20"] = mom(20)
    out["mom60"] = mom(60)
    out["mom120"] = mom(120)
    out["mom250"] = mom(250)
    m20 = mom(20)
    m20lag = np.full(n, np.nan)
    m20lag[20:] = m20[:-20]
    out["accel20"] = m20 - m20lag
    # RSI
    up = np.where(r0 > 0, r0, 0.0)
    dn = np.where(r0 < 0, -r0, 0.0)
    for w in (6, 12):
        au = roll_mean(up, w)
        ad = roll_mean(dn, w)
        rs = safe_div(au, ad)
        out[f"rsi{w}"] = pad(100 - 100 / (1 + rs) if rs is not None else None, n, w)
    # BIAS
    for w in (5, 20, 60):
        ma = roll_mean(c, w)
        out[f"bias{w}"] = pad(safe_div(c[w - 1:] - ma, ma) * 100 if ma is not None else None, n, w)
    # WR(14)
    hh14 = roll_max(h, 14)
    ll14 = roll_min(l, 14)
    out["wr14"] = pad(safe_div(hh14 - c[13:], hh14 - ll14) * 100 if hh14 is not None else None, n, 14)
    # CCI(14)
    tpm = roll_mean(tp, 14)
    tpd = roll_mean(np.abs(tp - pad(tpm, n, 14)), 14)
    out["cci14"] = pad(safe_div(tp[13:] - tpm, 0.015 * tpd) if tpm is not None else None, n, 14)
    # KDJ
    ll9 = pad(roll_min(l, 9), n, 9)
    hh9 = pad(roll_max(h, 9), n, 9)
    rsv = safe_div(c - ll9, hh9 - ll9) * 100
    rsv = np.nan_to_num(rsv, nan=50.0)
    k = ema(rsv, 3)
    d = ema(k, 3)
    out["kdjj"] = 3 * k - 2 * d
    # BOLL %B(20)
    ma20 = roll_mean(c, 20)
    sd20 = roll_std(c, 20)
    out["bollb20"] = pad(safe_div(c[19:] - (ma20 - 2 * sd20), 4 * sd20) if ma20 is not None else None, n, 20)
    # MACD 柱
    dif = ema(c, 12) - ema(c, 26)
    dea = ema(dif, 9)
    out["macdh"] = (dif - dea) / np.maximum(c, 1e-9) * 100
    # Sharpe
    for w in (20, 60):
        vv = out[f"vol{w}"]
        mm = pad(rmean[w], n, w) * 252 * 100
        out[f"sharpe{w}"] = safe_div(mm, vv)

    # 结构/位置
    hh250 = pad(roll_max(h, 250), n, 250)
    ll250 = pad(roll_min(l, 250), n, 250)
    out["high250"] = safe_div(c - hh250, hh250) * 100   # 距高点（负数，越接近0越强）
    out["low250"] = safe_div(c - ll250, ll250) * 100    # 距低点（正数，越小越接近底部）
    ma5 = pad(roll_mean(c, 5), n, 5)
    ma10 = pad(roll_mean(c, 10), n, 10)
    ma20f = pad(roll_mean(c, 20), n, 20)
    ma60f = pad(roll_mean(c, 60), n, 60)
    bull = ((ma5 > ma10).astype(float) + (ma10 > ma20f).astype(float)
            + (ma20f > ma60f).astype(float) + (c > ma60f).astype(float))
    out["mabull"] = bull
    out["abovecnt"] = ((c > ma5).astype(float) + (c > ma10).astype(float)
                       + (c > ma20f).astype(float) + (c > ma60f).astype(float))
    # 连续上涨天数（ capped ±10 ）
    sign = np.sign(r0)
    consec = np.zeros(n)
    for i in range(1, n):
        if sign[i] > 0:
            consec[i] = min(consec[i - 1] + 1, 10) if consec[i - 1] > 0 else 1
        elif sign[i] < 0:
            consec[i] = max(consec[i - 1] - 1, -10) if consec[i - 1] < 0 else -1
        else:
            consec[i] = 0
    out["consec"] = consec
    out["bigup20"] = pad(roll_mean((r0 > 0.05).astype(float), 20), n, 20) * 20
    out["bigdown20"] = pad(roll_mean((r0 < -0.05).astype(float), 20), n, 20) * 20
    gap = np.abs(o / np.maximum(np.roll(c, 1), 1e-9) - 1)
    gap[0] = 0
    out["gap20"] = pad(roll_mean((gap > 0.02).astype(float), 20), n, 20) * 20

    # 资金流（Tushare moneyflow 主力净流入；口径见 docs/data-conventions.md 红线 5）
    # mfNet{w} = sum(netMain,w)/sum(buyTotal,w)×100；mfElg20 同理用特大单净额；
    # mfTrend = mfNet20 − 20 日前的 mfNet20（资金流改善/恶化方向）。
    # 窗口内有效资金流天数不足一半时置 NaN（回填起点前/缺数据段不产出伪信号）。
    MF_FIELDS = ("mfNet5", "mfNet10", "mfNet20", "mfElg20", "mfTrend")
    if mf is not None:
        nm, ne, bt = mf
        valid = (~np.isnan(nm)).astype(float)
        nm0, ne0, bt0 = np.nan_to_num(nm), np.nan_to_num(ne), np.nan_to_num(bt)
        sbt = {w: roll_sum(bt0, w) for w in (5, 10, 20)}
        for w, src in ((5, nm0), (10, nm0), (20, nm0)):
            sn = roll_sum(src, w)
            cnt = roll_sum(valid, w)
            ratio = safe_div(sn, sbt[w]) * 100 if sn is not None else None
            if ratio is not None:
                ratio = np.where(cnt >= max(2, w // 2), ratio, np.nan)
            out[f"mfNet{w}"] = pad(ratio, n, w)
        sne = roll_sum(ne0, 20)
        cnt20 = roll_sum(valid, 20)
        e20 = safe_div(sne, sbt[20]) * 100 if sne is not None else None
        if e20 is not None:
            e20 = np.where(cnt20 >= 10, e20, np.nan)
        out["mfElg20"] = pad(e20, n, 20)
        m20 = out["mfNet20"]
        lag = np.full(n, np.nan)
        lag[20:] = m20[:-20]
        out["mfTrend"] = m20 - lag
    else:
        for f in MF_FIELDS:
            out[f] = np.full(n, np.nan)

    return out


# ──────────────────────────────────────────────────────────────
# 评估
# ──────────────────────────────────────────────────────────────

def spearman(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    ok = ~(np.isnan(x) | np.isnan(y))
    if ok.sum() < 30:
        return np.nan
    rx = np.argsort(np.argsort(x[ok])).astype(float)
    ry = np.argsort(np.argsort(y[ok])).astype(float)
    rx -= rx.mean()
    ry -= ry.mean()
    den = math.sqrt((rx ** 2).sum() * (ry ** 2).sum())
    if den <= 0:
        return np.nan
    return float((rx * ry).sum() / den)


def load_prices(d):
    """从 K 线 json 加载 OHLCV，优先用后复权（closesHfq）换算全量价格。

    前复权（qfq）在高分红股票的远期历史上会出现趋零甚至负价，
    导致收益率/动量/回撤等全部失真；后复权（hfq）锚定上市首日，收益率精确。
    做法：ratio = closesHfq / closes(qfq)，把 qfq 的 o/h/l 同比例换算到 hfq 尺度，
    保证 ATR 等跨价格字段的因子口径一致。无 closesHfq 时回退 qfq（短期影响可忽略）。
    """
    c_qfq = np.asarray(d["closes"], dtype=float)
    o = np.asarray(d.get("opens") or d["closes"], dtype=float)
    h = np.asarray(d.get("highs") or d["closes"], dtype=float)
    l = np.asarray(d.get("lows") or d["closes"], dtype=float)
    v = np.asarray(d["vols"], dtype=float)
    ch = d.get("closesHfq")
    if ch:
        c_hfq = np.asarray(ch, dtype=float)
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where((c_qfq > 0) & (c_hfq > 0), c_hfq / c_qfq, 1.0)
        c = np.where(c_hfq > 0, c_hfq, c_qfq)
        o, h, l = o * ratio, h * ratio, l * ratio
    else:
        c = c_qfq
    return c, o, h, l, v


def date_gaps(dates):
    """gaps[j] = 第 j 根K线与第 j+1 根K线之间的自然日间隔。"""
    dts = np.array(dates, dtype="datetime64[D]")
    return np.diff(dts).astype(int)


def tradable(gaps, t, lookback=60, fwd=0, max_gap=10):
    """t 时刻可交易性：t-lookback 到 t+fwd 窗口内无超过 max_gap 自然日的停牌缺口。

    长期停牌股票的K线直接断档（无零成交量bar），其特征被冻结在停牌前：
    波动率≈0、量能稳定——低波类模型会给这种股票打最高分，且复牌跳空
    （+300%~+1000%）会被当成可实现的持仓收益。必须全程剔除。
    """
    lo = max(0, t - lookback)
    hi = min(len(gaps), t + fwd)
    if hi <= lo:
        return False
    return bool((gaps[lo:hi] <= max_gap).all())


MAX_PERIOD_RET = 2.71  # 单期收益上限：北交所 30cm×5 连板理论极限；超过即停牌跳空/数据异常，不可交易


# ──────────────────────────────────────────────────────────────
# PIT（point-in-time）模式：环境变量 PIT_MODE=1 启用（缺省关闭，行为与历史完全一致）
# 消除幸存者偏差（docs/data-conventions.md 红线 3）：
# 训练/回测股票池纳入 research-data/kline-delisted 的退市股，
# ST 剔除用历史 ST 区间（时点口径），替代"现名近似"。
# ──────────────────────────────────────────────────────────────
PIT_MODE = os.environ.get("PIT_MODE") == "1"
RESEARCH_DATA = ROOT / "research-data"
KLINE_DELISTED = RESEARCH_DATA / "kline-delisted"
MF_DIR = RESEARCH_DATA / "moneyflow"


def load_moneyflow(code, dates):
    """加载 research-data/moneyflow/<code>.json 并按日期对齐到 K 线序列。

    返回 (netMain, netElg, buyTotal) 三个与 dates 等长的 float 数组（缺数据日 NaN）；
    文件缺失/损坏返回 None（调用方优雅降级为全 NaN 因子）。
    """
    path = MF_DIR / f"{code}.json"
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text())
        mdates = d["dates"]
        n = len(dates)
        nm = np.full(n, np.nan)
        ne = np.full(n, np.nan)
        bt = np.full(n, np.nan)
        pos = {dt: i for i, dt in enumerate(dates)}
        for i, dt in enumerate(mdates):
            j = pos.get(dt)
            if j is not None:
                nm[j] = d["netMain"][i]
                ne[j] = d["netElg"][i]
                bt[j] = d["buyTotal"][i]
        return nm, ne, bt
    except Exception:
        return None

_pit_ctx_cache = "unset"


def pit_context():
    """加载 PIT 三件套（进程内缓存）：listing-timeline.json + st-intervals.json。

    返回 {"timeline": {code: (list_int, delist_int|None)}, "st": {code: [(start_int, end_int), ...]}}；
    文件缺失/损坏返回 None（调用方应退化为非 PIT 行为）。
    日期统一转为 YYYYMMDD 整数，便于高频逐截面判定。
    """
    global _pit_ctx_cache
    if _pit_ctx_cache != "unset":
        return _pit_ctx_cache
    ctx = None
    try:
        tl_raw = json.loads((RESEARCH_DATA / "listing-timeline.json").read_text())
        st_raw = json.loads((RESEARCH_DATA / "st-intervals.json").read_text())
        timeline = {}
        for code, info in tl_raw.items():
            lst = info.get("list")
            dl = info.get("delist")
            timeline[code] = (int(lst) if lst else 0, int(dl) if dl else None)
        st = {}
        for code, ivs in st_raw.items():
            st[code] = [(int(a), int(b)) for a, b in ivs]
        ctx = {"timeline": timeline, "st": st}
    except Exception:
        ctx = None
    _pit_ctx_cache = ctx
    return ctx


def pit_eligible(code, date, ctx):
    """时点口径可投判定：list<=date 且（delist 为空或 date<delist）且 date 不在该 code 任一 ST 区间内。

    date 接受 "YYYY-MM-DD"（K 线格式）或 "YYYYMMDD"；ctx 为 pit_context() 返回值。
    ctx 为 None 时恒真（非 PIT 行为）；时间线中查无此 code 时判 False（无法证实其时点在市状态）。
    """
    if ctx is None:
        return True
    ymd = int(date.replace("-", "")) if isinstance(date, str) else int(date)
    info = ctx["timeline"].get(code)
    if info is None:
        return False
    lst, dl = info
    if ymd < lst or (dl is not None and ymd >= dl):
        return False
    for a, b in ctx["st"].get(code, ()):
        if a <= ymd <= b:
            return False
    return True


def main():
    t0 = time.time()
    files = sorted(KLINE.glob("*.json"))
    print(f"K线文件 {len(files)} 只，因子 {len(FACTORS)} 个", flush=True)

    fields = [f[0] for f in FACTORS]
    meta = {f[0]: f[1:] for f in FACTORS}
    ic_lists = {f: {w: [] for w in FWD} for f in fields}
    spread_lists = {f: [] for f in fields}
    buckets = {}

    stocks = 0
    skipped = 0
    for fp in files:
        try:
            d = json.loads(fp.read_text())
            dates = d["dates"]
            c, o, h, l, v = load_prices(d)
        except Exception:
            skipped += 1
            continue
        n = len(c)
        if n < MIN_BARS or len(dates) != n:
            skipped += 1
            continue
        ts = list(range(260, n - FWD[-1] - 1, STEP))
        if not ts:
            skipped += 1
            continue
        try:
            fac = compute_factor_arrays(c, o, h, l, v, mf=load_moneyflow(fp.stem, dates))
        except Exception:
            skipped += 1
            continue
        stocks += 1
        for t in ts:
            ds = dates[t]
            fw = {w: c[t + w] / c[t] - 1 for w in FWD}
            if c[t] <= 0 or np.isnan(fw[FWD[-1]]):
                continue
            bucket = buckets.setdefault(ds, {f: [] for f in fields})
            for f in fields:
                arr = fac.get(f)
                val = arr[t] if arr is not None and t < len(arr) else np.nan
                bucket[f].append((val, fw[5], fw[10], fw[20], fw[40]))
        if stocks % 800 == 0:
            print(f"  已处理 {stocks} 只，{time.time()-t0:.0f}s", flush=True)

    print(f"股票 {stocks} 只（跳过 {skipped}），评估日 {len(buckets)} 个", flush=True)

    for ds in sorted(buckets):
        bucket = buckets[ds]
        for f in fields:
            obs = bucket[f]
            if len(obs) < MIN_OBS:
                continue
            vals = np.array([o[0] for o in obs], dtype=float)
            name, drc, _kind = meta[f]
            for i, w in enumerate(FWD):
                rets = np.array([o[i + 1] for o in obs], dtype=float)
                ic = spearman(vals, rets)
                if not np.isnan(ic):
                    ic_lists[f][w].append(ic)
            ok = ~np.isnan(vals)
            if ok.sum() >= 100:
                r20 = np.array([o[3] for o in obs], dtype=float)
                order = np.argsort(vals[ok])
                rets = r20[ok]
                k = max(1, int(len(order) * 0.3))
                lo = rets[order[:k]].mean()
                hi = rets[order[-k:]].mean()
                spread_lists[f].append(float(((lo - hi) if drc == "asc" else (hi - lo)) * 100))

    def agg(xs):
        a = np.asarray(xs, dtype=float)
        if len(a) == 0:
            return None
        m = float(a.mean())
        sd = float(a.std()) if len(a) > 1 else 0.0
        return {
            "mean": round(m, 4),
            "ir": round(m / sd, 2) if sd > 1e-12 else None,
            "tstat": round(m / (sd / math.sqrt(len(a))), 2) if sd > 1e-12 else None,
            "posRatio": round(float((a > 0).mean()), 3),
            "dates": int(len(a)),
        }

    results = {}
    for f, name, drc, kind in FACTORS:
        ics = {w: agg(ic_lists[f][w]) for w in FWD}
        if not ics[20]:
            continue
        sign = -1.0 if drc == "asc" else 1.0
        sp = np.asarray(spread_lists[f], dtype=float)
        results[f] = {
            "name": name,
            "dir": drc,
            "kind": kind,
            "ic5": ics[5],
            "ic10": ics[10],
            "ic20": ics[20],
            "ic40": ics[40],
            "dic20": round(ics[20]["mean"] * sign, 4),
            "dicir20": round(ics[20]["ir"] * sign, 2) if ics[20]["ir"] is not None else None,
            "spread20": round(float(sp.mean()), 2) if len(sp) else None,
            "spreadPosRatio": round(float((sp > 0).mean()), 3) if len(sp) else None,
        }

    now = datetime.now(timezone(timedelta(hours=8)))
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
        except Exception:
            prev = {}
    history = prev.get("history", [])
    ranked = sorted(results.values(), key=lambda r: -(abs(r["dic20"] or 0)))
    good = [r["name"] for r in ranked[:8] if (r["dic20"] or 0) > 0.02]
    history.append({
        "date": now.strftime("%Y-%m-%d"),
        "stocks": stocks,
        "factorCount": len(results),
        "summary": f"实测 {len(results)} 个因子，|IC20| 前 8：{'、'.join(good) if good else '无'}",
    })
    history = history[-MAX_HIST:]

    out = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "method": "全A截面 Spearman 秩 IC；评估日间隔10交易日；前瞻5/10/20/40日；dic20=方向化IC20均值；dicir20=方向化ICIR；spread20=方向化top30%-bottom30%多空20日利差%",
        "window": {"evalDates": max((r["ic20"]["dates"] for r in results.values()), default=0), "stocks": stocks},
        "results": results,
        "history": history,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"写出 {OUT}，耗时 {(time.time()-t0)/60:.1f} 分钟", flush=True)
    print("── |dic20| 排行 ──")
    for f, r in sorted(results.items(), key=lambda kv: -(abs(kv[1]["dic20"] or 0))):
        t = r["ic20"]["tstat"]
        print(f"  {r['name']:<14} dic20={r['dic20']:+.4f} ICIR={r['dicir20']} t={t} spread={r['spread20']} [{r['kind']}]")


if __name__ == "__main__":
    sys.exit(main())
