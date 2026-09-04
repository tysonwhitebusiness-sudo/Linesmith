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

3. THE SURFACE BLEND WEIGHT IS PER SURFACE. Grass is ~600 matches a year, ~6,700
   across the whole span, spread over 1,500+ names — most players have
   single-digit career grass matches, so a standalone grass rating is mostly
   noise and must lean on the overall. Hard is 60% of all play and supports far
   more surface weight. One global weight would be too aggressive on grass and
   too timid on hard.

4. SURFACE RATINGS REVERT TOWARD OVERALL ON READ, BY ELAPSED TIME. Wimbledon
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
    """The five fitted numbers. Defaults are STARTING POINTS for 2.4's fit, not
    results — no walk-forward has chosen them yet."""

    k: float = 24.0
    w_hard: float = 0.60
    w_clay: float = 0.55
    w_grass: float = 0.30
    # Months of idleness on a surface after which that surface rating has fully
    # reverted to the player's overall. 18 is the 2019->2021 Wimbledon gap.
    reversion_months: float = 18.0

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

    def _months_idle(self, st: PlayerState, surface: str, as_of: date) -> float:
        last = st.last_played.get(surface)
        if last is None:
            return float("inf")
        return max(0.0, (as_of - last).days / _DAYS_PER_MONTH)

    def surface_rating(self, st: PlayerState, surface: str, as_of: date) -> float:
        """A player's surface rating as it should be READ today."""
        raw = st.surface.get(surface)
        if raw is None:
            return st.overall
        return reverted_surface_rating(
            raw, st.overall, self._months_idle(st, surface, as_of),
            self.params.reversion_months)

    def blended_rating(self, sport: str, name: str, surface: str, as_of: date) -> float:
        """Decision 3. The number a prediction actually uses."""
        st = self.state(sport, name)
        w = self.params.weight_for(surface)
        return w * self.surface_rating(st, surface, as_of) + (1.0 - w) * st.overall

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
        h_overall_pre, a_overall_pre = h.overall, a.overall
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
