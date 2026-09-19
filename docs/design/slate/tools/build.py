"""Inline src/ + data/ into docs/design/slate/slate.html (one self-contained page).

    python docs/design/slate/tools/build.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDER = ["mlb", "nfl", "cfb", "epl", "mls", "nhl", "nba", "atp", "wta", "golf"]

data = {}
for k in ORDER:
    p = ROOT / "data" / f"slate-{k}.json"
    if p.exists():
        data[k] = json.loads(p.read_text(encoding="utf-8"))

css = (ROOT / "src" / "slate.css").read_text(encoding="utf-8")
js = (ROOT / "src" / "slate.js").read_text(encoding="utf-8")
blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")

import base64
mark = "data:image/png;base64," + base64.b64encode((ROOT.parents[2] / "public" / "brand" / "linesmith-mark.png").read_bytes()).decode()

html = f"""<meta charset="utf-8">
<title>Slate Sheet</title>
<meta name="description" content="Slate Sheet mockup: every sport's Games, Movers, Props, Spotlights, Specials and Model sections on real data.">
<style>
{css}
</style>
<div id="app"></div>
<script>window.__SLATE__ = {blob}; window.__MARK__ = "{mark}";</script>
<script>
{js}
</script>
"""
out = ROOT / "slate.html"
out.write_text(html, encoding="utf-8")
print(f"{out} {out.stat().st_size // 1024} KB, sports: {', '.join(data)}")
