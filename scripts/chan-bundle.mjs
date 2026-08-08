// src/lib/chan.ts
var MIN_BARS = 60;
var MIN_STROKE_GAP = 4;
var DIVERGENCE_RATIO = 0.8;
var ZS_TOLERANCE = 0.02;
function mergeInclusion(dates, highs, lows) {
  const out = [];
  let dir = null;
  for (let i = 0; i < dates.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const last = out[out.length - 1];
    if (!last) {
      out.push({ high: h, low: l, date: dates[i] });
      continue;
    }
    const contained = last.high >= h && last.low <= l || h >= last.high && l <= last.low;
    if (!contained) {
      dir = h > last.high ? "up" : "down";
      out.push({ high: h, low: l, date: dates[i] });
    } else {
      const up = dir !== "down";
      last.high = up ? Math.max(last.high, h) : Math.min(last.high, h);
      last.low = up ? Math.max(last.low, l) : Math.min(last.low, l);
      last.date = dates[i];
    }
  }
  return out;
}
function findFractals(bars) {
  const out = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const p = bars[i - 1];
    const c = bars[i];
    const n = bars[i + 1];
    if (c.high > p.high && c.high > n.high && c.low > p.low && c.low > n.low) {
      out.push({ idx: i, type: "top", price: c.high, date: c.date });
    } else if (c.low < p.low && c.low < n.low && c.high < p.high && c.high < n.high) {
      out.push({ idx: i, type: "bottom", price: c.low, date: c.date });
    }
  }
  return out;
}
function buildStrokes(fractals) {
  const pts = [];
  for (const f of fractals) {
    const last = pts[pts.length - 1];
    if (!last) {
      pts.push(f);
      continue;
    }
    if (f.type !== last.type) {
      if (f.idx - last.idx >= MIN_STROKE_GAP) pts.push(f);
    } else if (f.type === "top" && f.price >= last.price || f.type === "bottom" && f.price <= last.price) {
      pts[pts.length - 1] = f;
    }
  }
  const strokes = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    strokes.push({
      dir: a.type === "bottom" ? "up" : "down",
      fromPrice: a.price,
      toPrice: b.price,
      fromDate: a.date,
      toDate: b.date
    });
  }
  return strokes;
}
function findZhongshu(strokes) {
  const n = strokes.length;
  if (n < 3) return null;
  const overlap = (from, to) => {
    let zg = Infinity;
    let zd = -Infinity;
    for (let i = from; i <= to; i++) {
      zg = Math.min(zg, Math.max(strokes[i].fromPrice, strokes[i].toPrice));
      zd = Math.max(zd, Math.min(strokes[i].fromPrice, strokes[i].toPrice));
    }
    if (zg <= zd) return null;
    return { zg, zd, startDate: strokes[from].fromDate, endDate: strokes[to].toDate };
  };
  let best = overlap(n - 3, n - 1);
  if (!best) return null;
  for (let from = n - 4; from >= 0; from--) {
    const z = overlap(from, n - 1);
    if (!z) break;
    best = z;
  }
  return best;
}
function ema(arr, period) {
  const k = 2 / (period + 1);
  const out = new Array(arr.length);
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
  return out;
}
function detectDivergence(strokes, dif, dateIdx) {
  const areaOf = (s) => {
    const a = dateIdx.get(s.fromDate) ?? 0;
    const b = dateIdx.get(s.toDate) ?? 0;
    let sum = 0;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      sum += s.dir === "up" ? Math.max(dif[i], 0) : Math.max(-dif[i], 0);
    }
    return sum;
  };
  const check = (dir, kind) => {
    const same = strokes.filter((s) => s.dir === dir);
    if (same.length < 2) return null;
    const cur = same[same.length - 1];
    const prev = same[same.length - 2];
    const prevArea = areaOf(prev);
    if (prevArea <= 0) return null;
    const ratio = areaOf(cur) / prevArea;
    const newExtreme = dir === "up" ? cur.toPrice > prev.toPrice : cur.toPrice < prev.toPrice;
    return newExtreme && ratio < DIVERGENCE_RATIO ? { kind, ratio } : null;
  };
  const lastDir = strokes[strokes.length - 1].dir;
  return lastDir === "down" ? check("up", "top") ?? check("down", "bottom") : check("down", "bottom") ?? check("up", "top");
}
function judgePoint(strokes, zs, div) {
  const last = strokes[strokes.length - 1];
  const prev = strokes[strokes.length - 2];
  if (zs && prev) {
    if (prev.dir === "up" && prev.toPrice > zs.zg * (1 + ZS_TOLERANCE) && last.dir === "down" && last.toPrice > zs.zg * (1 - ZS_TOLERANCE)) {
      return "\u7B2C\u4E09\u7C7B\u4E70\u70B9\uFF08\u56DE\u8E29\u4E2D\u67A2\u4E0A\u6CBF\u4E0D\u7834\uFF09";
    }
    if (prev.dir === "down" && prev.toPrice < zs.zd * (1 - ZS_TOLERANCE) && last.dir === "up" && last.toPrice < zs.zd * (1 + ZS_TOLERANCE)) {
      return "\u7B2C\u4E09\u7C7B\u5356\u70B9\uFF08\u53CD\u62BD\u4E2D\u67A2\u4E0B\u6CBF\u4E0D\u8FC7\uFF09";
    }
  }
  if (div) {
    if (div.kind === "top" && last.dir === "down") return "\u8B66\u60D5\u7B2C\u4E00\u7C7B/\u7B2C\u4E8C\u7C7B\u5356\u70B9\uFF08\u9876\u80CC\u9A70\u540E\u8F6C\u5165\u5411\u4E0B\u7B14\uFF09";
    if (div.kind === "bottom" && last.dir === "up") return "\u5173\u6CE8\u7B2C\u4E00\u7C7B/\u7B2C\u4E8C\u7C7B\u4E70\u70B9\uFF08\u5E95\u80CC\u9A70\u540E\u8F6C\u5165\u5411\u4E0A\u7B14\uFF09";
  }
  if (zs) {
    if (last.toPrice >= zs.zd && last.toPrice <= zs.zg) {
      return "\u4E2D\u67A2\u9707\u8361\u4E2D\uFF0C\u5173\u6CE8\u4E0A\u4E0B\u6CBF ZG/ZD \u7684\u7A81\u7834\u65B9\u5411";
    }
  }
  return null;
}
var r2 = (v) => Number(v.toFixed(2));
function runChanAnalysis(k) {
  const { dates, closes, highs, lows } = k;
  if (!highs || !lows || dates.length < MIN_BARS || closes.length !== dates.length || highs.length !== dates.length || lows.length !== dates.length) {
    return null;
  }
  const bars = mergeInclusion(dates, highs, lows);
  if (bars.length < 10) return null;
  const fractals = findFractals(bars);
  const strokes = buildStrokes(fractals);
  if (strokes.length < 2) return null;
  const zs = findZhongshu(strokes);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const div = detectDivergence(strokes, dif, dateIdx);
  const point = judgePoint(strokes, zs, div);
  const last = strokes[strokes.length - 1];
  const lastPrice = closes[closes.length - 1];
  const inZs = zs !== null && last.toPrice >= zs.zd && last.toPrice <= zs.zg;
  const trend = inZs ? "consolidation" : last.dir;
  const lastBottom = [...fractals].reverse().find((f) => f.type === "bottom");
  const lastTop = [...fractals].reverse().find((f) => f.type === "top");
  const support = zs ? zs.zd : lastBottom?.price ?? Math.min(...lows.slice(-20));
  const resistance = zs ? zs.zg : lastTop?.price ?? Math.max(...highs.slice(-20));
  const posText = zs ? lastPrice > zs.zg ? "\u4E2D\u67A2\u4E0A\u65B9" : lastPrice < zs.zd ? "\u4E2D\u67A2\u4E0B\u65B9" : "\u4E2D\u67A2\u5185\u90E8" : "";
  const strokePct = ((last.toPrice / last.fromPrice - 1) * 100).toFixed(1);
  const signals = [
    `\u539F\u59CB ${dates.length} \u6839\u65E5K\u7ECF\u5305\u542B\u5408\u5E76\u540E\u4E3A ${bars.length} \u6839\uFF0C\u8BC6\u522B\u5206\u578B ${fractals.length} \u4E2A\uFF0C\u6784\u6210\u7B14 ${strokes.length} \u7B14`,
    `\u6700\u8FD1\u4E00\u7B14${last.dir === "up" ? "\u5411\u4E0A" : "\u5411\u4E0B"}\uFF1A${last.fromDate} ${last.fromPrice.toFixed(2)} \u2192 ${last.toDate} ${last.toPrice.toFixed(2)}\uFF08${strokePct}%\uFF09`,
    zs ? `\u4E2D\u67A2\u533A\u95F4 ZD ${zs.zd.toFixed(2)} ~ ZG ${zs.zg.toFixed(2)}\uFF08${zs.startDate} \u8D77\u751F\u6548\uFF09\uFF0C\u73B0\u4EF7 ${lastPrice.toFixed(2)} \u4F4D\u4E8E${posText}` : `\u6700\u8FD1 ${Math.min(strokes.length, 3)} \u7B14\u672A\u5F62\u6210\u6709\u6548\u4E2D\u67A2\uFF0C\u8D70\u52BF\u5904\u4E8E\u7B14\u7EA7\u522B\u8D8B\u52BF\u4E2D`,
    div ? `${div.kind === "top" ? "\u9876" : "\u5E95"}\u80CC\u9A70\uFF1A\u6700\u8FD1\u540C\u5411\u7B14\u4EF7\u683C${div.kind === "top" ? "\u521B\u65B0\u9AD8" : "\u521B\u65B0\u4F4E"}\uFF0C\u4F46 MACD(DIF) \u9762\u79EF\u7F29\u5C0F\u81F3\u524D\u4E00\u7B14\u7684 ${(div.ratio * 100).toFixed(0)}%\uFF08< 80%\uFF09` : "\u672A\u68C0\u6D4B\u5230\u660E\u663E\u80CC\u9A70\u4FE1\u53F7",
    point ? `\u4E70\u5356\u70B9\u5224\u65AD\uFF1A${point}` : "\u6682\u65E0\u660E\u786E\u4E70\u5356\u70B9\u4FE1\u53F7"
  ];
  const parts = [
    `\u8FD1 500 \u65E5\u7F20\u8BBA\u7ED3\u6784\u5448${trend === "up" ? "\u4E0A\u5347" : trend === "down" ? "\u4E0B\u964D" : "\u4E2D\u67A2\u9707\u8361"}\u6001\u52BF`,
    zs ? `\u73B0\u4EF7\u4F4D\u4E8E${posText}` : "",
    div ? `\u51FA\u73B0${div.kind === "top" ? "\u9876" : "\u5E95"}\u80CC\u9A70` : "",
    point ?? ""
  ].filter(Boolean);
  return {
    conclusion: parts.join("\uFF0C") + "\u3002",
    signals,
    trend,
    lastStroke: {
      dir: last.dir,
      from: last.fromDate,
      to: last.toDate,
      fromPrice: r2(last.fromPrice),
      toPrice: r2(last.toPrice)
    },
    strokes: strokes.map((s) => ({
      from: s.fromDate,
      to: s.toDate,
      fromPrice: r2(s.fromPrice),
      toPrice: r2(s.toPrice),
      dir: s.dir
    })),
    zhongshu: zs ? { zg: r2(zs.zg), zd: r2(zs.zd), startDate: zs.startDate, endDate: zs.endDate } : null,
    buySellPoint: point,
    divergence: div?.kind ?? null,
    keyLevels: { support: r2(support), resistance: r2(resistance) }
  };
}
export {
  runChanAnalysis
};
