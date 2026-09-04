"""Phase 2.5 — the ship gate. Does the model beat the closing line?

Everything before this measured the model against itself. This measures it
against the market, which is the only comparison that decides whether it ships.

WHY NOT "CLV". The plan originally said "positive CLV against the closing
moneyline". Tennis has ZERO opening prices — all 448,914 archive rows carry a
closing price and none carry an open — so there is no entry price to compare a
close against and CLV cannot be computed. What follows is CROSS-SECTIONAL price
dispersion (best available price vs consensus at the same moment), not
time-based line movement. The two get conflated constantly and are not the same
measurement; this file says which one it is doing.

FOUR PRICE SERIES, and the choice of benchmark matters:

    market_avg   the consensus close       — the plan's stated benchmark
    pinnacle     the sharpest public book  — a HARDER bar, and the honest one
    market_max   best available price      — what a bet actually gets filled at
    bet365       one book, not used here

The plan named `market_avg`. `pinnacle` exists on 53,007 rows and is the
standard sharp reference in tennis, so both are reported. Beating market_avg
while losing to pinnacle would be a real result reported as a win by picking the
softer benchmark, so neither is quoted alone.

DE-VIGGING. Both sides of every moneyline are present, so implied probabilities
are normalised by their sum: p_home / (p_home + p_away). This is the standard
proportional method and it assumes the bookmaker's margin is split evenly
between the sides, which is known to be slightly wrong for longshots. It is the
same treatment for model and market, so it cannot flatter one over the other.

THE GATES:
  1. ACCURACY (the real one) — model log-loss < de-vigged market log-loss, on
     held-out years, with a paired significance test.
  2. CALIBRATION — predicted 60% wins about 60%, in deciles.
  3. ECONOMIC — flat-stake ROI at market_max where the model's edge over the
     consensus exceeds a threshold. INFORMATIONAL: ROI without gate 1 is a
     sample-size artifact.

Run from python-odds-service/:
    python ship_gate_tennis.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import tennis_elo as te  # noqa: E402

BURN_IN_END = date(2017, 1, 1)
HELD_OUT_FROM = date(2023, 1, 1)


def american_to_prob(odds: float) -> float:
    """American odds -> implied probability, vig included."""
    if odds is None:
        return float("nan")
    return (100.0 / (odds + 100.0)) if odds > 0 else ((-odds) / ((-odds) + 100.0))


def american_to_decimal(odds: float) -> float:
    return 1.0 + (odds / 100.0 if odds > 0 else 100.0 / (-odds))


def devig(p_home: float, p_away: float) -> float:
    """Proportional de-vig. Same treatment both sides, so it cannot favour one."""
    tot = p_home + p_away
    if not tot or math.isnan(tot):
        return float("nan")
    return p_home / tot


async def load():
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as c:
        matches = await c.fetch(
            """SELECT sport, game_date, surface, home_team_raw h, away_team_raw a,
                      (home_score > away_score) home_won
                 FROM game_result
                WHERE sport LIKE 'tennis%' AND surface IS NOT NULL
                ORDER BY game_date, id"""
        )
        odds = await c.fetch(
            """SELECT sport, game_date, home_team_raw h, away_team_raw a,
                      bookmaker, side, price
                 FROM odds_archive
                WHERE sport LIKE 'tennis%' AND market = 'moneyline'
                  AND price IS NOT NULL
                  AND bookmaker IN ('market_avg', 'market_max', 'pinnacle')"""
        )
    return matches, odds


def build_price_index(odds):
    idx: dict[tuple, dict] = {}
    for r in odds:
        k = (r["sport"], r["game_date"], r["h"], r["a"])
        idx.setdefault(k, {})[(r["bookmaker"], r["side"])] = float(r["price"])
    return idx


def log_loss_one(p: float, won: bool) -> float:
    p = min(1 - 1e-12, max(1e-12, p))
    return -(math.log(p) if won else math.log(1 - p))


def paired(a: list[float], b: list[float]) -> tuple[float, float, float]:
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


async def main() -> int:
    matches, odds = await load()
    idx = build_price_index(odds)
    ms = [{"sport": r["sport"], "played": r["game_date"], "surface": r["surface"],
           "home": r["h"], "away": r["a"], "home_won": r["home_won"]} for r in matches]
    scored, _ = te.replay(ms, te.EloParams(), score_from=BURN_IN_END)

    rows = []
    for s in scored:
        if s.played < HELD_OUT_FROM:
            continue
        pr = idx.get((s.sport, s.played, s.home, s.away))
        if not pr:
            continue
        rec = {"won": s.home_won, "model": s.predicted}
        ok = True
        for book in ("market_avg", "pinnacle"):
            h, a = pr.get((book, "home")), pr.get((book, "away"))
            if h is None or a is None:
                if book == "market_avg":
                    ok = False
                rec[book] = None
                continue
            rec[book] = devig(american_to_prob(h), american_to_prob(a))
        mh, ma = pr.get(("market_max", "home")), pr.get(("market_max", "away"))
        rec["max_home"], rec["max_away"] = mh, ma
        if ok:
            rows.append(rec)

    print(f"held-out matches with a consensus close: {len(rows):,}\n")

    # ---- GATE 1: accuracy vs the close ------------------------------------
    print("GATE 1 — ACCURACY vs the closing line (the gate that decides)")
    for book in ("market_avg", "pinnacle"):
        sub = [r for r in rows if r.get(book) is not None]
        if not sub:
            continue
        ml = [log_loss_one(r["model"], r["won"]) for r in sub]
        bl = [log_loss_one(r[book], r["won"]) for r in sub]
        m, se, t = paired(ml, bl)
        macc = sum((r["model"] > .5) == r["won"] for r in sub) / len(sub)
        bacc = sum((r[book] > .5) == r["won"] for r in sub) / len(sub)
        print(f"  vs {book:<11} n={len(sub):>6,}  model {sum(ml)/len(ml):.5f}  "
              f"{book} {sum(bl)/len(bl):.5f}")
        print(f"     {'model - market':<14} {m:+.5f}  SE {se:.5f}  t={t:+.2f}"
              f"   {'MODEL BEATS' if t < -1.96 else 'MARKET BEATS' if t > 1.96 else 'no sig. difference'}")
        print(f"     accuracy: model {macc*100:.1f}%  {book} {bacc*100:.1f}%")

    # ---- GATE 2: calibration ----------------------------------------------
    print("\nGATE 2 — CALIBRATION in deciles (model)")
    buckets: dict[int, list] = {}
    for r in rows:
        buckets.setdefault(min(9, int(r["model"] * 10)), []).append(r)
    for b in sorted(buckets):
        g = buckets[b]
        pred = sum(x["model"] for x in g) / len(g)
        act = sum(1 for x in g if x["won"]) / len(g)
        flag = "  <-- off" if abs(pred - act) > 0.05 else ""
        print(f"  {b/10:.1f}-{(b+1)/10:.1f}  n={len(g):>5,}  predicted {pred:.3f}  "
              f"actual {act:.3f}  gap {act-pred:+.3f}{flag}")

    # ---- GATE 3: economic, informational only -----------------------------
    print("\nGATE 3 — ROI at market_max (INFORMATIONAL, not a gate)")
    print("  edge     bets    ROI      per-bet SE")
    for thr in (0.00, 0.02, 0.05, 0.10):
        pnl, n = [], 0
        for r in rows:
            if r["max_home"] is None or r["max_away"] is None:
                continue
            for side, mp, price in (("h", r["model"], r["max_home"]),
                                    ("a", 1 - r["model"], r["max_away"])):
                cons = r["market_avg"] if side == "h" else 1 - r["market_avg"]
                if mp - cons <= thr:
                    continue
                win = r["won"] if side == "h" else not r["won"]
                pnl.append((american_to_decimal(price) - 1.0) if win else -1.0)
                n += 1
        if not pnl:
            print(f"  {thr:.0%}      0        -")
            continue
        mean = sum(pnl) / len(pnl)
        sd = (sum((x - mean) ** 2 for x in pnl) / max(1, len(pnl) - 1)) ** 0.5
        print(f"  {thr:>4.0%}  {len(pnl):>7,}  {mean*100:+6.2f}%   "
              f"{sd/math.sqrt(len(pnl))*100:.2f}%")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
