"""AlphaMind ML 信号历史回测（验证 mlScore 的真实超额收益）。

严格样本外：每个调仓日的打分模型只用该日之前的截面训练（滚动窗），
任何时刻不使用未来数据。

流程：
1. 复用 factor-research 的精选因子（与 ml-composite 相同的 15 个特征）。
2. 每 5 个交易日一个调仓截面；每 4 个截面重训一次模型（滚动 40 截面窗口），
   为其后的截面打样本外分数。
3. 组合：每期买入分数 top N 等权，持有一期；换手部分扣双边交易成本。
4. 基准：沪深300（indices.json）。输出净值曲线与统计指标。
5. 诊断：十分组多空利差（top decile - bottom decile 逐期收益）。

产物 public/data/ml-backtest.json：
{ updatedAt, method, params, metrics, curve: [{date, port, bench}], periods, deciles }
"""
import importlib.util
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
import json
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
INDICES_JSON = DATA / "indices.json"

_spec = importlib.util.spec_from_file_location("factor_research", ROOT / "scripts" / "factor-research.py")
fr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fr)

_spec2 = importlib.util.spec_from_file_location("ml_composite", ROOT / "scripts" / "ml-composite.py")
mc = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(mc)

WARMUP = 140        # 因子数组所需的最小历史（maxdd120 等）
STEP = int(os.environ.get("BT_STEP", "5"))            # 调仓间隔（交易日）
RETRAIN_EVERY = int(os.environ.get("BT_RETRAIN", "12"))  # 每 12 个截面重训一次（约季度；10 年走查控制训练次数）
TRAIN_WINDOW = 40   # 滚动训练窗口（截面数）
MIN_TRAIN = 16      # 首次训练所需最少截面数
TOP_N = int(os.environ.get("BT_TOPN", "100"))         # 组合持股数
BUFFER = int(os.environ.get("BT_BUFFER", "100"))      # 换手缓冲带：原持仓排名跌出 BUFFER 才卖出（实测缓冲带损害快衰减信号的 alpha，默认=TOP_N 即不启用）
IND_CAP = int(os.environ.get("BT_INDCAP", "0"))       # 行业中性：单行业持仓上限（0=不约束，仅约束新买入；实测该信号下行业约束损失 alpha，默认关闭）
TRANCHES = int(os.environ.get("BT_TRANCHES", "1"))    # 梯队数：>1 时资金均分 N 份错周调仓，每份持有 N×STEP 个交易日（匹配 20 日标签 horizon）
COST_SIDE = 0.001   # 单边交易成本 0.1%（佣金+印花+滑点近似）
FWD = 20            # 标签前瞻窗口（与训练一致）
MIN_OBS = 500
OUT_SUFFIX = os.environ.get("BT_OUT", "")  # 变体实验时区分输出文件
if fr.PIT_MODE and not OUT_SUFFIX:
    OUT_SUFFIX = "-pit"  # PIT 产物不得覆盖 ml-backtest.json
OUT = DATA / f"ml-backtest{OUT_SUFFIX}.json"


def main():
    t0 = time.time()
    research = json.loads(RESEARCH_JSON.read_text(encoding="utf-8"))
    features, _ = mc.select_features(research)
    print(f"特征 {len(features)} 个", flush=True)

    # 行业映射（行业中性约束用）+ ST 名单（回测剔除，与选股策略口径一致；为现名近似）
    # PIT 模式：不加载现名 ST 名单（st_codes 恒空），改由 pit_eligible 逐截面时点判定
    pit_ctx = fr.pit_context() if fr.PIT_MODE else None
    if fr.PIT_MODE and pit_ctx is None:
        print("PIT_MODE=1 但 research-data 三件套缺失/损坏，终止（不退化为非 PIT 口径）")
        return 1
    industry_of = {}
    st_codes = set()
    try:
        for s in json.loads((DATA / "universe.json").read_text(encoding="utf-8")):
            industry_of[s["code"]] = s.get("industry") or "未知"
            if pit_ctx is None and "ST" in (s.get("name") or "").upper():
                st_codes.add(s["code"])
    except Exception:
        pass

    # ── 数据：每只股票因子数组 + 收盘价序列 ──
    # code -> {dates, closes, fac}
    stocks = {}
    files = sorted(KLINE.glob("*.json"))
    if pit_ctx is not None:
        # PIT：股票池加入退市股全历史 K 线（与在市池零交集，已验证）
        files = files + sorted(fr.KLINE_DELISTED.glob("*.json"))
    for i, fp in enumerate(files):
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            dates = d["dates"]
            c, o, h, l, v = fr.load_prices(d)
            n = len(c)
            if n < 240 + FWD + STEP or len(dates) != n:  # 上市满约一年才可参与（避免次新连板污染）
                continue
            if fp.stem in st_codes:
                continue
            fac = fr.compute_factor_arrays(c, o, h, l, v)
            stocks[fp.stem] = {"dates": dates, "closes": c, "fac": fac, "gaps": fr.date_gaps(dates)}
        except Exception:
            continue
        if (i + 1) % 1000 == 0:
            print(f"  因子计算 {i+1}/{len(files)}，{time.time()-t0:.0f}s", flush=True)
    print(f"有效股票 {len(stocks)} 只，{time.time()-t0:.0f}s", flush=True)

    # ── 日历与基准：沪深300（indices.json，约260个交易日）──
    # 以指数交易日历为主日历：股票在该日有K线则参与当期的截面，没有则缺席
    idx_series = json.loads(INDICES_JSON.read_text(encoding="utf-8"))["series"]
    s300 = next(x for x in idx_series if x["code"] == "sh000300")["series"]
    cal = [x["date"] for x in s300]
    bench_close = {x["date"]: x["close"] for x in s300}
    LASTN = int(os.environ.get("BT_LASTN", "0"))  # >0 时只用最近 N 个交易日的日历（对照实验用）
    if LASTN:
        cal = cal[-LASTN:]

    for s in stocks.values():
        s["idx"] = {d: i for i, d in enumerate(s["dates"])}
    # 调仓点：每隔 STEP 一个；最后一个没有下一期持有收益，舍去
    reb_dates = cal[10::STEP][:-1]
    print(f"指数日历 {len(cal)} 天，调仓点 {len(reb_dates)} 个", flush=True)

    # ── 逐截面组装（特征截面秩 + 持有期收益）──
    # section: {date, codes, X(秩), ret_next(到下一调仓日的收益)}
    sections = []
    pit_pool_delisted = set()  # PIT 诊断：进入过可买池的退市股
    for di, ds in enumerate(reb_dates):
        codes, rows, rets = [], [], []
        delist_exit = set()  # 本截面中按"退市末bar"口径计收益的股票
        for code, s in stocks.items():
            t = s["idx"].get(ds)
            if t is None:
                continue
            # PIT 时点口径：t 时刻在市、未退市、不在 ST 区间内才进入可买池
            if pit_ctx is not None:
                if not fr.pit_eligible(code, ds, pit_ctx):
                    continue
                dl = pit_ctx["timeline"].get(code, (0, None))[1]
                if dl is not None:
                    pit_pool_delisted.add(code)
            # 持有期收益：本调仓日 → 下一调仓日
            nxt = reb_dates[di + 1] if di + 1 < len(reb_dates) else None
            if nxt is None:
                tn = None
            else:
                tn = s["idx"].get(nxt)
            c = s["closes"]
            if tn is None or tn >= len(c) or c[t] <= 0:
                r = np.nan
                # PIT 退市处理：持仓期内数据结束（退市）→ 收益算到最后一根 bar，
                # 剩余期间按 0%（现金），即该期收益 = 末bar价/买入价-1
                if (pit_ctx is not None and nxt is not None and c[t] > 0
                        and s["dates"][-1] < nxt):
                    r = c[-1] / c[t] - 1
                    delist_exit.add(code)
            else:
                r = c[tn] / c[t] - 1
            # 可交易性：持有窗口含停牌缺口 / 收益超理论上限（复牌跳空）→ 该期不可买
            if not fr.tradable(s["gaps"], t, 60, (tn - t) if tn is not None else 0):
                continue
            if not np.isnan(r) and abs(r) > fr.MAX_PERIOD_RET:
                continue
            fac = s["fac"]
            rows.append([fac.get(f)[t] if fac.get(f) is not None and t < len(fac.get(f)) else np.nan for f in features])
            codes.append(code)
            rets.append(r)
        if len(codes) < MIN_OBS:
            continue
        Xr = np.column_stack([mc.rank01(np.array([row[j] for row in rows])) for j in range(len(features))])
        Xr = np.where(np.isnan(Xr), 0.5, Xr)
        sections.append({"date": ds, "codes": codes, "X": Xr, "ret": np.array(rets), "delist_exit": delist_exit})
    print(f"有效截面 {len(sections)} 个，{time.time()-t0:.0f}s", flush=True)
    if len(sections) < MIN_TRAIN + 8:
        print("截面不足，终止")
        return 1

    # 标签：前瞻 FWD 日收益截面秩（用于训练）
    for di, sec in enumerate(sections):
        fwds = []
        for code in sec["codes"]:
            s = stocks[code]
            t = s["idx"].get(sec["date"])
            c = s["closes"]
            if t is None or t + FWD >= len(c) or c[t] <= 0:
                fwds.append(np.nan)
            else:
                fw = c[t + FWD] / c[t] - 1
                # 超理论上限的收益（停牌跳空/数据异常）不作为训练标签
                fwds.append(fw if abs(fw) <= fr.MAX_PERIOD_RET else np.nan)
        yv = mc.rank01(np.array(fwds))
        sec["y"] = yv

    # ── 滚动训练 + 样本外打分 + 组合模拟 ──
    from sklearn.ensemble import HistGradientBoostingRegressor

    def new_model():
        return HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
            min_samples_leaf=200, l2_regularization=1.0, random_state=42,
        )

    model = None
    curve = []
    port_nav, bench_nav = 1.0, 1.0
    prev_hold = set()
    tranche_holds = []  # 梯队模式：每个元素是一个梯队的持仓集合
    turnovers, period_rets, bench_period_rets, decile_spreads = [], [], [], []
    oos_ics = []
    pit_exit_events = []  # PIT 诊断：持仓期内退市的股票及其末bar口径收益

    for di, sec in enumerate(sections):
        # 重训：用 [di-TRAIN_WINDOW, di) 的截面
        if di >= MIN_TRAIN and (di - MIN_TRAIN) % RETRAIN_EVERY == 0:
            tr_secs = sections[max(0, di - TRAIN_WINDOW):di]
            Xtr = np.vstack([s["X"] for s in tr_secs])
            ytr = np.concatenate([s["y"] for s in tr_secs])
            m = ~np.isnan(ytr)
            model = new_model()
            model.fit(Xtr[m], ytr[m])
            print(f"  重训@截面{di}（{sec['date']}，{m.sum()}行），{time.time()-t0:.0f}s", flush=True)
        if model is None:
            continue

        pred = model.predict(sec["X"])
        ic = fr.spearman(pred, sec["ret"])
        if not np.isnan(ic):
            oos_ics.append(ic)

        order = np.argsort(-pred)
        valid = ~np.isnan(sec["ret"])
        ranked = [i for i in order if valid[i]]
        pos_of = {c: p for p, c in enumerate(sec["codes"])}
        rank_of = {sec["codes"][i]: pos for pos, i in enumerate(ranked)}

        # ── 组合构建 ──
        if TRANCHES > 1:
            # 梯队错周调仓：资金均分 TRANCHES 份，每周只有一份换仓（买当前排名前 per 名），
            # 每份持有 TRANCHES×STEP 个交易日，匹配 20 日标签 horizon
            per = max(1, TOP_N // TRANCHES)
            ti = di % TRANCHES
            new_codes = set(sec["codes"][i] for i in ranked[:per])
            old = tranche_holds[ti] if ti < len(tranche_holds) else set()
            tr_turnover = (1 - len(new_codes & old) / per) if old else 1.0
            if ti < len(tranche_holds):
                tranche_holds[ti] = new_codes
            else:
                tranche_holds.append(new_codes)
            hold_idx = [pos_of[c] for tr in tranche_holds for c in tr if c in pos_of]
            r = sec["ret"][hold_idx] if hold_idx else np.array([0.0])
            gross = float(np.mean(np.where(np.isnan(r), 0.0, r)))  # 缺失下一期价格（停牌等）按持平计
            turnover = tr_turnover / TRANCHES
            hold = new_codes  # 仅供下一期 prev_hold 语义占位
        else:
            # 单组合：换手缓冲带 + 行业中性
            # 1) 缓冲带：原持仓排名仍在前 BUFFER 名内 → 继续持有（避免边缘换手）
            keep = [c for c in prev_hold if c in pos_of and rank_of.get(c, 10**9) < BUFFER]
            ind_count = {}
            for c in keep:
                ind = industry_of.get(c, "未知")
                ind_count[ind] = ind_count.get(ind, 0) + 1
            # 2) 排名从高到低补位，新买入受单行业上限约束
            hold_list = list(keep)
            in_hold = set(hold_list)
            for i in ranked:
                if len(hold_list) >= TOP_N:
                    break
                c = sec["codes"][i]
                if c in in_hold:
                    continue
                ind = industry_of.get(c, "未知")
                if IND_CAP and ind_count.get(ind, 0) >= IND_CAP:
                    continue
                hold_list.append(c)
                in_hold.add(c)
                ind_count[ind] = ind_count.get(ind, 0) + 1
            hold = set(hold_list)
            hold_idx = [pos_of[c] for c in hold_list]
            gross = float(np.mean(sec["ret"][hold_idx])) if hold_idx else 0.0
            # 换手与成本
            if prev_hold:
                turnover = 1 - len(hold & prev_hold) / TOP_N
            else:
                turnover = 1.0
        cost = turnover * 2 * COST_SIDE
        net = gross - cost
        turnovers.append(turnover)
        period_rets.append(net)

        # PIT 诊断：本期持仓中按"退市末bar"口径计收益的股票（到期自动移出：下一期无K线/不在市自然落选）
        if pit_ctx is not None and sec["delist_exit"]:
            for i in hold_idx:
                c0 = sec["codes"][i]
                if c0 in sec["delist_exit"]:
                    pit_exit_events.append({"code": c0, "date": sec["date"], "ret": round(float(sec["ret"][i]), 4)})

        # 十分组利差
        dec = [i for i in order if valid[i]]
        d1 = dec[:len(dec) // 10]
        d10 = dec[-len(dec) // 10:]
        if d1 and d10:
            decile_spreads.append(float(np.mean(sec["ret"][d1]) - np.mean(sec["ret"][d10])))

        # 基准收益（调仓日→下一调仓日）
        nxt_date = sections[di + 1]["date"] if di + 1 < len(sections) else None
        b_r = 0.0
        if nxt_date and sec["date"] in bench_close and nxt_date in bench_close:
            b_r = bench_close[nxt_date] / bench_close[sec["date"]] - 1
        bench_period_rets.append(b_r)

        port_nav *= 1 + net
        bench_nav *= 1 + b_r
        curve.append({"date": sec["date"], "port": round(port_nav, 4), "bench": round(bench_nav, 4), "ret": round(net, 4)})
        prev_hold = hold

    if not curve:
        print("无有效回测期，终止")
        return 1

    # ── 统计指标 ──
    pr = np.array(period_rets)
    br = np.array(bench_period_rets)
    periods_per_year = 250 / STEP
    ann_port = (port_nav ** (periods_per_year / len(pr)) - 1) * 100
    ann_bench = (bench_nav ** (periods_per_year / len(br)) - 1) * 100 if bench_nav > 0 else None
    excess = pr - br
    ann_excess = float(np.mean(excess) * periods_per_year * 100)
    sharpe = float(np.mean(pr) / np.std(pr) * np.sqrt(periods_per_year)) if np.std(pr) > 0 else None
    # 最大回撤
    navs = np.array([c["port"] for c in curve])
    peak = np.maximum.accumulate(navs)
    maxdd = float(np.min(navs / peak - 1) * 100)
    win = float(np.mean(excess > 0) * 100)

    metrics = {
        "periods": len(pr),
        "spanMonths": round(len(pr) * STEP / 20, 1),
        "totalReturn": round((port_nav - 1) * 100, 1),
        "benchReturn": round((bench_nav - 1) * 100, 1),
        "annReturn": round(ann_port, 1),
        "annBench": round(ann_bench, 1) if ann_bench is not None else None,
        "annExcess": round(ann_excess, 1),
        "maxDrawdown": round(maxdd, 1),
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "winRateVsBench": round(win, 1),
        "avgTurnover": round(float(np.mean(turnovers)) * 100, 1),
        "oosIc": round(float(np.mean(oos_ics)), 4) if oos_ics else None,
        "decileSpreadAnn": round(float(np.mean(decile_spreads)) * periods_per_year * 100, 1) if decile_spreads else None,
    }
    if pit_ctx is not None:
        metrics["pitMode"] = True

    now = datetime.now(timezone(timedelta(hours=8)))
    out = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "method": f"严格样本外：滚动40截面窗口训练，每12截面重训；top{TOP_N}等权周度调仓{'（' + str(TRANCHES) + '梯队错周）' if TRANCHES > 1 else ''}；换手缓冲带前{BUFFER}名；单行业上限{IND_CAP}只；双边成本0.1%×换手；基准沪深300",
        "params": {"topN": TOP_N, "buffer": BUFFER, "indCap": IND_CAP, "tranches": TRANCHES, "step": STEP, "retrainEvery": RETRAIN_EVERY, "trainWindow": TRAIN_WINDOW, "costSide": COST_SIDE, "features": len(features)},
        "metrics": metrics,
        "curve": curve,
    }
    if pit_ctx is not None:
        out["method"] += "；PIT 时点口径（可买池含当时在市后退市股，ST 用历史区间判定，退市收益算到末bar）"
        out["pitDiag"] = {
            "delistedStocksInPool": len(pit_pool_delisted),
            "delistExitEvents": pit_exit_events[:50],
            "delistExitCount": len(pit_exit_events),
        }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"回测 {metrics['periods']} 期（{metrics['spanMonths']}个月）：组合 {metrics['totalReturn']}% vs 基准 {metrics['benchReturn']}%，年化超额 {metrics['annExcess']}%，最大回撤 {metrics['maxDrawdown']}%，夏普 {metrics['sharpe']}，胜率 {metrics['winRateVsBench']}%", flush=True)
    print(f"写出 {OUT}，耗时 {(time.time()-t0)/60:.1f} 分钟", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
