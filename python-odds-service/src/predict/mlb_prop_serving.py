"""Phase 5.8 — the PROJECTION pipe for MLB props.

Same shape as `nhl_prop_serving.py`, and deliberately so: one pipe per sport, one
table, one gate. Everything the NHL module's header says applies here —
projection only, no edge fields, constants read from `model_calibration` rather
than transcribed, `model_prob` NULL where calibration was not earned.

THREE MLB-SPECIFIC THINGS.

1. TWO SIDES, TWO VOLUMES. A batter's chances are plate appearances; a
   pitcher's are outs recorded. `MarketSpec.side` decides which, and the
   calibration row carries it so the serving path cannot pick the wrong one.

2. CALIBRATION IS PLATT OR TEMPERATURE, per market. NHL needed only temperature
   (an overconfidence correction); MLB's measured failure was a uniform
   under-prediction, which only a shift term can absorb. Both are stored as
   (a, b) and applied through the same `platt`, so this module does not need to
   know which was fitted.

3. NO PARK ADJUSTMENT, AND IT IS NOT AN OVERSIGHT. The plan called for park
   factors as a rate multiplier and `park_factors` holds 542 real rows, but
   there is no path from a player-game to a venue: `player_game_history` has no
   venue column, and its `event_id` does not join `game_result.event_ref` at all
   — 0 of 4,456 distinct 2025+ MLB event ids match. `game_result.venue` is also
   NULL on 28,057 of 44,192 MLB rows. The multiplier hook exists in
   `count_prop_engine.project` and is tested inert at 1.0; wiring it needs a
   game-to-venue join that does not currently exist.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date

from . import count_prop_engine as eng
from . import mlb_props as mp

MODEL_VERSION = 1
MIN_PRIOR_GAMES = 5

# Every parameter this pipe reads out of a calibration row. A row lacking any of
# them was produced by a different fitter and is skipped, not defaulted.
REQUIRED_PARAMS = (
    "league_rate", "league_volume", "shrink_k", "volume_window",
    "shape_kind", "calibration_a", "calibration_b",
)


@dataclass
class ServedProjection:
    athlete_id: str
    game_id: str
    dimension: str
    projection: float
    projected_volume: float
    games_of_history: int
    league_rate: float
    line: float | None
    model_prob: float | None


async def _active_markets(conn) -> dict[str, dict]:
    rows = await conn.fetch(
        "SELECT market, params_json, version FROM model_calibration "
        "WHERE sport = 'mlb' AND active = true")
    # A ROW MUST CARRY EVERY PARAMETER THIS PIPE NEEDS, or it is not a fitted
    # model and must not be served. `model_calibration` already held seven MLB
    # rows from an earlier phase — 'walks', 'hits-runs-rbis', 'pitcher-strikeouts'
    # among them — written by a different fitter, still `active`, and carrying
    # none of the volume/shape/shrink parameters this engine reads. Serving one
    # would either raise on a missing key or, worse, fall back to a default and
    # publish a projection nobody fitted.
    #
    # Checked by REQUIRED_PARAMS rather than by a version number or a date,
    # because the question is not "is this row old" but "does it describe the
    # model this code runs".
    out: dict[str, dict] = {}
    for r in rows:
        if r["market"] not in mp.BY_SLUG:
            continue
        p = json.loads(r["params_json"])
        missing = [k for k in REQUIRED_PARAMS if k not in p]
        if missing:
            continue
        out[r["market"]] = {**p, "version": r["version"]}
    return out


async def build(conn, as_of: date, lines: dict[str, float] | None = None) -> dict:
    """Projections for everyone on `as_of`'s slate, per active market."""
    markets = await _active_markets(conn)
    if not markets:
        return {"served": [], "markets": [], "note": "no active mlb calibration"}

    slate = await conn.fetch(
        "SELECT DISTINCT athlete_id, event_id FROM player_game_history "
        "WHERE sport = 'mlb' AND game_date = $1", as_of)
    if not slate:
        return {"served": [], "markets": sorted(markets),
                "note": f"no mlb games on {as_of}"}
    subjects = {str(r["athlete_id"]): str(r["event_id"]) for r in slate}

    out: list[ServedProjection] = []
    history_rows = 0
    for dim, cal in sorted(markets.items()):
        # ONE history source, shared with the walk-forward. Strictly before
        # as_of — asserted, because this is the whole leakage control.
        games = await mp.load_game_history(dim, conn=conn)
        hists: dict[str, eng.PlayerHistory] = {}
        for gd, aid, ev, vol in games:
            if gd >= as_of:
                break
            if aid in subjects:
                hists.setdefault(aid, eng.PlayerHistory()).add(ev, vol)
        history_rows += sum(h.games for h in hists.values())

        line = (lines or {}).get(dim)
        show_prob = bool(cal.get("probability_ok")) and line is not None
        shape = (cal.get("shape_kind", "nb"), cal.get("shape_param"))
        for aid, gid in subjects.items():
            h = hists.get(aid)
            if h is None or h.games < MIN_PRIOR_GAMES:
                continue
            pr = eng.project(h, cal["league_rate"], cal["league_volume"],
                             k=cal["shrink_k"],
                             volume_window=int(cal["volume_window"] or 0))
            prob = None
            if show_prob:
                raw = eng.shape_prob_over(shape[0], shape[1], line,
                                          pr.expected, pr.projected_volume)
                prob = eng.platt(raw, cal["calibration_a"], cal["calibration_b"])
            out.append(ServedProjection(
                athlete_id=aid, game_id=gid, dimension=dim,
                projection=pr.expected, projected_volume=pr.projected_volume,
                games_of_history=pr.games_of_history,
                league_rate=cal["league_rate"],
                line=line if show_prob else None, model_prob=prob))

    return {"served": out, "markets": sorted(markets),
            "subjects": len(subjects), "history_rows": history_rows}


def to_cache_rows(served: list[ServedProjection]) -> list:
    """Convert to the shared cache shape. NO EDGE FIELDS, asserted."""
    import db as _db

    rows = [
        _db.PropModelCacheRow(
            sport="mlb", game_id=s.game_id, subject_id=s.athlete_id,
            dimension=s.dimension, category="projection",
            line=s.line, model_prob=s.model_prob, model_std_dev=None,
            model_sample_size=s.games_of_history, league_rate=s.league_rate,
            matchup_favorable=None, model_version=MODEL_VERSION,
            projection=s.projection, projected_toi=s.projected_volume)
        for s in served
    ]
    assert all(r.category == "projection" for r in rows)
    assert all(r.matchup_favorable is None and r.model_std_dev is None
               for r in rows)
    return rows


async def run(as_of: date, lines: dict[str, float] | None = None) -> dict:
    import db as _db

    pool = await _db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        built = await build(conn, as_of, lines)
    rows = to_cache_rows(built["served"])
    written = await _db.write_prop_model_cache(rows)
    return {k: v for k, v in built.items() if k != "served"} | {
        "projections": len(built["served"]), "written": written}
