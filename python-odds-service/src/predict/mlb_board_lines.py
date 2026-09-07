"""The line the MLB board serves, per market — ONE definition, shared.

Phase 3.0 of docs/master-plan-2026-09-06.md (2026-09-06).

Scan shows every prop at a FIXED line per market, not at each player's own
market line. That line is load-bearing in three places that must agree:

  1. `jobs.job_mlb_projections` passes it to the serving pipe, which computes
     the displayed `model_prob` as P(stat > line).
  2. `fit_mlb_props.py` fits the calibration AT this line, because a
     calibration fitted anywhere else is applied outside the region it was
     fitted in — see below.
  3. `mlb_prop_grading` falls back to it when a cached row carries no line of
     its own.

THEY DID NOT AGREE. Before this module the numbers were written out twice — a
dict literal inside `jobs.py` and `StatMarketDef.line` in `mlb_stat_markets.py`
— and two of them differed:

    pitcher-outs           served at 16.5, graded at 15.5
    pitcher-hits-allowed   served at  4.5, graded at  5.5

Measured against `prop_odds_archive` (2026-09-06), the served values are the
correct ones: the median posted line is 16.5 for pitcher-outs (n=9,193) and 4.5
for pitcher-hits-allowed (n=9,627). Every other market already agreed and also
matches its median. So this table is `jobs.py`'s former literal, verified
against what books actually post, and `mlb_stat_markets` now reads from here.

WHY THE FIT MUST USE THIS TABLE. The calibration used to be fitted against each
archive row's OWN market line and then served at the fixed line above. For a
market whose line barely moves that is nearly the same thing; for one whose line
moves a lot it is extrapolation. Measured across 11 markets, the share of posted
lines sitting at the board line correlates with the fitted Platt slope at
**r = +0.849**:

    stolen-bases          100% of lines at 0.5    slope  0.7676
    singles                93% at 0.5             slope  0.9470
    hits                   84% at 0.5             slope  0.9236
    pitcher-hits-allowed   47% at 4.5             slope  0.1492
    pitcher-strikeouts     31% at 4.5             slope  0.1044
    pitcher-outs           16% at 16.5            slope -0.0649   <- inverted

That is the whole defect in one number. `pitcher-outs`, the market whose line
moves most, inverted outright and put backup catchers at the top of the board.

A market absent from this table gets a projection and a NULL probability, which
is the plan's existing rule for a market that has not earned one.
"""

# Verified against the median posted line in `prop_odds_archive` on 2026-09-06.
# Changing a value here changes what the board displays, what the model is
# calibrated for, and what a null-line row grades against — all three together,
# which is the point. Re-fit after changing one.
BOARD_LINES: dict[str, float] = {
    # Batters — chances are plate appearances.
    "hits": 0.5,
    "total-bases": 1.5,
    "hits-runs-rbis": 1.5,
    "home-runs": 0.5,
    "rbis": 0.5,
    "runs": 0.5,
    "singles": 0.5,
    "doubles": 0.5,
    "triples": 0.5,
    "walks": 0.5,
    "batter-strikeouts": 0.5,
    "stolen-bases": 0.5,
    # Pitchers — chances are outs recorded.
    "pitcher-strikeouts": 4.5,
    "pitcher-outs": 16.5,
    "pitcher-hits-allowed": 4.5,
    "earned-runs": 2.5,
    "pitcher-walks-allowed": 1.5,
}
