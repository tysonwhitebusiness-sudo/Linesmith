"""Direct port of lib/sports/mlb/simRates.ts — not a reimplementation.
Outcome-rate vector builders for the sim engine — the data-fetching half of
sim_engine.py's split (mirrors homeRunModel.ts/homeRunModelFit.ts's pure-vs-
fetching separation in the TS codebase).
"""
from dataclasses import dataclass

import httpx

from .sim_engine import OUTCOME_ORDER, OutcomeVector, dirichlet_shrunk_vector, make_outcome_vector
from .statsapi import (
    GameLogSplit,
    get_active_roster,
    get_league_batter_season_rows,
    get_league_pitcher_role_pools,
    get_league_starting_pitcher_stats,
    get_people_with_game_logs,
)


def _num(v) -> float:
    if v is None or isinstance(v, bool):
        return 0.0
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


@dataclass
class LeagueOutcomeRates:
    vector: OutcomeVector
    total_pa: float


async def compute_league_outcome_rates(client: httpx.AsyncClient, season: int) -> LeagueOutcomeRates:
    """League-wide per-PA outcome rates for one season, aggregated straight
    from real batter game logs. BB folds in HBP (both put the batter on
    first with no risk of an out). 1B is derived (hits minus the extra-base
    hit types) rather than fetched directly. OUT is everything left over
    (PA minus BB/hits/K) — groundouts, flyouts, sac flies/bunts, and
    reached-on-error all collapse into one bucket in v1."""
    batter_pool = await get_league_batter_season_rows(client, season)
    batter_ids = [b.person_id for b in batter_pool]
    logs_by_id = await get_people_with_game_logs(client, batter_ids, "hitting", season)

    pa = bb = k = hits = doubles = triples = hr = 0.0

    for person in logs_by_id.values():
        for g in person.game_log:
            game_pa = _num(g.stat.get("plateAppearances"))
            if game_pa <= 0:
                continue
            pa += game_pa
            bb += _num(g.stat.get("baseOnBalls")) + _num(g.stat.get("hitByPitch"))
            k += _num(g.stat.get("strikeOuts"))
            hits += _num(g.stat.get("hits"))
            doubles += _num(g.stat.get("doubles"))
            triples += _num(g.stat.get("triples"))
            hr += _num(g.stat.get("homeRuns"))

    if pa == 0:
        raise ValueError(f"compute_league_outcome_rates: no usable plate appearances found for season {season}")

    singles = max(0.0, hits - doubles - triples - hr)
    outs = max(0.0, pa - bb - hits - k)

    vector = make_outcome_vector(
        {
            "BB": bb / pa,
            "K": k / pa,
            "1B": singles / pa,
            "2B": doubles / pa,
            "3B": triples / pa,
            "HR": hr / pa,
            "OUT": outs / pa,
        }
    )
    return LeagueOutcomeRates(vector=vector, total_pa=pa)


def batter_outcome_counts(game_log: list[GameLogSplit]) -> OutcomeVector:
    """Raw per-category PA counts from one batter's game log — same field
    extraction as compute_league_outcome_rates, just not summed across the
    whole league."""
    pa = bb = k = hits = doubles = triples = hr = 0.0
    for g in game_log:
        game_pa = _num(g.stat.get("plateAppearances"))
        if game_pa <= 0:
            continue
        pa += game_pa
        bb += _num(g.stat.get("baseOnBalls")) + _num(g.stat.get("hitByPitch"))
        k += _num(g.stat.get("strikeOuts"))
        hits += _num(g.stat.get("hits"))
        doubles += _num(g.stat.get("doubles"))
        triples += _num(g.stat.get("triples"))
        hr += _num(g.stat.get("homeRuns"))

    singles = max(0.0, hits - doubles - triples - hr)
    outs = max(0.0, pa - bb - hits - k)
    return make_outcome_vector({"BB": bb, "K": k, "1B": singles, "2B": doubles, "3B": triples, "HR": hr, "OUT": outs})


def pitcher_outcome_counts(game_log: list[GameLogSplit]) -> OutcomeVector:
    """Same shape as batter_outcome_counts, for a PITCHER's own game log —
    the pitching group's stat object has no plateAppearances field (that's
    batting-only), so batters-faced is approximated as
    atBats + baseOnBalls + hitByPitch (misses sac flies/bunts and catcher's
    interference — a small undercount that lands in the OUT bucket, same as
    everything else v1's 7-category scheme doesn't itemize)."""
    batters_faced = bb = k = hits = doubles = triples = hr = 0.0
    for g in game_log:
        walks_and_hbp = _num(g.stat.get("baseOnBalls")) + _num(g.stat.get("hitByPitch"))
        game_faced = _num(g.stat.get("atBats")) + walks_and_hbp
        if game_faced <= 0:
            continue
        batters_faced += game_faced
        bb += walks_and_hbp
        k += _num(g.stat.get("strikeOuts"))
        hits += _num(g.stat.get("hits"))
        doubles += _num(g.stat.get("doubles"))
        triples += _num(g.stat.get("triples"))
        hr += _num(g.stat.get("homeRuns"))

    singles = max(0.0, hits - doubles - triples - hr)
    outs = max(0.0, batters_faced - bb - hits - k)
    return make_outcome_vector({"BB": bb, "K": k, "1B": singles, "2B": doubles, "3B": triples, "HR": hr, "OUT": outs})


@dataclass
class LineupOutcomeVectors:
    league_rates: OutcomeVector
    by_batter: dict[int, OutcomeVector]


async def compute_lineup_outcome_vectors(client: httpx.AsyncClient, person_ids: list[int], season: int, league_rates: OutcomeVector) -> LineupOutcomeVectors:
    """Real, shrunk outcome vectors for a specific list of batters (a
    lineup). `league_rates` is a required input rather than recomputed here
    so a caller building a whole game (both lineups) only pays for the
    expensive league-wide aggregation once, not once per lineup."""
    logs_by_id = await get_people_with_game_logs(client, person_ids, "hitting", season)
    by_batter: dict[int, OutcomeVector] = {}
    for id_ in person_ids:
        person = logs_by_id.get(id_)
        counts = batter_outcome_counts(person.game_log) if person else make_outcome_vector({})
        by_batter[id_] = dirichlet_shrunk_vector(counts, league_rates)
    return LineupOutcomeVectors(league_rates=league_rates, by_batter=by_batter)


@dataclass
class RankedBatterRow:
    person_id: int
    full_name: str
    pa: float
    hr_rate: float


async def rank_batters_by_hr_rate(client: httpx.AsyncClient, season: int, min_pa: float = 200) -> list[RankedBatterRow]:
    """Whole qualified-batter pool ranked by raw HR rate — a validation
    tool (an elite vs. replacement-level lineup test doesn't need hardcoded
    player IDs that go stale season to season). `min_pa` guards against a
    3-PA September call-up's one lucky homer looking like a real 33% HR rate."""
    batter_pool = await get_league_batter_season_rows(client, season)
    logs_by_id = await get_people_with_game_logs(client, [b.person_id for b in batter_pool], "hitting", season)
    rows: list[RankedBatterRow] = []
    for b in batter_pool:
        person = logs_by_id.get(b.person_id)
        if not person:
            continue
        counts = batter_outcome_counts(person.game_log)
        pa = sum(counts[k] for k in OUTCOME_ORDER)
        if pa < min_pa:
            continue
        rows.append(RankedBatterRow(person_id=b.person_id, full_name=b.full_name, pa=pa, hr_rate=counts["HR"] / pa))
    rows.sort(key=lambda r: r.hr_rate, reverse=True)
    return rows


async def compute_pitcher_outcome_vectors(client: httpx.AsyncClient, person_ids: list[int], season: int, league_rates: OutcomeVector) -> dict[int, OutcomeVector]:
    """A pitcher's own allowed-rate vector, shrunk the same way a batter's
    is — uses pitcher_outcome_counts (not batter_outcome_counts), since the
    pitching group's game log has no plateAppearances field to key off of."""
    logs_by_id = await get_people_with_game_logs(client, person_ids, "pitching", season)
    by_pitcher: dict[int, OutcomeVector] = {}
    for id_ in person_ids:
        person = logs_by_id.get(id_)
        counts = pitcher_outcome_counts(person.game_log) if person else make_outcome_vector({})
        by_pitcher[id_] = dirichlet_shrunk_vector(counts, league_rates)
    return by_pitcher


@dataclass
class RankedPitcherRow:
    person_id: int
    full_name: str
    era: float


async def rank_starters_by_era(client: httpx.AsyncClient, season: int, min_games_started: int = 10) -> list[RankedPitcherRow]:
    """Qualified starters ranked by ERA (lowest first) — same "don't
    hardcode a name that goes stale" reasoning as rank_batters_by_hr_rate."""
    stats = await get_league_starting_pitcher_stats(client, season)
    rows = [
        RankedPitcherRow(person_id=p.person_id, full_name=p.full_name, era=p.values["era"])
        for p in stats
        if p.games_started >= min_games_started and isinstance(p.values.get("era"), (int, float))
    ]
    rows.sort(key=lambda r: r.era)
    return rows


async def compute_bullpen_outcome_vector(client: httpx.AsyncClient, team_id: int, season: int, league_rates: OutcomeVector) -> OutcomeVector:
    """A team's whole bullpen (relievers + closers) as ONE pooled, shrunk
    outcome vector — v1's deliberate "who's actually on the mound doesn't
    matter, just what environment the bullpen creates" scope. Counts are
    pooled across every reliever on the roster before shrinking, not
    averaged per-pitcher-then-combined."""
    pools = await get_league_pitcher_role_pools(client, season)
    relievers = [p for p in (pools.relievers + pools.closers) if p.raw.team_id == team_id]
    if not relievers:
        return league_rates

    logs_by_id = await get_people_with_game_logs(client, [p.raw.person_id for p in relievers], "pitching", season)
    pooled = make_outcome_vector({})
    for p in relievers:
        person = logs_by_id.get(p.raw.person_id)
        if not person:
            continue
        counts = pitcher_outcome_counts(person.game_log)
        for key in OUTCOME_ORDER:
            pooled[key] += counts[key]
    return dirichlet_shrunk_vector(pooled, league_rates)


async def get_starter_innings_per_start(client: httpx.AsyncClient, person_id: int, season: int) -> float:
    """A starter's own average innings/start this season — the bullpen
    handoff trigger (see sim_engine.py's make_starter_bullpen_stream). Falls
    back to a neutral 5.0 when the pitcher isn't found in the role pool at
    all (e.g. a rookie with too few starts to classify)."""
    pools = await get_league_pitcher_role_pools(client, season)
    starter = next((p for p in pools.starters if p.raw.person_id == person_id), None)
    if not starter or starter.raw.games_started <= 0:
        return 5.0
    return starter.raw.innings_pitched / starter.raw.games_started


async def compute_team_batting_vector(client: httpx.AsyncClient, team_id: int, season: int, league_rates: OutcomeVector) -> OutcomeVector:
    """A whole team's batting staff (every non-pitcher on the active
    roster, pooled) as one shrunk outcome vector — the historical-backfill
    counterpart to the per-batter lineup vectors above. Real per-game
    historical lineups aren't cheaply available at scale, so this uses a
    team-season aggregate for training, same accepted simplification as
    modelFit.ts's own starter-ERA blending."""
    roster = await get_active_roster(client, team_id, season)
    batter_ids = [p.id for p in roster if p.position != "P"]
    if not batter_ids:
        return league_rates
    logs_by_id = await get_people_with_game_logs(client, batter_ids, "hitting", season)
    pooled = make_outcome_vector({})
    for person in logs_by_id.values():
        counts = batter_outcome_counts(person.game_log)
        for key in OUTCOME_ORDER:
            pooled[key] += counts[key]
    return dirichlet_shrunk_vector(pooled, league_rates)


async def compute_team_pitching_vector(client: httpx.AsyncClient, team_id: int, season: int, league_rates: OutcomeVector) -> OutcomeVector:
    """A whole team's pitching staff (starters + relievers combined,
    pooled) as one shrunk outcome vector — same team-only simplification as
    compute_team_batting_vector, used only for the historical backfill
    where a specific day's starter isn't cheaply knowable."""
    roster = await get_active_roster(client, team_id, season)
    pitcher_ids = [p.id for p in roster if p.position == "P"]
    if not pitcher_ids:
        return league_rates
    logs_by_id = await get_people_with_game_logs(client, pitcher_ids, "pitching", season)
    pooled = make_outcome_vector({})
    for person in logs_by_id.values():
        counts = pitcher_outcome_counts(person.game_log)
        for key in OUTCOME_ORDER:
            pooled[key] += counts[key]
    return dirichlet_shrunk_vector(pooled, league_rates)
