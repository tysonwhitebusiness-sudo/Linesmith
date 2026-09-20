"""M1 — the model register holds together, and the promotion test is careful.

The register is the list of what this app claims about its own models, so the
checks here are about honesty rather than mechanics: every row cites evidence,
every status is one of the four, a gate travels with anything that could move,
and the rule that reads it never hands out a probability by default.

Run with:  .venv/Scripts/python.exe src/test_model_status.py
"""
import sys

import model_status as ms

failures: list[str] = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {name}")


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


print("the register")
keys = [(r.sport, r.kind) for r in ms.REGISTRY]
ok("one row per sport and kind", len(keys) == len(set(keys)), f"duplicates: {[k for k in keys if keys.count(k) > 1]}")
ok("every kind is game or prop", all(r.kind in ms.KINDS for r in ms.REGISTRY))
ok("every status is one of the four",
   all(r.status in (ms.NONE, ms.BASELINE, ms.GATED, ms.FAILED) for r in ms.REGISTRY))
ok("every row cites evidence", all(len(r.evidence.strip()) > 20 for r in ms.REGISTRY),
   f"thin: {[(r.sport, r.kind) for r in ms.REGISTRY if len(r.evidence.strip()) <= 20]}")
ok("a live model names its engine",
   all(r.engine for r in ms.REGISTRY if r.status in (ms.BASELINE, ms.GATED)))
ok("a failed or absent model names no engine",
   all(r.engine is None for r in ms.REGISTRY if r.status in (ms.FAILED, ms.NONE)))
ok("anything that could move carries its gate",
   all(r.gate is not None for r in ms.REGISTRY if r.status in (ms.BASELINE, ms.GATED)))
ok("every gate states a minimum sample",
   all(r.gate.min_sample > 0 for r in ms.REGISTRY if r.gate))

print("the rule")
check("gated may show a probability", ms.may_show_probability("mlb", "prop"), True)
check("baseline may not", ms.may_show_probability("nhl", "prop"), False)
check("baseline may still show a pick", ms.may_show_pick("cfb", "game"), True)
check("baseline may not show a record", ms.may_show_record("nfl", "game"), False)
check("failed shows nothing", ms.may_show_pick("soccer", "game"), False)
check("none shows nothing", ms.may_show_pick("golf", "prop"), False)
check("an unknown sport is none, not a default yes", ms.may_show_probability("cricket", "prop"), False)
check("leagues fold onto their sport", ms.status_of("soccer_epl", "game"), ms.status_of("soccer", "game"))
check("tours fold onto their sport", ms.status_of("tennis_wta", "prop"), ms.status_of("tennis", "prop"))

print("what the page says")
check("gated label", ms.label("mlb", "prop"), "validated model")
check("baseline label", ms.label("mlb", "game"), "baseline model, not validated")
ok("a failed label says why", "did not pass" in ms.label("soccer", "game"))

print("MLB's game model is a baseline on purpose")
# Its own CLV backtest puts it below the close (mean -0.0571 prob-points,
# positive-CLV rate 37.9%), so it has not earned a probability beside a price.
check("not gated", ms.status_of("mlb", "game"), ms.BASELINE)
ok("and the evidence says so", "CLV" in ms.get("mlb", "game").evidence)

print("serialisation")
rows = ms.as_rows()
check("every row serialises", len(rows), len(ms.REGISTRY))
ok("dates are ISO", all(len(r["since"]) == 10 for r in rows))
ok("gate travels with the row", all(r["gate_test"] for r in rows if r["status"] in (ms.BASELINE, ms.GATED)))

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all model register checks passed")
