#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
# Tushare 每日刷新主通道（替代腾讯/东财为每日行情主源，旧通道降级为兜底）
# 数据源：Tushare Pro HTTP API（token 在 .secrets/tushare.env，禁止外泄）
#   trade_cal    交易日历（找 K 线缺口日）
#   daily        全市场日行情（未复权 OHLCV + pct_chg，vol 单位=手，amount 单位=千元）
#   daily_basic  全市场每日指标（turnover_rate / pe_ttm / pb / total_mv(万元)）
#   adj_factor   全市场复权因子（后复权=未复权×adj；前复权=未复权×adj/最新adj）
#   stock_basic  股票档案（name/industry/list_date，用于新增 universe 条目）
#   index_daily  指数日线（ts_code 形如 000300.SH）
# 产物（全部原子写 tmp+rename，绝不删除现有数据）：
#   kline/<code>.json  缺口日增量合并（closes=前复权展示 / closesHfq=后复权研究，2500 窗口）
#   universe.json      快照字段刷新（price/changePct/turnover/pe/pb/mktCap），其余字段原样保留
#   indices.json       六指数追加缺口日数据点 + 快照值
#   meta.json          时间戳 / 涨跌家数 / 成交额
# 复权口径红线：
#   - 现有 closesHfq 是腾讯/东财锚定的后复权，绝对尺度 ≠ raw×adj_factor。
#     增量必须用「接缝缩放」续接：scale = closesHfq[末日]/(raw[末日]×adj[末日])，
#     新 hfq = raw×adj×scale（实测收益率连续性误差 <0.1%，直接拼绝对值会跳变 30%+）。
#   - 前复权 closes 锚定最新交易日：新 qfq = raw×adj[t]/adj[最新数据日]，与存量在
#     锚定日精确相等（误差 0）。缺口期内有除权除息的个股 qfq 历史段不回头重锚（展示口径，
#     研究一律用 closesHfq，见 docs/data-conventions.md 红线 1）。
# 盘中行为：Tushare 当日数据一般 15:30 后才出；daily 返回空即跳过该日，不算错误。
# 进度协议（与 scripts/refresh-quotes.mjs 一致，RESULT 行供自动化解析）：
#   PROGRESS <stage> <done> <total> <message…>
#   RESULT {"ok":true,...}
# 用法：
#   python3 scripts/tushare_daily.py            # 正常每日增量
#   python3 scripts/tushare_daily.py --dry-run  # 只拉取+计算+打印，不落盘
# ─────────────────────────────────────────────────────────────
import json
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
import os
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
KLINE_DIR = os.path.join(DATA_DIR, "kline")
TOKEN_FILE = os.path.join(ROOT, ".secrets", "tushare.env")
API_URL = "http://api.tushare.pro"
DRY_RUN = "--dry-run" in sys.argv

# moneyflow 主力资金流每日缺口补充（merge 逻辑与 scripts/moneyflow_backfill.py 共用）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moneyflow_backfill import MF_DIR, MF_FIELDS, merge_moneyflow_batch, rows_to_mf  # noqa: E402

MF_GAP_CAP = 30  # 每日通道最多回补的 moneyflow 缺口日数；更早的历史缺口由 moneyflow_backfill.py 负责

KLINE_DAYS = 2500  # 与 build-dataset.mjs 窗口一致
PACE_S = 0.45  # 调用间隔，防限流
INDEX_MAP = [  # (indices.json series key, Tushare ts_code)
    ("sh000001", "000001.SH"),
    ("sz399001", "399001.SZ"),
    ("sz399006", "399006.SZ"),
    ("sh000688", "000688.SH"),
    ("sh000300", "000300.SH"),
    ("sh000905", "000905.SH"),
]
# 有 kline 但缺 universe 条目的 12 只（本任务补齐）
UNIVERSE_ADD = [
    "001237.SZ", "001365.SZ", "001393.SZ", "001399.SZ", "300955.SZ", "301531.SZ",
    "301599.SZ", "301669.SZ", "603407.SH", "603435.SH", "688635.SH", "688797.SH",
]
# 历史上缺 closesHfq 的 10 只（若已补齐则自动跳过；幂等）
HFQ_BACKFILL = [
    "605086.SH", "603730.SH", "601901.SH", "603978.SH", "688798.SH",
    "688808.SH", "601328.SH", "688787.SH", "601888.SH", "605077.SH",
]

T0 = time.time()
CN_TZ = timezone(timedelta(hours=8))


def log(msg):
    print(f"[{datetime.now(CN_TZ).strftime('%H:%M:%S')}] {msg}", flush=True)


def progress(stage, done, total, msg):
    print(f"PROGRESS {stage} {done} {total} {msg}", flush=True)


class TushareFatal(Exception):
    pass


def load_token():
    try:
        text = open(TOKEN_FILE, encoding="utf-8").read()
    except OSError as e:
        raise TushareFatal(f"token 文件不可读: {e}")
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("TUSHARE_TOKEN="):
            tok = line.split("=", 1)[1].strip().strip('"').strip("'")
            if tok:
                return tok
    raise TushareFatal(".secrets/tushare.env 中未找到 TUSHARE_TOKEN")


TOKEN = load_token()
_call_count = 0


def ts_call(api_name, params=None, fields="", retries=6):
    """Tushare HTTP 调用。code!=0 / 网络错误均重试；限流类 msg 阶梯退避。
    token 绝不进日志。连续失败抛 TushareFatal（整体失败，非零退出）。"""
    global _call_count
    body = json.dumps({
        "api_name": api_name, "token": TOKEN, "params": params or {}, "fields": fields,
    }).encode()
    last_err = None
    for i in range(retries):
        if i > 0 or _call_count > 0:
            time.sleep(PACE_S)
        try:
            req = urllib.request.Request(API_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.load(resp)
            _call_count += 1
            if payload.get("code") != 0:
                msg = str(payload.get("msg") or "")
                # token 无效/权限类错误不重试，直接整体失败
                if any(k in msg for k in ("token", "TOKEN", "权限", "permission")):
                    raise TushareFatal(f"{api_name} 鉴权失败: {msg[:80]}")
                last_err = f"{api_name} code={payload.get('code')} msg={msg[:80]}"
                # 限流类：长阶梯退避
                if "每分钟" in msg or "最多访问" in msg or "频繁" in msg:
                    wait = 20 * (i + 1)
                    log(f"  ⚠ {api_name} 限流，退避 {wait}s（第 {i + 1} 次）")
                    time.sleep(wait)
                else:
                    time.sleep(3 * (i + 1))
                continue
            data = payload.get("data") or {}
            return data.get("fields") or [], data.get("items") or []
        except TushareFatal:
            raise
        except Exception as e:
            last_err = f"{api_name} 网络错误: {type(e).__name__} {e}"
            log(f"  ⚠ {last_err}（第 {i + 1} 次重试）")
            time.sleep(4 * (i + 1))
    raise TushareFatal(f"{api_name} 连续 {retries} 次失败: {last_err}")


def rows_to_map(fields, items, key="ts_code"):
    ki = fields.index(key)
    return {r[ki]: {f: r[i] for i, f in enumerate(fields)} for r in items}


def write_json_atomic(path, obj):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def dash(yyyymmdd):
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def today_cn():
    return datetime.now(CN_TZ).strftime("%Y%m%d")


def r3(x):
    return round(float(x) + 0.0, 3)


# ── 指标计算（移植自 build-dataset.mjs computeMetrics，口径一致，供新增 universe 条目用）──
def _avg(a):
    return sum(a) / len(a) if a else 0.0


def _pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


def _std(a):
    if not a:
        return 0.0
    m = _avg(a)
    return (sum((x - m) ** 2 for x in a) / len(a)) ** 0.5


def _corr(a, b):
    if len(a) < 3:
        return 0.0
    ma, mb = _avg(a), _avg(b)
    s = sa = sb = 0.0
    for x, y in zip(a, b):
        s += (x - ma) * (y - mb)
        sa += (x - ma) ** 2
        sb += (y - mb) ** 2
    return s / (sa * sb) ** 0.5 if sa > 0 and sb > 0 else 0.0


def compute_metrics(kl):
    closes, vols = kl["closes"], kl["vols"]
    highs = kl.get("highs") or closes
    lows = kl.get("lows") or closes
    n = len(closes)
    last = closes[-1]
    win60 = closes[-60:]
    lo, hi = min(win60), max(win60)
    pos60 = round((last - lo) / ((hi - lo) or 1) * 100)
    ma20 = _avg(closes[-20:])
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, n)]
    r20, r60 = rets[-20:], rets[-60:]
    v20, v60 = vols[-20:], vols[-60:]
    vol20 = _std(r20) * (252 ** 0.5) * 100
    vol60 = _std(r60) * (252 ** 0.5) * 100
    hl_h, hl_l = highs[-20:], lows[-20:]
    import math
    park20 = (
        (_avg([math.log(h / (l or h)) ** 2 for h, l in zip(hl_h, hl_l)]) / (4 * math.log(2))) ** 0.5
        * (252 ** 0.5) * 100
        if len(hl_h) > 1 else 0.0
    )
    m4 = _avg([(r - _avg(r20)) ** 4 for r in r20]) if len(r20) > 3 else 0.0
    s20 = _std(r20)
    peak, mdd = win60[0], 0.0
    for c in win60:
        peak = max(peak, c)
        mdd = min(mdd, (c / peak - 1) * 100)
    return {
        "mom20": _pct(last, closes[-21]) if n > 21 else 0.0,
        "mom60": _pct(last, closes[-61]) if n > 61 else 0.0,
        "pos60": pos60,
        "aboveMa20": last > ma20,
        "volRatio": _avg(vols[-5:]) / (_avg(v20) or 1),
        "vol20": vol20, "vol60": vol60,
        "cpv20": _corr(closes[-20:], v20),
        "cpv10": _corr(closes[-10:], vols[-10:]),
        "vcv20": _std(v20) / (_avg(v20) or 1),
        "ret5": _pct(last, closes[-6]) if n > 6 else 0.0,
        "sharpe20": (_avg(r20) * 252 * 100) / vol20 if vol20 > 0 else 0.0,
        "maxdd60": mdd,
        "vcv60": _std(v60) / (_avg(v60) or 1),
        "vr2060": (_avg(v20) or 0) / (_avg(v60) or 1),
        "bias60": (last / (_avg(closes[-60:]) or last) - 1) * 100,
        "park20": park20,
        "bigup20": sum(1 for r in r20 if r > 0.05),
        "kurt20": (m4 / s20 ** 4 - 3) if vol20 > 0 and m4 > 0 and s20 > 0 else 0.0,
    }


def pct_rank(values, v):
    """与 build-dataset percentileScores 同口径的单值百分位"""
    s = sorted(values)
    return round(sum(1 for x in s if x < v) / max(len(s) - 1, 1) * 100)


def build_universe_entry(code, basic, snap, dbasic, kl):
    """为新增股票构建完整 universe 条目（快照同口径 + 因子自 kline 计算 + 空现金流）"""
    m = compute_metrics(kl)
    price = snap["close"] if snap else kl["closes"][-1]
    if snap and snap.get("pct_chg") is not None:
        change_pct = snap["pct_chg"]
    else:
        change_pct = r3((kl["closes"][-1] / kl["closes"][-2] - 1) * 100) if len(kl["closes"]) > 1 else 0.0
    ld = (basic or {}).get("list_date") or ""
    return {
        "code": code,
        "name": (basic or {}).get("name") or code,
        "industry": (basic or {}).get("industry") or "未分类",
        "price": price,
        "changePct": change_pct,
        "mktCap": round(dbasic["total_mv"] / 1e4) if dbasic and dbasic.get("total_mv") else None,
        "pe": dbasic.get("pe_ttm") if dbasic else None,
        "pb": dbasic.get("pb") if dbasic else None,
        "turnover": dbasic.get("turnover_rate") if dbasic else None,
        "listDate": dash(ld) if ld else None,
        "pos60": m["pos60"],
        "mom20": round(m["mom20"], 2), "mom60": round(m["mom60"], 2),
        "aboveMa20": m["aboveMa20"],
        "vol20": round(m["vol20"], 1), "vol60": round(m["vol60"], 1),
        "cpv20": round(m["cpv20"], 2), "cpv10": round(m["cpv10"], 2),
        "vcv20": round(m["vcv20"], 2), "vcv60": round(m["vcv60"], 2),
        "vr2060": round(m["vr2060"], 2), "bias60": round(m["bias60"], 2),
        "park20": round(m["park20"], 1), "bigup20": m["bigup20"],
        "kurt20": round(m["kurt20"], 2), "ret5": round(m["ret5"], 2),
        "sharpe20": round(m["sharpe20"], 2), "maxdd60": round(m["maxdd60"], 1),
        "roe": None,  # Tushare 免费口径无加权 ROE 快照，保持 null（前端可空）
        "cashflow": [],
        "_scores_input": m,  # 临时：百分位评分用，落盘前移除
    }


def attach_scores(entry, universe):
    """用现有 universe 的因子分布给新条目算 aiScore/signal/factors/winRate/radar（同 build-dataset 权重）"""
    m = entry.pop("_scores_input")
    mom20s = pct_rank([u["mom20"] for u in universe], m["mom20"])
    mom60s = pct_rank([u["mom60"] for u in universe], m["mom60"])
    pos60s = pct_rank([u["pos60"] for u in universe], m["pos60"])
    vols = pct_rank([u.get("volRatio", 1) for u in universe], m["volRatio"]) if "volRatio" in universe[0] else 50
    pe_v = m.get("_pe") or entry.get("pe")
    pe_ref = [(u["pe"] if isinstance(u.get("pe"), (int, float)) and 0 < u["pe"] < 200 else 200) for u in universe]
    pe_cur = pe_v if isinstance(pe_v, (int, float)) and 0 < pe_v < 200 else 200
    pes = 100 - pct_rank(pe_ref, pe_cur)
    ai = round(0.3 * mom20s + 0.2 * mom60s + 0.2 * pos60s + 0.15 * vols + 0.15 * pes)
    entry["aiScore"] = ai
    entry["signal"] = "强烈买入" if ai >= 75 else "买入" if ai >= 60 else "持有" if ai >= 45 else "观望"
    subs = sorted(
        [("动量", mom20s), ("成长", mom60s), ("技术形态", pos60s), ("资金流", vols), ("价值", pes)],
        key=lambda x: -x[1],
    )
    entry["factors"] = [n for n, x in subs if x >= 60][:3]
    entry["winRate"] = min(80, max(35, round(50 + (ai - 50) * 0.5)))
    entry["radar"] = [mom20s, pes, mom60s, vols, min(100, round(50 + (entry["changePct"] or 0) * 10)), pos60s]
    # 按现有条目的 key 顺序重排
    order = ["code", "name", "industry", "price", "changePct", "aiScore", "signal", "factors", "winRate",
             "mktCap", "pe", "pb", "turnover", "listDate", "pos60", "mom20", "mom60", "aboveMa20",
             "vol20", "vol60", "cpv20", "cpv10", "vcv20", "vcv60", "vr2060", "bias60", "park20",
             "bigup20", "kurt20", "ret5", "sharpe20", "maxdd60", "roe", "radar", "cashflow"]
    return {k: entry.get(k) for k in order}


# ── 主流程 ───────────────────────────────────────────────────
def main():
    today = today_cn()
    log(f"1/6 定位 K 线数据缺口（{'DRY-RUN ' if DRY_RUN else ''}今天 {dash(today)}）")

    # 1) 现有 K 线末日（抽样 40 个文件取众数；逐文件合并时仍按各文件自身末日判断）
    files = sorted(os.listdir(KLINE_DIR))
    sample = files[:20] + files[-20:]
    last_dates = []
    for fn in sample:
        try:
            with open(os.path.join(KLINE_DIR, fn), encoding="utf-8") as f:
                last_dates.append(json.load(f)["dates"][-1].replace("-", ""))
        except Exception:
            pass
    if not last_dates:
        raise TushareFatal("无法读取任何 kline 文件")
    base_date = Counter(last_dates).most_common(1)[0][0]
    log(f"  现有数据末日（众数）: {dash(base_date)}（样本 {len(last_dates)} 个文件）")

    # 2) trade_cal 找缺口开市日
    _, cal = ts_call("trade_cal", {"exchange": "SSE", "start_date": base_date, "end_date": today}, "cal_date,is_open")
    gap_days = sorted(d for d, op in cal if op == 1 and base_date < d <= today)
    log(f"  缺口开市日: {[dash(d) for d in gap_days] or '无'}")

    # 3) 逐缺口日拉全市场（盘中当日无数据 → 跳过，不算错误）
    daily_by_day, adj_by_day, dbasic_by_day = {}, {}, {}
    for d in gap_days:
        f, items = ts_call("daily", {"trade_date": d}, "ts_code,open,high,low,close,pct_chg,vol,amount")
        if not items:
            log(f"  {dash(d)} daily 返回空（数据未出，跳过该日）")
            continue
        daily_by_day[d] = rows_to_map(f, items)
        f, items = ts_call("adj_factor", {"trade_date": d}, "ts_code,adj_factor")
        adj_by_day[d] = {r[0]: r[1] for r in items}
        f, items = ts_call(
            "daily_basic", {"trade_date": d}, "ts_code,turnover_rate,pe_ttm,pb,total_mv")
        dbasic_by_day[d] = rows_to_map(f, items)
        log(f"  {dash(d)}: daily {len(daily_by_day[d])} 行, adj {len(adj_by_day[d])}, daily_basic {len(dbasic_by_day[d])}")
        progress("fetch", len(daily_by_day), len(gap_days), f"拉取缺口日 {dash(d)}")

    data_days = sorted(daily_by_day)
    latest_day = data_days[-1] if data_days else None

    # 3.5) 接缝缩放基准日（现有 K 线末日）的 raw/adj，用于 hfq 续接
    raw_base, adj_base = {}, {}
    if data_days:
        f, items = ts_call("daily", {"trade_date": base_date}, "ts_code,close")
        raw_base = {r[0]: r[1] for r in items}
        f, items = ts_call("adj_factor", {"trade_date": base_date}, "ts_code,adj_factor")
        adj_base = {r[0]: r[1] for r in items}
        log(f"  接缝基准日 {dash(base_date)}: raw {len(raw_base)}, adj {len(adj_base)}")

    # 4) K 线增量合并（绝不删数据；单股失败记名单继续）
    kline_updated = 0
    kline_failed = []  # [(code, reason)]
    hfq_null_note = 0
    if data_days:
        log(f"2/6 K 线增量合并 {len(files)} 个文件 × {len(data_days)} 天…")
        for idx, fn in enumerate(files):
            code = fn[:-5]
            path = os.path.join(KLINE_DIR, fn)
            try:
                with open(path, encoding="utf-8") as fp:
                    kl = json.load(fp)
                new_days = [d for d in data_days if d > kl["dates"][-1].replace("-", "")]
                if not new_days:
                    continue
                # 前复权锚：该股票出现的最新数据日的 adj
                anchor = None
                for d in reversed(new_days):
                    a = adj_by_day[d].get(code)
                    if a:
                        anchor = a
                        break
                if not anchor:
                    kline_failed.append((code, "缺 adj_factor"))
                    continue
                # 后复权接缝缩放：基准于现有末日（= base_date 时才有 raw/adj 可对齐）
                scale = None
                hfq_series = kl.get("closesHfq")
                if (
                    hfq_series and hfq_series[-1] is not None
                    and kl["dates"][-1].replace("-", "") == base_date
                    and code in raw_base and adj_base.get(code)
                ):
                    scale = hfq_series[-1] / (raw_base[code] * adj_base[code])
                if hfq_series is None:
                    hfq_series = [None] * len(kl["dates"])
                    kl["closesHfq"] = hfq_series
                appended = 0
                for d in new_days:
                    row = daily_by_day[d].get(code)
                    adj = adj_by_day[d].get(code)
                    if not row or not adj:
                        continue  # 当日停牌/缺因子：该日跳过，不破坏序列
                    kl["dates"].append(dash(d))
                    kl["opens"].append(r3(row["open"] * adj / anchor))
                    kl["closes"].append(r3(row["close"] * adj / anchor))
                    kl["highs"].append(r3(row["high"] * adj / anchor))
                    kl["lows"].append(r3(row["low"] * adj / anchor))
                    kl["vols"].append(round(row["vol"]))  # Tushare vol 单位=手，与存量一致（已实测核对）
                    kl["closesHfq"].append(r3(row["close"] * adj * scale) if scale else None)
                    appended += 1
                if not appended:
                    continue
                if scale is None:
                    hfq_null_note += 1
                for k in ("dates", "opens", "closes", "highs", "lows", "vols", "closesHfq"):
                    kl[k] = kl[k][-KLINE_DAYS:]
                if not DRY_RUN:
                    write_json_atomic(path, kl)
                kline_updated += 1
            except Exception as e:
                kline_failed.append((code, f"{type(e).__name__}: {e}"))
            if (idx + 1) % 1000 == 0:
                progress("kline", idx + 1, len(files), f"K线增量 {idx + 1}/{len(files)}（更新 {kline_updated}，失败 {len(kline_failed)}）")
        progress("kline", len(files), len(files), f"K线增量完成（更新 {kline_updated}，失败 {len(kline_failed)}）")
        log(f"  K线更新 {kline_updated}，失败 {len(kline_failed)}，hfq 置空续接 {hfq_null_note}")
        for c, why in kline_failed[:20]:
            log(f"  ✗ {c}: {why}")
    else:
        log("2/6 无新数据日，跳过 K 线合并（文件保持原样）")

    # 2.5) moneyflow 主力资金流缺口日补充（research-data/moneyflow/<code>.json，每股一文件）
    # 口径与 scripts/moneyflow_backfill.py 一致；缺口以 moneyflow 文件自身末日（众数）为基准，
    # 与 K 线缺口解耦——moneyflow 发布晚于 daily 的日子当日返回空即跳过，次日自动再试（自愈）。
    mf_updated, mf_days_done = 0, []
    try:
        os.makedirs(MF_DIR, exist_ok=True)
        mf_files = [fn for fn in os.listdir(MF_DIR) if fn.endswith(".json") and not fn.startswith("_")]
        mf_last = []
        for fn in mf_files[:20] + mf_files[-20:]:
            try:
                with open(os.path.join(MF_DIR, fn), encoding="utf-8") as fp:
                    mf_last.append(json.load(fp)["dates"][-1].replace("-", ""))
            except Exception:
                pass
        if mf_last:
            mf_base = Counter(mf_last).most_common(1)[0][0]
            _, mf_cal = ts_call("trade_cal", {"exchange": "SSE", "start_date": mf_base, "end_date": today}, "cal_date,is_open")
            mf_gap = sorted(d for d, op in mf_cal if op == 1 and mf_base < d <= today)
            if len(mf_gap) > MF_GAP_CAP:
                log(f"2.5/6 moneyflow 缺口 {len(mf_gap)} 天超过每日通道上限 {MF_GAP_CAP}，只补最近 {MF_GAP_CAP} 天（更早缺口由 moneyflow_backfill.py 回填）")
                mf_gap = mf_gap[-MF_GAP_CAP:]
            if mf_gap:
                log(f"2.5/6 moneyflow 缺口日: {[dash(d) for d in mf_gap]}")
                batch = {}
                for d in mf_gap:
                    f, items = ts_call("moneyflow", {"trade_date": d}, MF_FIELDS)
                    if not items:
                        log(f"  {dash(d)} moneyflow 返回空（数据未出，跳过该日，次日自愈）")
                        continue
                    dd = dash(d)
                    for code, vals in rows_to_mf(items).items():
                        batch.setdefault(code, {})[dd] = vals
                    mf_days_done.append(d)
                if batch and not DRY_RUN:
                    mf_updated = merge_moneyflow_batch(batch)
                elif batch:
                    mf_updated = len(batch)
                log(f"  moneyflow 合并 {len(mf_days_done)} 天 × {len(batch)} 只 → 更新 {mf_updated} 个文件{'（dry-run 未落盘）' if DRY_RUN and batch else ''}")
            else:
                log("2.5/6 moneyflow 无缺口日")
        else:
            log("2.5/6 moneyflow 目录为空（回填未完成？），跳过每日补充")
    except Exception as e:
        log(f"  ✗ moneyflow 缺口补充异常（不致命）: {type(e).__name__} {e}")

    # 5) 补 closesHfq 缺失名单（单股全历史接口；已补齐的自动跳过）
    hfq_backfilled = []
    log("3/6 检查 closesHfq 补缺名单…")
    for code in HFQ_BACKFILL:
        path = os.path.join(KLINE_DIR, f"{code}.json")
        try:
            with open(path, encoding="utf-8") as fp:
                kl = json.load(fp)
        except OSError:
            continue
        h = kl.get("closesHfq")
        if h and any(x is not None for x in h):
            continue  # 已有 hfq，幂等跳过
        try:
            f, items = ts_call("daily", {"ts_code": code}, "ts_code,trade_date,close")
            raw = {r[1]: r[2] for r in items}
            f, items = ts_call("adj_factor", {"ts_code": code}, "ts_code,trade_date,adj_factor")
            fac = {r[1]: r[2] for r in items}
            kl["closesHfq"] = [
                r3(raw[d.replace('-', '')] * fac[d.replace('-', '')])
                if d.replace("-", "") in raw and d.replace("-", "") in fac else None
                for d in kl["dates"]
            ]
            if not DRY_RUN:
                write_json_atomic(path, kl)
            hfq_backfilled.append(code)
            log(f"  ✓ {code} closesHfq 补齐 {sum(1 for x in kl['closesHfq'] if x is not None)}/{len(kl['dates'])}")
        except Exception as e:
            log(f"  ✗ {code} hfq 补缺失败（不致命）: {type(e).__name__} {e}")
    if not hfq_backfilled:
        log("  名单内 10 只均已有 closesHfq，无需补缺")

    # 3.5) 新股同步：Tushare 在市清单 vs 本地 K 线目录，缺失的全量建文件 + 进 universe
    # 与缺口日无关，任何一天跑都会补；当日上市无行情的新股跳过、次日自动再试
    log("3.5/6 新股同步（在市清单 vs 本地 K 线）…")
    new_klines, new_universe = [], []
    try:
        f, items = ts_call("stock_basic", {"list_status": "L"}, "ts_code,name,industry,list_date")
        basic_all = {r[0]: {"name": r[1], "industry": r[2], "list_date": r[3]} for r in items}
        have = {fn[:-5] for fn in os.listdir(KLINE_DIR) if fn.endswith(".json")}
        missing = sorted(c for c in basic_all if c not in have)
        log(f"  在市 {len(basic_all)}，本地 {len(have)}，缺失 {len(missing)}")
        if missing:
            # 新股的 universe 快照口径日：优先最新数据日，否则用现有 K 线基准日
            if latest_day:
                snap_new, dbas_new = daily_by_day[latest_day], dbasic_by_day[latest_day]
            else:
                f, items = ts_call("daily", {"trade_date": base_date}, "ts_code,open,high,low,close,pct_chg,vol,amount")
                snap_new = rows_to_map(f, items)
                f, items = ts_call("daily_basic", {"trade_date": base_date}, "ts_code,turnover_rate,pe_ttm,pb,total_mv")
                dbas_new = rows_to_map(f, items)
            upath = os.path.join(DATA_DIR, "universe.json")
            with open(upath, encoding="utf-8") as fp:
                universe_ns = json.load(fp)
            for i, code in enumerate(missing):
                try:
                    f, items = ts_call("daily", {"ts_code": code}, "ts_code,trade_date,open,high,low,close,vol")
                    if not items:
                        log(f"  - {code} {basic_all[code]['name']} 暂无行情（当日新股？），次日再补")
                        continue
                    f2, items2 = ts_call("adj_factor", {"ts_code": code}, "ts_code,trade_date,adj_factor")
                    fac = {r[1]: r[2] for r in items2}
                    rows = sorted(items, key=lambda r: r[1])[-KLINE_DAYS:]  # r=(code,date,o,h,l,c,vol)
                    anchor = next((fac[r[1]] for r in reversed(rows) if fac.get(r[1])), None)
                    if not anchor:
                        raise TushareFatal("无复权因子")
                    kl = {
                        "dates": [dash(r[1]) for r in rows],
                        "opens": [r3(r[2] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                        "closes": [r3(r[5] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                        "highs": [r3(r[3] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                        "lows": [r3(r[4] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                        "vols": [round(r[6]) for r in rows],
                        "fullHist": True,  # 全历史已回溯到上市首日（短序列=上市时间短）
                        "closesHfq": [r3(r[5] * fac[r[1]]) if fac.get(r[1]) else None for r in rows],
                    }
                    if not DRY_RUN:
                        write_json_atomic(os.path.join(KLINE_DIR, f"{code}.json"), kl)
                    new_klines.append(code)
                    entry = build_universe_entry(code, basic_all.get(code), snap_new.get(code), dbas_new.get(code), kl)
                    universe_ns.append(attach_scores(dict(entry), universe_ns))
                    new_universe.append(code)
                except Exception as e:
                    log(f"  ✗ {code} {basic_all.get(code, {}).get('name', '')}: {type(e).__name__} {e}（不致命，次日重试）")
                if (i + 1) % 50 == 0:
                    progress("newstock", i + 1, len(missing), f"新股同步 {i + 1}/{len(missing)}（已建 {len(new_klines)}）")
            if new_universe and not DRY_RUN:
                write_json_atomic(upath, universe_ns)
            log(f"  新建 K线 {len(new_klines)} 只，进 universe {len(new_universe)} 只{'（dry-run 未落盘）' if DRY_RUN else ''}")
    except Exception as e:
        log(f"  ✗ 新股同步阶段异常（不致命）: {type(e).__name__} {e}")

    # 6) universe.json 快照刷新 + 新增 12 只（仅当有最新数据日）
    universe_added = []
    universe_count = None
    if latest_day:
        log(f"4/6 更新 universe.json 快照（口径日 {dash(latest_day)}）…")
        upath = os.path.join(DATA_DIR, "universe.json")
        with open(upath, encoding="utf-8") as fp:
            universe = json.load(fp)
        snap, dbas = daily_by_day[latest_day], dbasic_by_day[latest_day]
        refreshed = 0
        for u in universe:
            row = snap.get(u["code"])
            if not row:
                continue  # 停牌：保留旧快照
            u["price"] = row["close"]
            if row.get("pct_chg") is not None:
                u["changePct"] = row["pct_chg"]
            b = dbas.get(u["code"])
            if b:
                if b.get("turnover_rate") is not None:
                    u["turnover"] = b["turnover_rate"]
                u["pe"] = b.get("pe_ttm")
                u["pb"] = b.get("pb")
                if b.get("total_mv"):
                    u["mktCap"] = round(b["total_mv"] / 1e4)  # 万元 → 亿元
            refreshed += 1
        log(f"  存量 {len(universe)} 只，快照刷新 {refreshed} 只（其余停牌保留旧值）；name/industry/cashflow/aiScore/radar 等原样保留")

        existing = {u["code"] for u in universe}
        to_add = [c for c in UNIVERSE_ADD if c not in existing]
        if to_add:
            f, items = ts_call("stock_basic", {"list_status": "L"}, "ts_code,name,industry,list_date")
            basic = {r[0]: {"name": r[1], "industry": r[2], "list_date": r[3]} for r in items}
            for code in to_add:
                kpath = os.path.join(KLINE_DIR, f"{code}.json")
                try:
                    with open(kpath, encoding="utf-8") as fp:
                        kl = json.load(fp)
                    entry = build_universe_entry(code, basic.get(code), snap.get(code), dbas.get(code), kl)
                    universe_added.append(entry)
                except Exception as e:
                    log(f"  ✗ 新增 {code} 失败（不致命）: {type(e).__name__} {e}")
            # 用现有 universe 分布打分后并入
            for e in universe_added:
                universe.append(attach_scores(dict(e), universe))
            log(f"  新增 universe 条目 {len(universe_added)}/{len(to_add)} 只")
            for e in universe_added:
                log(f"    + {e['code']} {e['name']} {e['industry']} 上市 {e['listDate']} "
                    f"price={e['price']} chg={e['changePct']} pe={e['pe']} pb={e['pb']} "
                    f"mktCap={e['mktCap']}亿 turnover={e['turnover']} aiScore={e['aiScore']}")
        universe_count = len(universe)
        if not DRY_RUN:
            write_json_atomic(upath, universe)
            log(f"  universe.json 已落盘：{universe_count} 只")
        else:
            log(f"  [dry-run] universe.json 未落盘（将为 {universe_count} 只）")
    else:
        log("4/6 无新数据日，universe.json 保持原样")

    # 7) indices.json：追加/覆盖缺口日指数点 + 快照值
    indices_updated = 0
    if data_days:
        log("5/6 更新 indices.json…")
        ipath = os.path.join(DATA_DIR, "indices.json")
        with open(ipath, encoding="utf-8") as fp:
            idata = json.load(fp)
        series_by_code = {e["code"]: e for e in idata["series"]}
        for i, (local_code, ts_code) in enumerate(INDEX_MAP):
            try:
                f, items = ts_call(
                    "index_daily",
                    {"ts_code": ts_code, "start_date": base_date, "end_date": today},
                    "ts_code,trade_date,close,pct_chg,vol",
                )
                pts = {dash(r[1]): {"date": dash(r[1]), "close": r[2], "vol": r[4] or 0} for r in items}
                # 只保留缺口数据日（覆盖当日盘中快照点为官方收盘）
                pts = {d: p for d, p in pts.items() if d.replace("-", "") in daily_by_day}
                entry = series_by_code.get(local_code)
                if entry and pts:
                    m = {p["date"]: p for p in entry["series"]}
                    m.update(pts)
                    entry["series"] = [m[k] for k in sorted(m)][-KLINE_DAYS:]
                    indices_updated += 1
                # 快照值（indices 数组与 series 同序）
                if latest_day and i < len(idata["indices"]):
                    lp = pts.get(dash(latest_day))
                    if lp:
                        idata["indices"][i]["value"] = lp["close"]
                        row = next((r for r in items if r[1] == latest_day), None)
                        if row and row[3] is not None:
                            idata["indices"][i]["changePct"] = row[3]
            except Exception as e:
                log(f"  ✗ 指数 {ts_code}: {type(e).__name__} {e}（不致命）")
        if not DRY_RUN:
            write_json_atomic(ipath, idata)
        log(f"  指数序列更新 {indices_updated}/{len(INDEX_MAP)}{'（dry-run 未落盘）' if DRY_RUN else ''}")
    else:
        log("5/6 无新数据日，indices.json 保持原样")

    # 8) meta.json
    if latest_day and universe_count:
        mpath = os.path.join(DATA_DIR, "meta.json")
        with open(mpath, encoding="utf-8") as fp:
            meta = json.load(fp)
        with open(os.path.join(DATA_DIR, "universe.json"), encoding="utf-8") as fp:
            final_universe = json.load(fp) if not DRY_RUN else None
        ref = final_universe
        if ref is None:
            # dry-run：用内存口径重算涨跌家数（快照已刷新的 universe 在上方局部变量中，这里从磁盘近似）
            ref = json.load(open(os.path.join(DATA_DIR, "universe.json"), encoding="utf-8"))
        meta["fetchedAt"] = datetime.now(CN_TZ).isoformat()
        meta["source"] = "Tushare Pro（行情/快照/复权因子主通道），东方财富/腾讯降级为兜底，公开接口"
        meta["stockCount"] = universe_count
        meta["klineFailed"] = len(kline_failed)
        if not DRY_RUN:
            meta["upCount"] = sum(1 for u in ref if (u.get("changePct") or 0) > 0)
            meta["downCount"] = sum(1 for u in ref if (u.get("changePct") or 0) < 0)
            amt = sum(r.get("amount") or 0 for r in daily_by_day[latest_day].values())
            if amt > 0:
                meta["turnoverYi"] = round(amt / 1e5)  # 千元 → 亿元
            write_json_atomic(mpath, meta)
        log(f"6/6 meta.json {'已更新' if not DRY_RUN else '[dry-run] 未落盘'}（stockCount={universe_count}）")
    else:
        log("6/6 无新数据日，meta.json 保持原样")

    minutes = round((time.time() - T0) / 60, 1)
    result = {
        "ok": True,
        "channel": "tushare",
        "dryRun": DRY_RUN,
        "baseDate": dash(base_date),
        "dataDays": [dash(d) for d in data_days],
        "latestDataDate": dash(latest_day) if latest_day else None,
        "klineUpdated": kline_updated,
        "klineFailed": len(kline_failed),
        "hfqBackfilled": hfq_backfilled,
        "newKlines": len(new_klines),
        "newUniverse": len(new_universe),
        "universeCount": universe_count or (len(universe_ns) if new_universe else None),
        "universeAdded": [e["code"] for e in universe_added],
        "indicesUpdated": indices_updated,
        "mfDays": [dash(d) for d in mf_days_done],
        "mfUpdated": mf_updated,
        "apiCalls": _call_count,
        "minutes": minutes,
    }
    print(f"RESULT {json.dumps(result, ensure_ascii=False)}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except TushareFatal as e:
        log(f"整体失败: {e}")
        print(f"RESULT {json.dumps({'ok': False, 'channel': 'tushare', 'error': str(e)[:200]}, ensure_ascii=False)}")
        sys.exit(1)
    except Exception as e:
        log(f"整体失败（未预期）: {type(e).__name__} {e}")
        print(f"RESULT {json.dumps({'ok': False, 'channel': 'tushare', 'error': f'{type(e).__name__}: {e}'[:200]}, ensure_ascii=False)}")
        sys.exit(1)
