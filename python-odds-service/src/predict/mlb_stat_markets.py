"""The MLB player-prop market map in live-feed form: for each market, which
field of an MLB Stats API box-score stat group carries it, and what the
standard line is.

**Phase 1.1 (2026-09-06)** — extracted from `prop_candidates.py`, which was
deleted along with the rest of the condemned scoring layer. This block was
the one part of that file with a life of its own: it is a data table, not
model arithmetic, and `mlb_prop_grading.py` needs it to know which stat to
read out of a finished game for each market it grades.

Not a duplicate of `mlb_props.py`'s `MARKETS`, and the two should not be
merged. `mlb_props.MarketSpec` is SQL — expressions evaluated inside
Postgres against `player_game_history.stats` for the walk-forward fit.
`StatMarketDef` below is a Python callable applied to a live-feed stat dict
fetched per game. Same markets, two genuinely different evaluation
contexts; collapsing them would mean one of the two callers doing its work
in the wrong place.

Originally a direct port of `lib/sports/mlb/adapter.ts`'s
BATTER_STAT_MARKETS / PITCHER_STAT_MARKETS / STAT_MARKET_BY_DIMENSION.
"""
from dataclasses import dataclass
from typing import Callable


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
