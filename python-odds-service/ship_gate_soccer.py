"""Phase 3.5 — the soccer ship gate. Does Dixon-Coles beat the closing line?

Everything before this measured the model against itself. This measures it
against the market, which is the only comparison that decides whether it ships.

WHAT IS AVAILABLE, measured 2026-09-04 rather than assumed:

    EPL  pinnacle   12,030 rows, 100% opening prices, 4,010 events
         bet365      8,040 rows, 100% opens
         marketavg   8,040 rows,   0 opens
         marketmax   8,040 rows,   0 opens
    MLS  pinnacle/marketavg/marketmax — ZERO opening prices

So EPL supports a REAL, time-based CLV measurement against the sharpest public
book, and MLS does not. They are reported separately and never averaged. This is
the first genuine CLV in the project: Phase 2.5 had to restate its gate because
tennis carried no opening prices at all.

NOTE THE BOOK NAMES. Soccer uses `marketavg` / `marketmax`, no underscore;
tennis uses `market_avg` / `market_max`. Code copied from ship_gate_tennis.py
matches zero rows and reports an empty gate as a pass.

DE-VIGGING A THREE-WAY MARKET. All three prices are present, so implied
probabilities are normalised by their sum. Same treatment for model and market,
so it cannot flatter either. The proportional method is known to be slightly
wrong for longshots; it is applied identically to both sides of every
comparison.

THE GATES, in order of authority:
  1. ACCURACY — model log-loss below de-vigged pinnacle AND marketavg, paired
     and out of sample. This decides.
  2. CALIBRATION — separately for home, draw and away. The draw is where Poisson
     models fail and an aggregate hides it.
  3. CLV — EPL only, real opening-to-closing movement.
  4. ROI at marketmax — informational, swept by edge with the monotonicity
     check that was Phase 2.5's most diagnostic single number.

Run from python-odds-service/:
    python ship_gate_soccer.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import dc_walkforward as wf  # noqa: E402
from predict import soccer_teams as st  # noqa: E402

HELD_OUT_FROM = date(2024, 1, 1)
XI = 0.002                      # fitted in 3.4, on a window that excluded these
SIDES = ("home", "draw", "away")


def american_to_prob(odds) -> float:
    o = float(odds)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def american_to_decimal(odds) -> float:
    o = float(odds)
    return 1.0 + (o / 100.0 if o > 0 else 100.0 / (-o))


def devig3(p: dict) -> dict | None:
    tot = sum(p.values())
    if not tot:
        return None
    return {k: v / tot for k, v in p.items()}


async def load_odds(sport: str) -> dict:
    """{(date, canon_home, canon_away): {book: {side: (close, open)}}}"""
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as c:
        rows = await c.fetch(
            """SELECT game_date, home_team_raw h, away_team_raw a, bookmaker,
                      side, price, open_price
                 FROM odds_archive
                WHERE sport = $1 AND market = 'moneyline' AND price IS NOT NULL
                  AND bookmaker IN ('pinnacle', 'marketavg', 'marketmax')""",
            sport)
    idx: dict = {}
    for r in rows:
        # Canonicalise BOTH sides of the join — odds_archive carries the same
        # duplicate spellings game_result does (Phase 3.1). Skipping this loses
        # rows to a silent non-join rather than an error.
        k = (r["game_date"], st.canonical(sport, r["h"]), st.canonical(sport, r["a"]))
        idx.setdefault(k, {}).setdefault(r["bookmaker"], {})[r["side"]] = (
            r["price"], r["open_price"])
    return idx


def market_probs(book: dict, which: int = 0) -> dict | None:
    """which=0 closing, 1 opening. None unless all three sides are present."""
    if not book or any(s not in book for s in SIDES):
        return None
    raw = {}
    for s in SIDES:
        v = book[s][which]
        if v is None:
            return None
        raw[s] = american_to_prob(v)
    return devig3(raw)


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


async def run(sport: str) -> None:
    print(f"\n{'=' * 68}\n{sport}\n{'=' * 68}")
    matches = await st.load_soccer_matches(sport)
    odds = await load_odds(sport)
    res = wf.walk_forward(matches, score_from=HELD_OUT_FROM, xi=XI, refit_days=7)

    rows = []
    for s in res.scored:
        books = odds.get((s.played, s.home, s.away))
        if not books:
            continue
        rec = {"outcome": s.outcome,
               "model": {"home": s.p_home, "draw": s.p_draw, "away": s.p_away}}
        for b in ("pinnacle", "marketavg"):
            rec[b] = market_probs(books.get(b, {}))
            rec[b + "_open"] = market_probs(books.get(b, {}), which=1)
        mx = books.get("marketmax", {})
        rec["max"] = {s_: mx[s_][0] for s_ in SIDES} if all(s_ in mx for s_ in SIDES) else None
        rows.append(rec)

    print(f"  {len(res.scored):,} held-out matches, {len(rows):,} joined to a market")

    # ---- GATE 1 -----------------------------------------------------------
    print("\nGATE 1 — ACCURACY vs the close (this is the gate that decides)")
    for book in ("pinnacle", "marketavg"):
        sub = [r for r in rows if r[book]]
        if not sub:
            print(f"  vs {book}: no rows")
            continue
        m_ll = [ll(r["model"][r["outcome"]]) for r in sub]
        b_ll = [ll(r[book][r["outcome"]]) for r in sub]
        mean, se, t = paired(m_ll, b_ll)
        verdict = ("MODEL BEATS" if t < -1.96 else
                   "MARKET BEATS" if t > 1.96 else "no significant difference")
        print(f"  vs {book:<10} n={len(sub):>5,}  model {sum(m_ll)/len(sub):.5f}  "
              f"{book} {sum(b_ll)/len(sub):.5f}")
        print(f"     model - market {mean:+.5f}  SE {se:.5f}  t={t:+.2f}   {verdict}")

    # ---- GATE 2 -----------------------------------------------------------
    print("\nGATE 2 — CALIBRATION per outcome (the draw is where Poisson fails)")
    for side in SIDES:
        buckets: dict[int, list] = {}
        for r in rows:
            buckets.setdefault(min(9, int(r["model"][side] * 10)), []).append(r)
        worst = 0.0
        parts = []
        for b in sorted(buckets):
            g = buckets[b]
            if len(g) < 25:
                continue
            pred = sum(x["model"][side] for x in g) / len(g)
            act = sum(1 for x in g if x["outcome"] == side) / len(g)
            worst = max(worst, abs(pred - act))
            parts.append(f"{b/10:.1f}:{pred:.2f}/{act:.2f}")
        flag = "  <-- OUT OF TOLERANCE" if worst > 0.05 else ""
        print(f"  {side:<5} worst gap {worst:+.3f}{flag}")
        print(f"        predicted/actual by bucket: {'  '.join(parts)}")

    # ---- GATE 3 -----------------------------------------------------------
    print("\nGATE 3 — CLV (real opening->closing movement)")
    clv_rows = [r for r in rows if r["pinnacle"] and r["pinnacle_open"]]
    if not clv_rows:
        print("  no opening prices for this league — beat-the-close only, and NOT")
        print("  to be averaged with a league that has them.")
    else:
        # The model's pick, priced at the OPEN, judged by where it CLOSED.
        moves = []
        for r in clv_rows:
            pick = max(SIDES, key=lambda s_: r["model"][s_])
            moves.append(r["pinnacle"][pick] - r["pinnacle_open"][pick])
        mean = sum(moves) / len(moves)
        sd = (sum((x - mean) ** 2 for x in moves) / max(1, len(moves) - 1)) ** 0.5
        se = sd / math.sqrt(len(moves))
        print(f"  n={len(clv_rows):,}  mean CLV {mean:+.5f} (de-vigged prob)  "
              f"SE {se:.5f}  t={mean/se:+.2f}")
        print("  positive => the line moved TOWARD the model's pick after it was made")

    # ---- GATE 4 -----------------------------------------------------------
    print("\nGATE 4 — ROI at marketmax (informational; watch MONOTONICITY)")
    print("  edge      bets      ROI    per-bet SE")
    for thr in (0.00, 0.02, 0.05, 0.10):
        pnl = []
        for r in rows:
            if not r["max"] or not r["marketavg"]:
                continue
            for side in SIDES:
                if r["model"][side] - r["marketavg"][side] <= thr:
                    continue
                won = r["outcome"] == side
                pnl.append(american_to_decimal(r["max"][side]) - 1.0 if won else -1.0)
        if not pnl:
            print(f"  {thr:>4.0%}       0         -")
            continue
        mean = sum(pnl) / len(pnl)
        sd = (sum((x - mean) ** 2 for x in pnl) / max(1, len(pnl) - 1)) ** 0.5
        print(f"  {thr:>4.0%}  {len(pnl):>7,}  {mean*100:+7.2f}%   "
              f"{sd/math.sqrt(len(pnl))*100:.2f}%")


async def main() -> int:
    for sport in ("soccer_epl", "soccer_mls"):
        await run(sport)
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
