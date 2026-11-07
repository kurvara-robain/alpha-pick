#!/usr/bin/env python3
"""补齐 indices.json 指定交易日的指数点，并回填 meta.json 的当日统计。

用途：tushare_daily.py 只在「有新数据日」时才更新 indices.json / meta.json；
若某次整夜跑批在两者被写入前中断（例如 2026-11-06 收盘数据），
K 线已前移而指数/元数据停在上一交易日，形成永久缺口。本脚本按交易日补点，幂等。

用法：python3 scripts/backfill_indices.py 20261106
"""
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tushare_daily as td  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: backfill_indices.py YYYYMMDD")
        return 2
    day = sys.argv[1]
    d = td.dash(day)

    # 1) indices.json 指数点
    ipath = os.path.join(td.DATA_DIR, "indices.json")
    with open(ipath, encoding="utf-8") as fp:
        idata = json.load(fp)
    series_by_code = {e["code"]: e for e in idata["series"]}
    updated = 0
    for i, (local_code, ts_code) in enumerate(td.INDEX_MAP):
        try:
            _fields, items = td.ts_call(
                "index_daily",
                {"ts_code": ts_code, "start_date": day, "end_date": day},
                "ts_code,trade_date,close,pct_chg,vol",
            )
            row = next((r for r in items if r[1] == day), None)
            if not row:
                print(f"  - {ts_code}: {day} 无数据（非交易日或接口未出）")
                continue
            point = {"date": d, "close": row[2], "vol": row[4] or 0}
            entry = series_by_code.get(local_code)
            if entry:
                by_date = {p["date"]: p for p in entry["series"]}
                by_date[d] = point
                entry["series"] = [by_date[k] for k in sorted(by_date)][-td.KLINE_DAYS:]
                updated += 1
            if i < len(idata["indices"]):
                idata["indices"][i]["value"] = row[2]
                if row[3] is not None:
                    idata["indices"][i]["changePct"] = row[3]
            print(f"  ✓ {local_code} {d} close={row[2]} pct={row[3]}")
        except Exception as exc:  # 单个指数失败不致命
            print(f"  ✗ {ts_code}: {type(exc).__name__} {exc}")
    td.write_json_atomic(ipath, idata)
    print(f"indices.json 已写回：更新 {updated}/{len(td.INDEX_MAP)} 条序列")

    # 2) meta.json 当日统计
    mpath = os.path.join(td.DATA_DIR, "meta.json")
    with open(mpath, encoding="utf-8") as fp:
        meta = json.load(fp)
    upath = os.path.join(td.DATA_DIR, "universe.json")
    with open(upath, encoding="utf-8") as fp:
        uni = json.load(fp)
    if isinstance(uni, list) and uni:
        meta["upCount"] = sum(1 for u in uni if (u.get("changePct") or 0) > 0)
        meta["downCount"] = sum(1 for u in uni if (u.get("changePct") or 0) < 0)
    try:
        _fields, items = td.ts_call("daily", {"trade_date": day}, "ts_code,amount")
        amount = sum((r[1] or 0) for r in items)
        if amount > 0:
            meta["turnoverYi"] = round(amount / 1e5)  # 千元 → 亿元
        if items:
            meta["stockCount"] = len(items)
    except Exception as exc:
        print(f"  meta 成交额/家数跳过：{type(exc).__name__} {exc}")
    meta["fetchedAt"] = datetime.now().astimezone().isoformat()
    td.write_json_atomic(mpath, meta)
    print(f"meta.json 已更新：up={meta.get('upCount')} down={meta.get('downCount')} "
          f"turnoverYi={meta.get('turnoverYi')} stockCount={meta.get('stockCount')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
