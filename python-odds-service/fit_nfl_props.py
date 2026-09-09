"""Phase 4.3 — the NFL receiving and rushing prop model.

    python fit_nfl_props.py [--persist] [market ...]

TWO DATA SOURCES WITH VERY DIFFERENT DEPTH, and using each for what it can
actually support is the whole design:

    player_game_history   58,116 target-games and 29,867 carry-games,
                          2012-09-06 .. 2026-01-05, ~4,000-4,600 per season
    prop_odds_archive     ONE season of lines (2025-09-05 .. 2026-01-18),
                          dense only Sept-Nov

So the PROJECTION is selected on a real multi-season walk-forward that needs no
lines at all, while anything LINE-dependent is limited to 2025. Phase 4.5 owns
the probability gate, which cannot run until the 2026 season produces held-out
rows — see the plan. **This file publishes projections only.**

WHY EACH MARKET IS SHAPED THE WAY IT IS. `count_prop_engine` models a count as
`volume x shrunk_rate`, and the two receiving/rushing markets differ in what
"volume" means:

    receptions       events = receptions,      volume = targets
    receiving yards  events = receiving yards, volume = targets
    carries          events = carries,         volume = team-ish opportunity
    rushing yards    events = rushing yards,   volume = carries

Receptions is a direct analogue of MLB hits-per-plate-appearance and the engine
fits it without argument (league catch rate 0.6574 per target). Yardage is the
awkward one: yards ARE non-negative integers, so a negative-binomial is not
absurd, but their variance is driven by occasional long gains rather than by
many small trials. Whether the engine's dispersion parameter can absorb that is
a question for the grid, not for a comment — it is measured below and reported
whatever it says.

**CALIBRATED AT EACH ROW'S OWN MARKET LINE, NOT AT A FIXED BOARD LINE.** This is
the opposite of what `fit_mlb_props.py` does, deliberately, and Phase 4.0c is
why: MLB serves every batter at one line because 84-93% of really posted hits
lines ARE 0.5, while NFL's line concentration runs 7.1-14.9% — every yardage
market below the 16% at which MLB's `pitcher-outs` inverted. A WR1's receiving
line is 70.5 and a WR3's is 15.5; no single number describes both, so NFL serves
each player at his own posted line.

The rule Phase 3.0 established is therefore more general than "calibrate at the
board line": **CALIBRATE WHERE YOU SERVE.** MLB serves fixed and calibrates
fixed; NFL serves per-player and calibrates per-line. Getting it backwards in
either direction is the same invisible bug.
"""
import asyncio
import math
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from predict import count_prop_engine as eng  # noqa: E402

# The projection walk-forward: seasons before CUTOFF choose the grid point,
# seasons from CUTOFF test it. Both sides are years of real games, unlike the
# prop archive.
PROJ_CUTOFF = 2024
MIN_PRIOR_GAMES = 4          # NFL plays 17 games; MLB's 5 would be a third of a season


@dataclass(frozen=True)
class NflMarket:
    slug: str
    stat_key: str
    volume_key: str
    # The archive's names for this market. Milestone schemes are deliberately
    # absent — Phase 4.0a excluded all twenty (415 rows, largest 59, none
    # two-sided), and folding them in would import the L vs L-0.5 off-by-one.
    names: tuple[str, ...]
    # When true the opportunity is simply "played a game", so volume is 1.0 and
    # the fitted rate is per game rather than per attempt.
    volume_is_game: bool = False


MARKETS = (
    NflMarket("receptions", "receiving.receptions", "receiving.receivingTargets",
              ("Total Receptions (incl. overtime)", "receptions")),
    NflMarket("receiving-yards", "receiving.receivingYards", "receiving.receivingTargets",
              ("Total Receiving Yards (incl. overtime)",)),
    # CARRIES IS ITS OWN VOLUME, AND THE RATE OF 1.000 IS NOT A BUG.
    #
    # There is no sub-opportunity to divide a carry by, so this market has no
    # "rate" in the sense receptions does. Read literally it looks degenerate —
    # carries per carry — and the obvious correction is to make the opportunity
    # "played a game", giving a rate of carries per game.
    #
    # That was tried and it is MEASURABLY WORSE: held-out MAE 3.0915 against
    # 2.8383. The reason is that the engine's `volume_window` applies to VOLUME,
    # not to the rate — so setting volume to a constant 1.0 makes the window
    # inert and forces a career average, and the fit duly picked
    # `volume_window=all`. With carries as its own volume the window does real
    # work and the model becomes "project this back's recent carry load", which
    # is both the better predictor and the honest description of the market.
    #
    # Recency matters here in a way it does not for a catch rate: a running
    # back's workload changes with depth chart and game script, while his hands
    # do not.
    NflMarket("carries", "rushing.rushingAttempts", "rushing.rushingAttempts",
              ("Total Carries (incl. overtime)",)),
    NflMarket("rushing-yards", "rushing.rushingYards", "rushing.rushingAttempts",
              ("Total Rushing Yards (incl. overtime)",)),
)
BY_SLUG = {m.slug: m for m in MARKETS}

VOLUME_WINDOWS = (0, 3, 5, 8, 12, 17)      # 0 = all history
SHRINK_KS = (0.0, 2.0, 5.0, 10.0, 20.0, 40.0)
SHAPES = eng.SHAPES


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    if n < 2:
        return m, float("nan")
    var = sum((x - m) ** 2 for x in d) / (n - 1)
    se = math.sqrt(var / n)
    return m, (m / se if se > 0 else float("nan"))


def season_of(d) -> int:
    s = str(d)
    y, mo = int(s[:4]), int(s[5:7])
    return y - 1 if mo <= 2 else y


async def load_nfl_crosswalk(conn) -> dict[str, str]:
    """External prop athlete id -> the id `player_game_history` uses, FOR NFL.

    `fit_mlb_props.load_crosswalk` hardcodes `sport = 'mlb'`. Reusing it here
    resolved NFL prop ids against MLB players and joined **zero** prop rows —
    silently, because a crosswalk miss is a `continue`, not an error. It was
    visible only because the joined-row count is printed, which is the argument
    for printing counts that ought to be non-zero.

    Phase 4.0b measured the real NFL rate: 97.5% of prop rows reach a
    player-game, with zero off-by-one dates.
    """
    out: dict[str, str] = {}
    for r in await conn.fetch(
            "SELECT espn_athlete_id, athlete_id FROM athlete_crosswalk WHERE sport = 'nfl'"):
        a = str(r["athlete_id"])
        out[a] = a
        if r["espn_athlete_id"]:
            out[str(r["espn_athlete_id"])] = a
    return out


async def load_history(conn, m: NflMarket):
    """(game_date, athlete_id, stat, volume) for one market, volume > 0.

    Rows with no opportunity are dropped here rather than by each caller: a
    receiver with zero targets carries no information about his catch rate, and
    including him would drag every rate toward zero.
    """
    rows = await conn.fetch(f"""
        SELECT game_date, athlete_id,
               (stats->>'{m.stat_key}')::float   AS stat,
               (stats->>'{m.volume_key}')::float AS volume
          FROM player_game_history
         WHERE sport='nfl' AND stats ? '{m.stat_key}' AND stats ? '{m.volume_key}'
           AND (stats->>'{m.volume_key}')::float > 0
         ORDER BY game_date""")
    return [(r["game_date"], str(r["athlete_id"]), float(r["stat"]),
             1.0 if m.volume_is_game else float(r["volume"]))
            for r in rows]


async def load_props(conn, m: NflMarket, xw, outcome):
    rows = await conn.fetch("""
        SELECT game_date, athlete_id, line, over_price, under_price
          FROM prop_odds_archive
         WHERE sport='nfl' AND type_name = ANY($1::text[])
           AND line IS NOT NULL AND athlete_id IS NOT NULL""", list(m.names))
    out = []
    for r in rows:
        aid = xw.get(str(r["athlete_id"]))
        if aid is None:
            continue
        actual = outcome.get((aid, r["game_date"]))
        if actual is None:
            continue
        out.append((r["game_date"], aid, float(r["line"]),
                    r["over_price"], r["under_price"], actual))
    out.sort(key=lambda t: (t[0], t[1]))
    return out


def league_rates(hist):
    ev = sum(h[2] for h in hist)
    vol = sum(h[3] for h in hist)
    games = len(hist)
    return (ev / vol if vol else 0.0), (vol / games if games else 0.0)


def snapshot(hist, lv):
    """Walk history once, recording what any grid point needs per row.

    Strictly-before is enforced here, in the one place it can be: a game enters
    a player's history only after it has been predicted.
    """
    acc: dict[str, eng.PlayerHistory] = {}
    out = []
    for gd, aid, stat, vol in hist:
        h = acc.get(aid)
        if h is not None and h.games >= MIN_PRIOR_GAMES:
            out.append((gd, aid, stat, vol, h.events, h.volume, h.games,
                        tuple(h.mean_volume(lv, w) for w in VOLUME_WINDOWS)))
        acc.setdefault(aid, eng.PlayerHistory()).add(stat, vol)
    return out


def project_all(snap, wi, k, shape, lr, lv):
    out = []
    for gd, aid, stat, vol, ev, volsum, games, vols in snap:
        v = vols[wi]
        expected = v * eng.shrunk_rate(ev, volsum, lr, k, lv)
        out.append((gd, aid, stat, expected, v))
    return out


def proj_score(rows, lo=None, hi=None):
    """Projection quality WITHOUT lines: mean absolute error and bias.

    This is what the deep 2012-2025 history can judge. Anything involving a
    line is limited to the single archived season and belongs to 4.5.
    """
    v = [r for r in rows
         if (lo is None or season_of(r[0]) >= lo) and (hi is None or season_of(r[0]) < hi)]
    if not v:
        return None
    n = len(v)
    mae = sum(abs(r[2] - r[3]) for r in v) / n
    act = sum(r[2] for r in v) / n
    prj = sum(r[3] for r in v) / n
    return {"n": n, "mae": mae, "actual": act, "proj": prj,
            "bias": (prj / act - 1) if act else float("nan"), "rows": v}


async def main() -> int:
    import db
    import fit_mlb_props as F

    persist = "--persist" in sys.argv
    wanted = [a for a in sys.argv[1:] if not a.startswith("--") and a in BY_SLUG]
    slugs = wanted or [m.slug for m in MARKETS]
    sys.stdout.reconfigure(line_buffering=True)

    pool = await db.get_pool()
    async with pool.acquire(timeout=3600.0) as conn:
        xw = await load_nfl_crosswalk(conn)
        print(f"crosswalk: {len(xw):,} ids resolve to an NFL athlete\n")

        for slug in slugs:
            m = BY_SLUG[slug]
            hist = await load_history(conn, m)
            if len(hist) < 2000:
                print(f"{slug}: only {len(hist):,} history rows — skipped")
                continue
            lr, lv = league_rates(hist)
            snap = snapshot(hist, lv)
            print(f"=== {slug} ===")
            print(f"  {len(hist):,} history rows, {len(snap):,} with >= {MIN_PRIOR_GAMES} prior games")
            print(f"  league: {lr:.5f} per chance, {lv:.2f} chances/game")

            # --- choose the projection on SELECT seasons, no lines involved --
            best = None
            for wi, w in enumerate(VOLUME_WINDOWS):
                for k in SHRINK_KS:
                    rows = project_all(snap, wi, k, SHAPES[0], lr, lv)
                    s = proj_score(rows, hi=PROJ_CUTOFF)
                    if s and (best is None or s["mae"] < best[0]):
                        best = (s["mae"], wi, w, k)
            _, bwi, bw, bk = best
            rows = project_all(snap, bwi, bk, SHAPES[0], lr, lv)
            sel = proj_score(rows, hi=PROJ_CUTOFF)
            held = proj_score(rows, lo=PROJ_CUTOFF)
            print(f"  fitted: volume_window={bw or 'all'} shrink_k={bk}")
            print(f"  SELECT (<{PROJ_CUTOFF}) n={sel['n']:,} MAE {sel['mae']:.4f}")
            print(f"  HELD OUT (>={PROJ_CUTOFF}) n={held['n']:,} MAE {held['mae']:.4f}"
                  f"  actual {held['actual']:.3f}  proj {held['proj']:.3f}"
                  f"  bias {held['bias']*100:+.1f}%")

            # A projection must beat "predict the league average for everyone",
            # or the player history is contributing nothing.
            flat = sum(abs(r[2] - held["actual"]) for r in held["rows"]) / held["n"]
            print(f"  flat league-average baseline MAE {flat:.4f}"
                  f"   model gains {flat - held['mae']:+.4f}"
                  f"  ({'BETTER' if held['mae'] < flat else 'NO BETTER'})")

            # --- line-dependent view, limited to the archived season ---------
            outcome: dict = {}
            for gd, aid, stat, _v in hist:
                key = (aid, gd)
                outcome[key] = None if key in outcome else stat
            props = await load_props(conn, m, xw, outcome)
            two = [p for p in props if p[3] is not None and p[4] is not None]
            print(f"  archived prop rows joined: {len(props):,}"
                  f"  ({len(two):,} two-sided)")
            print("  NO PROBABILITY IS PUBLISHED: 4.5 owns that gate and needs the"
                  " 2026 season.\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
