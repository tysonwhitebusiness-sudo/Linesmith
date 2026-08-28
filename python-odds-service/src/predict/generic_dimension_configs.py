"""Real per-sport DimensionConfig lists for generic_prop_score.py — all
six sports Phase 4's production job covers (NBA/NHL/NFL/CFB/Soccer-EPL/
Soccer-MLS). Every `dimension` string below is a real canonical market key
from entity_resolution.CANONICAL_MARKET_KEYS (not guessed —
resolve_candidate_edge can never find a live price for a dimension that
doesn't resolve to a real market key).

Rewritten 2026-08-27 (docs/daily-picks-full-model-build-2026-08-27.md
Phase 2) against `player_game_history`'s REAL stored keys, fetched live
from real games via backfill_player_game_history.py's own boxscore
parsers — NOT against ESPN's per-player common/v3 gamelog endpoint
(generic_player_gamelog.fetch_player_gamelog) this file originally
targeted. Those are two genuinely different ESPN endpoints with different
field-naming conventions for the same real stat; Phase 0's whole
architecture point is that every sport now reads player history from the
DB (the boxscore-parser shape) exclusively, so `espn_stat_name` here must
match THAT shape, not the old live-gamelog one. Three real, confirmed-live
mismatches were found doing this (nothing in production depended on the
old values yet — verified by grep — so fixing them here is a pure
correction, not a behavior change to anything live):
  - NBA rebounds: real key is "rebounds", not "totalRebounds".
  - NHL shots-on-goal: real key is "sog", not "shotsTotal".
  - NFL/CFB: every real key is CATEGORY-PREFIXED ("passing.passingYards",
    "rushing.rushingYards", ...) — backfill_player_game_history.py's
    parse_football groups stats by ESPN's own boxscore category the way
    parse_nba/parse_nhl/parse_soccer do not. The old values here
    ("passingYards" unprefixed) would have silently produced
    sample_size=0 for every single NFL player once Phase 4 repointed
    scoring at the DB.
Verified live per sport (see this session's own transcript): NBA event
401704627, NHL game 2024020705, NFL/CFB real player_game_history rows
already written by the in-progress historical backfill, EPL event 704481,
MLS event 761712/704481.

`line` on every entry below is a fallback-only default (see
DimensionConfig.line's own docstring in generic_prop_score.py) — real
production scoring resolves the actual live per-player line from
prop_odds first and only falls back to this when no live price exists.
These numbers are reasoned, real-world-shaped starting points, same
disclosed-guess status as this codebase's other hand-set v1 constants —
not fitted or validated against real outcome data.

No position filtering needed here: a dimension a given player's own
history doesn't have (e.g. a kicker has no passing-yards, a defender has
no shots) naturally produces zero history entries in build_candidate,
which already returns a clean no-candidate result (model_prob=None)
rather than fabricating anything — see generic_prop_score.py's own
early-return on total_count == 0.

Minutes/time-on-field floor for compute_league_rate: NBA's real key is
"minutes" (that function's own default). NHL's is "toiMinutes" — pass
minutes_stat_name="toiMinutes" wherever Phase 4 calls compute_league_rate
for NHL. Football (NFL/CFB) has no such field in ESPN's boxscore at all —
pass minutes_stat_name=None there (see compute_league_rate's own
docstring for why that's the correct floor-free behavior, not a gap).
Soccer's real "minutes" field doesn't exist either in the plain summary
endpoint used here (only isStarter/subIns/subbedInMinute) — also
minutes_stat_name=None; a starter/appeared player is already a real
participant, same reasoning as football.
"""
from predict.generic_prop_score import DimensionConfig

NBA_DIMENSIONS: list[DimensionConfig] = [
    DimensionConfig(dimension="points", espn_stat_name="points", line=20.5),
    DimensionConfig(dimension="rebounds", espn_stat_name="rebounds", line=6.5),
    DimensionConfig(dimension="assists", espn_stat_name="assists", line=4.5),
    DimensionConfig(dimension="steals", espn_stat_name="steals", line=1.5),
    DimensionConfig(dimension="blocks", espn_stat_name="blocks", line=1.5),
    DimensionConfig(dimension="turnovers", espn_stat_name="turnovers", line=2.5),
    # NOT included: three-pointers-made (a real canonical market key) — the
    # real stored key is threePointFieldGoalsMade (a plain number, not a
    # combo string, unlike the old gamelog endpoint) — addable, just not
    # verified end-to-end against a real prop line yet; left out rather
    # than added speculatively this pass.
    # NOT included: points-rebounds-assists / points-rebounds /
    # points-assists / rebounds-assists — real canonical market keys, but
    # derived sums, not a single raw stored field; history_entries() reads
    # a single g.stats[stat_name], so these need a real derived-stat step
    # in generic_prop_score.py before they can be wired, not attempted here.
]

NHL_DIMENSIONS: list[DimensionConfig] = [
    DimensionConfig(dimension="assists", espn_stat_name="assists", line=0.5),
    DimensionConfig(dimension="shots-on-goal", espn_stat_name="sog", line=2.5),
    # "goals" deliberately NOT here (Phase 5, 2026-08-27) — moved to the
    # rare-market pool (predict/generic_rare_markets.py's NHL_RARE),
    # admission-gated by RARE_EVENT_FLOOR, so the same real bet never
    # surfaces in both the regular player-props tab and the rare-markets
    # one.
    # NOT included: blocked-shots — real canonical market key, and the
    # real stored key (blockedShots) IS present in player_game_history
    # (unlike the old live-gamelog endpoint, which lacked it) — addable,
    # just not verified end-to-end against a real prop line yet.
    # NOT included: goals-against — goalie-specific, not a skater stat;
    # would need a separate goalie-only candidate path.
]

NFL_DIMENSIONS: list[DimensionConfig] = [
    DimensionConfig(dimension="passing-yards", espn_stat_name="passing.passingYards", line=224.5),
    DimensionConfig(dimension="passing-tds", espn_stat_name="passing.passingTouchdowns", line=1.5),
    DimensionConfig(dimension="interceptions-thrown", espn_stat_name="passing.interceptions", line=0.5),
    DimensionConfig(dimension="passing-completions", espn_stat_name="passing.completions", line=21.5),
    DimensionConfig(dimension="pass-attempts", espn_stat_name="passing.passingAttempts", line=32.5),
    DimensionConfig(dimension="rushing-yards", espn_stat_name="rushing.rushingYards", line=44.5),
    DimensionConfig(dimension="rushing-tds", espn_stat_name="rushing.rushingTouchdowns", line=0.5),
    DimensionConfig(dimension="rushing-attempts", espn_stat_name="rushing.rushingAttempts", line=12.5),
    DimensionConfig(dimension="receiving-yards", espn_stat_name="receiving.receivingYards", line=44.5),
    DimensionConfig(dimension="receptions", espn_stat_name="receiving.receptions", line=3.5),
    DimensionConfig(dimension="receiving-tds", espn_stat_name="receiving.receivingTouchdowns", line=0.5),
]

# CFB shares the exact same real canonical market keys and the exact same
# category-prefixed field shape as NFL (both use
# backfill_player_game_history.py's parse_football) — confirmed live
# against a real 2024 CFB game (event 401628384), same category names
# (passing.*/rushing.*/receiving.*) present. One entry list, not a
# separate derivation.
CFB_DIMENSIONS: list[DimensionConfig] = list(NFL_DIMENSIONS)

SOCCER_DIMENSIONS: list[DimensionConfig] = [
    DimensionConfig(dimension="assists", espn_stat_name="goalAssists", line=0.5),
    DimensionConfig(dimension="shots", espn_stat_name="totalShots", line=1.5),
    DimensionConfig(dimension="shots-on-target", espn_stat_name="shotsOnTarget", line=0.5),
    DimensionConfig(dimension="yellow-cards", espn_stat_name="yellowCards", line=0.5),
    DimensionConfig(dimension="saves", espn_stat_name="saves", line=2.5),
    # NOT included: goals-assists — a derived sum (goals + assists), same
    # gap as NBA's combo dimensions; needs a real derived-stat step, not
    # attempted here. "goals" alone is deliberately excluded from this
    # regular player-props pool too — it's Phase 5's rare-market
    # "anytime-goalscorer" dimension instead (RARE_EVENT_FLOOR-gated),
    # same reasoning NHL's "goals" moves out of NHL_DIMENSIONS for.
    # NOT included: tackles, passes-attempted, dribbles-attempted,
    # crosses-attempted — real canonical market keys, but confirmed live
    # NOT present anywhere in ESPN's soccer summary endpoint's real
    # payload (checked two full real games, EPL event 704481 and MLS
    # event 761712 — every distinct stat key present enumerated, none of
    # these four appear for any player in either). A real data gap, not
    # an oversight; these markets have no scoreable dimension until a
    # richer soccer stats source exists.
]
