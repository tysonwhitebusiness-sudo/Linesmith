"""Partial port of lib/odds/goodBets.ts — not a reimplementation of the
parts it covers. Scoped to exactly what predict/prop_score.py's `P`
component needs: `performance_match_details` and its thresholds. The rest
of goodBets.ts (`isGoodBet`/`goodBetReasons`/`qualifiesByEdge`/
`isMarketTrusted`/etc.) is the "Good Bets" UI filter feature — a separate
concern from Prop Score, not needed here, and not ported.
"""
from dataclasses import dataclass

import math

from predict.windowed_stat import HistoryEntry, WindowedStat, WindowedStatOk, subset_window, window_set


def _js_round(x: float) -> int:
    """JS's Math.round rounds .5 ties up (toward +Infinity); Python's
    round() rounds .5 ties to even. Same divergence risk logistic_regression.py's
    own docstring already flags for floating-point ops in a ported model —
    matched here so a percentage string can never land one tier off from
    what the TS original would have shown."""
    return math.floor(x + 0.5)


@dataclass
class PerformanceThresholds:
    l15: float
    l10: float
    l5: float
    h2h_rate: float
    h2h_min_sample: int
    season: float
    hot_streak: int


PERFORMANCE_THRESHOLDS = PerformanceThresholds(l15=0.7, l10=0.8, l5=1.0, h2h_rate=0.75, h2h_min_sample=4, season=0.65, hot_streak=5)

# Rare-event markets (home runs, triples, stolen bases, doubles) run at
# roughly 2-15% league-wide — the flat thresholds above leave them
# structurally unable to ever earn `performance`; these are set relative
# to how those markets actually run.
RARE_EVENT_PERFORMANCE_THRESHOLDS = PerformanceThresholds(l15=0.35, l10=0.4, l5=0.6, h2h_rate=0.4, h2h_min_sample=4, season=0.25, hot_streak=2)

RARE_EVENT_DIMENSIONS = {"home-runs", "triples", "stolen-bases", "doubles"}


def thresholds_for(dimension: str) -> PerformanceThresholds:
    return RARE_EVENT_PERFORMANCE_THRESHOLDS if dimension in RARE_EVENT_DIMENSIONS else PERFORMANCE_THRESHOLDS


@dataclass
class PerformanceMatch:
    column: str  # 'l15' | 'l10' | 'l5' | 'h2h' | 'szn' | 'strk'
    short: str
    long: str
    # How far past its own threshold this criterion cleared, normalized to
    # [0, 1] — lets Prop Score's `P` component grade *how much* a track
    # cleared by, not just whether it did.
    margin: float


def _pct(n: float) -> str:
    return f"{_js_round(n * 100)}%"


def _rate_margin(rate: float, threshold: float) -> float:
    # threshold == 1 (l5's bar) has no headroom above 100% to measure a
    # margin against — clearing it at all is definitionally the maximum
    # margin, not a 0/0 division.
    if threshold >= 1:
        return 1.0 if rate >= threshold else 0.0
    return min(1.0, max(0.0, (rate - threshold) / (1 - threshold)))


def performance_match_details(
    dimension: str,
    l5: WindowedStat,
    l10: WindowedStat,
    l15: WindowedStat,
    szn: WindowedStat,
    streak: int,
    h2h: WindowedStat,
) -> list[PerformanceMatch]:
    """Every `performance` sub-criterion this candidate actually clears —
    empty when none do. Used both to decide whether the `performance`
    track qualifies (non-empty) and to grade how strongly (margin)."""
    t = thresholds_for(dimension)
    matches: list[PerformanceMatch] = []

    if isinstance(l15, WindowedStatOk) and l15.rate > t.l15:
        matches.append(PerformanceMatch("l15", f"L15 {_pct(l15.rate)}", f"L15 {_pct(l15.rate)} (>{_pct(t.l15)})", _rate_margin(l15.rate, t.l15)))
    if isinstance(l10, WindowedStatOk) and l10.rate > t.l10:
        matches.append(PerformanceMatch("l10", f"L10 {_pct(l10.rate)}", f"L10 {_pct(l10.rate)} (>{_pct(t.l10)})", _rate_margin(l10.rate, t.l10)))
    if isinstance(l5, WindowedStatOk) and l5.rate >= t.l5:
        matches.append(PerformanceMatch("l5", f"L5 {_pct(l5.rate)}", f"L5 {_pct(l5.rate)} (>={_pct(t.l5)})", _rate_margin(l5.rate, t.l5)))
    if isinstance(h2h, WindowedStatOk) and h2h.total > t.h2h_min_sample and h2h.rate > t.h2h_rate:
        matches.append(
            PerformanceMatch(
                "h2h",
                f"H2H {_pct(h2h.rate)}",
                f"H2H {_pct(h2h.rate)} over {h2h.total} games (>{_pct(t.h2h_rate)})",
                _rate_margin(h2h.rate, t.h2h_rate),
            )
        )
    if isinstance(szn, WindowedStatOk) and szn.rate > t.season:
        matches.append(PerformanceMatch("szn", f"SZN {_pct(szn.rate)}", f"Season {_pct(szn.rate)} (>{_pct(t.season)})", _rate_margin(szn.rate, t.season)))
    if streak is not None and streak >= t.hot_streak:
        streak_margin = min(1.0, max(0.0, (streak - t.hot_streak) / t.hot_streak))
        matches.append(PerformanceMatch("strk", f"Strk +{streak}", f"{streak}-game hot streak (>={t.hot_streak})", streak_margin))

    return matches


@dataclass
class CandidateGoodBetSignals:
    l5: WindowedStat
    l10: WindowedStat
    l15: WindowedStat
    szn: WindowedStat
    streak: int
    h2h: WindowedStat
    matchup_favorable: bool | None


def candidate_good_bet_signals(history: list[HistoryEntry], category: str, opponent_id: int | None, matchup_favorable: bool | None) -> CandidateGoodBetSignals:
    """The windowed-stat side of performance_match_details' input, computed
    straight from a candidate's own history. Takes plain history/opponent
    data rather than a rich TS-shaped PickCandidate, since this port never
    builds one — see predict/prop_candidates.py."""
    windows = window_set(history, category)
    h2h = subset_window(history, category, lambda e: e.opponent_id is not None and opponent_id is not None and e.opponent_id == opponent_id, minimum=1)
    return CandidateGoodBetSignals(
        l5=windows.l5,
        l10=windows.l10,
        l15=windows.l15,
        szn=windows.szn,
        streak=windows.streak,
        h2h=h2h,
        matchup_favorable=matchup_favorable,
    )
