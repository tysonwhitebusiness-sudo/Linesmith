"""Record a usage figure read off a provider's own usage page (D25).

    python record_observed_cost.py supabase_egress_gb_mtd 12.4 --as-of 2026-09-25
    python record_observed_cost.py supabase_compute_usd 10 --as-of 2026-09-25     # Micro
    python record_observed_cost.py render_bandwidth_gb_mtd 21.0 --as-of 2026-09-25
    python record_observed_cost.py render_bandwidth_included_gb 5 --as-of 2026-09-25   # Hobby

For the figures our own meters cannot see (results/P6-cost-audit.md): billed
Supabase egress, the Supabase compute size, and Render's billed bandwidth and
plan. Each becomes `usage_meters` row `observed.<name>` for its day;
`costGuardJob` uses it for 7 days and then treats it as unmeasured again, so a
stale figure can never stand in for a current one.
"""
import argparse
import asyncio
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import cost_guard                                              # noqa: E402

NAMES = ("supabase_egress_gb_mtd", "supabase_compute_usd", "render_bandwidth_gb_mtd",
         "render_bandwidth_included_gb")


async def main(a) -> int:
    await cost_guard.add_meter(f"observed.{a.name}", a.value, date.fromisoformat(a.as_of), replace=True)
    r = await cost_guard.run_cost_guard()
    print(f"recorded observed.{a.name} = {a.value} for {a.as_of}")
    print(f"projection now ${r['projected_usd']:.2f}; unmeasured: {r['unmeasured'] or 'none'}; brake: {r['brake']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name", choices=NAMES)
    ap.add_argument("value", type=float)
    ap.add_argument("--as-of", required=True, help="the date the figure was read (YYYY-MM-DD)")
    raise SystemExit(asyncio.run(main(ap.parse_args())))
