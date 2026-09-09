"""Phase 4.4b — Anytime Touchdown Scorer, at the 0.5 line.

    python fit_nfl_anytime_td.py

**Operator decision, 2026-09-08: model it.** Anytime touchdown is the NFL
equivalent of MLB home runs — the marquee rare-event market — and Phase 3.2
showed that market was never unmodellable, only unread.

TWO THINGS HAD TO BE DECIDED BY MEASUREMENT, and neither is "which line":

1. **The opportunity denominator.** Every market in `fit_nfl_props.py` is a rate
   times a volume: receptions per TARGET, carries per GAME. A touchdown has no
   obvious denominator. Two candidates are fitted below and the better one wins:

       per game    volume = 1, rate = touchdowns per game
       per touch   volume = targets + carries, rate = touchdowns per touch

   Per touch is the more principled story — a player with 20 touches has more
   chances to score than one with 3 — but 4.3 already produced a case where the
   principled choice measured WORSE (carries), so it is measured, not assumed.

2. **The distribution.** Grid over the engine's shapes, same as every other
   market.

WHY THIS MARKET NEEDED ITS OWN FILE. A touchdown SPANS TWO STAT GROUPS.
`receiving.receivingTouchdowns` appears on 58,152 player-games and
`rushing.rushingTouchdowns` on 29,878, but only **17,485 carry both** — so a
player's touchdown total is the sum of two keys that are usually not both
present, and a market in `fit_nfl_props.py` reads exactly one key with exactly
one volume. Summing across groups is the whole difference.

ONLY THE 0.5 LINE IS MODELLED. `Anytime Touchdown Scorer` is four markets under
one name — 0.5 (4,670 rows), 1.5 (4,277), 2.5 (2,764), 3.5 (51), meaning 1+, 2+,
3+ and 4+ touchdowns. Measured base rates:

    P(>=1 TD) = 0.2103      the 0.5 line, modelled here
    P(>=2 TD) = 0.0333      the 1.5 line
    P(>=3 TD) = 0.0039      the 2.5 line, a 1-in-258 event

The alt-lines are left alone deliberately. A 0.4% event with 61 two-sided rows
is where a wrong tail does the most damage, which is the Phase 4.4 lesson, and
nothing here has earned the right to quote it.

**Projection and probability are both computed, but 4.5 owns the ship gate** —
NFL has no held-out prop season until 2026 produces one.
"""
import asyncio
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from predict import count_prop_engine as eng  # noqa: E402

PROJ_CUTOFF = 2024
MIN_PRIOR_GAMES = 4
LINE = 0.5

TD_KEYS = ("receiving.receivingTouchdowns", "rushing.rushingTouchdowns")
TOUCH_KEYS = ("receiving.receivingTargets", "rushing.rushingAttempts")

VOLUME_WINDOWS = (0, 3, 5, 8, 12, 17)
SHRINK_KS = (0.0, 2.0, 5.0, 10.0, 20.0, 40.0)


def season_of(d) -> int:
    s = str(d)
    y, mo = int(s[:4]), int(s[5:7])
    return y - 1 if mo <= 2 else y


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


async def load(conn):
    rows = await conn.fetch("""
        SELECT game_date, athlete_id,
               COALESCE((stats->>'receiving.receivingTouchdowns')::numeric, 0)
             + COALESCE((stats->>'rushing.rushingTouchdowns')::numeric, 0)   AS td,
               COALESCE((stats->>'receiving.receivingTargets')::numeric, 0)
             + COALESCE((stats->>'rushing.rushingAttempts')::numeric, 0)     AS touches
          FROM player_game_history
         WHERE sport = 'nfl'
           AND (stats ? 'receiving.receivingTouchdowns'
                OR stats ? 'rushing.rushingTouchdowns')
         ORDER BY game_date""")
    # A player with no touches had no chance to score and carries no information
    # about a scoring rate; including him would drag every rate toward zero.
    return [(r["game_date"], str(r["athlete_id"]), float(r["td"]), float(r["touches"]))
            for r in rows if float(r["touches"]) > 0]


def snapshot(hist, lv, per_touch: bool):
    acc: dict[str, eng.PlayerHistory] = {}
    out = []
    for gd, aid, td, touches in hist:
        vol = touches if per_touch else 1.0
        h = acc.get(aid)
        if h is not None and h.games >= MIN_PRIOR_GAMES:
            out.append((gd, aid, td, touches,
                        h.events, h.volume, h.games,
                        tuple(h.mean_volume(lv, w) for w in VOLUME_WINDOWS)))
        acc.setdefault(aid, eng.PlayerHistory()).add(td, vol)
    return out


def run(snap, wi, k, shape, lr, lv):
    out = []
    for gd, aid, td, touches, ev, volsum, games, vols in snap:
        v = vols[wi]
        expected = v * eng.shrunk_rate(ev, volsum, lr, k, lv)
        p = eng.shape_prob_over(shape[0], shape[1], LINE, expected, max(v, 1e-9))
        out.append((season_of(gd), td, expected, p))
    return out


def score(rows, lo=None, hi=None):
    v = [r for r in rows if (lo is None or r[0] >= lo) and (hi is None or r[0] < hi)]
    if not v:
        return None
    n = len(v)
    return {"n": n,
            "ll": sum(ll(r[3] if r[1] > LINE else 1 - r[3]) for r in v) / n,
            "base": sum(1 for r in v if r[1] > LINE) / n,
            "meanp": sum(r[3] for r in v) / n,
            "rows": v}


def quintiles(rows):
    r = sorted(rows, key=lambda t: t[2])
    step = len(r) // 5
    out = []
    for i in range(5):
        chunk = r[i * step:(i + 1) * step if i < 4 else len(r)]
        out.append((i + 1, len(chunk), sum(1 for x in chunk if x[1] > LINE) / len(chunk)))
    return out


async def main() -> int:
    import db
    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as c:
        hist = await load(c)
    print(f"{len(hist):,} player-games with a touch and a touchdown key")
    base = sum(1 for h in hist if h[2] > LINE) / len(hist)
    print(f"P(scores >= 1 TD) = {base:.4f}\n")

    results = {}
    for per_touch in (False, True):
        label = "per touch" if per_touch else "per game "
        ev = sum(h[2] for h in hist)
        vol = sum((h[3] if per_touch else 1.0) for h in hist)
        lr, lv = ev / vol, vol / len(hist)
        snap = snapshot(hist, lv, per_touch)
        best = None
        for wi, w in enumerate(VOLUME_WINDOWS):
            for k in SHRINK_KS:
                for sh in eng.SHAPES:
                    rows = run(snap, wi, k, sh, lr, lv)
                    s = score(rows, hi=PROJ_CUTOFF)
                    if s and (best is None or s["ll"] < best[0]):
                        best = (s["ll"], wi, w, k, sh)
        _, bwi, bw, bk, bsh = best
        rows = run(snap, bwi, bk, bsh, lr, lv)
        held = score(rows, lo=PROJ_CUTOFF)
        results[per_touch] = (best[0], held, bw, bk, bsh, lr, lv)
        print(f"  {label}  SELECT ll={best[0]:.5f}  "
              f"window={bw or 'all'} shrink_k={bk} shape={eng.shape_label(*bsh)}"
              f"  league rate {lr:.5f}")

    per_touch = results[True][0] < results[False][0]
    _, held, bw, bk, bsh, lr, lv = results[per_touch]
    print(f"\n  -> chosen ON SELECT: {'PER TOUCH' if per_touch else 'PER GAME'}\n")

    print(f"HELD OUT (>={PROJ_CUTOFF}): n={held['n']:,}  log-loss {held['ll']:.5f}")
    print(f"  actual base rate {held['base']:.4f}   mean predicted {held['meanp']:.4f}"
          f"   bias {100*(held['meanp']/held['base']-1):+.1f}%")

    const = sum(ll(held["base"] if r[1] > LINE else 1 - held["base"])
                for r in held["rows"]) / held["n"]
    print(f"  constant-rate baseline {const:.5f}"
          f"   model gains {const - held['ll']:+.5f}"
          f"  ({'BETTER' if held['ll'] < const else 'NO BETTER'})")

    q = quintiles(held["rows"])
    mono = all(q[i][2] <= q[i + 1][2] + 1e-9 for i in range(4))
    print("  ORDERING by projection quintile: "
          + ", ".join(f"Q{b}->{m:.3f} (n={n})" for b, n, m in q))
    print(f"  monotone: {mono}")

    cal = eng.calibration([(r[3], r[1] > LINE) for r in held["rows"]])
    print(f"  ECE {cal['ece']:.4f} (<=0.025)   worst bucket {cal['worst']:.3f} (<=0.05)")
    ok = mono and cal["ece"] <= 0.025 and cal["worst"] <= 0.05 and held["ll"] < const
    print(f"\n  WOULD CLEAR A HOME-RUNS-STYLE GATE: {ok}")
    print("  (4.5 still owns the ship gate — NFL has no held-out PROP season")
    print("   until 2026 produces one. This is the model, measured on history.)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
