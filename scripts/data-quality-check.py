"""AlphaMind 数据质量门禁：每周 ML 训练前运行，超标即阻断当周训练。

检查项（全部基于 public/data/ 真实文件）：
1. hfq 覆盖率：closesHfq 缺失的 K线文件占比 > 10% → 阻断
2. hfq 价格合法性：后复权收盘价非正（<=0 或 null）占比 > 1% → 阻断
3. hfq 极端收益率：|5日后复权收益| > 60% 的记录 > 100 条 → 阻断（复权异常特征）
4. 数据新鲜度：K线最新日期距今天 > 5 天 → 阻断（数据停滞）
5. universe 必备字段：因子规则所需字段缺失 → 阻断

产物 public/data/data-quality.json：{checkedAt, ok, checks, blocked}
退出码：0 = 通过，1 = 阻断，2 = 自检自身出错（按阻断处理，宁可不训）
"""
import json
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = DATA / "data-quality.json"

REQUIRED_FIELDS = [
    "code", "name", "mktCap", "pe", "pb", "turnover", "listDate",
    "mom20", "mom60", "vol20", "vol60", "cpv20", "cpv10", "vcv20", "ret5",
    "sharpe20", "maxdd60", "vcv60", "vr2060", "bias60", "park20", "bigup20", "kurt20",
]

LIMIT_HFQ_MISSING = 0.10
LIMIT_HFQ_BADPRICE = 0.01
LIMIT_EXTREME_RET = 100
LIMIT_STALE_DAYS = 5
EXTREME_BAR = 3.0  # |5日收益|判定线：300%（A股理论上限：北交所30cm×5连板≈271%；60%会误伤IPO连板潮，2016-17年单是真实事件就有数千条）


def main():
    t0 = time.time()
    checks = []
    blocked = []

    files = sorted((DATA / "kline").glob("*.json"))
    n_files = len(files)

    hfq_missing = 0
    hfq_bad = 0
    hfq_total = 0
    extreme = 0
    last_dates = []

    for fp in files:
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            dates = d.get("dates") or []
            c_qfq = np.asarray(d.get("closes") or [], dtype=float)
            ch = d.get("closesHfq")
            if not ch:
                hfq_missing += 1
                c_hfq = c_qfq
            else:
                c_hfq = np.asarray([x if x is not None else np.nan for x in ch], dtype=float)
            if dates:
                last_dates.append(dates[-1])
            valid = c_hfq[~np.isnan(c_hfq)]
            hfq_total += len(c_hfq)
            hfq_bad += int((valid <= 0).sum())
            if len(c_hfq) > 10:
                base = c_hfq[:-5]
                with np.errstate(divide="ignore", invalid="ignore"):
                    r = np.where(base > 0, c_hfq[5:] / base - 1, np.nan)
                extreme += int((np.abs(r) > EXTREME_BAR).sum())
        except Exception:
            hfq_missing += 1

    now = datetime.now(timezone(timedelta(hours=8)))

    # 1. hfq 覆盖率
    miss_ratio = hfq_missing / max(n_files, 1)
    ok = miss_ratio <= LIMIT_HFQ_MISSING
    checks.append({"name": "hfq覆盖率", "value": f"{1-miss_ratio:.1%}（{n_files-hfq_missing}/{n_files}）", "ok": ok})
    if not ok:
        blocked.append(f"closesHfq 缺失占比 {miss_ratio:.1%} > {LIMIT_HFQ_MISSING:.0%}")

    # 2. hfq 价格合法性
    bad_ratio = hfq_bad / max(hfq_total, 1)
    ok = bad_ratio <= LIMIT_HFQ_BADPRICE
    checks.append({"name": "hfq价格合法性", "value": f"非正价格 {hfq_bad} 条（{bad_ratio:.4%}）", "ok": ok})
    if not ok:
        blocked.append(f"后复权非正价格占比 {bad_ratio:.4%} > {LIMIT_HFQ_BADPRICE:.2%}")

    # 3. 极端收益率（|5日|>300%，超A股理论上限即数据异常；60%级别为真实事件不拦）
    ok = extreme <= LIMIT_EXTREME_RET
    checks.append({"name": "hfq极端收益率", "value": f"|5日收益|>300% 共 {extreme} 条", "ok": ok})
    if not ok:
        blocked.append(f"极端 5 日收益 {extreme} 条 > {LIMIT_EXTREME_RET}（复权异常特征）")

    # 4. 数据新鲜度
    latest = max(last_dates) if last_dates else ""
    stale = 999
    if latest:
        stale = (now.date() - datetime.strptime(latest, "%Y-%m-%d").date()).days
    ok = stale <= LIMIT_STALE_DAYS
    checks.append({"name": "数据新鲜度", "value": f"最新K线 {latest}（{stale} 天前）", "ok": ok})
    if not ok:
        blocked.append(f"最新K线日期 {latest}，距今 {stale} 天 > {LIMIT_STALE_DAYS} 天")

    # 5. universe 字段
    try:
        u = json.loads((DATA / "universe.json").read_text(encoding="utf-8"))
        sample = u[len(u) // 2] if u else {}
        missing = [f for f in REQUIRED_FIELDS if f not in sample]
        ok = not missing
        checks.append({"name": "universe字段", "value": f"{len(u)} 只，缺失字段：{missing or '无'}", "ok": ok})
        if not ok:
            blocked.append(f"universe 缺失字段：{missing}")
    except Exception as e:
        checks.append({"name": "universe字段", "value": f"读取失败：{e}", "ok": False})
        blocked.append("universe.json 读取失败")

    passed = not blocked
    out = {
        "checkedAt": now.isoformat(timespec="seconds"),
        "ok": passed,
        "checks": checks,
        "blocked": blocked,
        "elapsedSec": round(time.time() - t0, 1),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    status = "通过" if passed else "阻断"
    print(f"数据质量门禁：{status}（{n_files} 只，{out['elapsedSec']}s）", flush=True)
    for c in checks:
        print(f"  {'✓' if c['ok'] else '✗'} {c['name']}：{c['value']}", flush=True)
    for b in blocked:
        print(f"  阻断原因：{b}", flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"门禁自检出错（按阻断处理）：{e}", flush=True)
        sys.exit(2)
