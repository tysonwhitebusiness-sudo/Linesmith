"""Direct port of lib/sports/mlb/adapter.ts's prediction-relevant subset —
not a reimplementation, and not a port of the whole 2385-line file. Skips
~1100+ lines of display/UI-only card builders (SplitEvidence bullets,
DVP-column labels, live-game state, opposing-starter/own-Statcast display
cards) that a prediction pipeline with no UI of its own has no use for —
this port only produces what a `pick_history` row actually needs: which
candidates exist, their history, and their model probability.

Three disclosed adaptations:
- `HistoryEntry` (category/opponent_id/is_home) reuses
  predict.windowed_stat.HistoryEntry directly rather than porting a
  second, richer TS HistoryEntry with period/result/periodLabel fields
  nothing here reads.
- `matchup_split`/`team_level_matchup_rank` return just (rank, favorable)
  — the TS source's SplitEvidence "ranks well/poorly" sentence is display
  text, never read by anything in this module or downstream
  (edge_model.py, prop_score.py).
- Lineup/side resolution reuses predict.game_model_cache's already-built
  `TeamSide`/`build_recent_lineups`/`_make_side` (ported for the MLB
  game-model job) rather than re-porting adapter.ts's makeSide a second
  time — same real slate, same real lineup-resolution rules, one source
  of truth.
"""
import asyncio
from dataclasses import dataclass
from typing import Callable

import httpx

import db
from entity_resolution import candidate_category_to_side
from predict import game_model_cache, savant, statsapi
from predict.edge_model import ModelProbabilityInput, compute_model_probability
from predict.home_run_live_matchup import TeamHrRateAllowedCache, load_team_hr_rate_allowed_cache
from predict.home_run_model import (
    HomeRunFeatureInputs,
    apply_fitted_home_run_weights,
    apply_lineup_confidence,
    expected_pa_centered,
    park_hr_factor_centered,
    pitcher_matchup_signal,
)
from predict.windowed_stat import HistoryEntry

# Phase A's relevance floor — recent-form window, not season-long average.
HISTORY_WINDOW = 15
# Below this many starts, an opposing starter's own rank is noise; fall
# back to the team-wide (bullpen-included) rank instead.
MIN_STARTS_FOR_PITCHER_RANK = 3


def _num0(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _outs_from_innings_pitched(raw) -> float:
    """IP's fractional digit is literal outs-into-the-inning (0/1/2), not
    tenths — "6.1" means 6 innings + 1 out = 19 outs."""
    s = str(raw) if raw is not None else "0"
    parts = s.split(".", 1)
    whole = parts[0]
    frac = parts[1] if len(parts) > 1 else "0"
    try:
        whole_n = float(whole) if whole else 0.0
    except ValueError:
        whole_n = 0.0
    try:
        frac_n = float(frac) if frac else 0.0
    except ValueError:
        frac_n = 0.0
    return whole_n * 3 + frac_n


# ---------------------------------------------------------------------------
# Dimension tables — direct port of adapter.ts's BATTER_STAT_MARKETS /
# PITCHER_STAT_MARKETS / STAT_MARKET_BY_DIMENSION.
# ---------------------------------------------------------------------------


@dataclass
class StatMarketDef:
    dimension: str
    value_of: Callable[[dict], float]
    line: float
    # Set only for rare-positive events (home runs, triples, stolen
    # bases, doubles) — see RARE_EVENT_FLOOR below.
    interest_side: str | None = None


BATTER_STAT_MARKETS: list[StatMarketDef] = [
    StatMarketDef("total-bases", lambda s: _num0(s.get("totalBases")), 1.5),
    StatMarketDef("home-runs", lambda s: _num0(s.get("homeRuns")), 0.5, interest_side="over"),
    StatMarketDef("rbis", lambda s: _num0(s.get("rbi")), 0.5),
    StatMarketDef("runs", lambda s: _num0(s.get("runs")), 0.5),
    StatMarketDef("walks", lambda s: _num0(s.get("baseOnBalls")), 0.5),
    StatMarketDef("batter-strikeouts", lambda s: _num0(s.get("strikeOuts")), 0.5),
    # Real sportsbooks only ever post the Over on doubles — same
    # interestSide treatment as home runs/triples/stolen bases.
    StatMarketDef("doubles", lambda s: _num0(s.get("doubles")), 0.5, interest_side="over"),
    StatMarketDef("triples", lambda s: _num0(s.get("triples")), 0.5, interest_side="over"),
    # Not reported directly — hits minus every extra-base hit.
    StatMarketDef("singles", lambda s: _num0(s.get("hits")) - _num0(s.get("doubles")) - _num0(s.get("triples")) - _num0(s.get("homeRuns")), 0.5),
    StatMarketDef("stolen-bases", lambda s: _num0(s.get("stolenBases")), 0.5, interest_side="over"),
    StatMarketDef("hits-runs-rbis", lambda s: _num0(s.get("hits")) + _num0(s.get("runs")) + _num0(s.get("rbi")), 1.5),
]

PITCHER_STAT_MARKETS: list[StatMarketDef] = [
    StatMarketDef("pitcher-strikeouts", lambda s: _num0(s.get("strikeOuts")), 4.5),
    StatMarketDef("earned-runs", lambda s: _num0(s.get("earnedRuns")), 2.5),
    StatMarketDef("pitcher-outs", lambda s: _outs_from_innings_pitched(s.get("inningsPitched")), 15.5),
    # Pitching-group gamelogs report hits/baseOnBalls as allowed, not
    # earned by the pitcher at bat — same field names as the batting
    # group, different meaning, because they come from a differently-
    # scoped fetch (get_people_with_game_logs(ids, 'pitching', season)).
    StatMarketDef("pitcher-hits-allowed", lambda s: _num0(s.get("hits")), 5.5),
    StatMarketDef("pitcher-walks-allowed", lambda s: _num0(s.get("baseOnBalls")), 1.5),
]

STAT_MARKET_BY_DIMENSION: dict[str, StatMarketDef] = {d.dimension: d for d in [*BATTER_STAT_MARKETS, *PITCHER_STAT_MARKETS]}
PITCHER_MARKET_DIMENSIONS = {d.dimension for d in PITCHER_STAT_MARKETS}

# Which team-stat rank a batter market reads matchup context from — always
# the opposing pitching staff's *against*-rank (what it allows).
BATTER_MARKET_TEAM_STAT: dict[str, str] = {
    "hit-in-game": "hits",
    "total-bases": "totalBases",
    "home-runs": "homeRuns",
    "rbis": "rbi",
    "runs": "runs",
    "walks": "baseOnBalls",
    "batter-strikeouts": "strikeOuts",
    "doubles": "doubles",
    "triples": "triples",
    "singles": "singles",
    "stolen-bases": "stolenBases",
    "hits-runs-rbis": "hits",
}

# The individual-starter equivalent, when a specific opposing starter is
# known and ranked. rbis/runs/doubles/triples/stolen-bases have no clean
# single-pitcher stat to point at, so they're absent — team rank is the
# honest signal for those.
BATTER_MARKET_PITCHER_STAT: dict[str, str] = {
    "hit-in-game": "hits",
    "total-bases": "hits",
    "home-runs": "barrelPct",
    "walks": "baseOnBalls",
    "batter-strikeouts": "strikeOuts",
    "singles": "hits",
    "hits-runs-rbis": "hits",
}

# Pitcher markets read the mirror image: the opposing lineup's for-rank.
# pitcher-outs has no team-level proxy (durability tracks the pitcher's
# own workload trend, not the opponent's) — deliberately absent.
PITCHER_MARKET_TEAM_STAT: dict[str, str] = {
    "pitcher-strikeouts": "strikeOuts",
    "earned-runs": "runs",
    "pitcher-hits-allowed": "hits",
    "pitcher-walks-allowed": "baseOnBalls",
}

# Below this Over rate, a rare-positive market's pattern is closer to
# base-rate noise than a real signal, and the candidate isn't generated at
# all. Shifts a few points either way based on the matchup.
RARE_EVENT_FLOOR = {"base": 0.25, "favorable_matchup": 0.2, "tough_matchup": 0.35}


# ---------------------------------------------------------------------------
# Matchup context — the once-per-snapshot league-wide rank tables
# ---------------------------------------------------------------------------


@dataclass
class PropMatchupContext:
    hitting_ranks: dict[int, dict[str, int]]
    allowed_ranks: dict[int, dict[str, int]]
    pitcher_ranks: dict[int, dict[str, int]]
    starts_by_pitcher_id: dict[int, int]
    league_rates: dict[str, float]
    home_run_model: db.ModelWeightsRow | None
    park_factor_cache: dict[int, float]
    # Live team HR-rate-allowed cache (predict/home_run_live_matchup.py).
    # None falls back to the neutral 0.11 league rate inline below, same
    # fallback the TS source's own optional-chaining applies when this
    # cache has never been refreshed for the season yet.
    hr_team_matchup_cache: TeamHrRateAllowedCache | None = None


async def build_snapshot_context(client: httpx.AsyncClient, season: int) -> PropMatchupContext:
    team_hitting, team_pitching, league_pitcher_stats = await asyncio.gather(
        statsapi.get_team_season_stats(client, season, "hitting"),
        statsapi.get_team_season_stats(client, season, "pitching"),
        statsapi.get_league_starting_pitcher_stats(client, season),
    )
    hitting_ranks = statsapi.rank_teams(team_hitting, True)
    allowed_ranks = statsapi.rank_teams(team_pitching, False, statsapi.PITCHING_RANK_INVERTED_KEYS)

    # Statcast quality metrics merged in on top of the traditional+FIP
    # stats — cache-only read, so a season nobody's ever refreshed
    # savant.py for yet just quietly contributes no Statcast columns
    # rather than blocking this call.
    statcast_rates = await savant.get_cached_statcast_pitcher_rates(season)
    for p in league_pitcher_stats:
        sc = statcast_rates.get(p.person_id)
        if sc:
            p.values = {**p.values, "whiffPct": sc.whiff_pct, "barrelPct": sc.barrel_pct, "exitVelo": sc.exit_velo, "hardHitPct": sc.hard_hit_pct}

    pitcher_ranks = statsapi.rank_pitchers(league_pitcher_stats)
    starts_by_pitcher_id = {p.person_id: p.games_started for p in league_pitcher_stats}

    league_rates = {r.dimension: r.rate for r in await db.league_base_rates("mlb")}
    home_run_model = await db.get_active_model_weights("mlb", "home-run")
    park_factor_rows = await db.read_park_factors(season)
    park_factor_cache = {r.venue_id: r.factor for r in park_factor_rows}
    # Cheap cached read (see home_run_live_matchup.py) — refreshed
    # periodically by its own job, not here; falls back to the neutral
    # league rate on its own if that's never been run yet for this season.
    hr_team_matchup_cache = await load_team_hr_rate_allowed_cache(season)

    return PropMatchupContext(
        hitting_ranks=hitting_ranks,
        allowed_ranks=allowed_ranks,
        pitcher_ranks=pitcher_ranks,
        starts_by_pitcher_id=starts_by_pitcher_id,
        league_rates=league_rates,
        home_run_model=home_run_model,
        park_factor_cache=park_factor_cache,
        hr_team_matchup_cache=hr_team_matchup_cache,
    )


def _rank_worth_showing(rank: int, pool_size: float) -> bool:
    """Only worth acting on in the extreme third of the pool — a middling
    rank says nothing either way. Percentile-based, not an absolute
    cutoff, since a 30-team pool and a ~180-starter pool need different
    absolute numbers to mean "bottom third"."""
    return rank > (pool_size * 2) / 3 or rank <= pool_size / 3


@dataclass
class MatchupResult:
    rank: int
    favorable: bool


def matchup_split(
    team_stat_key: str | None,
    pitcher_stat_key: str | None,
    side: str,  # 'against' | 'for'
    opponent_team_id: int,
    opposing_starter_id: int | None,
    ctx: PropMatchupContext,
) -> MatchupResult | None:
    """Prefers the specific opposing starter's own rank once they've
    thrown enough to mean something; otherwise falls back to the opposing
    team's whole-staff rank. Batter markets read the opponent's *against*
    rank; pitcher markets read the opponent's *for* rank."""
    if pitcher_stat_key and opposing_starter_id is not None:
        starts = ctx.starts_by_pitcher_id.get(opposing_starter_id, 0)
        if starts >= MIN_STARTS_FOR_PITCHER_RANK:
            pool_size = len(ctx.pitcher_ranks)
            rank = ctx.pitcher_ranks.get(opposing_starter_id, {}).get(pitcher_stat_key)
            if rank is not None and pool_size > 0 and _rank_worth_showing(rank, pool_size):
                # Always a batter market (only BATTER_MARKET_PITCHER_STAT
                # sets pitcher_stat_key). For stats where rank 1 = fewest
                # allowed, a *weak* pitcher (high rank number) is
                # favorable. For strikeouts — rank 1 = most recorded, the
                # pitcher causes the outcome rather than allowing it — a
                # *dominant* pitcher (low rank) is favorable instead.
                bad_pitcher_is_favorable = pitcher_stat_key in statsapi.PITCHER_RANK_LOWER_IS_BETTER
                favorable = rank > (pool_size * 2) / 3 if bad_pitcher_is_favorable else rank <= pool_size / 3
                return MatchupResult(rank=rank, favorable=favorable)

    if not team_stat_key:
        return None
    ranks = ctx.allowed_ranks if side == "against" else ctx.hitting_ranks
    rank = ranks.get(opponent_team_id, {}).get(team_stat_key)
    team_pool_size = 30  # MLB has exactly 30 teams
    if rank is None or not _rank_worth_showing(rank, team_pool_size):
        return None

    if side == "for":
        # Pitcher markets reading the opposing lineup's own output: more
        # of the stat is always favorable for the pitcher's over-prop.
        favorable = rank <= team_pool_size / 3
    else:
        # Batter markets reading the opposing pitching staff's
        # against-rank. Strikeouts is the one against-stat rank_teams
        # already flips (PITCHING_RANK_INVERTED_KEYS), so rank 1 there
        # means most Ks recorded, not fewest allowed.
        favorable = rank <= team_pool_size / 3 if team_stat_key in statsapi.PITCHING_RANK_INVERTED_KEYS else rank > (team_pool_size * 2) / 3

    return MatchupResult(rank=rank, favorable=favorable)


# ---------------------------------------------------------------------------
# History building
# ---------------------------------------------------------------------------


def stat_entry(split: statsapi.GameLogSplit, market_def: StatMarketDef) -> HistoryEntry:
    value = market_def.value_of(split.stat or {})
    over = value > market_def.line
    return HistoryEntry(category="over" if over else "under", opponent_id=split.opponent_id, is_home=split.is_home)


def hit_entry(split: statsapi.GameLogSplit) -> HistoryEntry:
    hits = _num0((split.stat or {}).get("hits"))
    got = hits > 0
    return HistoryEntry(category="hit" if got else "no-hit", opponent_id=split.opponent_id, is_home=split.is_home)


def over_rate_of(history: list[HistoryEntry]) -> float:
    if not history:
        return 0.0
    return sum(1 for h in history if h.category == "over") / len(history)


def _prob_for_category(over_prob: float | None, category: str) -> float | None:
    """Convert a P(over) into the probability of the proposition the candidate
    actually represents.

    Every model in this file computes P(over) — `compute_model_probability` is
    fed `over_count`, and the hit model is fed the count of "hit" outcomes. But
    a candidate becomes an "under"/"no-hit"/"no-run" whenever a player's entire
    game log sits on that side of the line, and before Phase 1.1 nothing
    flipped the probability to match. The stored number was then the
    probability of the proposition the user was NOT being shown — its exact
    complement.

    This was not a theory. Scoring the 36 graded under-side rows in
    pick_history against their own outcomes gave a Brier of 0.3756 as stored
    and 0.1956 flipped (audit finding P3 C3, re-verified 2026-08-28). A
    probability that scores far worse as-is than inverted is the probability of
    the other outcome.

    Reuses entity_resolution.candidate_category_to_side so the category->side
    rule lives in exactly one place — it already knows all six categories
    ("hit"/"run"/"over" vs "no-hit"/"no-run"/"under"), and a second copy here
    would be the thing that drifts.
    """
    if over_prob is None:
        return None
    return 1.0 - over_prob if candidate_category_to_side(category) == "under" else over_prob


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------


@dataclass
class CandidateResult:
    subject_id: str
    subject_name: str
    dimension: str
    category: str
    line: float
    game_id: str
    sample_size: int
    history: list[HistoryEntry]
    opponent_team_id: int | None
    model_prob: float | None
    model_std_dev: float | None
    model_sample_size: int | None
    league_rate: float | None
    matchup_favorable: bool | None
    model_version: int | None


def stat_market_candidates(
    person: statsapi.PersonStats,
    game_id: str,
    opponent_team_id: int,
    opposing_starter_id: int | None,
    lineup: list[int],
    lineup_projected: bool,
    venue_id: int | None,
    market_def: StatMarketDef,
    eligible: Callable[[statsapi.GameLogSplit], bool],
    role: str,  # 'batter' | 'pitcher'
    ctx: PropMatchupContext,
) -> CandidateResult | None:
    """Every generic counting-stat market shares this shape: filter
    eligible games, bucket by the line, resolve matchup + model
    probability."""
    full = [stat_entry(s, market_def) for s in person.game_log if eligible(s)]
    if not full:
        return None
    # Phase A's floor gate deliberately reads recent form, not
    # season-long average — a full-season rate would mask a real recent
    # change in usage.
    recent = full[-HISTORY_WINDOW:]

    matchup_side = "against" if role == "batter" else "for"
    if role == "batter":
        team_stat_key = BATTER_MARKET_TEAM_STAT.get(market_def.dimension)
        pitcher_stat_key = BATTER_MARKET_PITCHER_STAT.get(market_def.dimension)
    else:
        team_stat_key = PITCHER_MARKET_TEAM_STAT.get(market_def.dimension)
        pitcher_stat_key = None
    matchup = matchup_split(team_stat_key, pitcher_stat_key, matchup_side, opponent_team_id, opposing_starter_id, ctx)

    # Phase A: rare-positive markets need the Over rate to clear a real
    # bar, shifted by the matchup — otherwise every player "passes"
    # simply because the event is uncommon for everyone.
    if market_def.interest_side == "over":
        if matchup is None:
            floor = RARE_EVENT_FLOOR["base"]
        elif matchup.favorable:
            floor = RARE_EVENT_FLOOR["favorable_matchup"]
        else:
            floor = RARE_EVENT_FLOOR["tough_matchup"]
        if over_rate_of(recent) < floor:
            return None

    # Beta-Binomial model probability — real league rate for this market
    # plus this candidate's own full-season history. None when
    # pick_history has no graded rows for this market yet.
    league_rate = ctx.league_rates.get(market_def.dimension)
    recent10 = full[-10:]
    model = None
    if league_rate is not None:
        model = compute_model_probability(
            ModelProbabilityInput(
                dimension=market_def.dimension,
                league_rate=league_rate,
                over_count=sum(1 for e in full if e.category == "over"),
                total_count=len(full),
                matchup_favorable=matchup.favorable if matchup else None,
                recent_over_count=sum(1 for e in recent10 if e.category == "over"),
                recent_total_count=len(recent10),
            )
        )

    # Home Run model — only overrides model_prob when (a) this IS the
    # home-runs dimension, (b) a fitted version has actually beaten the
    # Beta-Binomial baseline on holdout, and (c) the plain Beta-Binomial
    # model above resolved at all. Falls through to the unmodified
    # model.prob otherwise.
    final_model_prob = model.prob if model else None
    home_run_model_version = None
    if market_def.dimension == "home-runs" and model is not None and ctx.home_run_model:
        fitted = ctx.home_run_model
        park_factor = ctx.park_factor_cache.get(venue_id, 1.0) if venue_id is not None else 1.0
        slot = (lineup.index(person.id) + 1) if person.id in lineup else 0

        if ctx.hr_team_matchup_cache is not None:
            team_hr_rate = ctx.hr_team_matchup_cache.rate_for(opponent_team_id)
            league_hr_rate_for_matchup = ctx.hr_team_matchup_cache.league_hr_rate
        else:
            team_hr_rate = 0.11
            league_hr_rate_for_matchup = 0.11

        blended = apply_fitted_home_run_weights(
            HomeRunFeatureInputs(
                beta_binomial_hr_prob=model.prob,
                park_hr_factor_centered=park_hr_factor_centered(park_factor),
                pitcher_matchup_signal=pitcher_matchup_signal(team_hr_rate, league_hr_rate_for_matchup),
                expected_pa_centered=expected_pa_centered(slot) if slot > 0 else 0.0,
            ),
            fitted.weights,
            fitted.intercept,
        )
        # Same discount as the FullCountProps-documented example — a
        # projected (not yet official) lineup slot doesn't guarantee this
        # batter actually starts.
        projected_lineup_start_probability = 0.9
        final_model_prob = apply_lineup_confidence(blended, projected_lineup_start_probability) if lineup_projected else blended
        home_run_model_version = fitted.version

    consistent = all(e.category == full[0].category for e in full)
    category = full[0].category if consistent else "over"

    return CandidateResult(
        subject_id=str(person.id),
        subject_name=person.full_name,
        dimension=market_def.dimension,
        category=category,
        line=market_def.line,
        game_id=game_id,
        sample_size=len(full),
        history=full,
        opponent_team_id=opponent_team_id,
        model_prob=_prob_for_category(final_model_prob, category),
        model_std_dev=model.std_dev if model else None,
        model_sample_size=model.sample_size if model else None,
        league_rate=league_rate,
        matchup_favorable=matchup.favorable if matchup else None,
        model_version=home_run_model_version,
    )


def hit_in_game_candidate(
    person: statsapi.PersonStats,
    game_id: str,
    opponent_team_id: int,
    opposing_starter_id: int | None,
    ctx: PropMatchupContext,
) -> CandidateResult | None:
    """Dimension: did this batter get a hit, game by game. Same opponent-
    difficulty mechanism every other market uses — 'hits'/'hits' are
    fixed keys here (not looked up from BATTER_MARKET_TEAM_STAT/
    BATTER_MARKET_PITCHER_STAT), matching adapter.ts's own hard-coded
    matchupSplit call for this one dimension."""
    full = [hit_entry(s) for s in person.game_log if _num0((s.stat or {}).get("atBats")) > 0 or _num0((s.stat or {}).get("plateAppearances")) > 0]
    if not full:
        return None

    matchup = matchup_split("hits", "hits", "against", opponent_team_id, opposing_starter_id, ctx)
    league_rate = ctx.league_rates.get("hit-in-game")
    recent10 = full[-10:]
    model = None
    if league_rate is not None:
        model = compute_model_probability(
            ModelProbabilityInput(
                dimension="hit-in-game",
                league_rate=league_rate,
                over_count=sum(1 for e in full if e.category == "hit"),
                total_count=len(full),
                matchup_favorable=matchup.favorable if matchup else None,
                recent_over_count=sum(1 for e in recent10 if e.category == "hit"),
                recent_total_count=len(recent10),
            )
        )

    consistent = all(e.category == full[0].category for e in full)
    category = full[0].category if consistent else "hit"

    return CandidateResult(
        subject_id=str(person.id),
        subject_name=person.full_name,
        dimension="hit-in-game",
        category=category,
        line=0.5,
        game_id=game_id,
        sample_size=len(full),
        history=full,
        opponent_team_id=opponent_team_id,
        model_prob=_prob_for_category(model.prob if model else None, category),
        model_std_dev=model.std_dev if model else None,
        model_sample_size=model.sample_size if model else None,
        league_rate=league_rate,
        matchup_favorable=matchup.favorable if matchup else None,
        model_version=None,
    )


# ---------------------------------------------------------------------------
# Today's slate -> every candidate
# ---------------------------------------------------------------------------


async def build_todays_candidates(client: httpx.AsyncClient, today: str, season: int, ctx: PropMatchupContext) -> list[CandidateResult]:
    """No status ('pre'/'live'/'done') gate — matches adapter.ts's own
    candidate loop, which generates candidates for every game on the
    slate regardless of state (unlike the game-model job's pre-game-only
    gate). A game already live or final by the time this runs simply
    won't be the first cycle to surface its candidates that day, and
    log_surfaced's first-surfaced-wins semantics make computing (but not
    re-locking) a value for it harmless."""
    slate = await statsapi.get_slate(client, today)
    if not slate:
        return []
    recent_lineup_games = await statsapi.get_recent_lineups(client, today, 4)
    recent_lineups = game_model_cache.build_recent_lineups(recent_lineup_games)

    games = []
    for game in slate:
        home = game_model_cache._make_side(game, "home", recent_lineups)
        away = game_model_cache._make_side(game, "away", recent_lineups)
        games.append((game, home, away))

    batter_ids = [pid for _, home, away in games for pid in (*home.lineup, *away.lineup)]
    pitcher_ids = [side.starter_id for _, home, away in games for side in (home, away) if side.starter_id]

    batters, pitchers = await asyncio.gather(
        statsapi.get_people_with_game_logs(client, batter_ids, "hitting", season),
        statsapi.get_people_with_game_logs(client, pitcher_ids, "pitching", season),
    )

    def batted_this_game(s: statsapi.GameLogSplit) -> bool:
        # Splits require a real plate appearance — a pinch-runner-only
        # game doesn't count as "0 total bases" for a player who didn't bat.
        return _num0((s.stat or {}).get("atBats")) > 0 or _num0((s.stat or {}).get("plateAppearances")) > 0

    def started(s: statsapi.GameLogSplit) -> bool:
        return _num0((s.stat or {}).get("gamesStarted")) > 0

    results: list[CandidateResult] = []
    for game, home, away in games:
        venue_id = (game.venue or {}).get("id")
        game_id = str(game.game_pk)

        for side, opponent_side in ((home, away), (away, home)):
            for batter_id in side.lineup:
                person = batters.get(batter_id)
                if not person:
                    continue

                hit = hit_in_game_candidate(person, game_id, opponent_side.team_id, opponent_side.starter_id, ctx)
                if hit:
                    results.append(hit)

                for market_def in BATTER_STAT_MARKETS:
                    c = stat_market_candidates(
                        person,
                        game_id,
                        opponent_side.team_id,
                        opponent_side.starter_id,
                        side.lineup,
                        side.lineup_projected,
                        venue_id,
                        market_def,
                        batted_this_game,
                        "batter",
                        ctx,
                    )
                    if c:
                        results.append(c)

            # Every dimension here only tracks starters (the fetch above
            # never pulls relievers), same "did this person start" filter.
            if side.starter_id:
                person = pitchers.get(side.starter_id)
                if person:
                    for market_def in PITCHER_STAT_MARKETS:
                        c = stat_market_candidates(
                            person,
                            game_id,
                            opponent_side.team_id,
                            None,
                            [],
                            False,
                            venue_id,
                            market_def,
                            started,
                            "pitcher",
                            ctx,
                        )
                        if c:
                            results.append(c)

    return results
