"""AlphaMind 因子自研实测：调用项目内的 factor-research.py。

每周用本地全A两年日K数据对因子库全部可执行因子 + 自研候选变体做真实
截面 IC 实测，结果累积写入项目 public/data/factor-research.json。
"""
import subprocess
import sys
from pathlib import Path

import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPT = PROJECT_DIR / "scripts" / "factor-research.py"


def run(ctx):
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=1500,
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return {"artifact": {"ok": False, "summary": f"因子实测失败（exit {proc.returncode}）：{log[-500:]}"}}

    import json
    import re
    data = {}
    try:
        with open(PROJECT_DIR / "public" / "data" / "factor-research.json", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        pass
    results = data.get("results", {})
    good = [r["name"] for r in results.values()
            if r.get("dic20") is not None and r["dic20"] > 0.02]
    last_line = [l for l in log.splitlines() if l.startswith("写出")]
    return {
        "artifact": {
            "ok": True,
            "summary": (
                f"因子实测完成：{len(results)} 个因子，有效窗口 {data.get('window', {}).get('evalDates', '?')} 个评估日；"
                f"方向化 IC20>0.02 的因子 {len(good)} 个：{'、'.join(good[:8])}{'…' if len(good) > 8 else ''}。"
                f"{last_line[0] if last_line else ''}"
            ),
            "factorCount": len(results),
            "goodFactors": good,
        }
    }
