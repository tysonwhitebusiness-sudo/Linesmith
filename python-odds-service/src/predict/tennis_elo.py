"""Phase 2.2 — surface-weighted Elo for tennis.

The rating engine only. Fitting the parameters is 2.4, and the ship gate is 2.5;
nothing here reads odds or decides whether the model is any good.

FOUR DESIGN DECISIONS, each forced by something measured rather than assumed:

1. RATINGS ARE KEYED ON (sport, name), NOT name. Phase 2.1 found 8 confirmed
   collisions and every one was cross-tour — `Trevisan M.` alone covers 136
   player-slots across ATP and WTA. Keying on the tour resolves all eight at
   once, and it is correct independently: ATP and WTA are separate competitive
   pools that must never share a rating. This is not optional and
   `key()` is the only way ratings are addressed.

2. NO HOME-ADVANTAGE TERM. `generic_team_elo` carries a `home_bonus` because in
   team sport the home side really does win more. Here home/away is just column
   order in tennis-data: measured 2026-09-04, the "home" player wins 50.3% of
   56,386 matches — 1.4 standard errors off a coin flip. Adding a bonus would
   fit noise, and reading the ordering as meaningful is also how a leaked
   winner-first column would have slipped through (it did not: 50.3% is exactly
   what an arbitrary ordering looks like).

3. THE SURFACE BLEND WEIGHT IS PER SURFACE — and the fit reversed the reason.
   The original argument was that hard, at 60% of all play, supports the HIGHEST
   surface weight while thin grass data must lean on the overall. The 2.4 fit
   says the opposite: w_hard 0.304, w_clay 0.429, w_grass 0.379. HARD GETS THE
   LOWEST.

   In hindsight that is the obvious result. Hard is the default surface, so a
   player's overall rating already IS largely a hard-court rating and a separate
   one adds little beyond it. Clay and grass differ from the overall, so their
   surface ratings carry information the overall does not. The conclusion — fit
   the weight per surface — survives; the reasoning that motivated it did not.

4. SURFACE RATINGS REVERT TOWARD OVERALL ON READ, BY ELAPSED TIME — AND THE FIT
   DROVE THIS TO EFFECTIVELY OFF. Fitted freely, the horizon runs to 1200
   months (the bound) in the 5-parameter solution and 216 months in the
   6-parameter one, against a data span of 11.6 years. The 18-month prior below
   was roughly an order of magnitude too aggressive.

   The rule is KEPT, at that near-off setting, on one piece of evidence: on
   grass alone — the surface the 2020 gap actually hit — a weak reversion beats
   none, 0.62078 against 0.62225. That is a subgroup chosen after seeing the
   result and is not significance-tested, so it is suggestive, not established.
   On the 2021 Wimbledon fortnight it designed for, n=385 and the signal is
   mixed (log-loss slightly better, accuracy slightly worse). Reported as weak
   rather than quietly kept as a win.

   Wimbledon
   2020 was cancelled: zero grass matches that year, so grass ratings would sit
   untouched for ~18 months while the players themselves kept changing. The
   reversion is applied when a rating is READ rather than on a schedule, so it
   needs no calendar special-casing and equally covers a player who simply skips
   a clay season. It reverts toward the overall rating — which did keep updating
   through 2020 — rather than freezing or resetting to 1500.

   It also falls out of this rule for free that a player who has NEVER played a
   surface reads as their overall rating: infinite idle time is full reversion.

KNOWN LIMITATION — THE OVERALL RATING DOES NOT DECAY WHEN IDLE. Only surface
ratings revert (decision 4); `overall` is frozen the moment a player stops
playing. The smoke run makes this visible: Ashleigh Barty tops the WTA list at
2024 having retired in 2022, because nothing has moved her rating since.

For TRAINING this is harmless — a retired player appears in no future match, so
a stale rating is never used. It matters for COMEBACKS, which tennis has many
of: Phase 2.1 catalogued thirteen multi-year breaks (Wozniacki retired 2020 and
returned 2023; Pironkova, Sevastova and Rodina maternity; Haddad Maia
suspension). Such a player resumes on the rating they left with, and the surface
reversion cannot help because it reverts TOWARD that same stale overall.

Deliberately not fixed here. An overall-decay term is a sixth parameter and
belongs in 2.4 where it can be fitted and measured, not guessed at now. Flagged
so it is a known open question rather than a surprise in the walk-forward.

EACH RATING IS UPDATED ON ITS OWN EXPECTATION. The overall rating updates from
the overall-vs-overall expectation and the surface rating from
surface-vs-surface, so each is a valid Elo in its own right and the blend is
purely a read-time combination. Updating both from the blended number would
couple them and make neither interpretable alone.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

ELO_SCALE = 400.0
STARTING_ELO = 1500.0

# Exactly the values tennis-data ships in its Surface column.
SURFACES = ("Hard", "Clay", "Grass")

# Average days per month, for turning a date delta into the reversion horizon's
# units. Nothing here is precise enough for calendar months to matter.
_DAYS_PER_MONTH = 30.44


@dataclass(frozen=True)
class EloParams:
    """FITTED 2026-09-04 by fit_tennis_elo.py — train 2017-2022, held out 2023+.

    These are the 5-parameter solution. The 6-parameter variant (overall decay
    on) scored marginally better held-out but did NOT clear significance against
    it — paired t = -1.81 over 19,150 matches — so the simpler model is adopted.

    Held out vs unfitted defaults: log-loss 0.62317 -> 0.62210, paired
    t = -2.01. Real, and very small.
    """

    k: float = 35.06
    w_hard: float = 0.304
    w_clay: float = 0.429
    w_grass: float = 0.379
    # Months of idleness on a surface after which that surface rating has fully
    # reverted to the player's overall. 18 is the 2019->2021 Wimbledon gap.
    reversion_months: float = 1200.0
    # Months of idleness ON ANY SURFACE after which the OVERALL rating has fully
    # reverted to STARTING_ELO — i.e. a long absence regresses a player toward
    # the field. 0 DISABLES it (note this is the opposite convention to
    # reversion_months, where <=0 means always-fully-reverted; the two are
    # different questions and sharing a sentinel would be worse than the
    # asymmetry). Whether this earns its place is 2.4's to measure.
    overall_reversion_months: float = 0.0

    def weight_for(self, surface: str) -> float:
        if surface == "Hard":
            return self.w_hard
        if surface == "Clay":
            return self.w_clay
        if surface == "Grass":
            return self.w_grass
        # An unknown surface gets zero surface weight rather than a guess: the
        # overall rating is the only defensible answer for a court we have never
        # calibrated on.
        return 0.0


@dataclass
class PlayerState:
    overall: float = STARTING_ELO
    surface: dict[str, float] = field(default_factory=dict)
    last_played: dict[str, date] = field(default_factory=dict)
    matches: int = 0
    surface_matches: dict[str, int] = field(default_factory=dict)
    # Last match on ANY surface, for the overall idle decay.
    last_any: date | None = None


def expected_win_prob(rating: float, opponent_rating: float) -> float:
    """Standard logistic Elo expectation. No home term — see decision 2."""
    return 1.0 / (1.0 + 10.0 ** ((opponent_rating - rating) / ELO_SCALE))


def reverted_surface_rating(
    surface_rating: float,
    overall_now: float,
    months_idle: float,
    horizon_months: float,
) -> float:
    """Decision 4. Linear reversion toward `overall_now`, complete at `horizon`.

    `months_idle` of infinity (never played the surface) reverts fully, which is
    why a first-ever match on a surface is priced off the overall rating.
    """
    if horizon_months <= 0:
        return overall_now
    frac = months_idle / horizon_months
    if frac >= 1.0:
        return overall_now
    if frac <= 0.0:
        return surface_rating
    return surface_rating + (overall_now - surface_rating) * frac


def reverted_overall_rating(overall: float, months_idle: float,
                            horizon_months: float) -> float:
    """Regress an idle player's OVERALL rating toward the field (STARTING_ELO).

    `horizon_months <= 0` DISABLES this entirely and returns the rating
    unchanged — deliberately the opposite sentinel to reverted_surface_rating,
    because "no decay at all" is a real configuration here and "frozen surface
    rating" is not.

    Exists because the overall rating was otherwise frozen the moment a player
    stopped playing: Barty topped the WTA smoke run at 2024 having retired in
    2022. Harmless for a retiree, wrong for a COMEBACK — and surface reversion
    cannot compensate, since it reverts toward this same rating.
    """
    if horizon_months <= 0 or months_idle <= 0:
        return overall
    frac = min(1.0, months_idle / horizon_months)
    return overall + (STARTING_ELO - overall) * frac


class TennisElo:
    """Chronological rating state. Feed matches in date order; never backwards."""

    def __init__(self, params: EloParams | None = None):
        self.params = params or EloParams()
        self._players: dict[tuple[str, str], PlayerState] = {}

    @staticmethod
    def key(sport: str, name: str) -> tuple[str, str]:
        """Decision 1. The ONLY way a player is addressed."""
        return (sport, (name or "").strip())

    def state(self, sport: str, name: str) -> PlayerState:
        k = self.key(sport, name)
        st = self._players.get(k)
        if st is None:
            st = PlayerState()
            self._players[k] = st
        return st

    def overall_rating(self, st: PlayerState, as_of: date) -> float:
        """The overall rating as it should be READ today, after idle decay."""
        h = self.params.overall_reversion_months
        if h <= 0 or st.last_any is None:
            return st.overall
        months = max(0.0, (as_of - st.last_any).days / _DAYS_PER_MONTH)
        return reverted_overall_rating(st.overall, months, h)

    def _months_idle(self, st: PlayerState, surface: str, as_of: date) -> float:
        last = st.last_played.get(surface)
        if last is None:
            return float("inf")
        return max(0.0, (as_of - last).days / _DAYS_PER_MONTH)

    def surface_rating(self, st: PlayerState, surface: str, as_of: date) -> float:
        """A player's surface rating as it should be READ today.

        Reverts toward the DECAYED overall, not the raw one — otherwise a
        comeback's surface rating would be pulled toward a rating that is itself
        stale, which is the exact hole the overall decay exists to close.
        """
        overall_now = self.overall_rating(st, as_of)
        raw = st.surface.get(surface)
        if raw is None:
            return overall_now
        return reverted_surface_rating(
            raw, overall_now, self._months_idle(st, surface, as_of),
            self.params.reversion_months)

    def blended_rating(self, sport: str, name: str, surface: str, as_of: date) -> float:
        """Decision 3. The number a prediction actually uses."""
        st = self.state(sport, name)
        w = self.params.weight_for(surface)
        return (w * self.surface_rating(st, surface, as_of)
                + (1.0 - w) * self.overall_rating(st, as_of))

    def predict(self, sport: str, home: str, away: str, surface: str, as_of: date) -> float:
        """P(home wins). 'home' is column order only, not an advantage."""
        return expected_win_prob(
            self.blended_rating(sport, home, surface, as_of),
            self.blended_rating(sport, away, surface, as_of),
        )

    def update(self, sport: str, home: str, away: str, surface: str,
               played: date, home_won: bool) -> None:
        """Apply one finished match. Call AFTER predicting it, never before."""
        h = self.state(sport, home)
        a = self.state(sport, away)
        k = self.params.k
        s_home = 1.0 if home_won else 0.0

        # READ EVERY PRE-MATCH RATING BEFORE WRITING ANY OF THEM.
        #
        # This ordering is load-bearing, not style. surface_rating() falls back
        # to `overall` for a surface never played, so updating `overall` first
        # meant a player's FIRST match on a surface took an already-updated
        # overall as its surface base — the result landed in that rating twice.
        # Measured before the fix: a first-match winner went to 1523.2 where the
        # correct value is 1512.0, a 47% overshoot. A small self-leak, and
        # exactly the kind that never raises and never looks wrong.
        h_overall_pre = self.overall_rating(h, played)
        a_overall_pre = self.overall_rating(a, played)
        h_surf = self.surface_rating(h, surface, played)
        a_surf = self.surface_rating(a, surface, played)

        # Overall: updated on the overall-vs-overall expectation.
        e_home_overall = expected_win_prob(h_overall_pre, a_overall_pre)
        h.overall = h_overall_pre + k * (s_home - e_home_overall)
        a.overall = a_overall_pre + k * ((1.0 - s_home) - (1.0 - e_home_overall))

        # Surface: updated on the surface-vs-surface expectation, using the
        # REVERTED reading as the base so a comeback does not resume from a
        # rating the player no longer deserves.
        e_home_surf = expected_win_prob(h_surf, a_surf)
        h.surface[surface] = h_surf + k * (s_home - e_home_surf)
        a.surface[surface] = a_surf + k * ((1.0 - s_home) - (1.0 - e_home_surf))

        for st in (h, a):
            st.last_played[surface] = played
            st.last_any = played
            st.matches += 1
            st.surface_matches[surface] = st.surface_matches.get(surface, 0) + 1


@dataclass
class ScoredMatch:
    sport: str
    played: date
    surface: str
    home: str
    away: str
    home_won: bool
    predicted: float


def replay(matches, params: EloParams | None = None, score_from: date | None = None):
    """Walk matches in order, predicting each BEFORE it updates the ratings.

    `score_from` is the burn-in boundary (2.4 sets it to 2017-01-01): matches
    before it still update ratings but are not returned, because scoring them
    would measure the burn-in rather than the model.

    Returns (scored_matches, engine) so the caller can inspect final state.
    """
    engine = TennisElo(params)
    scored: list[ScoredMatch] = []
    previous: date | None = None
    for m in matches:
        played = m["played"]
        # Chronology is the whole basis of the no-leakage claim, so it is
        # asserted rather than assumed — an out-of-order feed would silently
        # score a match on ratings that already contain its own result.
        if previous is not None and played < previous:
            raise ValueError(
                f"matches must be chronological: {played} came after {previous}")
        previous = played

        p = engine.predict(m["sport"], m["home"], m["away"], m["surface"], played)
        if score_from is None or played >= score_from:
            scored.append(ScoredMatch(
                sport=m["sport"], played=played, surface=m["surface"],
                home=m["home"], away=m["away"], home_won=m["home_won"], predicted=p))
        engine.update(m["sport"], m["home"], m["away"], m["surface"], played, m["home_won"])
    return scored, engine
