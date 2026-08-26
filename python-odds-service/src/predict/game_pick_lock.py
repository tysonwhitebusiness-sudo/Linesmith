"""Direct port of lib/core/gamePickLock.ts — not a reimplementation.

The Linesmith Pick lock system. Two captures per game per market: an
"initial" read taken once the slate opens for the day (intended to be ~6am
America/Chicago) and a "final" read frozen 3 hours before first pitch — the
pick that actually counts for the record. Once a slot is captured it never
moves; capture_moneyline_pick/capture_total_pick enforce that with a
`WHERE ..._captured_at IS NULL` guard, so calling these on every cycle is
cheap and safe — most calls are no-ops.

Genuine correctness upgrade over the TS source, not just a language swap:
TS's own header comment discloses both capture windows are "due" checks
evaluated only at page-load time, since that app runs only while someone
has it open — if nobody opens it near 6am or near the 3-hour mark, the next
open captures whatever the model says *right now* and marks it `late`.
Python's SequentialQueue (job_queue.py) is already a real, persistent,
always-on scheduler — once a real capture-cycle job is wired into it
(deferred to Phase G, which builds the live gameModel/Elo/sim data feed
these functions need as MoneylineLockInput/TotalLockInput — that data
doesn't exist yet in Python), these windows get evaluated every few minutes
around the clock instead of opportunistically. The timing-window functions
below are unchanged from the TS source — what changes is how OFTEN
something calls them.

Grading (grade_finished_game_picks) has no such time-window dependency —
it only needs final scores, which statsapi.py (Phase B) already provides —
so it's real, useful, and wired into SequentialQueue starting this phase
(see jobs.py's job_grade_finished_mlb_picks). Safe to run alongside TS's
own grading (snapshotRebuild.ts): both read/write the same game_picks
table, and grade_game_pick's `WHERE graded_at IS NULL` guard makes a race
between them a harmless no-op, not a correctness problem — whichever gets
there first wins.

Deliberately does not fabricate a pick for a game already in progress or
final with no prior capture — a "prediction" made after the outcome is
known isn't a prediction. That game simply has no Linesmith Pick on
record, which is the honest outcome of nothing having captured it in time.
"""
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import db

from .calibration import apply_calibration
from .probability_blend import ELO_BLEND_WEIGHT, MARKET_BLEND_WEIGHT, blend_probability

_CHICAGO = ZoneInfo("America/Chicago")
INITIAL_HOUR_CT = 6
LATE_GRACE_MINUTES = 20
FINAL_LOCK_HOURS_BEFORE = 3


def _chicago_minutes_of_day(now: datetime) -> int:
    local = now.astimezone(_CHICAGO)
    return local.hour * 60 + local.minute


def _is_past_initial_window(now: datetime) -> bool:
    return _chicago_minutes_of_day(now) >= INITIAL_HOUR_CT * 60


def _is_initial_late(now: datetime) -> bool:
    return _chicago_minutes_of_day(now) > INITIAL_HOUR_CT * 60 + LATE_GRACE_MINUTES


def _parse_epoch_ms(iso_str: str) -> float:
    s = iso_str[:-1] + "+00:00" if iso_str.endswith("Z") else iso_str
    return datetime.fromisoformat(s).timestamp() * 1000


def _final_lock_threshold_ms(commence_time: str) -> float | None:
    try:
        return _parse_epoch_ms(commence_time) - FINAL_LOCK_HOURS_BEFORE * 60 * 60 * 1000
    except ValueError:
        # Matches TS's Number.isFinite(Date.parse(...)) guard — an
        # unparseable commence_time reads as "not due" rather than crashing.
        return None


def _is_final_lock_due(commence_time: str, now: datetime) -> bool:
    t = _final_lock_threshold_ms(commence_time)
    return t is not None and now.timestamp() * 1000 >= t


def _is_final_lock_late(commence_time: str, now: datetime) -> bool:
    t = _final_lock_threshold_ms(commence_time)
    return t is not None and now.timestamp() * 1000 > t + LATE_GRACE_MINUTES * 60 * 1000


# ---------------------------------------------------------------------------
# Moneyline
# ---------------------------------------------------------------------------


@dataclass
class MoneylineDiagnostics:
    raw_log5_home_win_prob: float
    home_venue_edge: float
    away_venue_edge: float
    home_recent_edge: float
    away_recent_edge: float
    raw_home_recent_edge: float
    raw_away_recent_edge: float
    park_factor: float


@dataclass
class MoneylineLockInput:
    game_id: str
    home_team_id: int
    away_team_id: int
    home_team_name: str
    away_team_name: str
    matchup: str
    commence_time: str | None
    is_pre_game: bool
    home_win_prob: float
    away_win_prob: float
    # Raw ingredients behind home_win_prob — game_model.py's
    # MoneylineResult.diagnostics — logged so a later fitting pass can learn
    # real weights instead of trusting the hand-picked ones.
    diagnostics: MoneylineDiagnostics
    # De-vigged market probability the home side will win, when a genuine
    # two-sided price exists at capture time; None otherwise (falls back to
    # pure model, same as always).
    market_home_prob: float | None
    # Elo's own home-win probability, already gated by the caller for
    # minimum games-played trust; None when not yet trustworthy or
    # unavailable.
    elo_home_prob: float | None
    # 90% confidence interval for the HOME side's win probability, from the
    # fitted regression's own covariance — None whenever no fit with a
    # covariance matrix is active.
    prob_lower_home: float | None
    prob_upper_home: float | None


async def run_moneyline_lock_cycle(sport: str, games: list[MoneylineLockInput], now: datetime | None = None, calibration: "db.CalibrationRow | None" = None) -> None:
    """calibration: an active predict/calibration.py CalibrationRow for
    this (sport, 'moneyline'), or None (default — current behavior,
    unchanged). When present, calibrates the model's own raw probability
    BEFORE the market blend, not after — blending an uncalibrated model
    signal with the market and hoping the blend accidentally fixes
    calibration is strictly worse than calibrating the model's own signal
    first, then blending two individually-more-honest probabilities (also
    matches the reference methodology's own ordering). apply_calibration
    already no-ops when calibration is None, so every call site below
    works identically whether or not a fitted calibration is active."""
    now = now if now is not None else datetime.now(timezone.utc)
    for g in games:
        if not g.commence_time or not g.is_pre_game:
            continue
        identity = db.GamePickIdentity(
            sport=sport,
            game_id=g.game_id,
            home_team_id=g.home_team_id,
            away_team_id=g.away_team_id,
            home_team_name=g.home_team_name,
            away_team_name=g.away_team_name,
            matchup=g.matchup,
            commence_time=g.commence_time,
        )
        await db.ensure_game_pick_row(identity)

        # Calibrate the raw model probability first (no-op if calibration
        # is None), THEN blend on the calibrated home probability, then
        # re-derive the side from the BLENDED number — not the model's own
        # side first. Blending can flip which side is actually favored.
        # Sequential composition: market blends into the (calibrated) model
        # first, then Elo nudges the market-informed number at a smaller
        # weight.
        calibrated_home_prob = apply_calibration(g.home_win_prob, calibration)
        after_market_prob = blend_probability(calibrated_home_prob, g.market_home_prob, MARKET_BLEND_WEIGHT)
        blended_home_prob = blend_probability(after_market_prob, g.elo_home_prob, ELO_BLEND_WEIGHT)
        side = "home" if blended_home_prob >= 0.5 else "away"
        prob = blended_home_prob if side == "home" else 1 - blended_home_prob

        # The interval is only meaningful as-is when it's the fit's own
        # direct output. Flip to the picked side the same way `prob` above
        # does: away's bounds are 1 minus home's, with lower/upper swapping.
        prob_lower = None if g.prob_lower_home is None else (g.prob_lower_home if side == "home" else 1 - g.prob_upper_home)
        prob_upper = None if g.prob_upper_home is None else (g.prob_upper_home if side == "home" else 1 - g.prob_lower_home)

        features_json = json.dumps(
            {
                "rawLog5HomeWinProb": g.diagnostics.raw_log5_home_win_prob,
                "homeVenueEdge": g.diagnostics.home_venue_edge,
                "awayVenueEdge": g.diagnostics.away_venue_edge,
                "homeRecentEdge": g.diagnostics.home_recent_edge,
                "awayRecentEdge": g.diagnostics.away_recent_edge,
                "parkFactor": g.diagnostics.park_factor,
                "modelHomeProb": g.home_win_prob,
                "calibratedModelHomeProb": calibrated_home_prob,
                "calibrationMethod": calibration.method if calibration is not None else None,
                "marketHomeProb": g.market_home_prob,
                "marketBlendWeight": MARKET_BLEND_WEIGHT if g.market_home_prob is not None else None,
                "afterMarketProb": after_market_prob,
                "eloHomeProb": g.elo_home_prob,
                "eloBlendWeight": ELO_BLEND_WEIGHT if g.elo_home_prob is not None else None,
                "blendedHomeProb": blended_home_prob,
                "probLowerHome": g.prob_lower_home,
                "probUpperHome": g.prob_upper_home,
            }
        )

        if _is_past_initial_window(now):
            await db.capture_moneyline_pick(
                db.MoneylinePickCapture(
                    sport=sport,
                    game_id=g.game_id,
                    slot="initial",
                    side=side,
                    prob=prob,
                    late=_is_initial_late(now),
                    features_json=features_json,
                    prob_lower=prob_lower,
                    prob_upper=prob_upper,
                )
            )
        if _is_final_lock_due(g.commence_time, now):
            await db.capture_moneyline_pick(
                db.MoneylinePickCapture(
                    sport=sport,
                    game_id=g.game_id,
                    slot="final",
                    side=side,
                    prob=prob,
                    late=_is_final_lock_late(g.commence_time, now),
                    features_json=features_json,
                    prob_lower=prob_lower,
                    prob_upper=prob_upper,
                )
            )


# ---------------------------------------------------------------------------
# Total (O/U)
# ---------------------------------------------------------------------------


@dataclass
class TotalLockInput:
    game_id: str
    home_team_id: int
    away_team_id: int
    home_team_name: str
    away_team_name: str
    matchup: str
    commence_time: str | None
    is_pre_game: bool
    line: float
    over_prob: float
    # De-vigged market probability of the Over, when a genuine two-sided
    # price exists; None otherwise.
    market_over_prob: float | None
    # 90% confidence interval for the OVER probability, from the fitted
    # total model's own covariance — None whenever no fit is active.
    prob_lower_over: float | None
    prob_upper_over: float | None


async def run_total_lock_cycle(sport: str, games: list[TotalLockInput], now: datetime | None = None) -> None:
    now = now if now is not None else datetime.now(timezone.utc)
    for g in games:
        if not g.commence_time or not g.is_pre_game:
            continue
        await db.ensure_game_pick_row(
            db.GamePickIdentity(
                sport=sport,
                game_id=g.game_id,
                home_team_id=g.home_team_id,
                away_team_id=g.away_team_id,
                home_team_name=g.home_team_name,
                away_team_name=g.away_team_name,
                matchup=g.matchup,
                commence_time=g.commence_time,
            )
        )

        blended_over_prob = blend_probability(g.over_prob, g.market_over_prob)
        side = "over" if blended_over_prob >= 0.5 else "under"
        prob = blended_over_prob if side == "over" else 1 - blended_over_prob

        # Same side-flip convention as the moneyline interval above.
        prob_lower = None if g.prob_lower_over is None else (g.prob_lower_over if side == "over" else 1 - g.prob_upper_over)
        prob_upper = None if g.prob_upper_over is None else (g.prob_upper_over if side == "over" else 1 - g.prob_lower_over)

        features_json = json.dumps(
            {
                "modelOverProb": g.over_prob,
                "marketOverProb": g.market_over_prob,
                "blendWeight": MARKET_BLEND_WEIGHT if g.market_over_prob is not None else None,
                "blendedOverProb": blended_over_prob,
                "line": g.line,
                "probLowerOver": g.prob_lower_over,
                "probUpperOver": g.prob_upper_over,
            }
        )

        if _is_past_initial_window(now):
            await db.capture_total_pick(
                db.TotalPickCapture(
                    sport=sport,
                    game_id=g.game_id,
                    slot="initial",
                    side=side,
                    prob=prob,
                    line=g.line,
                    late=_is_initial_late(now),
                    features_json=features_json,
                    prob_lower=prob_lower,
                    prob_upper=prob_upper,
                )
            )
        if _is_final_lock_due(g.commence_time, now):
            await db.capture_total_pick(
                db.TotalPickCapture(
                    sport=sport,
                    game_id=g.game_id,
                    slot="final",
                    side=side,
                    prob=prob,
                    line=g.line,
                    late=_is_final_lock_late(g.commence_time, now),
                    features_json=features_json,
                    prob_lower=prob_lower,
                    prob_upper=prob_upper,
                )
            )


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------


@dataclass
class FinishedGameInput:
    game_id: str
    is_final: bool
    home_score: float | None
    away_score: float | None


async def grade_finished_game_picks(sport: str, games: list[FinishedGameInput]) -> None:
    """Grades against the locked (final) pick, falling back to the initial
    one if a final lock never happened."""
    for g in games:
        if not g.is_final or g.home_score is None or g.away_score is None or g.home_score == g.away_score:
            continue
        row = await db.get_game_pick(sport, g.game_id)
        if not row or row.graded_at:
            continue

        ml_side = row.ml_final_side or row.ml_initial_side
        total_side = row.total_final_side or row.total_initial_side
        total_line = row.total_final_line if row.total_final_line is not None else row.total_initial_line

        ml_outcome = None
        if ml_side:
            winner = "home" if g.home_score > g.away_score else "away"
            ml_outcome = "win" if ml_side == winner else "loss"

        total_outcome = None
        total = g.home_score + g.away_score
        if total_side and total_line is not None and total != total_line:
            actual = "over" if total > total_line else "under"
            total_outcome = "win" if total_side == actual else "loss"

        if ml_outcome or total_outcome:
            await db.grade_game_pick(
                db.GamePickGrade(sport=sport, game_id=g.game_id, home_score=g.home_score, away_score=g.away_score, ml_outcome=ml_outcome, total_outcome=total_outcome)
            )
