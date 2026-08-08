#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
# Tushare moneyflow（主力资金流）10 年历史回填
# 数据源：Tushare Pro moneyflow（按 trade_date 全市场单日返回，token 见 .secrets，禁止外泄）
#   主力净流入 netMain = (buy_lg − sell_lg) + (buy_elg − sell_elg)   单位：万元
#   特大单净额 netElg  = buy_elg − sell_elg
#   买入总额   buyTotal = buy_sm + buy_md + buy_lg + buy_elg（四档买入额之和）
# 产物（全部原子写 tmp+rename）：
#   research-data/moneyflow/<code>.json  {dates:[YYYY-MM-DD], netMain:[], netElg:[], buyTotal:[]}
#     —— 每股一个文件，保留 1 位小数；与 K 线按日期 map 对齐（使用时对齐，不要求等长）
# 断点续跑：
#   按年分块。年内抓取缓冲持久化在 _buffer_<year>.json（每段结束原子落盘），
#   一年抓满后 merge 进每股文件并在 _state.json 记录 doneYears；中断重跑自动续。
# 进度协议（与 tushare_daily.py 一致）：
#   PROGRESS <stage> <done> <total> <message…>
#   RESULT {"ok":true,...}
# 用法：
#   python3 scripts/moneyflow_backfill.py                    # 自动续跑（默认单段预算 270s）
#   python3 scripts/moneyflow_backfill.py --max-seconds 200  # 自定义单段时间预算
#   python3 scripts/moneyflow_backfill.py --status           # 只看进度
# ─────────────────────────────────────────────────────────────
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MF_DIR = os.path.join(ROOT, "research-data", "moneyflow")
STATE_PATH = os.path.join(MF_DIR, "_state.json")
START_DATE = "20160701"
MF_FIELDS = "ts_code,trade_date,buy_sm_amount,buy_md_amount,buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount"

T0 = time.time()


def _log(msg):
    from tushare_daily import log
    log(msg)


def _progress(stage, done, total, msg):
    from tushare_daily import progress
    progress(stage, done, total, msg)


def write_json_atomic(path, obj):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def r1(x):
    return round(float(x) + 0.0, 1)


def rows_to_mf(items):
    """moneyflow items → {code: (netMain, netElg, buyTotal)}，保留 1 位小数。"""
    out = {}
    for r in items:
        bsm, bmd, blg, slg, bel, sel = (float(x or 0.0) for x in r[2:8])
        out[r[0]] = (r1((blg - slg) + (bel - sel)), r1(bel - sel), r1(bsm + bmd + blg + bel))
    return out


def merge_moneyflow_batch(batch, mf_dir=MF_DIR):
    """把 {code: {date_dash: (netMain, netElg, buyTotal)}} merge 进每股文件（原子写）。

    回填（整年）与每日增量（单日）共用：按日期去重排序重写，绝不删除既有日期。
    返回更新文件数。文件损坏时跳过该文件（记日志），不覆盖旧数据。
    """
    by_code = {}
    for code, daymap in batch.items():
        by_code.setdefault(code, {}).update(daymap)
    updated = 0
    for code, daymap in by_code.items():
        path = os.path.join(mf_dir, f"{code}.json")
        merged = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    d = json.load(f)
                for i, dt in enumerate(d["dates"]):
                    merged[dt] = (d["netMain"][i], d["netElg"][i], d["buyTotal"][i])
            except Exception as e:
                _log(f"  ✗ {code} 既有文件损坏，跳过（不覆盖）: {type(e).__name__} {e}")
                continue
        merged.update(daymap)
        dates = sorted(merged)
        obj = {
            "dates": dates,
            "netMain": [merged[d][0] for d in dates],
            "netElg": [merged[d][1] for d in dates],
            "buyTotal": [merged[d][2] for d in dates],
        }
        write_json_atomic(path, obj)
        updated += 1
    return updated


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            s = json.load(f)
        s.setdefault("doneYears", [])
        s.setdefault("pending", None)  # {"year": Y, "dates": [yyyymmdd,...]}
        return s
    except OSError:
        return {"doneYears": [], "pending": None}


def buffer_path(year):
    return os.path.join(MF_DIR, f"_buffer_{year}.json")


def load_buffer(year):
    try:
        with open(buffer_path(year), encoding="utf-8") as f:
            raw = json.load(f)
        return {c: {d: tuple(v) for d, v in dm.items()} for c, dm in raw.items()}
    except OSError:
        return {}


def save_buffer(year, buf):
    write_json_atomic(buffer_path(year), buf)


def dash(yyyymmdd):
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def status():
    state = load_state()
    files = [f for f in os.listdir(MF_DIR) if f.endswith(".json") and not f.startswith("_")]
    pend = state.get("pending")
    print(f"已完成年份: {state['doneYears'] or '无'}")
    print(f"进行中: {('year=' + str(pend['year']) + ' 已抓 ' + str(len(pend['dates'])) + ' 天') if pend else '无'}")
    print(f"每股文件: {len(files)} 个")
    if files:
        import random
        for fn in random.sample(files, min(2, len(files))):
            with open(os.path.join(MF_DIR, fn), encoding="utf-8") as f:
                d = json.load(f)
            print(f"  样本 {fn}: {len(d['dates'])} 天, {d['dates'][0]} ~ {d['dates'][-1]}")


def main():
    max_seconds = 270.0
    args = sys.argv[1:]
    if "--max-seconds" in args:
        max_seconds = float(args[args.index("--max-seconds") + 1])

    from tushare_daily import ts_call, today_cn, TushareFatal  # 延迟导入，避免与 tushare_daily 循环依赖

    os.makedirs(MF_DIR, exist_ok=True)
    today = today_cn()
    state = load_state()
    done_years = set(state["doneYears"])

    # 交易日历（2016-07-01 起全部开市日，按年分组）
    _, cal = ts_call("trade_cal", {"exchange": "SSE", "start_date": START_DATE, "end_date": today}, "cal_date,is_open")
    open_days = sorted(d for d, op in cal if op == 1)
    years = {}
    for d in open_days:
        years.setdefault(int(d[:4]), []).append(d)
    todo_years = [y for y in sorted(years) if y not in done_years]
    total_days_all = sum(len(years[y]) for y in todo_years)
    _log(f"待回填年份 {todo_years}，共 {total_days_all} 个交易日（已完成 {sorted(done_years) or '无'}）")
    if not todo_years:
        print(f"RESULT {json.dumps({'ok': True, 'done': True, 'doneYears': sorted(done_years)}, ensure_ascii=False)}", flush=True)
        return 0

    fetched_total = 0
    empty_days = 0
    merged_years = []

    for year in todo_years:
        days = years[year]
        # 恢复年内缓冲（跨年换了 pending 则丢弃陈旧缓冲）
        pend = state.get("pending")
        if pend and pend.get("year") == year:
            buf = load_buffer(year)
            got = set(pend.get("dates") or [])
        else:
            buf, got = {}, set()
            state["pending"] = {"year": year, "dates": []}
        remain = [d for d in days if d not in got]
        _log(f"── {year} 年：{len(days)} 个交易日，已抓 {len(got)}，剩余 {len(remain)}")

        for d in remain:
            # 预留 75s 给年末 merge（5500+ 文件读写），防止超时被 kill 在 merge 中途
            if time.time() - T0 > max_seconds - 75:
                save_buffer(year, buf)
                state["pending"] = {"year": year, "dates": sorted(got)}
                write_json_atomic(STATE_PATH, state)
                _log(f"  时间预算用尽，缓冲已落盘（{year} 年已抓 {len(got)}/{len(days)} 天），下段续跑")
                print(f"RESULT {json.dumps({'ok': True, 'done': False, 'year': year, 'yearFetched': len(got), 'yearTotal': len(days), 'fetchedThisRun': fetched_total, 'emptyDays': empty_days, 'doneYears': sorted(done_years), 'seconds': round(time.time() - T0, 1)}, ensure_ascii=False)}", flush=True)
                return 0
            f, items = ts_call("moneyflow", {"trade_date": d}, MF_FIELDS)
            if not items:
                empty_days += 1
                _log(f"  {dash(d)} moneyflow 返回空（接口无数据，跳过）")
            else:
                dd = dash(d)
                for code, vals in rows_to_mf(items).items():
                    buf.setdefault(code, {})[dd] = vals
                fetched_total += 1
            got.add(d)
            if fetched_total % 50 == 0 and fetched_total > 0:
                _progress("backfill", len(got), len(days), f"{year} 年已抓 {len(got)}/{len(days)} 天")
                save_buffer(year, buf)  # 分段持久化，kill 也只丢 ≤50 天
                state["pending"] = {"year": year, "dates": sorted(got)}
                write_json_atomic(STATE_PATH, state)

        # 一年抓满：merge 进每股文件并落盘
        _log(f"  {year} 年抓取完成（{len(got)} 天，空 {empty_days}），merge 进每股文件…")
        batch = {c: dm for c, dm in buf.items()}
        updated = merge_moneyflow_batch(batch)
        done_years.add(year)
        state["doneYears"] = sorted(done_years)
        state["pending"] = None
        write_json_atomic(STATE_PATH, state)
        try:
            os.remove(buffer_path(year))
        except OSError:
            pass
        merged_years.append(year)
        _log(f"  ✓ {year} 年落盘完成：更新 {updated} 个每股文件")
        _progress("merge", len(merged_years), len(todo_years), f"已完成年份 {sorted(done_years)}")

    files = [f for f in os.listdir(MF_DIR) if f.endswith(".json") and not f.startswith("_")]
    result = {
        "ok": True, "done": True,
        "doneYears": sorted(done_years),
        "mergedThisRun": merged_years,
        "fetchedThisRun": fetched_total,
        "emptyDays": empty_days,
        "stockFiles": len(files),
        "seconds": round(time.time() - T0, 1),
    }
    print(f"RESULT {json.dumps(result, ensure_ascii=False)}", flush=True)
    return 0


if __name__ == "__main__":
    if "--status" in sys.argv:
        status()
        sys.exit(0)
    try:
        sys.exit(main())
    except Exception as e:
        from tushare_daily import TushareFatal  # noqa: F401
        _log(f"整体失败: {type(e).__name__} {e}")
        print(f"RESULT {json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'[:200]}, ensure_ascii=False)}")
        sys.exit(1)
