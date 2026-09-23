"""What each sport's model is, and therefore what a page may say about it.

M1 of docs/design/master-gameplan-ui-and-slate.md. Before this, "which model is
real" lived across plan documents and nothing in the app could read it, so every
surface decided for itself what to render. One row per sport x kind, one rule per
status, and a promotion test that moves a row on evidence (M4).

THE FOUR STATUSES
  none      no model exists
  baseline  a simple, unvalidated stand-in. It may show a pick, a projection and
            history; it may NOT show a probability beside a price, a record
            framed as a track record, or anything resembling an edge
  gated     it passed its own pre-registered test, and its evidence says so
  failed    it was attempted and did not pass; nothing is shown

WHY THE SEEDS LOOK LIKE THIS. Every status below cites a measurement, not a
memory:

  mlb/prop   GATED. Phase 4's gate — ordering monotone, ECE <= 0.025, worst
             bucket <= 0.05 at the board's line, positive slope. Home runs:
             ECE 0.0090, worst 0.020, slope +0.9995 on 30,975 held-out rows.
             14 Platt calibrations are active in `model_calibration`.
  mlb/game   BASELINE, not gated, and this surprises people. Its own CLV
             backtest (`clvSummaryJob`, read 2026-09-20) puts it BELOW the
             closing price: moneyline mean CLV -0.057 prob-points, positive-CLV
             rate 37.9% on 290 matched picks; totals -0.016 and 40.4%. A model
             that does not beat the close has not earned a probability beside a
             price, whatever its win-loss record looks like.
  nhl/prop   BASELINE. Five markets with temperature calibration, never put
             through the prop gate above.
  nfl/prop   BASELINE by explicit decision (master plan 4.6): projections with
             NO probability until a market clears the gate.
  */game     BASELINE for the generic Elo (nfl, cfb, nba, nhl). It blends 50%
             with the market price by construction, so it picks the favourite
             95-100% of the time; measured 2026-09-19: CFB 216 picks / 6
             underdogs / 84.7% wins / -1.3% per unit, NFL 47/2, NHL 14/0.
  cfb/game   ALSO records Phase 6's FAILED ridge-rating attempt in `evidence`:
             the sport is served by the baseline, and the researched attempt
             failed. Same for nba/prop (Phase 7) and soccer/game (Dixon-Coles).
  golf/prop  NONE. The model layer was deleted 2026-09-13 (Phase 8, decision 2).
  golf/game  BASELINE (`golf_elo`), built 2026-09-20 — see the REGISTRY row,
             not this stale summary line (fixed 2026-09-23; this line
             previously said "NONE" for all of golf, contradicting the
             REGISTRY two paragraphs below).
  tennis/game BASELINE (`tennis_elo`) — WIRED 2026-09-20 (fixed 2026-09-23;
             this line previously said "wired to nothing", also stale).

Nothing here decides what to BUILD; it records what is true and what may be
said. The gate specs travel with each row so M4 can re-run them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

NONE = "none"
BASELINE = "baseline"
GATED = "gated"
FAILED = "failed"

KINDS = ("game", "prop")


@dataclass(frozen=True)
class GateSpec:
    """The pre-registered test a row must pass to become `gated`."""

    test: str
    criteria: str
    min_sample: int = 0


@dataclass(frozen=True)
class ModelRow:
    sport: str
    kind: str
    engine: str | None
    status: str
    evidence: str
    since: str
    gate: GateSpec | None = None
    fitted_at: str | None = None
    notes: str = ""


PROP_GATE = GateSpec(
    test="calibration at the board's line",
    criteria="ordering monotone, ECE <= 0.025, worst bucket <= 0.05, positive slope",
    min_sample=2000,
)
GAME_GATE = GateSpec(
    test="CLV against the reference close",
    criteria="positive mean CLV and a positive-CLV rate above 50% over the matched picks",
    min_sample=200,
)

REGISTRY: tuple[ModelRow, ...] = (
    # ---- MLB ---------------------------------------------------------------
    ModelRow("mlb", "prop", "mlb_pa_sim", GATED,
             "Phase 4 gate met per market; home runs ECE 0.0090, worst 0.020, slope +0.9995 on "
             "30,975 held-out rows; 14 active Platt calibrations in model_calibration",
             "2026-09-08", PROP_GATE, fitted_at="2026-09-08"),
    ModelRow("mlb", "game", "mlb_ensemble", BASELINE,
             "clvSummaryJob 2026-09-20: moneyline mean CLV -0.0571 prob-pts, positive-CLV rate "
             "37.9% (290/433 matched); total -0.0159 and 40.4%. Below the close, so not gated",
             "2026-09-20", GAME_GATE,
             notes="Ensemble with park, starter, rest and travel. Deeper than the generic Elo, "
                   "but it has not beaten a closing price."),
    # ---- the generic Elo baseline -----------------------------------------
    *[ModelRow(s, "game", "generic_elo", BASELINE,
               "Never gated. Blends 50% with the market price (MARKET_BLEND_WEIGHT 0.5), so it "
               "picks the favourite 95-100% of the time; measured 2026-09-19",
               "2026-08-27", GAME_GATE,
               notes="Weights are hand-set placeholders until M2 fits them.")
      for s in ("nfl", "nba", "nhl")],
    ModelRow("cfb", "game", "generic_elo", BASELINE,
             "Never gated: 216 picks, 6 on underdogs, 84.7% wins, -1.3% per unit (2026-09-19). "
             "CALIBRATED 2026-09-20 (M2 fit 1): it said 68.0% while those picks won 83.9%; "
             "walk-forward log loss 0.47081 -> 0.39678, ECE 0.159 -> 0.054 on 161 scored picks. "
             "The researched attempt FAILED: Phase 6 ridge margin ratings, three benchmarks "
             "negative, every Wilson interval spanning break-even",
             "2026-08-27", GAME_GATE, fitted_at="2026-09-20",
             notes="Reopen only on the pre-registered hypothesis: week 5+, |edge| >= 16, large spreads."),
    ModelRow("soccer", "game", "generic_elo", BASELINE,
             "RE-ENABLED 2026-09-20 on the simple Elo, reversing Phase 8's decision 4. The "
             "researched attempt still FAILED (Dixon-Coles, t=+3.05 the wrong way), which is why "
             "this is the baseline and not that. Three-way: the draw takes its measured rate "
             "(EPL 24.03% of 4,627 matches, MLS 25.12% of 7,058) and a drawn game now grades "
             "instead of being skipped",
             "2026-09-20", GAME_GATE,
             notes="The draw never leads at that rate, so the pick is still a side - but its "
                   "probability is the honest one, and a draw counts as a loss."),
    # ---- props -------------------------------------------------------------
    ModelRow("nhl", "prop", "nhl_prop_serving", BASELINE,
             "Five markets (goals, assists, points, shots on goal, hits) with temperature "
             "calibration; never put through the prop gate",
             "2026-09-06", PROP_GATE, fitted_at="2026-09-06"),
    ModelRow("nfl", "prop", "count_prop_engine", BASELINE,
             "Master plan 4.6: projections serve with hasProbability=false until a market "
             "clears the 4.5 calibration gate",
             "2026-09-08", PROP_GATE),
    ModelRow("nba", "prop", None, FAILED,
             "Phase 7: rate x minutes model calibrated, but the pre-registered edge test failed "
             "(ROI -8.78%, 7.25pts worse than always taking the under). Reopen needs a full "
             "season of prices AND an active-roster feed",
             "2026-09-13", PROP_GATE),
    ModelRow("cfb", "prop", None, NONE, "No prop model has been attempted", "2026-09-19", PROP_GATE),
    ModelRow("soccer", "prop", None, NONE, "No prop model has been attempted", "2026-09-19", PROP_GATE),
    ModelRow("tennis", "prop", None, NONE, "No prop model has been attempted", "2026-09-19", PROP_GATE),
    ModelRow("tennis", "game", "tennis_elo", BASELINE,
             "WIRED 2026-09-20. The surface-weighted engine was built and FITTED 2026-09-04 "
             "(k 35.06, per-surface weights, held-out log loss 0.62317 -> 0.62210) and called by "
             "nothing. It now replays 57,155 matches back to 2015 and blends toward the market "
             "like every other baseline",
             "2026-09-20", GAME_GATE, fitted_at="2026-09-04",
             notes="Surface is left unknown for a scheduled match - the engine answers with the "
                   "overall rating, which is the only defensible number for an uncalibrated court."),
    # ---- golf --------------------------------------------------------------
    ModelRow("golf", "prop", None, NONE,
             "The golf model layer was DELETED 2026-09-13 (Phase 8, decision 2); the prediction "
             "tables are frozen at 2026-08-30/09-01",
             "2026-09-13", PROP_GATE),
    ModelRow("golf", "game", "golf_elo", BASELINE,
             "BUILT 2026-09-20. Golf has no head-to-head game, so each event is treated as its "
             "field playing each other: a player's result is the share of the field he beat. It "
             "held 149 rows across 3 events until backfill_golf_results.py filled 235 events "
             "(28,206 rows, 2022-2026) from ESPN's season view. 1,863 golfers rated; Scheffler "
             "leads at 1778.6, then Fleetwood, Henley, McIlroy",
             "2026-09-20", GAME_GATE,
             notes="It RANKS the field and publishes no win probability: turning ratings into "
                   "tournament win odds needs a scale nobody has fitted."),
)

_BY_KEY = {(r.sport, r.kind): r for r in REGISTRY}


def get(sport: str, kind: str) -> ModelRow | None:
    """The row for a sport and kind. `soccer_epl` and `tennis_atp` fold onto
    their league-independent sport, which is how the model is actually built."""
    return _BY_KEY.get((_base_sport(sport), kind))


def _base_sport(sport: str) -> str:
    if sport.startswith("soccer"):
        return "soccer"
    if sport.startswith("tennis"):
        return "tennis"
    return sport


def status_of(sport: str, kind: str) -> str:
    row = get(sport, kind)
    return row.status if row else NONE


def may_show_probability(sport: str, kind: str) -> bool:
    """A probability beside a price is a claim about the market. Only a model
    that passed its own test makes it."""
    return status_of(sport, kind) == GATED


def may_show_pick(sport: str, kind: str) -> bool:
    return status_of(sport, kind) in (BASELINE, GATED)


def may_show_record(sport: str, kind: str) -> bool:
    """A win-loss record reads as a track record, which a baseline has not earned."""
    return status_of(sport, kind) == GATED


def label(sport: str, kind: str) -> str:
    """What the page says out loud."""
    return {
        GATED: "validated model",
        BASELINE: "baseline model, not validated",
        FAILED: "no model — the attempt did not pass its test",
        NONE: "no model",
    }[status_of(sport, kind)]


def as_rows() -> list[dict]:
    """Serialisable rows, for the DB mirror and the API."""
    out = []
    for r in REGISTRY:
        out.append({
            "sport": r.sport,
            "kind": r.kind,
            "engine": r.engine,
            "status": r.status,
            "evidence": r.evidence,
            "since": r.since,
            "fitted_at": r.fitted_at,
            "notes": r.notes,
            "gate_test": r.gate.test if r.gate else None,
            "gate_criteria": r.gate.criteria if r.gate else None,
            "gate_min_sample": r.gate.min_sample if r.gate else None,
        })
    return out
