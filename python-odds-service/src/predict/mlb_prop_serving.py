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
from . import statsapi as sa

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
    league_baseline: float | None


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


async def live_slate_subjects(client, as_of: date) -> tuple[dict[str, str], dict]:
    """TODAY'S SCHEDULED players, as {athlete_id: game_id} — the slate the board
    is actually about.

    WHY THIS EXISTS. `build` originally took its slate from
    `player_game_history WHERE game_date = as_of`, which is a table of games
    that have ALREADY BEEN PLAYED AND RECORDED. That is the right shape for the
    walk-forward it was written beside, and the wrong shape for serving: it can
    only ever answer "who played on a past date", never "who plays tonight".
    Measured 2026-09-06, `player_game_history` ended 2026-08-28 while Scan's
    board showed that evening's real games — so every cached projection was for
    a nine-day-old set of players and would have joined onto almost nothing.

    Nothing about the MODEL changes here. Histories are still loaded strictly
    before `as_of`; this only changes which athletes are asked about.

    TWO SOURCES, because a lineup is not posted until roughly three hours
    before first pitch and a board has to work all day:
      - posted lineups and probable starters from today's schedule, and
      - each team's most recent posted lineup as the fallback, so an early-
        morning board still ranks the players who are about to be in it.

    A projected lineup is a real guess and is reported as such in the return's
    second element rather than being silently indistinguishable from a posted
    one.
    """
    date_str = as_of.strftime("%Y-%m-%d")
    games = await sa.get_slate(client, date_str)
    if not games:
        return {}, {"games": 0, "posted_lineups": 0, "projected_lineups": 0}

    # Team -> its most recent posted lineup, for games whose own lineup is not
    # out yet. Fetched once for the whole slate, not per game.
    recent_by_team: dict[int, list[str]] = {}
    for g in await sa.get_recent_lineups(client, sa.shift_date(date_str, -1), days=5):
        lu = g.lineups or {}
        for side, key in (("home", "homePlayers"), ("away", "awayPlayers")):
            team_id = ((g.teams.get(side) or {}).get("team") or {}).get("id")
            ids = [str(p["id"]) for p in (lu.get(key) or []) if p.get("id")]
            if team_id and ids:
                recent_by_team[team_id] = ids      # later games overwrite earlier

    subjects: dict[str, str] = {}
    posted = 0
    projected = 0
    for g in games:
        gid = str(g.game_pk)
        lu = g.lineups or {}
        for side, key in (("home", "homePlayers"), ("away", "awayPlayers")):
            ids = [str(p["id"]) for p in (lu.get(key) or []) if p.get("id")]
            if ids:
                posted += 1
            else:
                team_id = ((g.teams.get(side) or {}).get("team") or {}).get("id")
                ids = recent_by_team.get(team_id, [])
                if ids:
                    projected += 1
            for aid in ids:
                subjects[aid] = gid
            # The probable starter is a separate hydrate from the lineup and is
            # available well before it — the pitcher markets are servable on a
            # morning board even when no batter lineup is out.
            pp = ((g.teams.get(side) or {}).get("probablePitcher") or {})
            if pp.get("id"):
                subjects[str(pp["id"])] = gid

    return subjects, {"games": len(games), "posted_lineups": posted,
                      "projected_lineups": projected}


def league_baseline_for(games, subjects, line: float | None, as_of: date) -> float | None:
    """League-wide P(stat > line) for one market, from the same history list
    this pipe already loaded to build player histories.

    THIS IS NOT `cal["league_rate"]`, and the distinction is the whole reason
    this function exists. `league_rate` is the engine's per-CHANCE rate — hits
    per plate appearance (0.2219), strikeouts per out recorded (0.3180). It is
    a parameter of `count_prop_engine.project`, not a probability of anything.
    Scan's ranking metric subtracts a baseline from a calibrated P(over), so
    both terms have to describe the same event or the subtraction is a unit
    error that produces a plausible-looking number instead of a crash.

    THE POPULATION IS MATCHED BY CONSTRUCTION, not by a threshold: exactly the
    history rows this pipe feeds into the player histories it is about to serve
    — this market's stat, this slate's players, strictly before `as_of`. One
    rule, applied identically in `nhl_prop_serving`, so the two sports' baselines
    mean the same thing.

    That matters more than it sounds. Measured 2026-09-06, P(K > 4.5) is 0.129
    across all pitcher-games and 0.630 across starts of 15+ outs — a five-fold
    swing on nothing but which pitchers you count. Any hand-picked threshold
    would reorder the whole cross-market board on a definitional choice, so
    nothing here picks one; it takes the population the board already has.

    Strictly before `as_of`, matching the leakage control `build` applies to
    player histories. A baseline is a descriptive statistic rather than a
    prediction, so today's rows could not leak an outcome into it in any way
    that matters, but a number computed over a different window than the
    histories beside it would be one more thing to have to explain.
    """
    if line is None:
        return None
    over = 0
    total = 0
    for gd, aid, ev, _vol in games:
        if gd >= as_of:
            break
        if aid not in subjects:
            continue
        total += 1
        if ev > line:
            over += 1
    return (over / total) if total > 0 else None


async def build(conn, as_of: date, lines: dict[str, float] | None = None,
                subjects: dict[str, str] | None = None) -> dict:
    """Projections for everyone on `as_of`'s slate, per active market.

    `subjects` is {athlete_id: game_id}. Passing it in is the SERVING path —
    `live_slate_subjects` resolves today's scheduled players from the schedule.
    Omitting it falls back to reading the slate out of `player_game_history`,
    which is the BACKTEST path: it answers "who played on this past date", which
    is what the walk-forward wants and is useless for a live board. Both are
    kept because both are real; see `live_slate_subjects` for why the
    distinction was worth a parameter.
    """
    markets = await _active_markets(conn)
    if not markets:
        return {"served": [], "markets": [], "note": "no active mlb calibration"}

    if subjects is None:
        slate = await conn.fetch(
            "SELECT DISTINCT athlete_id, event_id FROM player_game_history "
            "WHERE sport = 'mlb' AND game_date = $1", as_of)
        subjects = {str(r["athlete_id"]): str(r["event_id"]) for r in slate}
    if not subjects:
        return {"served": [], "markets": sorted(markets),
                "note": f"no mlb games on {as_of}"}

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

        # Phase 2 — the anchor Scan's cross-market ranking subtracts. See
        # `league_baseline_for` for why it is computed from `games` rather than
        # read from `cal["league_rate"]`, which is a different quantity.
        baseline = league_baseline_for(games, subjects, line, as_of) if show_prob else None
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
                line=line if show_prob else None, model_prob=prob,
                league_baseline=baseline))

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
            projection=s.projection, projected_toi=s.projected_volume,
            league_baseline=s.league_baseline)
        for s in served
    ]
    assert all(r.category == "projection" for r in rows)
    assert all(r.matchup_favorable is None and r.model_std_dev is None
               for r in rows)
    return rows


async def run(as_of: date, lines: dict[str, float] | None = None,
              live_slate: bool = True) -> dict:
    """Serve `as_of`'s board.

    `live_slate` resolves today's SCHEDULED players from the MLB schedule, which
    is the only way a board about tonight's games can contain tonight's players
    — see `live_slate_subjects`. Set it False to reproduce the old behaviour of
    reading the slate out of already-recorded box scores, which is what the
    walk-forward and the verification scripts want.

    A live slate that resolves to nothing does NOT fall back to the recorded
    one. An empty schedule means there are no games, and quietly serving a
    different day's players instead is exactly the failure this parameter
    exists to end.
    """
    import httpx

    import db as _db

    slate_meta: dict = {}
    subjects: dict[str, str] | None = None
    if live_slate:
        async with httpx.AsyncClient() as client:
            subjects, slate_meta = await live_slate_subjects(client, as_of)

    pool = await _db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        built = await build(conn, as_of, lines, subjects=subjects)
    rows = to_cache_rows(built["served"])
    written = await _db.write_prop_model_cache(rows)
    return {k: v for k, v in built.items() if k != "served"} | slate_meta | {
        "projections": len(built["served"]), "written": written}
