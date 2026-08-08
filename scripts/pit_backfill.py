#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
# PIT（point-in-time）研究数据补齐：退市股 K 线 + 历史 ST 区间 + 上市/退市时间线
# 用途：消除回测幸存者偏差（docs/data-conventions.md 红线 3）。
# 产物（research-data/，研究专用，不进前端 public/）：
#   research-data/kline-delisted/<code>.json  退市股全历史双复权 K 线（含 delistDate）
#   research-data/st-intervals.json           {code: [[start,end],...]} ST 状态区间（YYYYMMDD）
#   research-data/listing-timeline.json       {code: {list, delist}} 全市场上市/退市时间线
# 幂等可断点：已存在的 K 线文件跳过；JSON 产物每次全量重建（一次调用成本）。
# ─────────────────────────────────────────────────────────────
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = os.path.join(ROOT, ".secrets", "tushare.env")
OUT_DIR = os.path.join(ROOT, "research-data")
KLINE_DIR = os.path.join(OUT_DIR, "kline-delisted")
API_URL = "http://api.tushare.pro"
PACE_S = 0.45
KLINE_DAYS = 2500
WINDOW_START = "20150101"  # 比回测窗口（2016-08）多留缓冲

os.makedirs(KLINE_DIR, exist_ok=True)

token = next(
    l.split("=", 1)[1].strip().strip('"').strip("'")
    for l in open(TOKEN_FILE).read().splitlines()
    if l.strip().startswith("TUSHARE_TOKEN=")
)
_call_count = 0


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def ts_call(api_name, params=None, fields="", retries=5):
    global _call_count
    body = json.dumps({"api_name": api_name, "token": token,
                       "params": params or {}, "fields": fields}).encode()
    last = None
    for i in range(retries):
        _call_count += 1
        try:
            req = urllib.request.Request(API_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            if d.get("code") == 0:
                time.sleep(PACE_S)
                return d["data"]["fields"], d["data"]["items"]
            last = d.get("msg", "unknown")
            if "每分钟" in str(last) or "最多访问" in str(last):
                time.sleep(20 * (i + 1))
            else:
                time.sleep(2 * (i + 1))
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{api_name} 连续失败: {last}")


def r3(x):
    return round(float(x), 3)


def dash(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}"


def main():
    t0 = time.time()
    # 1) 上市/退市时间线（L + D + P 暂停上市）
    timeline = {}
    for status in ("L", "D", "P"):
        _, items = ts_call("stock_basic", {"list_status": status}, "ts_code,list_date,delist_date")
        for code, ld, dd in items:
            timeline[code] = {"list": ld, "delist": dd}
    with open(os.path.join(OUT_DIR, "listing-timeline.json"), "w") as f:
        json.dump(timeline, f, ensure_ascii=False)
    log(f"1/3 时间线：{len(timeline)} 只（含退市/暂停）")

    # 2) 历史 ST 区间（namechange 批量，一次调用；名字含 ST 的区间即 ST 状态）
    _, items = ts_call("namechange", {"start_date": WINDOW_START},
                       "ts_code,name,start_date,end_date")
    per_stock = {}
    for code, name, sd, ed in items:
        per_stock.setdefault(code, []).append((sd or "19900101", ed or "99999999", name or ""))
    st_intervals = {}
    for code, rows in per_stock.items():
        rows.sort()
        iv = [[sd, ed] for sd, ed, name in rows if "ST" in name.upper()]
        if iv:
            st_intervals[code] = iv
    with open(os.path.join(OUT_DIR, "st-intervals.json"), "w") as f:
        json.dump(st_intervals, f, ensure_ascii=False)
    log(f"2/3 ST 区间：{len(st_intervals)} 只股票曾有 ST 标记（namechange 记录 {len(items)} 条）")

    # 3) 退市股全历史 K 线（只拉窗口内退市的；幂等跳过已有文件）
    delisted = sorted(
        c for c, v in timeline.items()
        if v["delist"] and v["delist"] >= WINDOW_START
    )
    have = {fn[:-5] for fn in os.listdir(KLINE_DIR) if fn.endswith(".json")}
    todo = [c for c in delisted if c not in have]
    log(f"3/3 退市股（{WINDOW_START} 后退市）{len(delisted)} 只，待拉取 {len(todo)} 只")
    done, failed = 0, []
    for i, code in enumerate(todo):
        try:
            _, items = ts_call("daily", {"ts_code": code}, "ts_code,trade_date,open,high,low,close,vol")
            if not items:
                failed.append((code, "无行情"))
                continue
            _, fac_items = ts_call("adj_factor", {"ts_code": code}, "ts_code,trade_date,adj_factor")
            fac = {r[1]: r[2] for r in fac_items}
            rows = sorted(items, key=lambda r: r[1])[-KLINE_DAYS:]
            anchor = next((fac[r[1]] for r in reversed(rows) if fac.get(r[1])), None)
            if not anchor:
                failed.append((code, "无复权因子"))
                continue
            kl = {
                "dates": [dash(r[1]) for r in rows],
                "opens": [r3(r[2] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                "closes": [r3(r[5] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                "highs": [r3(r[3] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                "lows": [r3(r[4] * fac[r[1]] / anchor) if fac.get(r[1]) else None for r in rows],
                "vols": [round(r[6]) for r in rows],
                "fullHist": True,
                "closesHfq": [r3(r[5] * fac[r[1]]) if fac.get(r[1]) else None for r in rows],
                "delistDate": dash(timeline[code]["delist"]),
            }
            tmp = os.path.join(KLINE_DIR, f".{code}.tmp")
            with open(tmp, "w") as f:
                json.dump(kl, f, ensure_ascii=False)
            os.replace(tmp, os.path.join(KLINE_DIR, f"{code}.json"))
            done += 1
        except Exception as e:
            failed.append((code, f"{type(e).__name__}: {e}"))
        if (i + 1) % 50 == 0:
            log(f"  进度 {i + 1}/{len(todo)}（成功 {done}，失败 {len(failed)}）")
    log(f"退市股 K 线完成：成功 {done}，失败 {len(failed)}，API {_call_count} 次，{time.time()-t0:.0f}s")
    for c, why in failed[:15]:
        log(f"  ✗ {c}: {why}")
    print(f"RESULT {json.dumps({'ok': True, 'delistedDone': done, 'failed': len(failed), 'stStocks': len(st_intervals), 'apiCalls': _call_count})}", flush=True)


if __name__ == "__main__":
    main()
