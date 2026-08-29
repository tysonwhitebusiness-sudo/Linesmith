"""Phase 4.10 — the generic sports can surface an UNDER.

Audit finding P3 M12: "The five generic sports can only ever surface 'over'
picks — a structural bias in candidate generation, not a modelling choice."

It was literally a hardcoded string in two places: `build_candidate` passed
"over" to the edge resolver and the good-bet signals, and
`_candidate_to_entry` wrote `category="over"` regardless. Since
`pick_history`'s uniqueness key is
(sport, subject_id, dimension, category, game_id), that second one meant an
under could not be STORED even if one had been generated.

The under's probability is the complement of the over's — the same rule Phase
1.1 established for MLB in `prop_candidates._prob_for_category`, whose bug was
a candidate whose proposition was the under carrying the OVER's probability.
This must not reintroduce that for the generic sports, so it is asserted
directly below.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_both_sides.py
"""
import sys

sys.path.insert(0, "src")

from predict.generic_player_gamelog import PlayerGameStat  # noqa: E402
from predict.generic_prop_score import DimensionConfig, build_candidate  # noqa: E402

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def close(label: str, actual, expected, eps: float = 1e-9) -> None:
    global _failures
    ok = actual is not None and abs(actual - expected) < eps
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want ~{expected})"))


CFG = DimensionConfig(dimension="points", espn_stat_name="points", line=10.5)


def _games(points_each: float, n: int = 20):
    return [
        PlayerGameStat(
            event_id=str(i), game_date=f"2026-01-{i % 28 + 1:02d}", opponent_id="opp",
            is_home=i % 2 == 0, stats={"points": points_each, "minutes": 30.0},
        )
        for i in range(n)
    ]


def _build(games, category):
    return build_candidate(
        games, CFG, league_rate=0.5, subject_id="a1",
        prop_rows=None, user_sportsbook="Fanatics", category=category,
    )


def test_both_sides_can_be_built():
    print("\n4.10: an under candidate can be built at all")
    games = _games(2.0)  # always well under 10.5
    over = _build(games, "over")
    under = _build(games, "under")
    check("the over candidate reports its side", over.category, "over")
    check("the under candidate reports its side", under.category, "under")
    check("both produced a model probability",
          over.model_prob is not None and under.model_prob is not None, True)


def test_under_probability_is_the_complement():
    """Phase 1.1's bug, guarded: an under must NOT carry the over's number."""
    print("\n4.10: P(under) is exactly 1 - P(over)")
    for pts in (2.0, 20.0):
        games = _games(pts)
        over = _build(games, "over")
        under = _build(games, "under")
        close(f"points={pts}: complements sum to 1", over.model_prob + under.model_prob, 1.0)
        check(f"points={pts}: they are not the same number",
              over.model_prob != under.model_prob, True)


def test_the_side_the_player_actually_hits_scores_higher():
    """A player who never clears the line should make the UNDER the better
    candidate, and vice versa. This is the whole point — before, the under was
    unreachable no matter what the history said."""
    print("\n4.10: the model prefers the side the history supports")
    never = _games(2.0)   # never over 10.5
    always = _games(30.0)  # always over 10.5

    check("a player who never clears it: under has the higher probability",
          _build(never, "under").model_prob > _build(never, "over").model_prob, True)
    check("a player who always clears it: over has the higher probability",
          _build(always, "over").model_prob > _build(always, "under").model_prob, True)


def test_the_better_side_wins_the_selection():
    """Mirrors the production loop's choice, including its tie-break. Both
    sides are generated and the better-scoring one is kept — surfacing both
    would recommend a proposition and its exact opposite."""
    print("\n4.10: generation keeps the better-scoring side")

    def pick(games):
        sided = [_build(games, s) for s in ("over", "under")]
        scored = [c for c in sided if c.score is not None]
        if not scored:
            return sided[0]
        return max(scored, key=lambda c: (c.score.score, c.category == "over"))

    check("never clears the line -> under is selected", pick(_games(2.0)).category, "under")
    check("always clears the line -> over is selected", pick(_games(30.0)).category, "over")


def test_zero_sample_still_reports_its_side():
    print("\n4.10: an empty-sample candidate still names its side")
    for side in ("over", "under"):
        c = _build([], side)
        check(f"{side}: category preserved", c.category, side)
        check(f"{side}: no probability invented", c.model_prob, None)


def main() -> bool:
    test_both_sides_can_be_built()
    test_under_probability_is_the_complement()
    test_the_side_the_player_actually_hits_scores_higher()
    test_the_better_side_wins_the_selection()
    test_zero_sample_still_reports_its_side()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
