"""P6.0 (D25) — hermetic: cost_guard.compute. Run: python -u src/test_cost_guard.py

The projection counts only what is measured and names the rest; observed
figures expire after 7 days; the brake fires on the dollar line and on Supabase
egress past 90% of its allowance.
"""
import os
import sys
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("DATABASE_URL", "postgresql://x:y@localhost:5432/z")

import cost_guard as cg                                        # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def main():
    p = cg.load_prices()
    now = datetime(2026, 9, 15, 12, tzinfo=timezone.utc)      # halfway through a 30-day month
    d = date(2026, 9, 15)

    r = cg.compute(p, now, {}, None)
    check("nothing observed: fixed parts only", r["projected_usd"] == round(25 + 19 * 0.125 + 7 + 1, 2), r)
    check("the unknowns are named, not guessed",
          set(r["unmeasured"]) == {"supabase.compute", "supabase.storage", "supabase.egress",
                                   "render.cron_run_time", "render.bandwidth"}, r["unmeasured"])

    meters = {
        "observed.supabase_compute_usd": [(d, 10.0)],
        "observed.supabase_egress_gb_mtd": [(d, 60.0)],
        "observed.render_bandwidth_gb_mtd": [(d, 10.0)],
        "observed.render_bandwidth_included_gb": [(d, 5.0)],
        "cron.run_seconds": [(d, 29_000 * 60.0)],             # 29,000 min so far
    }
    r = cg.compute(p, now, meters, 0.5)
    check("everything measured -> nothing unmeasured", r["unmeasured"] == [], r["unmeasured"])
    check("Micro compute is covered by the credit", r["parts"]["supabase.compute"] == 0.0, r["parts"])
    check("egress 60 GB at mid-month projects ~116 GB, under the allowance",
          r["parts"]["supabase.egress"] == 0.0 and 115 < r["egress_projected_gb"] < 125, r)
    check("cron minutes projected and priced", 9.0 < r["parts"]["render.line-buddy-odds-worker-health-check"] < 10.0, r["parts"])
    check("bandwidth over the included tier is charged",
          r["parts"]["render.bandwidth"] > 0, r["parts"])

    stale = {"observed.supabase_egress_gb_mtd": [(date(2026, 9, 3), 60.0)]}
    r = cg.compute(p, now, stale, 0.5)
    check("an observed figure older than 7 days is unmeasured again", "supabase.egress" in r["unmeasured"], r["unmeasured"])

    hot = {"observed.supabase_egress_gb_mtd": [(d, 120.0)]}
    r = cg.compute(p, now, hot, 0.5)
    check("egress projected past 90% of 250 GB -> brake", r["brake"] and "egress" in (r["reason"] or ""), r)

    dear = {"observed.supabase_compute_usd": [(d, 60.0)]}
    r = cg.compute(p, now, dear, 0.5)
    check("projection over $48 -> brake", r["brake"] and r["projected_usd"] > 48, r)

    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
