"""predict/tennis_elo.py — the Phase 2.2 rating engine.

Pure and deterministic, so every property below is checkable without a database.
The ones worth having are not "Elo goes up when you win" — they are the four
design decisions, each of which would fail SILENTLY if it regressed:

  keying on (sport, name), which is what makes Phase 2.1's 8 cross-tour
  collisions harmless;
  no home advantage, which an arbitrary column order must not acquire;
  per-surface blend weights actually differing per surface;
  and reversion by elapsed time, including the infinite-idle case that makes a
  first-ever match on a surface price off the overall rating.

Plus the one that protects the whole backtest: replay() must refuse
out-of-order input, because scoring a match on ratings that already contain its
result is the failure the walk-forward exists to prevent.

Run with:  python test_tennis_elo.py
"""
import sys
from datetime import date

from predict import tennis_elo as te

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def close(label: str, actual: float, expected: float, tol: float = 1e-6) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"  PASS  {label}  ({actual:.4f})")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual:.6f}, expected {expected:.6f}")


D = date(2020, 6, 1)


def test_expectation() -> None:
    print("\nthe Elo expectation itself")
    close("equal ratings are a coin flip", te.expected_win_prob(1500, 1500), 0.5)
    close("400 points is 10:1", te.expected_win_prob(1900, 1500), 10 / 11, 1e-6)
    close("it is symmetric",
          te.expected_win_prob(1600, 1500) + te.expected_win_prob(1500, 1600), 1.0)


def test_no_home_advantage() -> None:
    print("\nNO home advantage — column order must not become a bonus")
    # Measured: the 'home' player wins 50.3% of 56,386 matches, 1.4 SE off a coin
    # flip. Two identical players must price at exactly 0.5 either way round.
    e = te.TennisElo()
    p1 = e.predict("tennis_atp", "A", "B", "Hard", D)
    p2 = e.predict("tennis_atp", "B", "A", "Hard", D)
    close("identical players price at 0.500", p1, 0.5)
    close("and swapping sides changes nothing", p2, 0.5)


def test_keying_is_by_tour() -> None:
    print("\nKEYING on (sport, name) — what makes 2.1's 8 collisions harmless")
    e = te.TennisElo()
    # `Trevisan M.` is a real ATP player AND a real WTA player. Phase 2.1 found
    # 136 player-slots under that one name. Rating them together would blend two
    # unrelated careers into one number.
    e.update("tennis_atp", "Trevisan M.", "Opponent X", "Hard", D, home_won=True)
    atp = e.state("tennis_atp", "Trevisan M.").overall
    wta = e.state("tennis_wta", "Trevisan M.").overall
    check("the ATP rating moved", atp > te.STARTING_ELO, True)
    check("the WTA rating of the same NAME is untouched", wta, te.STARTING_ELO)
    check("they are genuinely separate keys",
          te.TennisElo.key("tennis_atp", "Trevisan M.") ==
          te.TennisElo.key("tennis_wta", "Trevisan M."), False)
    check("the key trims whitespace so ' Fery A.' is not a third player",
          te.TennisElo.key("tennis_atp", " Fery A. ") ==
          te.TennisElo.key("tennis_atp", "Fery A."), True)


def test_blend_weight_is_per_surface() -> None:
    print("\nPER-SURFACE blend weights — grass must lean on the overall rating")
    p = te.EloParams(w_hard=0.60, w_clay=0.55, w_grass=0.30)
    check("hard, clay and grass are three different weights",
          len({p.weight_for("Hard"), p.weight_for("Clay"), p.weight_for("Grass")}), 3)
    # An unknown surface must not silently borrow another surface's weight.
    check("an unknown surface gets zero surface weight", p.weight_for("Carpet"), 0.0)

    e = te.TennisElo(p)
    st = e.state("tennis_atp", "P")
    st.overall = 1500.0
    st.surface["Grass"] = 1900.0
    st.surface["Hard"] = 1900.0
    st.last_played["Grass"] = D
    st.last_played["Hard"] = D
    grass = e.blended_rating("tennis_atp", "P", "Grass", D)
    hard = e.blended_rating("tennis_atp", "P", "Hard", D)
    # Same surface rating, same overall — only the weight differs, so grass must
    # sit closer to the overall than hard does.
    close("grass blend = 1500 + 0.30*400", grass, 1620.0, 1e-9)
    close("hard blend  = 1500 + 0.60*400", hard, 1740.0, 1e-9)
    check("grass leans harder on the overall rating", grass < hard, True)


def test_reversion() -> None:
    print("\nREVERSION by elapsed time — the 2020 grass gap")
    f = te.reverted_surface_rating
    close("fresh: no reversion", f(1900, 1500, months_idle=0, horizon_months=18), 1900.0)
    close("halfway: half reverted", f(1900, 1500, months_idle=9, horizon_months=18), 1700.0)
    close("at the horizon: fully reverted", f(1900, 1500, months_idle=18, horizon_months=18), 1500.0)
    close("past it: does not overshoot", f(1900, 1500, months_idle=60, horizon_months=18), 1500.0)
    # Reversion is toward the CURRENT overall, so a player who improved while
    # away is pulled UP, not down. Freezing or resetting to 1500 would do
    # neither, which is the argument for this rule over a 2020 patch.
    close("a player who improved while away reverts UPWARD",
          f(1400, 1600, months_idle=18, horizon_months=18), 1600.0)
    close("a zero horizon means always fully reverted",
          f(1900, 1500, months_idle=0, horizon_months=0), 1500.0)

    # Infinite idle == never played the surface, which is how a first-ever match
    # on a surface gets priced off the overall rating for free.
    e = te.TennisElo(te.EloParams(w_grass=1.0))
    st = e.state("tennis_atp", "Newcomer")
    st.overall = 1750.0
    close("a surface never played reads as the overall rating",
          e.blended_rating("tennis_atp", "Newcomer", "Grass", D), 1750.0)


def test_wimbledon_2020_gap() -> None:
    print("\nthe real case: 2019 grass -> 2021 grass, with 2020 missing entirely")
    e = te.TennisElo(te.EloParams(w_grass=1.0, reversion_months=18.0))
    st = e.state("tennis_atp", "GrassSpecialist")
    st.overall = 1500.0
    st.surface["Grass"] = 1900.0
    st.last_played["Grass"] = date(2019, 7, 14)      # 2019 Wimbledon final
    at_2021 = e.blended_rating("tennis_atp", "GrassSpecialist", "Grass", date(2021, 7, 11))
    # 24 months idle against an 18-month horizon: fully reverted.
    close("a 2019 grass rating is fully reverted by 2021 Wimbledon", at_2021, 1500.0)
    mid = e.blended_rating("tennis_atp", "GrassSpecialist", "Grass", date(2020, 4, 14))
    check("and partially reverted at the point 2020 Wimbledon would have been",
          1500.0 < mid < 1900.0, True)


def test_update_moves_both_ratings() -> None:
    print("\nupdates move the overall AND the surface, each on its own expectation")
    e = te.TennisElo(te.EloParams(k=24.0))
    e.update("tennis_atp", "W", "L", "Clay", D, home_won=True)
    w, l = e.state("tennis_atp", "W"), e.state("tennis_atp", "L")
    # Even ratings: expectation 0.5, so the swing is exactly k/2.
    close("winner overall +k/2", w.overall, 1512.0, 1e-9)
    close("loser overall -k/2", l.overall, 1488.0, 1e-9)
    close("winner clay +k/2", w.surface["Clay"], 1512.0, 1e-9)
    close("loser clay -k/2", l.surface["Clay"], 1488.0, 1e-9)
    check("ratings are zero-sum", round(w.overall + l.overall, 9), 3000.0)
    check("the untouched surface stays absent", "Hard" in w.surface, False)
    check("match counts recorded", (w.matches, w.surface_matches["Clay"]), (1, 1))


def test_replay_refuses_out_of_order() -> None:
    print("\nreplay() — chronology is the no-leakage guarantee, so it is enforced")
    ms = [
        {"sport": "tennis_atp", "played": date(2021, 5, 1), "surface": "Clay",
         "home": "A", "away": "B", "home_won": True},
        {"sport": "tennis_atp", "played": date(2020, 5, 1), "surface": "Clay",
         "home": "A", "away": "B", "home_won": True},
    ]
    try:
        te.replay(ms)
        check("out-of-order input raises", False, True)
    except ValueError:
        check("out-of-order input raises", True, True)


def test_replay_burn_in() -> None:
    print("\nreplay() — burn-in matches update ratings but are NOT scored")
    ms = [
        {"sport": "tennis_atp", "played": date(2015, 5, 1), "surface": "Clay",
         "home": "A", "away": "B", "home_won": True},
        {"sport": "tennis_atp", "played": date(2016, 5, 1), "surface": "Clay",
         "home": "A", "away": "B", "home_won": True},
        {"sport": "tennis_atp", "played": date(2017, 5, 1), "surface": "Clay",
         "home": "A", "away": "B", "home_won": True},
    ]
    scored, engine = te.replay(ms, score_from=date(2017, 1, 1))
    check("only the post-burn-in match is scored", len(scored), 1)
    check("and it is the 2017 one", scored[0].played, date(2017, 5, 1))
    # The whole point of burn-in: by 2017 A is rated well above B, so the
    # prediction reflects two prior wins rather than a cold 1500-vs-1500.
    # Two wins at k=24 puts A ~46 points clear, i.e. ~0.57 — the point is that
    # it is meaningfully above the cold 0.500, not that it is large.
    check("its prediction used the burnt-in ratings, not a cold 1500",
          0.55 < scored[0].predicted < 0.62, True)
    check("burn-in still moved the ratings",
          engine.state("tennis_atp", "A").overall > te.STARTING_ELO, True)


def main() -> int:
    test_expectation()
    test_no_home_advantage()
    test_keying_is_by_tour()
    test_blend_weight_is_per_surface()
    test_reversion()
    test_wimbledon_2020_gap()
    test_update_moves_both_ratings()
    test_replay_refuses_out_of_order()
    test_replay_burn_in()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all tennis_elo checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
