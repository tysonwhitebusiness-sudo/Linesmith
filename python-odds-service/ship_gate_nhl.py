"""Phase 4.4 — the NHL game ship gate. Does Dixon-Coles beat the closing line?

EXPECTED TO FAIL, and run anyway because the engine already exists and the
marginal cost is minutes. Two phases of evidence say ratings-only models lose to
liquid closing lines: tennis at t=+20.68, EPL soccer at t=+3.05. **This gate
must not block 4.5**, which is the real objective of Phase 4.

THE ODDS LANDSCAPE IS DIFFERENT HERE, and it changes what the gate can do.

  There is NO `pinnacle` and no `marketavg`/`marketmax` for NHL. Soccer's
  benchmark books simply do not exist in this sport's data, so a consensus has
  to be BUILT from the individual books present rather than read off a row.

  `sbrconsensus` is the one ready-made consensus — 35,750 rows, 100% opening
  prices — and it stops in 2022-11, before the held-out window begins. Useless
  here, valuable later if the window ever moves.

  Held-out coverage rests on `espnbet` (2,603 events) and `draftkings` (1,786),
  both with ~100% opening prices, so **real time-based CLV is measurable** as it
  was for EPL.

LIVE-ODDS BOOKS ARE EXCLUDED, AND THIS IS THE TRAP OF THIS STEP.
`espnbetliveodds` carries 1,756 held-out events — more than draftkings — and
they are IN-GAME prices. A live price already knows the score, so including it
would not be a weak benchmark, it would be leakage that makes the market look
superhuman and the model hopeless. Any bookmaker whose name contains "live" is
dropped, and the count of dropped rows is reported rather than silently applied.

TWO-WAY, NOT THREE. An NHL final score never ties, so the model's P(draw) is a
prediction that the game reaches overtime and is split 50/50 — see fit_nhl_dc.py
for why that split is an unmeasured neutral rather than a measured value.

Run from python-odds-service/:
    python ship_gate_nhl.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import dc_walkforward as wf  # noqa: E402
from predict import nhl_teams as nt  # noqa: E402

HELD_OUT_FROM = date(2024, 1, 1)
XI = 0.004                      # fitted in 4.3 on a window excluding these games
P_OT_HOME = 0.5
BENCH = "espnbet"               # best held-out coverage; no pinnacle exists here


def american_to_prob(o) -> float:
    o = float(o)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def american_to_decimal(o) -> float:
    o = float(o)
    return 1.0 + (o / 100.0 if o > 0 else 100.0 / (-o))


def devig2(ph: float, pa: float) -> float:
    t = ph + pa
    return ph / t if t else float("nan")


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


async def load_odds():
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as c:
        rows = await c.fetch(
            """SELECT game_date, home_team_raw h, away_team_raw a, bookmaker,
                      side, price, open_price
                 FROM odds_archive
                WHERE sport = 'nhl' AND market = 'moneyline' AND price IS NOT NULL
                  AND game_date >= $1""", HELD_OUT_FROM)
    idx, dropped = {}, 0
    for r in rows:
        if "live" in (r["bookmaker"] or "").lower():
            dropped += 1               # in-game price: knows the score
            continue
        k = (r["game_date"], nt.canonical(r["h"]), nt.canonical(r["a"]))
        idx.setdefault(k, {}).setdefault(r["bookmaker"], {})[r["side"]] = (
            r["price"], r["open_price"])
    return idx, dropped


def book_prob(book: dict, which: int = 0) -> float | None:
    if not book or "home" not in book or "away" not in book:
        return None
    ph, pa = book["home"][which], book["away"][which]
    if ph is None or pa is None:
        return None
    return devig2(american_to_prob(ph), american_to_prob(pa))


async def main() -> int:
    games = await nt.load_nhl_games()
    odds, dropped = await load_odds()
    res = wf.walk_forward(games, score_from=HELD_OUT_FROM, xi=XI, refit_days=7)
    print(f"NHL game gate — {len(res.scored):,} held-out games")
    print(f"  dropped {dropped:,} in-game (live) odds rows before anything else")

    rows = []
    for s in res.scored:
        books = odds.get((s.played, s.home, s.away))
        if not books:
            continue
        ph = s.p_home + P_OT_HOME * s.p_draw
        pa = s.p_away + (1 - P_OT_HOME) * s.p_draw
        model = ph / (ph + pa)
        closes = [book_prob(b) for b in books.values()]
        closes = [c for c in closes if c is not None]
        if not closes:
            continue
        rows.append({
            "won": s.home_goals > s.away_goals,
            "model": model,
            "consensus": sum(closes) / len(closes),
            "n_books": len(closes),
            "bench": book_prob(books.get(BENCH, {})),
            "bench_open": book_prob(books.get(BENCH, {}), which=1),
            "best_home": max((b["home"][0] for b in books.values() if "home" in b),
                             default=None),
            "best_away": max((b["away"][0] for b in books.values() if "away" in b),
                             default=None),
        })
    print(f"  {len(rows):,} joined to a market, "
          f"median {sorted(r['n_books'] for r in rows)[len(rows)//2]} books per game")

    print("\nGATE 1 — ACCURACY vs the close (this decides)")
    for name, key in (("consensus", "consensus"), (BENCH, "bench")):
        sub = [r for r in rows if r[key] is not None]
        if not sub:
            print(f"  vs {name}: no rows")
            continue
        m_ll = [ll(r["model"] if r["won"] else 1 - r["model"]) for r in sub]
        b_ll = [ll(r[key] if r["won"] else 1 - r[key]) for r in sub]
        mean, se, t = paired(m_ll, b_ll)
        verdict = ("MODEL BEATS" if t < -1.96 else
                   "MARKET BEATS" if t > 1.96 else "no significant difference")
        macc = sum((r["model"] > .5) == r["won"] for r in sub) / len(sub)
        bacc = sum((r[key] > .5) == r["won"] for r in sub) / len(sub)
        print(f"  vs {name:<12} n={len(sub):>5,}  model {sum(m_ll)/len(sub):.5f}  "
              f"{name} {sum(b_ll)/len(sub):.5f}")
        print(f"     model - market {mean:+.5f}  SE {se:.5f}  t={t:+.2f}   {verdict}")
        print(f"     accuracy: model {macc*100:.1f}%  {name} {bacc*100:.1f}%")

    print("\nGATE 2 — CALIBRATION (deciles)")
    buckets: dict[int, list] = {}
    for r in rows:
        buckets.setdefault(min(9, int(r["model"] * 10)), []).append(r)
    worst = 0.0
    for b in sorted(buckets):
        g = buckets[b]
        if len(g) < 25:
            continue
        pred = sum(x["model"] for x in g) / len(g)
        act = sum(1 for x in g if x["won"]) / len(g)
        worst = max(worst, abs(pred - act))
        print(f"  {b/10:.1f}-{(b+1)/10:.1f}  n={len(g):>5,}  predicted {pred:.3f}  "
              f"actual {act:.3f}  gap {act-pred:+.3f}")
    print(f"  worst gap {worst:+.3f}" + ("  <-- OUT OF TOLERANCE" if worst > 0.05 else ""))

    print("\nGATE 3 — CLV (real opening -> closing movement)")
    clv = [r for r in rows if r["bench"] is not None and r["bench_open"] is not None]
    if clv:
        moves = [(r["bench"] - r["bench_open"]) if r["model"] > 0.5
                 else ((1 - r["bench"]) - (1 - r["bench_open"])) for r in clv]
        mean = sum(moves) / len(moves)
        sd = (sum((x - mean) ** 2 for x in moves) / max(1, len(moves) - 1)) ** 0.5
        se = sd / math.sqrt(len(moves))
        print(f"  n={len(clv):,}  mean CLV {mean:+.5f}  SE {se:.5f}  t={mean/se:+.2f}")
        print("  positive => the line moved TOWARD the model's pick after it was made")
    else:
        print("  no opening prices available")

    print("\nGATE 4 — ROI at best available price (informational; watch MONOTONICITY)")
    print("  edge      bets      ROI    per-bet SE")
    for thr in (0.00, 0.02, 0.05, 0.10):
        pnl = []
        for r in rows:
            for side, mp, price in (("h", r["model"], r["best_home"]),
                                    ("a", 1 - r["model"], r["best_away"])):
                if price is None:
                    continue
                cons = r["consensus"] if side == "h" else 1 - r["consensus"]
                if mp - cons <= thr:
                    continue
                won = r["won"] if side == "h" else not r["won"]
                pnl.append(american_to_decimal(price) - 1.0 if won else -1.0)
        if not pnl:
            print(f"  {thr:>4.0%}       0         -")
            continue
        mean = sum(pnl) / len(pnl)
        sd = (sum((x - mean) ** 2 for x in pnl) / max(1, len(pnl) - 1)) ** 0.5
        print(f"  {thr:>4.0%}  {len(pnl):>7,}  {mean*100:+7.2f}%   "
              f"{sd/math.sqrt(len(pnl))*100:.2f}%")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
