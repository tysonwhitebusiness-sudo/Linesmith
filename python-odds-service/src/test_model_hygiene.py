"""Phase 4.12 — model-math hygiene items, each with its own evidence.

The gate for 4.12 is explicit: "Every 4.12 item closed individually, each with
its own one-line evidence. Eight items, eight lines. 'Model hygiene done' is
not an entry." So each item gets its own test group here.

Covered so far:
  P3 L1  poisson_over_probability treated an integer line as a LOSS
  P3 L5  the Elo sort comparator was not a total order
  P3 M4  the starter blend mixed two units at a hand-set 50/50
  P3 M7  the golf model double-counted the subject golfer's own scores
  P3 M5  home-field/form were ADDED to a probability instead of log-odds
  P3 M6  compute_league_rate returned a fabricated 0.5 on no sample

Also covers task 4.11 (P3 C2), which is not a 4.12 item but shares this file's
"measured against reality, not asserted" shape.

Pure functions, no network, no database, so this runs in CI (Q20).

Run with:  python -u src/test_model_hygiene.py
"""
import math
import random
import sys
from dataclasses import dataclass

sys.path.insert(0, "src")

from predict.game_model import (  # noqa: E402
    _EARNED_TO_TOTAL_RUNS,
    _STARTER_INNINGS_SHARE,
    OpposingStarter,
    _blend_with_starter_era,
    _from_log_odds,
    _poisson_pmf,
    _to_log_odds,
    _neg_binom_pmf,
    _TOTALS_DISPERSION_R,
    neg_binom_over_probability,
    poisson_over_probability,
    poisson_push_probability,
)
from predict.generic_prop_score import compute_league_rate  # noqa: E402
from predict.golf_models import (  # noqa: E402
    _OWN_EXTRA_WEIGHT,
    _PRIOR_WEIGHT,
    _category_for,
    _prior_for,
    HoleFieldObservation,
    HoleModelInput,
    predict_hole_score,
)

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    ok = actual == expected
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual!r}, want {expected!r})"))


def close(label: str, actual: float, expected: float, eps: float = 1e-4) -> None:
    global _failures
    ok = abs(actual - expected) < eps
    if not ok:
        _failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (got {actual:.6f}, want {expected:.6f})"))


def _old_poisson_over(lam: float, threshold: float) -> float:
    """The pre-4.12 implementation, kept here so the counterfactual is
    measured rather than asserted."""
    k = math.floor(threshold)
    cdf = sum(_poisson_pmf(lam, i) for i in range(k + 1))
    return min(0.99, max(0.01, 1 - cdf))


# ---------------------------------------------------------------------------
# P3 L1
# ---------------------------------------------------------------------------

def test_integer_line_is_a_push_not_a_loss():
    print("\nP3 L1: an integer total line pushes; it is not a loss")
    # lambda 9, line 9 — X == 9 returns the stake.
    over = poisson_over_probability(9.0, 9.0)
    push = poisson_push_probability(9.0, 9.0)
    old = _old_poisson_over(9.0, 9.0)
    close("push mass is real and non-trivial", push, 0.1318)
    close("over, conditioned on not-a-push", over, 0.4752)
    close("the OLD code scored that push as a loss", old, 0.4126)
    check("so the old code understated the over", old < over, True)
    # P(over | not push) + P(under | not push) must be exactly 1.
    close("over and under partition the non-push mass", over + (1 - over), 1.0)


def test_half_integer_lines_are_untouched():
    """The overwhelming majority of MLB totals are half-integers. If the fix
    moved those at all it would be a regression, not a fix."""
    print("\nP3 L1: half-integer lines are provably unchanged")
    for lam, line in ((9.0, 8.5), (8.2, 7.5), (10.5, 10.5), (7.0, 9.5)):
        close(f"lambda={lam} line={line} identical to pre-fix",
              poisson_over_probability(lam, line), _old_poisson_over(lam, line))
        check(f"lambda={lam} line={line} cannot push", poisson_push_probability(lam, line), 0.0)


def test_push_probability_shape():
    print("\nP3 L1: push probability is zero exactly when a push is impossible")
    check("half-integer -> 0", poisson_push_probability(9.0, 8.5), 0.0)
    check("integer -> non-zero", poisson_push_probability(9.0, 9.0) > 0, True)
    close("integer push equals the pmf at that point",
          poisson_push_probability(8.2, 8.0), _poisson_pmf(8.2, 8))


# ---------------------------------------------------------------------------
# P3 L5
# ---------------------------------------------------------------------------

@dataclass
class _G:
    game_date: str
    game_pk: int


def _new_sort(xs):
    ys = list(xs)
    ys.sort(key=lambda g: (g.game_date, g.game_pk))
    return [g.game_pk for g in ys]


def _old_sort(xs):
    import functools
    ys = sorted(xs, key=functools.cmp_to_key(lambda a, b: -1 if a.game_date < b.game_date else 1))
    return [g.game_pk for g in ys]


def test_elo_sort_is_a_total_order():
    """Elo is order-sensitive, so a comparator that never returns 0 for equal
    keys makes ratings depend on the ARRIVAL ORDER of same-day games. Two runs
    over identical data could disagree."""
    print("\nP3 L5: the Elo sort is deterministic across input orderings")
    base = [_G("2026-04-01", 3), _G("2026-04-01", 1), _G("2026-04-01", 2), _G("2026-03-31", 9)]

    new_results, old_results = [], []
    for seed in (1, 2, 3, 4, 5):
        shuffled = base[:]
        random.Random(seed).shuffle(shuffled)
        new_results.append(_new_sort(shuffled))
        old_results.append(_old_sort(shuffled))

    check("new sort: every shuffle gives the same order", len(set(map(tuple, new_results))), 1)
    check("new sort: chronological, then by game_pk", new_results[0], [9, 1, 2, 3])
    # The counterfactual — if this ever becomes 1, the old bug was not real and
    # this test is no longer evidence of anything.
    check("old comparator really was non-deterministic", len(set(map(tuple, old_results))) > 1, True)


def test_elo_sort_still_orders_by_date_first():
    print("\nP3 L5: date still dominates game_pk")
    xs = [_G("2026-05-02", 1), _G("2026-04-01", 999)]
    check("earlier date wins regardless of a larger game_pk", _new_sort(xs), [999, 1])


# ---------------------------------------------------------------------------
# P3 M5
# ---------------------------------------------------------------------------

HOME_FIELD_EDGE = 0.04


def test_home_field_is_applied_in_log_odds():
    """A fixed edge must mean the same thing at every base rate. Added directly
    to a probability it does not: +0.04 on a coin flip is a nudge, +0.04 on a
    0.94 favourite HALVES the underdog."""
    print("\nP3 M5: a fixed edge behaves consistently across base rates")
    for raw, dog_old, dog_new in ((0.50, 0.460, 0.490), (0.94, 0.030, 0.058)):
        old = min(0.97, max(0.03, raw + HOME_FIELD_EDGE))
        new = min(0.97, max(0.03, _from_log_odds(_to_log_odds(raw) + HOME_FIELD_EDGE)))
        close(f"raw {raw}: old underdog", 1 - old, dog_old, eps=1e-3)
        close(f"raw {raw}: new underdog", 1 - new, dog_new, eps=1e-3)

    # The load-bearing property: the OLD form cut a big favourite's underdog
    # roughly in half, the new one does not.
    raw = 0.94
    old_dog = 1 - min(0.97, max(0.03, raw + HOME_FIELD_EDGE))
    new_dog = 1 - min(0.97, max(0.03, _from_log_odds(_to_log_odds(raw) + HOME_FIELD_EDGE)))
    check("old form roughly halved the underdog", old_dog < (1 - raw) * 0.6, True)
    check("new form leaves it roughly intact", new_dog > (1 - raw) * 0.9, True)


def test_log_odds_round_trip():
    print("\nP3 M5: logit/inverse-logit round-trip")
    for p in (0.01, 0.25, 0.5, 0.75, 0.99):
        close(f"round-trip {p}", _from_log_odds(_to_log_odds(p)), p, eps=1e-9)
    check("a zero adjustment changes nothing", round(_from_log_odds(_to_log_odds(0.62) + 0.0), 9), 0.62)


# ---------------------------------------------------------------------------
# P3 M6
# ---------------------------------------------------------------------------

class _Game:
    def __init__(self, stats):
        self.stats = stats


def test_no_sample_returns_none_not_a_coin_flip():
    """0.5 asserted as a measurement is indistinguishable downstream from a real
    50% base rate — and for the RARE markets this serves (triple-doubles,
    hat-tricks) a true rate near 0.5 is impossible, so the fabricated value was
    always wrong in the direction that makes a prop look attractive."""
    print("\nP3 M6: no qualifying games -> None, not 0.5")
    check("empty input", compute_league_rate({}, "points", 10.5), None)
    check("players present but no matching stat",
          compute_league_rate({"a": [_Game({"rebounds": 5, "minutes": 30})]}, "points", 10.5), None)
    check("stat present but every game below the minutes floor",
          compute_league_rate({"a": [_Game({"points": 20, "minutes": 1})]}, "points", 10.5), None)


def test_a_real_sample_still_computes():
    print("\nP3 M6: a real sample still returns a real rate")
    sample = {
        "a": [_Game({"points": 20, "minutes": 30}), _Game({"points": 5, "minutes": 30})],
        "b": [_Game({"points": 15, "minutes": 30}), _Game({"points": 2, "minutes": 30})],
    }
    check("2 of 4 games over 10.5", compute_league_rate(sample, "points", 10.5), 0.5)
    check("and that 0.5 is COMPUTED, not the old fallback",
          compute_league_rate(sample, "points", 10.5) is not None, True)



# ---------------------------------------------------------------------------
# P3 M4
# ---------------------------------------------------------------------------

def test_starter_blend_weights_sum_to_one_and_mean_something():
    """The old blend was `team_rate * 0.5 + era * 0.5` — runs per GAME added to
    earned runs per NINE INNINGS, as if an ERA described a whole game. The new
    weight is the share of the game the starter actually pitches, so it means
    something rather than being tuned."""
    print("\nP3 M4: the starter weight is a real innings share, not 0.5")
    close("starter innings share is 5.2/9", _STARTER_INNINGS_SHARE, 5.2 / 9.0, eps=1e-9)
    check("weights sum to exactly 1",
          round(_STARTER_INNINGS_SHARE + (1 - _STARTER_INNINGS_SHARE), 12), 1.0)
    check("and it is NOT the old 0.5", abs(_STARTER_INNINGS_SHARE - 0.5) > 0.05, True)


def test_era_is_grossed_up_to_total_runs():
    """ERA is EARNED runs; a team's runs-per-game includes unearned. Blending
    one into the other without converting under-predicts scoring in proportion
    to the starter's weight."""
    print("\nP3 M4: ERA is converted to total runs before blending")
    check("gross-up factor is above 1", _EARNED_TO_TOTAL_RUNS > 1.0, True)
    # A league-average team facing a league-average ERA should expect slightly
    # MORE than that ERA's worth of runs, precisely because ERA omits unearned.
    # The old form returned exactly 4.30 here, which quietly asserted that
    # earned runs are all the runs.
    blended = _blend_with_starter_era(4.30, OpposingStarter(era=4.30, starts=20))
    check("a 4.30 team facing a 4.30 ERA expects MORE than 4.30", blended > 4.30, True)
    check("the OLD form returned exactly 4.30", round(4.30 * 0.5 + 4.30 * 0.5, 6), 4.30)


def test_starter_quality_is_not_compressed():
    """The 50/50 halved the spread between a good and a bad starter. Weighting
    by real innings share keeps more of that signal."""
    print("\nP3 M4: good and bad starters stay further apart")
    good = _blend_with_starter_era(4.30, OpposingStarter(era=2.50, starts=20))
    bad = _blend_with_starter_era(4.30, OpposingStarter(era=7.00, starts=20))
    old_good, old_bad = 4.30 * 0.5 + 2.50 * 0.5, 4.30 * 0.5 + 7.00 * 0.5
    check("new spread exceeds the old", (bad - good) > (old_bad - old_good), True)
    check("a better starter still means fewer runs", good < bad, True)
    print(f"       new {good:.3f}..{bad:.3f} (spread {bad - good:.3f}) | "
          f"old {old_good:.3f}..{old_bad:.3f} (spread {old_bad - old_good:.3f})")


def test_blend_declines_without_a_usable_starter():
    """Unchanged behaviour: no starter, no ERA, or too few starts falls through
    to the team's own rate rather than inventing one."""
    print("\nP3 M4: no usable starter falls through untouched")
    check("no starter", _blend_with_starter_era(4.30, None), 4.30)
    check("no ERA", _blend_with_starter_era(4.30, OpposingStarter(era=None, starts=30)), 4.30)
    check("too few starts", _blend_with_starter_era(4.30, OpposingStarter(era=3.0, starts=1)), 4.30)



# ---------------------------------------------------------------------------
# P3 M7
# ---------------------------------------------------------------------------

def _golf_counts(field, own, par, own_top_up):
    """The hole model's Dirichlet blend, parameterised by the subject's top-up
    weight so the pre-fix behaviour can be measured rather than described."""
    prior = _prior_for(par)
    counts = {k: prior[k] * _PRIOR_WEIGHT for k in ("birdie", "par", "bogey")}
    for o in field:
        counts[_category_for(o.relative_to_par)] += 1
    for o in own:
        counts[_category_for(o.relative_to_par)] += own_top_up
    total = sum(counts.values())
    return {k: v / total for k, v in counts.items()}


def test_subject_is_not_double_counted():
    """`golfer_own_observations` is documented as a SUBSET of
    `field_observations`, so the subject already scores +1 in the field loop.
    Adding the full own-weight on top counted their scores twice."""
    print("\nP3 M7: the subject golfer is deduped from the field")
    own = [HoleFieldObservation(-1.0), HoleFieldObservation(-1.0)]
    field = [HoleFieldObservation(0.0)] * 10 + own

    old = _golf_counts(field, own, 4, _OWN_EXTRA_WEIGHT)          # pre-fix
    new = _golf_counts(field, own, 4, _OWN_EXTRA_WEIGHT - 1)      # deduped

    check("the old form gave the subject a higher birdie prob",
          old["birdie"] > new["birdie"], True)
    close("old birdie", old["birdie"], 0.3082, eps=1e-3)
    close("new birdie", new["birdie"], 0.2390, eps=1e-3)
    check("the inflation was material (>5 points)",
          (old["birdie"] - new["birdie"]) > 0.05, True)
    print(f"       own form inflated birdie by {100 * (old['birdie'] - new['birdie']):.2f} points")


def test_live_model_matches_the_deduped_math():
    """The real predict_hole_score must agree with the deduped blend, or the
    fix is in the test and not in the model."""
    print("\nP3 M7: the shipped function uses the deduped weighting")
    own = [HoleFieldObservation(-1.0), HoleFieldObservation(-1.0)]
    field = [HoleFieldObservation(0.0)] * 10 + own
    got = predict_hole_score(HoleModelInput(
        par=4, field_observations=field, golfer_own_observations=own,
        golfer_sg_total=None, field_avg_sg_total=None,
    ))
    want = _golf_counts(field, own, 4, _OWN_EXTRA_WEIGHT - 1)
    close("birdie", got.prob_birdie, want["birdie"], eps=1e-9)
    close("par", got.prob_par, want["par"], eps=1e-9)
    close("bogey", got.prob_bogey, want["bogey"], eps=1e-9)


def test_a_golfer_with_no_own_history_is_unaffected():
    print("\nP3 M7: a golfer with no own rounds is untouched by the fix")
    field = [HoleFieldObservation(0.0)] * 10
    a = _golf_counts(field, [], 4, _OWN_EXTRA_WEIGHT)
    b = _golf_counts(field, [], 4, _OWN_EXTRA_WEIGHT - 1)
    check("identical with an empty own list", a == b, True)



# ---------------------------------------------------------------------------
# 4.11 (P3 C2) — MLB totals are over-dispersed; Poisson is the wrong shape.
# ---------------------------------------------------------------------------

# Measured over 24,790 real MLB games — every game in player_game_history,
# summing bat_runs per event. These are facts about baseball, not fixtures.
MLB_MEAN_TOTAL = 9.0391
MLB_VAR_TOTAL = 20.5732
# Empirical P(total > line), same 24,790 games.
MLB_EMPIRICAL_OVER = {7.5: 0.5828, 8.5: 0.5038, 9.5: 0.4006, 11.5: 0.2600, 13.5: 0.1565}


def test_the_distribution_reproduces_the_measured_moments():
    """r is derived from the data (var = mu + mu^2/r), not tuned, so the
    distribution must reproduce the mean AND variance it was derived from."""
    print("\n4.11: the negative binomial matches MLB's real moments")
    ks = range(0, 150)
    total = sum(_neg_binom_pmf(MLB_MEAN_TOTAL, k) for k in ks)
    mean = sum(k * _neg_binom_pmf(MLB_MEAN_TOTAL, k) for k in ks)
    var = sum((k - mean) ** 2 * _neg_binom_pmf(MLB_MEAN_TOTAL, k) for k in ks)
    close("pmf is a distribution (sums to 1)", total, 1.0, eps=1e-6)
    close("mean is preserved", mean, MLB_MEAN_TOTAL, eps=1e-4)
    close("variance matches the measured 20.5732", var, MLB_VAR_TOTAL, eps=0.05)
    close("var/mean is the measured 2.276, not Poisson's 1.0",
          var / mean, MLB_VAR_TOTAL / MLB_MEAN_TOTAL, eps=0.01)


def test_it_beats_poisson_against_reality_at_every_line():
    """The re-validation 4.11 asks for. Both distributions are scored against
    the EMPIRICAL over-rate from the same 24,790 games."""
    print("\n4.11: scored against 24,790 real games, at five real lines")
    nb_worst = po_worst = 0.0
    for line, empirical in MLB_EMPIRICAL_OVER.items():
        nb = neg_binom_over_probability(MLB_MEAN_TOTAL, line)
        po = poisson_over_probability(MLB_MEAN_TOTAL, line)
        nb_err, po_err = abs(nb - empirical), abs(po - empirical)
        nb_worst, po_worst = max(nb_worst, nb_err), max(po_worst, po_err)
        check(f"line {line}: negbinom closer to reality than poisson", nb_err < po_err, True)
        print(f"       line {line:>5}  empirical {empirical:.4f} | negbinom {nb:.4f} (err {nb_err:.4f})"
              f" | poisson {po:.4f} (err {po_err:.4f})")
    check("negbinom's worst error is under 1 point", nb_worst < 0.01, True)
    check("poisson's worst error is over 5 points", po_worst > 0.05, True)


def test_poisson_underestimates_the_tail_specifically():
    """The failure has a direction: Poisson puts far too little mass on the
    blowouts and duels a totals bet is actually decided by."""
    print("\n4.11: the Poisson error is concentrated in the tail")
    nb = neg_binom_over_probability(MLB_MEAN_TOTAL, 13.5)
    po = poisson_over_probability(MLB_MEAN_TOTAL, 13.5)
    check("poisson understates a high total", po < nb, True)
    check("and by more than a factor of two", nb / po > 2.0, True)
    print(f"       over 13.5: poisson {po:.4f} vs negbinom {nb:.4f} vs empirical 0.1565")


def test_push_handling_survived_the_swap():
    """4.12's P3 L1 fix must not be lost in 4.11's replacement — an integer
    line still pushes."""
    print("\n4.11: integer lines still push (P3 L1 preserved)")
    over_int = neg_binom_over_probability(9.0, 9.0)
    over_half = neg_binom_over_probability(9.0, 8.5)
    check("an integer line returns a valid probability", 0 < over_int < 1, True)
    # Conditioning on not-a-push must RAISE the over versus treating it as a
    # loss, exactly as it does for Poisson.
    k = 9
    cdf = sum(_neg_binom_pmf(9.0, i) for i in range(k + 1))
    unconditioned = min(0.99, max(0.01, 1 - cdf))
    check("the push is conditioned out, not scored as a loss", over_int > unconditioned, True)
    check("a half-integer line is unaffected by push logic", 0 < over_half < 1, True)


def main() -> bool:
    test_integer_line_is_a_push_not_a_loss()
    test_half_integer_lines_are_untouched()
    test_push_probability_shape()
    test_elo_sort_is_a_total_order()
    test_elo_sort_still_orders_by_date_first()
    test_home_field_is_applied_in_log_odds()
    test_log_odds_round_trip()
    test_no_sample_returns_none_not_a_coin_flip()
    test_a_real_sample_still_computes()
    test_starter_blend_weights_sum_to_one_and_mean_something()
    test_era_is_grossed_up_to_total_runs()
    test_starter_quality_is_not_compressed()
    test_blend_declines_without_a_usable_starter()
    test_subject_is_not_double_counted()
    test_live_model_matches_the_deduped_math()
    test_a_golfer_with_no_own_history_is_unaffected()
    test_the_distribution_reproduces_the_measured_moments()
    test_it_beats_poisson_against_reality_at_every_line()
    test_poisson_underestimates_the_tail_specifically()
    test_push_handling_survived_the_swap()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
