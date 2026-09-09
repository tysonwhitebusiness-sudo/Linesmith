# Linesmith master plan — 2026-09-06

Supersedes the phase numbering in `model-build-plan-2026-09-02.md` and the track
lettering in `audit-remediation-plan.md`. Those documents keep their measured
results and their reasoning; this one owns the ORDER.

Every claim inherited from an older doc was re-checked against the database and
the tree before being carried in. Stale ones are marked and corrected.

---

## The rules

1. **Subtract before adding.** The last three phases were executed add-only —
   the audit prescribed deletions that never happened, so each correct new thing
   was built beside an old wrong one. That is the mechanism behind "every time we
   build something the app regresses another way." Phase 1 exists to stop it.
2. **One surface.** Scan is the product. Nothing gets its own page because it is
   easier to build there.
3. **A model ships when it is measured, not when it is written.**
4. **Commercial and infrastructure come last**, after the product is worth
   selling.

---

## Corrections to inherited claims

Checked 2026-09-06:

| older doc says | actually |
|---|---|
| `ingestNbaShotsJob` **never run** | **HAS run** — `nba_shot_events` holds 219,873 rows to 2025-04-13 |
| `ingestNflPbpJob` **never run** | **HAS run** — `nfl_target_events` holds 35,430 rows |
| Track E: `player_game_history` non-zero for MLB/NBA/golf/tennis | **satisfied** — non-zero for all nine sports |
| Track E: `model_calibration` non-empty | **satisfied** — 89 rows, MLB 13 + NHL 5 active |
| Assume **Free tier**, 500 MB ceiling | **wrong** — on Pro, 6,459 MB of 8,192 |
| Track F: `odds_unresolved` near zero | **still open** — 22,838 rows |
| NFL props blocked on snap counts (`model-rebuild-plan.md` §8) | **wrong** — 58,152 rows carry receiving targets |

---

# Phase 1 — Consolidation — **DONE 2026-09-06**

**Goal:** one model, one table, one surface. Nothing new is built until this
lands.

**Net: 3,435 lines deleted, 222 added.** 21 modules removed, 8 jobs
de-registered, 2 pages and 3 components gone.

## What was planned, and what was actually done

- **1.1 Delete the condemned scoring layer.** `edge_model` (118 lines),
  `prop_score` (180), `good_bets` (139), `live_edge` (431). The audit named all
  four for deletion; task 4.12 already measured `prop_score` and found that with
  `model_prob` held fixed its ordering collapses — D outranks C+, A is
  indistinguishable from B. Its extra terms carry almost no signal.

  **Done, with one deliberate departure: `live_edge` was SPLIT, not deleted.**
  Only about a third of it was the condemned edge score. The rest is the only
  genuine price machinery this app has — the sharp/consensus reference, the
  two-sided de-vig, the staleness bounds, `real_line_for`, `best_price` — with
  four dedicated test files, a live import from `generic_price_attach`, and
  three of Phase 8's own sourcing items written as assertions about it. Phase 2
  needs it for the implied-probability column. It is now
  `predict/price_resolution.py`; `resolve_candidate_edge` became
  `resolve_candidate_price`, and the dead `raw_model_prob`/`model_prob`
  passthrough (kept since 2026-08-27 "for signature stability with existing
  callers", all of whom are now deleted) went with the rest.

- **1.2 One prop engine.** Migrate `nhl_props` onto `count_prop_engine` and
  delete the duplicated maths (~90 lines).

  **Done — 95 lines.** `nhl_props` now binds the shared engine with
  `MINUTES_PER_GAME = 18.0`, the NHL constant that used to be hard-coded inside
  its private `shrunk_rate`. Every caller was moved to the engine's field names
  (`expected`/`projected_volume`/`rate_per_chance`) rather than left behind a
  translation shim, so there is no second vocabulary either.

  `test_count_prop_engine.py` asserted the two implementations agreed. That
  assertion is now meaningless — there is only one — so the file was rewritten
  as a **regression pin**: `src/nhl_props_golden.json` holds 1,500 projections
  and 1,500 probabilities computed by the pre-migration code (recovered from
  commit `a49f8b5` and executed, not transcribed) before it was deleted. The
  engine reproduces all 1,500 projections **exactly**, and the probabilities to
  a worst deviation of **6.99e-07** — inside the 2.72e-6 the plan predicted, and
  four orders below the gate tolerance. A fourth test asserts the *structural*
  claim too (NHL's types must BE the engine's), because a future private copy
  would otherwise pass the numeric pin on the day it was written.

- **1.3 Delete the parallel surfaces.** `/mlb/projections`, `/nhl/projections`,
  `StatsBoard.tsx`, both projection panels. Built 2026-09-05/06 and never asked
  for. The serving pipe, `prop_model_cache`, the calibration store and the
  adapters survive.

  **Done.** Confirmed first that nothing linked to either page — they were
  reachable only by typing the URL. Both now 404 on a clean server; the routes
  and adapters still serve real ranked data.

- **1.4 Retire the generic prop pipeline** once Phase 2 proves the replacement —
  `generic_prop_score` (226) + `generic_prop_production` (541).

  **PULLED FORWARD into 1.1 by operator decision (2026-09-06).** Keeping it
  would have defeated 1.1 entirely: the six `genericPropProduction*Jobs` and
  `computeMlbPropPredictionsJob` were the condemned layer's only real consumers,
  so leaving them alive meant leaving the condemned arithmetic alive inside
  them. Deleted with the layer: `generic_prop_score`, `generic_prop_production`,
  `generic_rare_markets`, `generic_dimension_configs`, `generic_prop_grading`,
  `prop_candidates`, `prop_pick_history`, `market_trust`, `windowed_stat`.

## Operator decisions recorded 2026-09-06

1. **`live_edge` is split, not deleted** — see 1.1 above.
2. **The generic pipeline dies now, not after Phase 2.** Accepted cost:
   `pick_history` stops accruing new prop rows for seven sports, and Scan's
   non-MLB/NHL prop rows go away until Phases 4-7 restore them on validated
   models.
3. **The TypeScript twins survive until Phase 2.** `propScore.ts`,
   `goodBets.ts`, `edgeModel.ts` and `liveEdge.ts` are what Scan renders today;
   deleting them in Phase 1 would have left Scan blank for a whole phase with
   nothing built to replace them. They die when Phase 2 replaces the surface.
4. **Model % may appear alongside Implied %** on Scan. This closes the open item
   in §2.3 — both columns ship.

## Three things found while doing it

1. **`prop_candidates.py` was the live MLB prop producer, not just condemned
   code.** Deleting it looked like it would blank MLB props on Scan.
   `lib/sports/mlb/adapter.ts` turns out to have a documented fallback
   (`PROP_MODEL_CACHE_MAX_AGE_MS`) that recomputes the prop model locally when
   the cache goes stale, so the TS twin — kept by decision 3 — covers the gap.
   Checked before deleting, not after.
2. **Two modules reached into the delete set for things that were not condemned
   math**, and both were re-homed rather than dragged along: `mlb_prop_grading`
   needed the live-feed market map, now `predict/mlb_stat_markets.py`;
   `home_run_model_fit` needed one beta-binomial posterior, now ~20 lines
   specialised to home runs inside `home_run_model.py` and verified **bit-exact**
   against the deleted general version across the matchup shift and standard
   deviation. The 118-line general module and its per-market prior table are
   gone.
3. **`db.live_market_skill` was orphaned** by `market_trust`'s deletion — 33
   lines with no remaining Python caller. Removed. The TS twin is still live and
   is Phase 2's to decide on.

## Gate — met

- **One implementation of the prop maths** — in Python. The TS twins survive by
  explicit decision 3 above; Phase 1 did not and could not close that half.
- **One table holding prop model output** — `prop_model_cache`, written only by
  `mlb_prop_serving` and `nhl_prop_serving`. `pick_history` now receives only
  MLB game-moneyline rows, from the validated game model.
- **No page renders a model number except Scan** — both projection pages 404,
  verified in a browser on a clean server. (The first check was run against a
  dev server started before this work and returned the page from a stale
  compiled route; a fresh server was used instead.)
- **`tsc` clean; 346 TS tests, 0 fail** (347 before — the one removed is the
  copy-language assertion that read the deleted `StatsBoard.tsx`; see below).
  **50 Python test files pass**, same 4 pre-existing non-failures as before
  (2 exceed a 180s cutoff, 2 environmental). Production build succeeds.

## What Phase 2 inherits

- **A guard it owes.** `tests/stats-board-no-edge.test.ts` asserted that no edge
  or profit language reached the board's rendered copy. That component is gone
  and the assertion was NOT re-aimed at Scan, because decision 4 deliberately
  puts a model probability next to an implied one there — re-aiming it today
  would fail on work not yet done. Phase 2 must restore the constraint against
  the surface it builds: no edge, no profit, no beaten close, and only the two
  approved identifiers.
- `prop_model_cache` and `/api/{mlb,nhl}/projections`, serving 11 MLB and 5 NHL
  markets with a per-market `hasProbability` flag — the ranked data §2.1 needs.
- Four TypeScript modules still to delete when the surface is rebuilt.

---

# Phase 2 — Scan, the only surface — **BUILT 2026-09-06**

**This is the product. Everything else feeds it.**

## What shipped

- **Good Bets is gone from Scan** — the tab, the "Good Bet only" filter and the
  Reason column. `propScore.ts` and `PropScoreBadge.tsx` are deleted.
- **The ranking is the table's default sort**, not a tab. Every sport opens on
  All, ranked.
- **Columns**: `Avg L10` → **`Proj`** (the hero number, unit muted after it),
  `Diff` is now **projection − line**, **`Model %`** sits beside `IP`, and
  **`Conf`** shows sample size as Thin/Some/Deep history.
- **Rank chip** in the leftmost cell: 1-3 filled, 4-10 outlined, 11+ muted.
- **`lib/sports/propRanking.ts`** — the metric, with 8 tests.
- **`tests/scan-no-edge.test.ts`** — the guard Phase 1 owed, now aimed at Scan.

## Four things that were wrong underneath, found by building on them

1. **The ranking metric had no valid input.** The plan said to rank on
   `P(over) − league baseline`, and the obvious candidate — `league_rate`, which
   `prop_model_cache` already carried on every row — is **not a probability**.
   It is the engine's per-CHANCE rate: 0.222 hits per plate appearance, 0.318
   strikeouts per out recorded. Subtracting it from a calibrated probability is
   a unit error that produces a plausible number rather than an error. Added
   `league_baseline` (migration `20260906120000`), computed by each serving job
   as P(stat > line) over the same history it built the projections from.

   **The population is the whole question, not a detail.** P(K > 4.5) is
   **0.129** across all pitcher-games and **0.630** across starts of 15+ outs —
   a five-fold swing that reorders the entire board. Neither pipe picks a
   threshold; each measures over exactly the history it already loaded, so the
   population matches the rows served by construction.

2. **The serving pipe could not serve a live slate.** `build()` took its slate
   from `player_game_history WHERE game_date = as_of` — games *already played
   and recorded*. That is the walk-forward's shape and it can never answer "who
   plays tonight". `player_game_history` also ended 2026-08-28, so all 338
   cached MLB rows were nine days stale. Added `live_slate_subjects`, which
   resolves today's posted lineups and probable starters from the MLB schedule,
   with each team's most recent lineup as the pre-lineup fallback. Verified
   live: **15 games, 29 posted lineups, 1 projected, 2,078 projections.** The
   model math is untouched; only which players it is asked about changed.

3. **The projection reads served a union of slates.** `prop_model_cache` upserts
   on `(sport, game_id, subject_id, dimension, category)`, so a new run sits
   beside the old rather than replacing it, and the routes had **no date
   predicate at all**. Measured: five runs coexisting, spanning 15- and 17-game
   slates, with the same player appearing more than once. Reads are now scoped
   to `computed_at = max(computed_at)` — one transaction, one timestamp, one
   slate — and `asOf` is exposed so a stale board can say so.

4. **The board opened at #117.** Ranking was computed over the served board
   while the table shows a filtered subset (it drops rows with no posted price),
   so the top 116 were real but elsewhere. `rankWithin` is now applied to the
   rows actually rendered, which is also what makes a market filter produce a
   1..N leaderboard for free. It was made non-mutating at the same time — it had
   been renumbering the hook's shared rows as a side effect of one component's
   filtering.

## The pitcher markets: an operator decision, and what it produced

Before building, measurement found two defects in the *fitted* calibrations:

- **`pitcher-outs` ranks backwards.** `corr(projection, model_prob) = −0.933`;
  its Platt slope is negative (−0.065). Every other market is +0.94 to +0.996.
- **`pitcher-strikeouts` is crushed flat.** Slope 0.104 maps raw 63% → 51.9% and
  raw 0.55% → 37.2%.

Root cause: those calibrations were fitted against rows at the **market's own
lines** (centred near 50%) and are served at the board's **fixed** line, far
outside the region they were fitted in. The fit's gate checked
`ordering_monotone` on the *projection*, never on the *calibrated probability*,
so the hole was never tested.

**The operator decided 2026-09-06 to keep all pitcher probabilities and fix them
in Phase 3.** Built as decided. The measured consequence, from the live board:

```
#1  Luis Torrens    pitcher-outs  proj 2.00 outs  P 65.1%  base 37.0%  +28.1pt
#2  Jhonny Pereda   pitcher-outs  proj 2.20 outs  P 64.0%  base 37.0%  +27.0pt
#3  Kody Clemens    pitcher-outs  proj 2.40 outs  P 63.1%  base 37.0%  +26.0pt
```

Those are position players and backup catchers who threw a mop-up inning,
holding the top of the entire cross-market board, because the inverted
calibration rewards the *lowest* projection. **Phase 3.4 owns the re-fit.** A
one-line serving guard (refuse a non-positive calibration slope) would drop
`pitcher-outs` to projection-only under the plan's existing rule for a market
that has not earned a probability; it is not applied, by decision.

## Gate

- **Good Bets gone** — verified in a browser: the tab strip reads
  All / Coming up / Watchlist / Home Runs.
- **One table, ranked by default** — verified in a browser with real data: 150
  rows, headers `Player | Odds | IP | Model % | DVP | Proj | Diff | Conf | L5 |
  L10 | L15 | H2H | Strk | SZN`, rank chips rendering.
- **Market filter re-ranks 1..N** — verified against the live API through the
  real modules: served ranks `91, 109, 135, 138, 146, 155` renumber to
  `1, 2, 3, 4, 5, 6`.
- **Every row carries a sample size** — the `Conf` column, on every row with a
  projection.
- **`tsc` clean; 359 TS tests, 0 fail** (346 before; 13 added).

**One gate item is not fully met and is stated rather than claimed.** "Verified
in a browser with the top of each market face-valid" was confirmed for the
column set and the chips, but tonight's MLB slate finished during the work
(2,382 of 2,739 candidates went `done`), so the ranked board could not be
painted at #1 in a browser; that step was verified against the live API through
the real ranking module instead. And the top of `pitcher-outs` is **not**
face-valid — see above. It is a known, measured, deliberately-retained defect,
not an unverified one.

## Deliberately out of scope

`goodBets.ts`, `edgeModel.ts` and `liveEdge.ts` survive. Phase 1 listed four
TypeScript modules to delete here; that list was made before their reach was
mapped:

- **`liveEdge.ts` is price plumbing**, the TS twin of the `price_resolution.py`
  Phase 1 deliberately kept. It drives Scan's Odds and IP columns.
- **`edgeModel.ts`** feeds PlayerDetail and the Home Runs board, both of which
  Phase 3 owns.
- **`goodBets.ts`** no longer touches Scan, but still serves GameDetail's panel
  and the historical track record. Phase 11 owns that page.

# Phase 3 — Finish MLB

- **3.0** **The pitcher re-fit — BUILT 2026-09-06.** Carried in from Phase 2,
  which shipped `pitcher-outs` inverted by operator decision. Written up in
  full below; it is unnumbered in the original plan because `CURRENT.md` filed
  it under "3.4", a number already taken by the simulation comparison.
- **3.1** Statcast skill-vs-luck prior — **MEASURED NO, 2026-09-07.** Built,
  measured, rejected. Reproducible: `python experiment_statcast_prior.py`.
  Written up below.
- **3.2** Home runs — **MODELLABLE AND SHIPPED, 2026-09-07.** The premise was
  wrong: the data existed under a `type_name` nothing read. Written up below.
- **3.3** Plate-appearance simulation — **BUILT AND VALIDATED, 2026-09-07.**
  `predict/mlb_pa_sim.py`, `calibrate_pa_sim.py`, `src/test_pa_sim.py`. Written
  up below. NOT wired to any surface: 3.4 decides that.
- **3.4** Sim vs direct model — **MEASURED: A TIE, 2026-09-08.** The direct
  model keeps the props board; the simulation's case rests on game markets.
  `compare_sim_vs_direct.py`. Written up below.
- **3.5** Game ship gate — **MEASURED 2026-09-08: NO DEMONSTRATED EDGE, and the
  first measurement was contaminated.** `clv_pregame_rebuild.py`. Written up
  below.

## 3.5 — the game ship gate, and a broken measurement that looked like a broken model

**First answer, from `clv_backtest` as it stood:** moneyline CLV mean -0.0791,
34.5% beating the close, **t = -5.83**; total mean -0.0168, **t = -2.78**. Read
literally, the game model was losing badly to the closing line on both markets.

**That measurement was contaminated, and the contamination was in the entry
price.** The worst rows had entry prices of -10000 — a 99% implied probability
— sitting in the same `game_picks` row as a pinnacle market probability of 0.50.

The cause is not corrupt data. It is IN-PLAY data. Measured on
`game_odds_book_lines`, MLB moneylines, joined to each game's own commence_time:

    implausible prices (|odds| >= 1000):  70 rows, 70 fetched AFTER first
                                          pitch — 100.0%
    ordinary prices    (|odds| <  1000): 629 rows, 537 after — 85.4%

A moneyline reaches -10000 once a team has all but won, so those are REAL
prices — just not prices anyone could have taken at pick time. One game carried
betmgm home -200, fanduel home +215 and hardrockbet home -10000 side by side,
which is only possible across different in-game moments. Both price-attach
paths recorded whatever the book was quoting when their job ran, and those jobs
run during games; `attach_moneyline_price` writes once behind a `price IS NULL`
guard, so the first value in became permanent. **22 of 291 MLB picks** were
priced this way.

`_market_prob_for`, in the same file reading the same rows, was never affected —
it requires both sides from the same book and de-vigs, so a lone in-play row
cannot satisfy it. One column of `game_picks` was right while the column beside
it was wrong.

**Both write paths are now guarded** — `_reference_row` takes a `commence_time`
and returns nothing rather than an in-play price; `odds_lines_cycle` skips a
game that has already started. Pinned by `src/test_pregame_price_only.py`.

**The history could not be repaired in place** — only 6 of 295 MLB picks have
any pregame row in `game_odds_book_lines`. But `game_odds_history` is a genuine
point-in-time log (223,995 rows, 735 events, 51.9% pregame coverage, 0.76%
implausible), so the measurement was rebuilt from it: entry = last observation
at or before the pick's own capture time, close = last before first pitch, both
from the SAME book, entry strictly before close.

**REBUILT RESULT — one value per pick, averaged across the 18 books with real
coverage:**

| market | n | mean | median | beat close | mean t | sign test |
|---|---|---|---|---|---|---|
| moneyline | 129 | -0.00709 | -0.00659 | **34.9%** | -1.57 | **z=-3.43, p=0.0006** |
| total | 133 | -0.00038 | -0.00177 | 48.9% | -0.12 | p=0.79 |

**The two tests disagree on moneyline, and both are reported rather than
choosing the flattering one.** The distribution is skewed: more picks lose a
little to the close than beat it (sign test, significant), but the wins are
larger when they come (mean test, not significant). Economically the mean is
what a bettor collects; the sign test says the model is more often on the wrong
side of small moves.

**VERDICT: no demonstrated edge on either market, and no evidence of the severe
negative CLV originally reported.** The gate asks for positive closing line
value. There is none — moneyline is mildly and inconsistently negative, totals
are indistinguishable from noise. The game model does not ship on this evidence.

**Two limits on how far this should be pushed.** The window is short —
`clv_backtest`'s own docstring records that everything before 2026-08-27 is
permanently unjoinable, because the-odds-api rows were keyed by a foreign UUID
rather than the real MLB game_pk. And n=129/133 picks is thin for a market
question. The honest reading is "no edge demonstrated yet", not "no edge
exists"; the corrected pipeline will accumulate clean evidence from here.

---

## 3.4 — a dead heat, and the first answer was an artifact of my own comparison

`compare_sim_vs_direct.py`. Both models scored on **identical held-out rows**,
same 2026-01-01 split, same strictly-before leakage rule, same paired t-test the
fitter uses for its betting bar. The direct model's numbers come from the
PERSISTED calibration — the control the board actually has.

**Result, 2,647 simulated games at 4,000 iterations:**

| market | n | direct | sim | delta | t | verdict |
|---|---|---|---|---|---|---|
| hits | 28,239 | 0.66798 | 0.66790 | -0.00008 | -0.18 | TIE |
| singles | 28,175 | 0.68305 | 0.68269 | -0.00036 | -0.90 | TIE |
| **home-runs** | 28,251 | 0.35356 | **0.35266** | **-0.00090** | **-2.69** | **SIM BETTER** |
| total-bases | 15,942 | 0.67102 | 0.67120 | +0.00018 | +0.26 | TIE |
| **pooled** | **100,607** | 0.58439 | 0.58404 | -0.00035 | **-1.57** | **TIE** |

**THE FIRST RUN SAID THE OPPOSITE, AND IT WAS MY COMPARISON THAT WAS WRONG.**
Uncalibrated, the simulation lost decisively — pooled **t = +6.12**, "DIRECT
BETTER" on three markets. That verdict looked clean and publishable. It was an
artifact: the direct model's probability passes through a fitted Platt
calibration and the simulation's was raw Monte Carlo frequency, so the two were
never comparable. The tell was that the simulation ran high on **all four**
markets at once — four independent failures in the same direction is a missing
layer, not a modelling defect.

Giving the simulation its own Platt, **fitted on SELECT only** (fitting it on
held-out rows would be leakage and would flatter it into an unearned win), moved
the pooled result from t=+6.12 against to t=-1.57 slightly for. The simulation
is now **better calibrated than the direct model on three of four markets**:

    market        mean p_direct   mean p_sim   actual
    hits             0.5760        0.5683      0.5622
    singles          0.4543        0.4519      0.4483
    home-runs        0.1182        0.1162      0.1159
    total-bases      0.3781        0.3980      0.3932

**A CAVEAT THAT CUTS ONE WAY.** Monte Carlo noise at 4,000 iterations adds
~1.5e-4 to the simulation's log-loss and falls only on the simulation. So the
home-runs win is CONSERVATIVE — the true effect is at least that large — and the
pooled TIE may understate the simulation: removing that penalty from a -0.00035
delta would put t near -2.2, which is significant. The pooled verdict genuinely
sits on the boundary and is not claimed as more than a tie. Settling it needs a
10,000-iteration re-run.

**THE VERDICT: the direct model keeps the props board.** A tie means no change,
because the simulation is the more expensive thing to run and maintain, and
-0.0005 log-loss does not buy a Monte Carlo per slate against a closed-form
model.

**But this is not a rejection the way 3.1 was.** A from-scratch simulation
fought a tuned, validated, calibrated direct model to a statistical draw and beat
it on one market. The simulation's real case was never props — it is game
markets, which the direct model cannot answer at all. If Phase 3.5 puts it in
production for moneyline and totals, serving home runs from it costs nothing
extra.

**THREE BUGS FOUND HERE, ALL IN PHASE 3.3 CODE COMMITTED THE DAY BEFORE**, none
visible by reading it:

1. **`PaRates.from_counts` double-subtracted strikeouts.** `raw[:I_OUT]` spans
   indices 0..6, which already includes K at 6, and K was subtracted again. OUT
   was understated by the whole strikeout rate, the distribution summed to 0.778,
   and normalisation inflated every other outcome by **1.286x**. The 3.3 tests
   could not catch it: they all build `PaRates(LEAGUE_PA)` directly and never
   call `from_counts`. It surfaced as a simulated home-run rate of 0.203 against
   a real 0.116, found by a calibration diagnostic. Now pinned by a round-trip
   identity test.
2. **The calibration asymmetry above.**
3. **An unbounded half-inning.** `while outs < 3` never terminates if a matchup
   yields P(K)+P(OUT) ~ 0. Capped at 60 batters — about 3x the largest half-inning
   in major-league history, verified bit-identical on real play. It would have
   been indistinguishable from the machine-sleep hangs that killed two runs.

---

## 3.3 — the plate-appearance simulation, and a run deficit that is explained

`predict/mlb_pa_sim.py`. Eight PA outcomes (1B/2B/3B/HR/BB/HBP/K/OUT), combined
batter-against-pitcher by log5, drawn into an explicit base-out state, nine
innings, ten thousand times. **Nothing is wired to a surface** — Phase 3.4
decides whether it earns one.

**Validated against real baseball**, league-average lineups, 5,000 games:

    runs per team-game   4.16    real 4.4 - 4.6    <- short by ~0.3, explained
    PA per team-game    38.7     real ~37.9        <- high by ~0.8, same cause
    hits per team-game   8.56    real 8.0 - 8.5
    shutout pct          7.0%    real 7 - 8%
    10+ run pct          5.1%    real 3.5 - 5.5%
    P(home run)          0.121   measured baseline 0.112
    P(a single)          0.470   measured baseline 0.447

**THE RUN DEFICIT IS EXPLAINED AND DELIBERATELY NOT TUNED AWAY.** This model
scores only through plate appearances. Real baseball also scores on events that
are not plate appearances — reached-on-error ~0.12 runs/team-game, net stolen
bases ~0.10, wild pitches and passed balls ~0.08, totalling ~0.30. That puts
4.16 + 0.30 = **4.46, inside the real range**. The PA excess is the mirror image:
real games fit fewer plate appearances into 27 outs because caught stealings and
pickoffs consume outs without a PA.

**The sweep's best parameters were REJECTED.** `calibrate_pa_sim.py` scores best
at `P_GIDP=0.19` — half again baseball's real 0.12-0.13. It wins only by
dragging PA/game toward target, standing in for a mechanism the model does not
have. Tuning one parameter past its real value to cover for a different absent
one buys the aggregate and loses everything underneath, which is the precise
failure this phase is exposed to. Every constant is held at its real value and
the residual is documented instead.

**WHICH MARKETS THIS BIASES.** Hits, singles, doubles, triples, home runs, total
bases and strikeouts are PURE PA OUTCOMES — baserunning does not touch them, so
the deficit does not bias them at all, and those are what 3.4 compares on. Runs,
RBIs and any game total DO depend on advancement and run low; **Phase 3.5's game
gate needs non-PA events modelled first.**

**Two real bugs were caught building this, both by measurement rather than
inspection.** A first cut of the single-advancement rule scored the runner from
second only when the runner from first did not take third — conflating two
independent runners, and costing runs in a way that read as a modelling choice.
And `LEAGUE_PA` summed to 1.00001, so `matchup`'s renormalisation shifted every
rate even for the average-vs-average case that should be an identity. Both are
pinned by `src/test_pa_sim.py`.

Still absent, each a candidate if 3.4 says the idea has legs: errors, steals,
wild pitches, sacrifices; park factors (no player-game-to-venue join exists);
platoon splits; times-through-the-order; and a real bullpen — today a starter is
pulled after 24 batters faced and everything after is league-average.

## 3.2 — home runs was never unmodellable; 37,252 rows were unread

**The plan's premise was wrong, and so was the market map's own note.** Both
said home-run coverage ends 2025-11-02, leaving no held-out rows. Measured, the
archive holds **three** schemes for one market:

| `type_name` | rows | span | in the map? |
|---|---|---|---|
| `Total Home Runs Hit` | 54,740 | 2025-03-27 .. **2025-11-02** | yes |
| `home-runs` (live feed) | 4,373 | 2026-09-03 .. 09-07 | yes |
| **`Home Runs Milestones`** | **37,252** | **2026-04-11 .. 2026-09-02** | **no** |

The two mapped schemes really do leave nothing testable — the historical one
ends in 2025 and the live one begins *after* `player_game_history`'s last
outcome (2026-08-28). So "no held-out rows" was true of what the fitter was
looking at. It was not true of the data.

**Why the third scheme was excluded: its lines are integer MILESTONES.** A
milestone line `L` means "L or more", where every other line in this archive is
a half-integer meaning "strictly more than". Verified empirically rather than
assumed, n=31,238 joined rows:

    P(hr >= line) = 0.1119     <- correct; matches the half-integer scheme
    P(hr >  line) = 0.0069     <- an ordinary-line reading: "2+ home runs"
    reference, `Total Home Runs Hit` at 0.5:  P(hr > 0.5) = 0.1170

0.1119 against 0.1170 is one event on two schemes. 0.0069 is a market sixteen
times rarer, and nothing about it looks wrong on inspection — it would simply
train and calibrate confidently on the wrong question. **This is the same trap
the plan already records for NFL in Phase 6.**

`MarketSpec.milestone_names` now carries such schemes separately from `names`,
and the loader converts `L -> L - 0.5`. A non-integer line under a milestone
name is SKIPPED rather than shifted, because shifting one would create the very
off-by-one the branch removes.

**Result — home runs passes every gate:**

    held out n=30,975   log-loss 0.34510   acc 88.8%   slope +0.9995
    ordering Q1 0.070 -> Q5 0.176 (monotone, 2.5x)
    ECE 0.0090 (<=0.025)   worst 0.020 (<=0.05)   verdict: rank + probability

Against a constant predictor fitted on SELECT it gains **+0.00677 log-loss
(1.92%)** — for scale, that is **260x** the xwOBA effect rejected in 3.1.
Persisted and live: home runs serves 196 projections, all with a probability.
**The board goes from 7 markets with a probability to 8.**

**An audit found NO market ingesting an integer scheme through `names`**, so no
historical fit was corrupted. Pinned by `src/test_milestone_lines.py`.

### The other four milestone schemes — wired, and only two of them helped

All four are now declared. **They are not four wins; they are two**, and the
reason is worth keeping.

**Every milestone scheme sits entirely inside the held-out window (2026).** A
fit needs rows on BOTH sides of the cutoff — SELECT to choose the grid point and
fit the calibration, held-out to test it:

| market | SELECT | held-out before -> after | outcome |
|---|---|---|---|
| stolen-bases | 8,899 | 12,548 -> **46,087** | fittable; test set 3.6x |
| pitcher-strikeouts | 5,568 | 3,401 -> **6,797** | fittable; test set 2x |
| batter-strikeouts | **0** | 35,627 | NOT fittable |
| walks | **0** | 69,624 | NOT fittable |

`walks` and `batter-strikeouts` have the opposite of the usual problem: tens of
thousands of rows to TEST against and nothing to TRAIN on. No milestone wiring
fixes that. Their names are declared anyway so each becomes fittable the moment
a pre-2026 source appears, with no code change.

**`NOT_YET`'s stated reason was wrong and is corrected.** It said "live scheme
only, four days deep". For `walks` that is false — `Total Walks (Batter)` alone
carries 34,534 usable rows. The real reason is zero SELECT-era data. Same
conclusion, wrong evidence, and the wrong evidence would have sent the next
person hunting for the wrong fix.

**For the two that were fittable, the MODEL DID NOT CHANGE — only the test.**
Milestone rows are all held-out, so SELECT was untouched, and SELECT is what
picks the grid point and fits the calibration. Both calibrations came back
bit-identical (+0.7676 and +0.9740). This is a confidence gain, not a
performance gain:

    stolen-bases        n 11,190 -> 40,322   ECE 0.0108 -> 0.0132   still rank+probability
                        ordering Q1 0.019 -> Q5 0.181 (9.5x) on 40k rows
    pitcher-strikeouts  n  2,474 ->  4,944   ECE 0.0360 -> 0.0360   still rank only

`stolen-bases`' log-loss "improving" 0.330 -> 0.256 is NOT a real gain — the
2026 population has a lower base rate (0.0665 against 0.1134), so the number is
not comparable across different test sets. What is real: `pitcher-strikeouts`'
ECE failure is now confirmed on double the evidence rather than possibly being
small-sample noise.

**Semantics were verified per scheme, not assumed.** `stolen-bases` initially
looked wrong (milestone 0.0665 against a 0.1134 reference, a 1.7x gap). The
clean test is rows where the SAME (athlete, date) carries both schemes, which
admits no population or era confound: **100.0% agreement** for walks
(41,890/41,893) and stolen bases (15,403/15,404). The gap was population. The
`Strikeouts Thrown` mismatches (84.7%) are books posting genuinely different
alt-lines — 6 against 4.5 — not a semantic difference.

Also still unread: `Total Walks (Batter)` (34,534 usable rows, half-integer),
whose exclusion note blamed missing PRICES. That reason stopped binding when
Phase 3.0 moved calibration to the board line — the stats bar never reads a
price — but it does not matter either way while walks has no SELECT rows.

## 3.1 — the Statcast prior is a measured NO

**The join is real and was re-verified before anything was built on it.**
`player_game_history.event_id` IS the MLB `gamePk`: 6,885 distinct games in the
overlap window, **100.00% matched with 100.00% game_date agreement**, and
**98.3% coverage** of the batter player-games the model actually fits (136,518
of 138,902 since 2024-03-01). Nothing below is a data-plumbing artifact.

**The first answer was wrong, which is the point.** Against a control of prior
hit-rate alone, xwOBA looks like a clear win — held-out log-loss 0.620443 ->
0.620221 at **t = -4.06**. It is not. Almost all of that is xwOBA proxying for
the batter's POWER, which the model already reads off his own `bat_totalBases`
history for free:

    corr(prior xwOBA, prior TB/PA)    = +0.658
    corr(prior xwOBA, prior hits/PA)  = +0.461
    R^2 of xwOBA from those two       =  0.433

Put prior TB/PA in the control — ask xwOBA to beat what the model ALREADY HAS
rather than a strawman — and the effect collapses **8.5x**, to delta -0.000026.
That is 0.004% of the log-loss, against the **0.064** that prior hit-rate itself
buys over the league base rate: three hundred times smaller than the signal it
is being added to.

**1 of 8 fair tests found any improvement.** The power markets are where the
hypothesis should be strongest — xwOBA is weighted toward extra-base hits — and
they tie with the sign pointing the wrong way. A gradient-boosted model finds
nothing linear regression missed. And the prior-game bands kill the last version
of the claim: a prior binds hardest when the observed rate is noisiest, and the
5-14-prior-games band ties too.

*(An earlier cut of that band test used a FLOOR rather than bands, which never
isolates a noisy player at all — a min-5 population still contains every
veteran. Worth knowing before re-running this with a "fix".)*

**What it would have cost:** a join against `mlb_pitch_events` (452 MB, 2.17M
rows) inside the serving pipe, a second freshness contract (Statcast runs to
2026-09-06, `player_game_history` ends 2026-08-28), and a new empty case for the
18.2% of batter-games with no tracked contact.

**Recorded like tennis (t=+20.68) and soccer (t=+3.05): built, measured,
rejected — not "not built yet."** Reopening needs a NEW feature, not a re-run.
xwOBA per se is spent. The candidates this did not test, because the data is not
in `player_game_history`, are batted-ball spray and pitcher-side contact quality
allowed. Neither is a re-fit of this.

## 3.0 — the pitcher re-fit, and a calibration measured where it is served

**The defect.** `pitcher-outs` served a Platt slope of **-0.0649** with
`probability_ok = True`. `platt` is sigmoid(a*logit(p)+b), so a negative `a`
mirrors the curve: the lower the raw probability, the higher the number
published. At the board's fixed line of 16.5 outs that put position players who
threw a mop-up inning at the top of the entire cross-market board.

**Three gates existed and none of them asked the right question.**
`ordering_monotone` is measured on the PROJECTION; `ECE` and `worst bucket` were
measured at each archive row's OWN market line. All three passed. Measured at
market lines, `pitcher-outs` had **the best calibration numbers of any MLB
market — ECE 0.0050, worst bucket 0.005** — while being catastrophically
inverted at the line it was actually served at.

**The root cause, as one number.** The calibration was fitted at each row's
market line and applied at one fixed board line. Where a market's posted line
barely moves those are the same question; where it moves a lot the fit is
extrapolated. Across 11 markets, the share of posted lines sitting at the board
line predicts the fitted slope at **r = +0.849** (n=9,193 archived rows for
pitcher-outs alone):

    stolen-bases         100% of lines at 0.5     slope  0.7676
    singles               93% at 0.5              slope  0.9470
    hits                  84% at 0.5              slope  0.9236
    pitcher-hits-allowed  47% at 4.5              slope  0.1492
    pitcher-strikeouts    31% at 4.5              slope  0.1044
    pitcher-outs          16% at 16.5             slope -0.0649   <- inverted

**Three fixes, deliberately independent.**

1. `count_prop_engine.probability_is_servable`, called by BOTH serving pipes, so
   a row already persisted cannot reach a board inverted. It reads the slope via
   `effective_calibration_slope` rather than off one key: MLB stores
   `calibration_a` and serves through `platt`, NHL stores `temperature` and
   serves through `temper` (the a=1/T case). Reading only `calibration_a` would
   have silently blanked **all four NHL markets**.
2. `fit_mlb_props.py` refuses `probability_ok` on a non-positive slope, and now
   fits the calibration — and measures ECE/worst — **at the board's line**.
3. `predict/mlb_board_lines.py`: ONE definition of that line. There were two and
   they disagreed — `pitcher-outs` served at 16.5 but graded at 15.5,
   `pitcher-hits-allowed` served at 4.5 but graded at 5.5. Measured against
   `prop_odds_archive`, the served values are the correct ones (they are the
   median posted line); the grading fallbacks were wrong.

**Measured result.** Both broken markets are repaired as models and then fail
honestly as probabilities:

| market | slope before -> after | ECE before -> after | probability |
|---|---|---|---|
| pitcher-outs | -0.0649 -> **+1.1063** | 0.0050 -> 0.0430 | loses it |
| pitcher-strikeouts | +0.1044 -> **+0.9740** | 0.0145 -> 0.0360 | loses it |
| pitcher-walks-allowed | +0.3966 -> +0.4888 | 0.0188 -> 0.0271 | loses it |
| pitcher-hits-allowed | +0.1492 -> +0.2515 | 0.0292 -> **0.0214** | **gains it** |

Both repaired markets now discriminate strongly (served spread ~70pt against
`hits`' 40pt) and order monotonically — they rank well and are not calibrated
well enough to publish a number at a fixed line. That is the plan's existing
rule, now measured correctly rather than assumed.

**The neutrality check, which is what made this safe to ship.** Moving the
calibration target had to be neutral for the healthy markets, not merely good
for the broken ones. All six batter markets that published a probability keep
it; `hits` improved (0.0121 -> 0.0115), `stolen-bases` (100% line concentration)
is bit-identical, and `hits-runs-rbis` gained a lot of slope (0.5453 -> 0.8234)
exactly as its 72% concentration predicted. Held-out log-loss is unchanged for
every market, because the grid selection was deliberately left on market lines —
it chooses the projection model, where every posted line is a real observation.
Only the calibration, which must answer a question about one specific line,
moved.

**Net effect on the board: 9 markets with a probability become 7.** Three that
were not earning theirs lose them; one that was wrongly excluded gains one.

**Still open, and not gated.** A positive slope only says the ordering is not
reversed. `pitcher-strikeouts` shipped monotone at +0.971 and useless —
projections spanning 0.56..7.35 strikeouts mapped into a 35.3%..51.7% band, a
16.4pt spread where `hits` got 46.9pt. `served_probability_spread` is now
computed and persisted, but NOT gated: the honest threshold is not yet known and
inventing one would be a guess dressed as a criterion.

---

# Phase 4 — NFL

**MOVED AHEAD OF NBA on 2026-09-08: the NFL season starts 2026-09-09.** NBA
(now Phase 6) tips off in late October and loses nothing by waiting; its
evidence base is entirely historical either way.

**Every claim below was re-measured 2026-09-08 before these steps were
written**, because Phase 3 found four of its five premises wrong. Three
inherited NFL claims survived exactly (`nfl_target_events` 35,430 rows; 58,152
player rows carrying `receivingTargets`; games back to 1999). Two facts the plan
did not record change the shape of the whole phase:

**1. GAME MARKETS AND PROPS ARE IN COMPLETELY DIFFERENT STATES.**

    game markets   spread 15,269 / total 15,762 / moneyline 11,540 rows,
                   1999-09-12 .. 2026-12-25, 7,561 games in game_result
    props          152,417 rows across 1,039 athletes, but ONE season only:
                   2025-09-05 .. 2026-01-18, and dense only Sept-Nov

Game markets have deep multi-season history and are testable immediately.
Props are not.

**2. NFL PROPS CANNOT BE WALK-FORWARD VALIDATED ON EXISTING DATA.** There is no
split that works. Measured on the largest market, `Total Receiving Yards`:

    cutoff 2026-01-01 (MLB's):  20,433 SELECT /  42 held out
    cutoff 2025-12-01:          20,330 SELECT / 145 held out, 11 two-sided
    `Anytime Touchdown Scorer` at MLB's cutoff:      0 held out

Forty-two rows is not a test. This is the same wall Phase 3.5 hit — evidence
never captured cannot be recovered — and it has exactly one honest resolution:
**fit on the 2025 season and let the 2026 season, starting 2026-09-09, BE the
held-out set.** That is a real walk-forward with a real time boundary, and it is
only available because this phase starts the day the season does. It also means
the prop ship gate cannot be run in September. It accrues.

---

## 4.0 — Audit before fitting — **DONE 2026-09-08. All three gates pass.**

Reproducible: `python audit_nfl_phase4.py`. It re-derives every number below and
exits non-zero if any classification stops matching the data.

### 4.0a — every `type_name` classified

68 distinct schemes carrying a line, 152,417 rows, split three ways:

    player props   33 schemes   151,364 rows
    milestone      20 schemes       415 rows
    game/team      15 schemes     3,925 rows

Two assertions run on every audit, both currently zero: **no scheme classified
as a player prop carries integer lines** (that is the unread-milestone defect,
and it is silent), and **no declared milestone is actually half-integer**.

**The 20 milestone schemes are EXCLUDED, not mapped.** 415 rows across all
twenty, largest 59, and **not one carries a two-sided price**. There is not
enough there to fit, and folding them into an ordinary market's `names` would
import the `L` vs `L-0.5` off-by-one for no gain. This is the opposite call from
MLB, where one such scheme held 37,252 rows and was the sole 2026 coverage of a
market the plan had written off as unmodellable — the same check, a different
answer, because the data is different.

Semantics were still verified where testable: on rows where a milestone and an
ordinary scheme cover the same athlete and date and post the same value,
`L -> L-0.5` holds (8 -> 7.5, 11 -> 10.5, 3 -> 2.5). The apparent mismatches are
not off-by-one — yardage milestones post round numbers (25, 60) while ordinary
yardage lines are arbitrary (20.5, 57.5), so they are simply different bets.

**`Anytime Touchdown Scorer` is not one market.** It is an alt-line family:
0.5 (4,670 rows), 1.5 (4,277), 2.5 (2,764), 3.5 (51). Only the 0.5 line is
genuinely "anytime". Each row carries its own line so the data is usable as-is,
but treating the `type_name` as a single market would be wrong.

### 4.0b — the join, verified by DATE AGREEMENT

    exact date match       : 6,969 pairs (89.7%)   138,372 rows (97.5%)
    off by exactly ONE day :     0 pairs ( 0.0%)   <- a date bug would live here
    within a week, not 1   :   401 pairs ( 5.2%)   bye week / DNP
    no game within a week  :   396 pairs ( 5.1%)   inactive / never played
    id never resolved      :    28 pairs ( 0.4%)

**Zero off-by-one is the result that matters.** The standing rule is that a
numeric id matching the expected shape is not evidence it is the right id — 399
MLB ids once matched by shape and 0.00% landed on the right game date. Here the
10% that miss are players who did not play, which is correct behaviour for a
prop posted on someone later inactive, not a keying defect.

### 4.0c — NFL CANNOT SERVE PROPS AT A FIXED BOARD LINE

This is the finding 4.0 existed to produce, and it changes the architecture
rather than a constant.

MLB shows every batter at 0.5 hits. That is legitimate **only because 84-93% of
really posted hits lines are 0.5**. NFL is not like that. Share of rows sitting
at each market's single most common line:

    Total Rushing Plus Receiving Yards    7.1%
    Total Rushing Yards                   8.5%
    Total Receiving Yards                10.3%
    Longest Reception                    12.8%
    Total Carries                        14.9%
    Total Receptions                     16.9%
    ...
    Total Sacks                          96.4%
    Total Defensive Interceptions       100.0%

Phase 3.0 measured that this concentration predicts the fitted calibration slope
at **r = +0.849**, and that `pitcher-outs` — MLB's worst at **16%** — came out
with a NEGATIVE slope and put backup catchers at the top of the board.
**Fifteen NFL markets sit below that 16%.** Serving them at one fixed line would
reproduce that failure fifteen times over.

The cause is physical, not a data defect: a WR1's receiving line is 70.5 and a
WR3's is 15.5. No single number describes both.

**So NFL serves each player at HIS OWN posted line — and therefore calibrates at
that line.**

### The general rule this establishes

Phase 3.0 is usually remembered as "calibrate at the board's fixed line". That
is the instance, not the rule. **The rule is CALIBRATE WHERE YOU SERVE.**

    MLB   serves a fixed line      -> calibrate at the fixed line   (3.0's fix)
    NFL   serves per-player lines  -> calibrate at each row's line

Which means the PRE-3.0 MLB approach — fitting at each row's own market line —
was not wrong in itself; it was wrong for a board that had been changed to serve
fixed. Getting this backwards in either direction is the same bug, and it is
invisible: `pitcher-outs` shipped inverted with the best ECE in the book.

`Total Sacks` and `Total Defensive Interceptions` are the two exceptions,
concentrating at 0.5 like MLB's batter markets, and may be served fixed. They
are declared in `audit_nfl_phase4.FIXED_LINE_MARKETS`, and the audit fails if
that declaration ever stops matching the measurement.

---

## 4.1 — The game model: margin-adjusted Elo

Margin-adjusted Elo with diminishing returns on blowouts, over 7,561 games back
to 1999. Both spread sides are priced, so **NFL spread can be de-vigged** —
unlike NBA, EPL and CFB, where the spread is effectively one-sided. That makes
NFL the first sport where a spread model can be judged against a real
probability rather than only against the posted line.

Season-boundary splits are available in abundance here; use one rather than
inventing a cutoff.

**Gate:** held-out log-loss beats a market-implied baseline on the same rows,
with the paired t-test `fit_mlb_props.py` already uses. Beating a constant is
not sufficient — Phase 3.2 showed a market can clear a constant by 1.92% and
still be the weakest thing on the board.

---

## 4.2 — The game ship gate: CLV, measured the way 3.5 learned to

**Do not reuse `clv_backtest` naively.** Phase 3.5 found its entry prices were
IN-PLAY prices — `game_odds_book_lines` is overwhelmingly a post-commence
snapshot (85.4% of ordinary MLB moneylines, 100% of implausible ones), and both
attach paths recorded whatever was quoted when their job ran. It reported
moneyline CLV at t=-5.83; rebuilt from pregame data the same picks came out
indistinguishable from zero.

Both write paths are now guarded, so **NFL picks captured from Week 1 onward are
clean by construction** — the second reason this phase belongs in September. Use
`clv_pregame_rebuild.py`'s method: entry = last observation at or before the
pick's own capture time, close = last before kickoff, both from the SAME book,
entry strictly before close, reported across every book with real coverage
rather than one thin feed.

**Report the sign test alongside the mean.** They disagreed on MLB moneyline
(beat rate 34.9%, p=0.0006 significant; mean t=-1.57 not) because the
distribution is skewed, and reporting only the flattering one would have been a
choice.

**Gate:** positive CLV, or an explicit recorded decision that it is not there.

---

## 4.3 — Props: the receiving and rushing family

The volume markets, in order of real size:

    Total Receiving Yards        20,475 rows   2,103 two-sided
    Longest Reception            15,929        2,024
    Total Rushing Yards          11,993        1,068
    Anytime Touchdown Scorer     11,762          265
    Total Receptions             11,669        2,074

**Opportunity is the modellable quantity, not the yardage.** 58,152 player rows
carry `receiving.receivingTargets` and `nfl_target_events` holds 35,430 rows
(2024-2025). A target is the opportunity; a blocking snap is not — which is why
the older claim that NFL props are blocked on snap counts was wrong.

The two-sided fraction is ~10-13% throughout. Fine for the stats bar, which
needs projection, line and outcome and never touches a price; fatal for anything
needing a de-vigged market probability. Same split MLB has, same consequence.

**Gate:** fit on 2025; NO probability is published until 4.5 clears. Projection
only, exactly as Phase 3.0's rule requires for a market that has not earned one.

---

## 4.4 — Longest reception needs extreme-value treatment

Second-biggest NFL market by volume, and **a maximum rather than a sum**. Every
model in this repo — `count_prop_engine`, the Beta-Binomial priors, the
plate-appearance simulation — projects totals. The distribution of a maximum has
a different shape and a heavier right tail, and fitting it with a count model
will misprice the tail in the direction that matters.

Treat it as its own model, not a parameterisation of the others. If it does not
clear its gate, record it as unmodellable and serve a projection.

---

## 4.5 — The gate that can only run in-season

**The prop ship gate cannot be run in September.** There is no held-out data
until the 2026 season produces it, and the 2025 archive is training data. Not a
delay to work around; the honest structure of the problem.

Each week of the 2026 season adds real held-out rows. The gate runs when there
are enough; until then every NFL prop market serves a projection with a NULL
probability. Phase 3.0's rule already covers this: a market that has not earned a
probability does not get one, ranks within its own market, and takes no global
position on the board.

**Gate:** ordering monotone, ECE <= 0.025 and worst bucket <= 0.05 **measured at
the board's line** (Phase 3.0), and a positive calibration slope. Do not measure
calibration at each row's market line and serve at a fixed one — that is exactly
how `pitcher-outs` shipped inverted with the best-looking ECE in the book.

---

## 4.6 — It ends in Scan

No new page. NFL props join the existing cross-market board through the same
`prop_model_cache` and the same adapters, ranked on `calibrated P(over) - league
baseline` like everything else. The sport-adapter architecture already has NFL
adapters for `PlayerDetail`/`TeamDetail`/`GameDetail`; nothing here needs a new
surface.

**Gate:** NFL rows appear on Scan, ranked against MLB rows, with a sample size on
every row and no probability on any market that has not cleared 4.5.

---

# Phase 5 — College football

- Ridge/least-squares rating on margin; residual against the closing spread is
  the signal. Cap or shrink blowout margins.
- Spreads back to 2013 (13,569 games) against moneylines only from 2021 (4,017).
  Model the spread.
- **CFBD spread rows carry lines but zero prices**, so CLV is measurable only on
  the 2025–26 ESPN rows. A real limit on the gate.
- **Props out of scope** — zero of 45,000 rows are two-sided.

---

# Phase 6 — NBA

**MOVED BACK FROM PHASE 4 on 2026-09-08** — see Phase 4's note. NBA tips off in
late October; nothing here depends on the season being live, so it loses
nothing by waiting.

- Possessions × points-per-possession. Possessions are computable from
  FGA/FTA/TOV/OREB, all already in the player rows.
- 24,705 priced games, dense 2008–2019 and 2021–2025, 100% result coverage.
- `nba_shot_events` **already holds 219,873 rows** — the plan's "never run" is
  stale.
- **Props are the thinnest of any viable sport**: 4,480 graded player-games, a
  sixteenth of MLB's. Minutes are the least predictable part, so an NBA prop
  model is mostly a minutes model. Build it knowing that.
- Spread is home-side only — judged against the posted line, not a de-vigged
  probability. Moneyline and total are the primary gates.

---

# Phase 7 — Golf, tennis, soccer: decide

Three sports in an undecided state. Each needs a written decision, not drift.

- **Golf** has a live model layer the audit lists for deletion, plus 1,033,752
  shot events and 7,333 stored predictions. Either rebuild it onto the shared
  engine (match winner, top 3/5/10, hole-score prop) or delete it.
- **Tennis** closed with a measured NO at t=+20.68. Reopening needs new features,
  not a re-fit.
- **Soccer** failed at t=+3.05. No second attempt is scheduled.

---

# Phase 8 — Correctness backlog

The 36 unchecked remediation items, minus those now satisfied. Grouped:

- **Truthfulness (9)** — `P(over) + P(under) ≈ 1.0`; price age correct with the
  worker stopped; every displayed rate carries a sample size; calibration
  excludes backfill; under 5% "Source not recorded".
  **Note:** the item "no model probability or edge outside `/diagnostics`" is
  **superseded** — Phase 2 deliberately puts model output on Scan. Rewrite it as
  "no UNVALIDATED model output outside `/diagnostics`".
- **Security (7)** — anonymous PostgREST POST returns 401/403;
  `/api/props/fit-weights` returns 401; open redirect closed; service key
  rotated; no internal detail in a 502 body.
- **Sourcing (9)** — `odds_unresolved` **is 22,838, not near zero**; sharp
  coverage re-measured with a buy/no-buy decision recorded; out-of-band total
  rejected by a CHECK constraint; implausible price excluded with a test;
  consensus excludes the compared book; concurrent job failure preserves
  siblings' rows.
- **Operational (5)** — restore tested with a row count; no `EMAXCONNSESSION` in
  an hour; all jobs healthy **with a test alert actually received**.

**Also here: the database is 79% full** (6,459 MB of 8,192) and grew ~1.2 GB in a
week. `prop_odds_history` (823 MB) and `odds_import_staging` (270 MB) are the
first prune candidates. This already killed a fit run.

---

# Phase 9 — Production infrastructure

- **No hosted web app exists.** Deploy it.
- Staging; load test; uptime monitoring; alerts as a product feature.
- **Move OddsHarvester off the laptop** — verified by unplugging it and checking
  `game_odds_book_lines` still advances.
- **Move the weekly backup off the laptop** — verified by shutting it for a week
  and checking a dump still appears.
- Supabase Pro migration **appears already done**.

---

# Phase 10 — Commercial readiness

**Last by design.** Nothing here is worth doing until the product is.

- Account recovery and password policy; entitlement layer; billing.
- **Legal review by an actual lawyer.** Affiliate rules are state-by-state with
  the operator carrying liability; 38 states differ materially; several regulate
  paid pick services; and **redistributing odds data is restricted under most
  provider terms**.
- Support process and runbook.
- **Operator must review `/privacy`** before any public exposure — retention
  terms and jurisdiction are outside the repo.

---

# Phase 11 — UI design passes

Four briefs exist and none has been executed: `prompt-1-scan.md`,
`prompt-2-player-detail.md`, `prompt-3-teams.md`, `prompt-4-diagnostics.md`.

**Scan's is partly superseded** by Phase 2, which is a functional redesign of the
same page. Re-read it against Phase 2 before using it. Player Detail, Teams and
Diagnostics stand as written.

---

## Order and why

```
1  Consolidation        stops the add-only pattern before five sports are added to it
2  Scan                 proves the pipeline end-to-end on the two sports that work
3  Finish MLB           the largest evidence base; the sim has a real control now
4  NFL  5 CFB  6 NBA    in-season first; each ends in Scan, not a new page
7  Golf/tennis/soccer   decide rather than drift
8  Correctness          before anyone outside sees it
9  Infrastructure       before anyone outside can reach it
10 Commercial           last
11 UI polish            after the structure stops moving
```

**Phase 2 before Phase 3** is deliberate. Two sports already have validated
models and neither is visible in the product. Adding a third before the first two
are on screen repeats exactly the pattern that produced this document.

**NFL AND NBA SWAPPED, 2026-09-08.** NFL was Phase 6 and is now Phase 4,
because the NFL season starts 2026-09-09 and the NBA's does not start until late
October. The sports are now ordered by whether they are actually being played:
NFL (starts tomorrow), CFB (already underway), NBA (late October).

This is not a preference. **Phase 3.5 ended blocked on exactly this problem** —
the game ship gate could only be measured on 129 picks over 11 days, because
everything before 2026-08-27 is permanently unjoinable, and no amount of work
creates evidence that was never captured. An in-season sport produces live
lines, live results and CLV that accumulates every week; an out-of-season one
produces none of that until it starts. Building NBA in September means finishing
it and then waiting six weeks to learn whether it works.

MLB's own season ends in October, which is a second reason not to spend the
autumn on a sport that is not playing.

Nothing about either sport's model content changed — only their position.
