"""Phase 4.9 — the PROJECTION pipe for NHL props.

This is deliberately NOT the edge pipe. It writes a projection, the ice time
behind it, the sample size behind that, and — only for markets that earned it —
a calibrated probability. It writes NO edge, NO market probability, NO prop
score and NO grade, because those are claims about someone else's price and they
are gated on 4.7, which failed. The assertion in `to_cache_rows` enforces that
rather than trusting it.

WHY NOT `pick_history`. That table stores SELECTED picks: generic_prop_production
keeps only the better-scoring side per dimension. A ranking board needs the full
ordered field — every qualifying player, ranked. Different shape, different
query. Writing projections there would also mix edge-gated and ordering-gated
rows in one table, so every reader would have to know which kind it was holding,
which is exactly how a stats surface silently becomes a betting surface.

THE CONSTANTS ARE READ, NEVER TRANSCRIBED. Every market's toi_window, shrink_k,
dispersion, temperature, league_rate and league_toi come from
`model_calibration`, written by `fit_nhl_props_all.py --persist`. A market with
no ACTIVE calibration row does not get served at all: `active` means its
ordering was measured monotone across five equal-count quintiles, and a market
whose ranking is backwards is the one thing that would make the board lie.
Blocked shots and hits are both inactive for that reason and are skipped here
with no special-casing.

`model_prob` IS LEFT NULL ON PURPOSE for a market whose calibration gap exceeds
tolerance (shots-on-goal 0.057, goals 0.131). A null probability is how the
board is told "rank this, but do not put a percentage on it" — there is no
separate flag, because a flag can disagree with the data and a null cannot.

ON THE AS-OF DATE AND WHAT IT DOES AND DOES NOT PROVE. NHL is out of season
until October, so this runs against a historical slate. History is built
STRICTLY BEFORE the as-of date — asserted, not assumed. The one thing a
historical run takes from the future is the PARTICIPANT LIST: it learns who
dressed from the games themselves. That is standard for measuring projection
quality (you condition on participation) but it is not nothing, and a live slate
would take that list from the schedule and the roster instead. So this path
proves the projection and the leakage discipline; it does NOT prove scheduling
or roster resolution, and those stay unproven until a real October slate runs.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date

from . import nhl_props as npx

MODEL_VERSION = 1

# Same slug space as fit_nhl_props_all.DIMENSION and prop_model_cache.dimension.
DIMENSION_STAT = {
    "shots-on-goal": "sog",
    "points": "points",
    "assists": "assists",
    "goals": "goals",
    "blocked-shots": "blockedShots",
    "hits": "hits",
}

# A projection off two games is not a projection. Same floor the walk-forward
# used (fit_nhl_props_all.MIN_PRIOR), so the served model is gated exactly as
# the measured one was.
MIN_PRIOR_GAMES = 5


@dataclass
class ServedProjection:
    athlete_id: str
    game_id: str
    dimension: str
    projection: float
    projected_toi: float
    games_of_history: int
    league_rate: float
    line: float | None
    model_prob: float | None


def _temper(p: float, t: float) -> float:
    lo = math.log(max(1e-12, p) / max(1e-12, 1.0 - p)) / t
    return 1.0 / (1.0 + math.exp(-lo))


async def _active_markets(conn) -> dict[str, dict]:
    """Every NHL market whose ordering was measured monotone. `active` carries
    that and only that; `probability_ok` inside params is the separate,
    stricter claim about calibration."""
    rows = await conn.fetch(
        "SELECT market, params_json, version FROM model_calibration "
        "WHERE sport = 'nhl' AND active = true"
    )
    out: dict[str, dict] = {}
    for r in rows:
        if r["market"] not in DIMENSION_STAT:
            continue
        out[r["market"]] = {**json.loads(r["params_json"]), "version": r["version"]}
    return out


def _stats(raw) -> dict:
    st = raw or {}
    if isinstance(st, str):
        st = json.loads(st or "{}")
    return st


async def build(conn, as_of: date, lines: dict[str, float] | None = None) -> dict:
    """Projections for every skater who appears on `as_of`'s slate.

    `lines` maps dimension -> the line to price against, used only for markets
    that earned a displayed probability. Absent, those markets still get a
    projection and a null probability.
    """
    markets = await _active_markets(conn)
    if not markets:
        return {"served": [], "markets": [], "note": "no active nhl calibration"}

    # The slate. `event_id` is the game these rows belong to; for a historical
    # as-of date it comes from the played games themselves.
    slate = await conn.fetch(
        "SELECT athlete_id, event_id, stats FROM player_game_history "
        "WHERE sport = 'nhl' AND game_date = $1", as_of)
    if not slate:
        return {"served": [], "markets": sorted(markets),
                "note": f"no nhl games on {as_of}"}

    subjects: dict[str, str] = {}
    for r in slate:
        if _stats(r["stats"]).get("isGoalie"):
            continue          # a goalie's sog is not a shot he took
        subjects[str(r["athlete_id"])] = str(r["event_id"])

    # History, STRICTLY BEFORE as_of. The inequality is the entire leakage
    # control on this path, and it is asserted below rather than trusted.
    hist_rows = await conn.fetch(
        "SELECT athlete_id, game_date, stats FROM player_game_history "
        "WHERE sport = 'nhl' AND game_date < $1 AND athlete_id = ANY($2::text[]) "
        "ORDER BY game_date", as_of, list(subjects))

    parsed: list[tuple[str, dict]] = []
    for r in hist_rows:
        st = _stats(r["stats"])
        if st.get("isGoalie") or "toiMinutes" not in st:
            continue
        assert r["game_date"] < as_of, (
            f"leakage: history row dated {r['game_date']} is not before {as_of}")
        parsed.append((str(r["athlete_id"]), st))

    out: list[ServedProjection] = []
    for dim, cal in sorted(markets.items()):
        stat = DIMENSION_STAT[dim]
        hists: dict[str, npx.PlayerHistory] = {}
        for aid, st in parsed:
            if stat not in st:
                continue
            hists.setdefault(aid, npx.PlayerHistory()).add(
                float(st[stat]), float(st["toiMinutes"]))

        line = (lines or {}).get(dim)
        show_prob = bool(cal.get("probability_ok")) and line is not None
        for aid, gid in subjects.items():
            h = hists.get(aid)
            if h is None or h.games < MIN_PRIOR_GAMES:
                continue
            p = npx.project(h, cal["league_rate"], cal["league_toi"],
                            k=cal["shrink_k"], toi_window=int(cal["toi_window"] or 0))
            prob = None
            if show_prob:
                raw = npx.nb_prob_over(line, p.expected_sog, cal["dispersion"])
                prob = _temper(raw, cal["temperature"])
            out.append(ServedProjection(
                athlete_id=aid, game_id=gid, dimension=dim,
                projection=p.expected_sog, projected_toi=p.projected_toi,
                games_of_history=p.games_of_history,
                league_rate=cal["league_rate"],
                line=line if show_prob else None,
                model_prob=prob))

    return {"served": out, "markets": sorted(markets),
            "subjects": len(subjects), "history_rows": len(parsed)}


def to_cache_rows(served: list[ServedProjection]) -> list:
    """Convert to the shared cache shape.

    THE EDGE FIELDS ARE NOT SET, AND THAT IS ASSERTED. `model_prob` is the one
    probability this pipe may write and it comes from the model alone, never
    from a price. Nothing here touches market_prob/edge/prop_score/grade —
    those live on `pick_history`, behind 4.7's gate.
    """
    import db as _db

    rows = []
    for s in served:
        rows.append(_db.PropModelCacheRow(
            sport="nhl", game_id=s.game_id, subject_id=s.athlete_id,
            dimension=s.dimension,
            # The projection pipe has no side. `category` exists for the edge
            # pipe's over/under selection; a ranking is not a side, so it is
            # recorded as what it actually is.
            category="projection",
            line=s.line, model_prob=s.model_prob, model_std_dev=None,
            model_sample_size=s.games_of_history, league_rate=s.league_rate,
            matchup_favorable=None, model_version=MODEL_VERSION,
            projection=s.projection, projected_toi=s.projected_toi))
    assert all(r.category == "projection" for r in rows)
    return rows


async def run(as_of: date, lines: dict[str, float] | None = None) -> dict:
    import db as _db

    pool = await _db.get_pool()
    async with pool.acquire(timeout=60.0) as conn:
        built = await build(conn, as_of, lines)
    rows = to_cache_rows(built["served"])
    written = await _db.write_prop_model_cache(rows)
    return {k: v for k, v in built.items() if k != "served"} | {
        "projections": len(built["served"]), "written": written}
