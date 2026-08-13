"""AlphaMind 树模型因子合成（多因子研究框架的「组合」环节）。

流程：
1. 因子精选：读 factor-research.json，按 |方向化 ICIR| 选拔高 IC 高 IR 因子（默认前 15，
   要求 |dic20|>0.015），去重、覆盖多类别。
2. 建训练集：近一年每周截面（间隔 5 交易日），特征 = 因子值的截面秩（0-1，缺失填 0.5），
   标签 = 前瞻 20 日收益的截面秩并高斯化。
3. 树模型：HistGradientBoostingRegressor（梯度提升树），滚动样本外验证（扩展窗 3 折），
   报告 OOS rank IC / ICIR。
4. 全量训练最终模型，为当前全市场截面打分 → public/data/ml-scores.json。
5. 同时把合成信号的 OOS IC 作为 "mlScore" 因子写回 factor-research.json，
   前端因子评估表可直接查看。

每周运行（在因子评估之后）。产物 ml-scores.json：
{ updatedAt, model, features: [...], oos: {ic, icir, folds}, scores: {code: 0-100}, topPicks: [...] }
"""
import importlib.util
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
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
RESEARCH_JSON = DATA / "factor-research.json"
# PIT 模式（PIT_MODE=1）：训练池纳入退市股、ST 用时点口径，产物写 ml-scores-pit.json，
# 不得覆盖 ml-scores.json / factor-research.json。
OUT = DATA / ("ml-scores-pit.json" if os.environ.get("PIT_MODE") == "1" else "ml-scores.json")

# 加载因子引擎（复用 compute_factor_arrays / spearman / FACTORS）
_spec = importlib.util.spec_from_file_location("factor_research", ROOT / "scripts" / "factor-research.py")
fr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fr)

TOP_FEATURES = 15       # 精选因子数
MIN_ABS_DIC = 0.015     # 入选门槛：|方向化 IC20|
STEP = 10               # 训练截面间隔（交易日；10 年数据下双周截面，控制训练规模）
MIN_BARS = 280
FWD = 20                # 标签前瞻窗口
N_FOLDS = 3             # 扩展窗样本外折数
MIN_OBS = 500


def select_features(research):
    rows = []
    for field, r in research.get("results", {}).items():
        dic = r.get("dic20")
        dicir = r.get("dicir20")
        if dic is None or dicir is None:
            continue
        if abs(dic) < MIN_ABS_DIC:
            continue
        rows.append((field, r["name"], abs(dicir), abs(dic)))
    rows.sort(key=lambda x: -x[2])
    picked = rows[:TOP_FEATURES]
    return [p[0] for p in picked], {p[0]: {"name": p[1], "absIcir": p[2], "absDic": p[3]} for p in picked}


def rank01(x):
    """截面秩（0-1），nan 保持 nan。"""
    x = np.asarray(x, dtype=float)
    ok = ~np.isnan(x)
    out = np.full(len(x), np.nan)
    if ok.sum() > 0:
        order = np.argsort(np.argsort(x[ok]))
        out[ok] = (order + 1) / (ok.sum() + 1)
    return out


def main():
    t0 = time.time()
    research = json.loads(RESEARCH_JSON.read_text(encoding="utf-8"))
    features, feat_meta = select_features(research)
    # PIT 模式：时点口径上下文；启用后不加载"现名 ST"名单（st_codes 恒空，过滤改由 pit_eligible 逐样本判定）
    pit_ctx = fr.pit_context() if fr.PIT_MODE else None
    if fr.PIT_MODE and pit_ctx is None:
        print("PIT_MODE=1 但 research-data 三件套缺失/损坏，终止（不退化为非 PIT 口径）")
        return 1
    # ST 剔除（现名近似，与选股策略口径一致）：不训练、不打分；PIT 模式下不使用
    st_codes = set()
    if pit_ctx is None:
        try:
            for s0 in json.loads((DATA / "universe.json").read_text(encoding="utf-8")):
                if "ST" in (s0.get("name") or "").upper():
                    st_codes.add(s0["code"])
        except Exception:
            pass
    print(f"精选因子 {len(features)} 个：{features}{'，PIT 模式' if pit_ctx is not None else ''}", flush=True)
    if len(features) < 5:
        print("有效因子不足，终止")
        return 1

    files = sorted(KLINE.glob("*.json"))
    score_files = files  # 打分池恒为在市股票目录
    if pit_ctx is not None:
        # 训练池加入退市股全历史 K 线（与在市池零交集）
        files = files + sorted(fr.KLINE_DELISTED.glob("*.json"))
    # date -> {field: (codes, ranks)}, date -> (codes, label_rank)
    X_by_date = {}
    y_by_date = {}
    stocks = 0
    skipped = 0
    for fp in files:
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            dates = d["dates"]
            c, o, h, l, v = fr.load_prices(d)
        except Exception:
            skipped += 1
            continue
        n = len(c)
        if n < MIN_BARS or len(dates) != n:
            skipped += 1
            continue
        ts = list(range(260, n - FWD - 1, STEP))
        if not ts:
            skipped += 1
            continue
        try:
            fac = fr.compute_factor_arrays(c, o, h, l, v)
        except Exception:
            skipped += 1
            continue
        gaps = fr.date_gaps(dates)
        code = fp.stem
        if code in st_codes:
            skipped += 1
            continue
        stocks += 1
        for t in ts:
            ds = dates[t]
            # PIT 时点口径：t 时刻在市、未退市、不在 ST 区间内才纳入训练样本
            if pit_ctx is not None and not fr.pit_eligible(code, ds, pit_ctx):
                continue
            fwd = c[t + FWD] / c[t] - 1
            if c[t] <= 0 or np.isnan(fwd):
                continue
            # 可交易性过滤：停牌缺口 / 复牌跳空收益不可实现，不得进入训练集
            if not fr.tradable(gaps, t, 60, FWD) or abs(fwd) > fr.MAX_PERIOD_RET:
                continue
            xb = X_by_date.setdefault(ds, {f: [] for f in features})
            for f in features:
                arr = fac.get(f)
                val = arr[t] if arr is not None and t < len(arr) else np.nan
                xb[f].append((code, val))
            y_by_date.setdefault(ds, []).append((code, fwd))
        if stocks % 1000 == 0:
            print(f"  已处理 {stocks} 只，{time.time()-t0:.0f}s", flush=True)

    dates_sorted = sorted(ds for ds in y_by_date if len(y_by_date[ds]) >= MIN_OBS)
    print(f"股票 {stocks} 只，有效截面 {len(dates_sorted)} 个", flush=True)
    if len(dates_sorted) < N_FOLDS * 8 + 10:
        print("有效截面不足，终止")
        return 1

    # 组装 numpy 数据集（截面秩化）
    all_dates = []
    X_rows, y_rows, date_idx = [], [], []
    for di, ds in enumerate(dates_sorted):
        yobs = y_by_date[ds]
        codes = [c0 for c0, _ in yobs]
        yv = rank01([fwd for _, fwd in yobs])
        col = {}
        for f in features:
            pairs = X_by_date[ds][f]
            rank_map = {}
            vals = [v0 for _, v0 in pairs]
            rk = rank01(vals)
            for (c0, _), r0 in zip(pairs, rk):
                rank_map[c0] = r0
            col[f] = rank_map
        Xd = np.full((len(codes), len(features)), 0.5)
        for j, f in enumerate(features):
            rm = col[f]
            for i, c0 in enumerate(codes):
                r0 = rm.get(c0)
                if r0 is not None and not np.isnan(r0):
                    Xd[i, j] = r0
        mask = ~np.isnan(yv)
        X_rows.append(Xd[mask])
        y_rows.append(yv[mask])
        date_idx.append(np.full(mask.sum(), di))
        all_dates.append(ds)

    X = np.vstack(X_rows)
    y = np.concatenate(y_rows)
    didx = np.concatenate(date_idx)
    print(f"训练集 {X.shape[0]} 行 × {X.shape[1]} 特征", flush=True)

    from sklearn.ensemble import HistGradientBoostingRegressor

    def new_model():
        return HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
            min_samples_leaf=200, l2_regularization=1.0, random_state=42,
        )

    # 滚动样本外：扩展窗 N_FOLDS 折
    nd = len(dates_sorted)
    fold_size = nd // (N_FOLDS + 1)
    oos_ics = []
    fold_reports = []
    for k in range(N_FOLDS):
        train_end = fold_size * (k + 1) + fold_size  # 训练到第 k+2 段前
        test_start = train_end
        test_end = min(test_start + fold_size, nd)
        if test_end - test_start < 3:
            continue
        tr = didx < train_end
        te = (didx >= test_start) & (didx < test_end)
        model = new_model()
        model.fit(X[tr], y[tr])
        pred = model.predict(X[te])
        te_dates = didx[te]
        ics = []
        for di in np.unique(te_dates):
            m = te_dates == di
            ic = fr.spearman(pred[m], y[te][m])
            if not np.isnan(ic):
                ics.append(ic)
        mean_ic = float(np.mean(ics)) if ics else float("nan")
        oos_ics.extend(ics)
        fold_reports.append({
            "trainDates": int(train_end), "testDates": int(test_end - test_start),
            "ic": round(mean_ic, 4),
        })
        print(f"  折{k+1}: 训练{train_end}截面→测试{test_end-test_start}截面，OOS IC={mean_ic:.4f}", flush=True)

    oos_ic = float(np.mean(oos_ics))
    oos_ir = oos_ic / float(np.std(oos_ics)) if len(oos_ics) > 1 and np.std(oos_ics) > 0 else None

    # 全量训练 + 当前截面打分
    model = new_model()
    model.fit(X, y)

    latest = {}
    latest_codes = []
    latest_rows = []
    for fp in score_files:
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            c, o, h, l, v = fr.load_prices(d)
        except Exception:
            continue
        if len(c) < MIN_BARS or fp.stem in st_codes:
            continue
        # PIT：当前截面打分只对在市股票（delist 为空、当前非 ST）——产品选股不推退市股
        if pit_ctx is not None and not fr.pit_eligible(fp.stem, d["dates"][-1], pit_ctx):
            continue
        # 当前截面可交易性：近期有停牌缺口的股票特征是冻结值，不打分
        try:
            gaps = fr.date_gaps(d["dates"])
            if not fr.tradable(gaps, len(c) - 1, 60, 0):
                continue
        except Exception:
            continue
        try:
            fac = fr.compute_factor_arrays(c, o, h, l, v)
        except Exception:
            continue
        latest[fp.stem] = {f: (fac.get(f)[-1] if fac.get(f) is not None else np.nan) for f in features}
        latest_codes.append(fp.stem)

    for f in features:
        vals = np.array([latest[c0][f] for c0 in latest_codes], dtype=float)
        rk = rank01(vals)
        for i, c0 in enumerate(latest_codes):
            latest[c0][f + "__rank"] = rk[i]

    Xcur = np.full((len(latest_codes), len(features)), 0.5)
    for j, f in enumerate(features):
        for i, c0 in enumerate(latest_codes):
            r0 = latest[c0][f + "__rank"]
            if not np.isnan(r0):
                Xcur[i, j] = r0
    scores = model.predict(Xcur)
    # 归一化到 0-100（截面秩）
    srank = rank01(scores) * 100
    score_map = {c0: round(float(srank[i]), 1) for i, c0 in enumerate(latest_codes)}

    names = {}
    try:
        for s in json.loads((DATA / "universe.json").read_text(encoding="utf-8")):
            names[s["code"]] = s["name"]
    except Exception:
        pass
    top = sorted(score_map.items(), key=lambda kv: -kv[1])[:30]
    top_picks = [{"code": c0, "name": names.get(c0, c0), "score": sc} for c0, sc in top]

    now = datetime.now(timezone(timedelta(hours=8)))
    out = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "model": "HistGradientBoostingRegressor（梯度提升树，300 棵树 / lr 0.05 / L2 1.0）",
        "method": "特征=精选因子截面秩；标签=前瞻20日收益截面秩；滚动样本外3折验证；分数=截面秩0-100",
        "features": [{"field": f, "name": feat_meta[f]["name"], "absIcir": round(feat_meta[f]["absIcir"], 2)} for f in features],
        "oos": {"ic": round(oos_ic, 4), "icir": round(oos_ir, 2) if oos_ir is not None else None, "folds": fold_reports},
        "trainRows": int(X.shape[0]),
        "scores": score_map,
        "topPicks": top_picks,
    }
    if pit_ctx is not None:
        out["pitMode"] = True
        out["method"] += "；PIT 时点口径（训练池含退市股，ST 用历史区间判定）"
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # 写回 factor-research.json，让评估表展示合成信号（PIT 模式不写回，避免污染主产物）
    if pit_ctx is None:
        try:
            research = json.loads(RESEARCH_JSON.read_text(encoding="utf-8"))
            research.setdefault("results", {})["mlScore"] = {
                "name": "ML 合成信号（梯度提升树）",
                "dir": "desc",
                "kind": "composite",
                "ic5": None, "ic10": None, "ic40": None,
                "ic20": {"mean": round(oos_ic, 4), "ir": round(oos_ir, 2) if oos_ir is not None else None,
                         "tstat": None, "posRatio": None, "dates": len(oos_ics)},
                "dic20": round(oos_ic, 4),
                "dicir20": round(oos_ir, 2) if oos_ir is not None else None,
                "spread20": None, "spreadPosRatio": None,
            }
            RESEARCH_JSON.write_text(json.dumps(research, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception as e:
            print(f"写回 research 失败（忽略）：{e}")

    print(f"OOS IC={oos_ic:.4f} ICIR={oos_ir}，写出 {OUT}，耗时 {(time.time()-t0)/60:.1f} 分钟", flush=True)
    print("Top10：", "、".join(f"{p['name']}({p['score']})" for p in top_picks[:10]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
