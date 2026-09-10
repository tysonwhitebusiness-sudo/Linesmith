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
  three of Phase 9's own sourcing items written as assertions about it. Phase 2
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
  and the historical track record. Phase 12 owns that page.

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
the plan already records for NFL in Phase 4.**

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
(now Phase 7) tips off in late October and loses nothing by waiting; its
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

## 4.1 — The game model — **MEASURED 2026-09-08: DOES NOT BEAT THE MARKET**

`fit_nfl_elo.py`. Fitted on seasons 1999-2020, gated once on 2021-2025.

**Not a rewrite.** `predict/generic_team_elo.py` already carried the whole
apparatus — logistic expectation, a log-scaled margin-of-victory multiplier
dampened by how big a favourite the winner already was, season regression. That
IS the "margin-adjusted Elo with diminishing returns on blowouts" this phase
asked for. Two things were missing, and they were the whole of 4.1:

1. **Nothing was ever fitted.** NFL sat on `k_factor=20, home_bonus=48`, which
   that module's own docstring calls "reasonable, standard sports-Elo starting
   points".
2. **It only ever saw ~400 days.** `backfill_sport_elo` walks ESPN's scoreboard
   with `days_back=400`, while the database holds **7,561 NFL games with scores
   back to 1999-09-12**, 7,264 joining to archived odds.

Fitted on SELECT: `k=20, home_bonus=56, season_regression=0.6`.

### Result

    always-home-at-0.544 baseline   0.68919
    fitted Elo                      0.62365     gains +0.06553 over the constant
    de-vigged closing moneyline     0.61028
                                    ---------
    delta +0.01337   t = +2.55      MARKET BEATS MODEL

n = 1,709 held-out games with a two-sided price. **The gate fails.** The Elo
captures **83%** of the market's edge over a constant and still loses to it,
which is the expected result: NFL closing lines are among the most efficient in
sport, and this model has no injury, quarterback, rest, travel or weather
information at all.

### A flaw in the first measurement, found before it was reported

The first run said `t = +7.82`. That was **my query, not the model**. It took
`MAX(price)` for home and `MAX(price)` for away independently across ALL
bookmakers, which is a cross-book de-vig — not any book's opinion — and by
taking the best price on each side it stripped the vig entirely, synthesising a
sharper line than any real book ever posted. Corrected to ONE book quoting both
sides, with `is_live` rows excluded, the market's edge fell from t=+7.82 to
t=+2.55. Same rule `_market_prob_for` enforces everywhere else in this repo.

### Home-field advantage is NOT a constant, and the fit cannot see that

Measured by era:

    1999-2007   home win 0.5757   ->  53.0 Elo points
    2008-2014   home win 0.5730   ->  51.1
    2015-2020   home win 0.5524   ->  36.5      (all three inside SELECT)
    2021-2025   home win 0.5445   ->  31.0      (held out; confirms the trend)

A single global fit picks ~56 from the high-advantage era and then over-favours
the home side on every held-out game. **The decline is fully visible inside
SELECT alone**, so an adaptive estimator is justifiable without looking at the
test window — and one was built and offered to the fit.

**It lost on SELECT (0.62983 against 0.62957) and was therefore NOT adopted**,
leaving the held-out number unchanged at 0.62365. That is the correct outcome
rather than a disappointing one: SELECT is dominated by the high-advantage era,
so an estimator that tracks the decline is genuinely worse *there*. Choosing it
because the era table suggests it would do better on 2021-2025 would be tuning
against the held-out set, which is the one thing the split exists to prevent.

**A legitimate future attempt** would use an inner validation slice —
fit 1999-2014, choose the variant on 2015-2020 where the decline is already
underway, gate once on 2021+. That is a protocol change justified entirely by
SELECT-era evidence, not a re-run.

### What this means

The Elo does not ship as an edge. It is a real baseline — 83% of the way from a
constant to the market — and that is worth having as a fallback where no market
price exists, but it is not evidence of an edge and must not be displayed as
one. Phase 3.0's rule applies unchanged: a model that has not earned a
probability does not get to publish one.

**4.2's CLV gate is now the more informative measurement**, because it tests the
picks actually made rather than a retrospective log-loss, and because NFL picks
captured from Week 1 onward are clean by construction under the Phase 3.5 fix.

---

## 4.2 — The game ship gate — **CANNOT BE GATED YET, 2026-09-08. Machinery ready.**

**There are 17 NFL picks, 15 graded.** `clv_pregame_rebuild.py nfl` runs and
correctly reports nothing measurable: zero books reach the 60-pair minimum. This
is not a failure to build the gate; it is the gate honestly saying there is no
evidence yet, the same wall Phase 3.5 hit with MLB's 129 picks over 11 days.

For scale, the whole `game_picks` table: mlb 295, cfb 85, soccer 64, nfl 17.
NFL's season starts 2026-09-09.

**What was done instead, and it is the part that could only be done now:**

### The measurement is ready

`clv_pregame_rebuild.py` now takes a sport argument rather than hard-coding MLB,
so 4.2 uses the same measurement 3.5 arrived at rather than a second copy to
keep correct: entry = last observation at or before the pick's own capture time,
close = last before kickoff, both from the SAME book, entry strictly before
close, reported across every book with real coverage, with the sign test beside
the mean.

### The existing NFL picks are clean — but not because of the fix

All 17 carry sane pregame prices (-105 to -189, each consistent with its own
recorded market probability) and **none was captured after kickoff**. Zero
contaminated, against MLB's 22 of 291.

That is structural rather than earned. NFL plays weekly with a long pregame
window, so its capture job rarely overlaps a live game; MLB plays daily and its
jobs run straight through the slate. NFL was less exposed to the same bug, not
protected from it.

**Sunday is where NFL becomes exposed.** Games kick at 1pm, 4pm and 8pm ET. A
pick on a 4:25pm game whose price is still NULL when a job runs at 4:40pm gets
an in-play entry price, permanently, because `attach_moneyline_price` writes once
behind a `price IS NULL` guard.

### THE DEPLOYED WORKER DOES NOT HAVE THE PHASE 3.5 FIX

Established by probing what the live jobs actually write, not by assuming:

    home-runs rows in prop_model_cache, written 0.4h ago   -> Phase 3.2 IS live
    pitcher-outs rows carrying a probability: 0            -> Phase 3.0 IS live
    every stale job (~25h) is one Phase 1 DELETED          -> deploy landed

    deploy landed          2026-09-08 ~02:16 UTC
    Phase 3.3  (8aa8962)   2026-09-07 21:23   before  -> deployed
    Phase 3.5  (9a5e862)   2026-09-08 20:14   AFTER   -> NOT deployed

So the running worker predates the pregame-price guard. **Deploying before
Sunday is what protects Week 1's CLV evidence**, and Week 1 can only be captured
once — the same reason everything before 2026-08-27 is permanently unjoinable
and left Phase 3.5 with 129 picks to work from.

### Gate

Unchanged and unmet: positive CLV, or an explicit recorded decision that it is
not there. It runs when the season has produced enough picks. Until then NFL
game picks are captured but nothing is claimed about them.

---

## 4.3 — Props: the receiving and rushing family — **BUILT AND MEASURED 2026-09-08**

`fit_nfl_props.py`. **Projections only. No probability is published** — 4.5 owns
that gate and needs the 2026 season.

### The structural insight: two sources, very different depth

    player_game_history   58,116 target-games, 29,867 carry-games,
                          2012-09-06 .. 2026-01-05, ~4,000-4,600 per season
    prop_odds_archive     ONE season of lines, dense only Sept-Nov 2025

Phase 4's opening measurement said NFL props "cannot be walk-forward validated",
and that is true of anything needing a LINE. It is not true of the PROJECTION,
which needs no lines at all — only what a player did and how much opportunity he
had. That splits the phase cleanly: the projection gets a genuine multi-season
walk-forward now; the probability waits for 4.5.

### Result — every market beats a flat league average

Fitted on seasons before 2024, held out on 2024-2025:

| market | held-out n | MAE | flat baseline | gain | bias |
|---|---|---|---|---|---|
| receptions | 7,860 | 1.4007 | 1.7566 | **+0.3559** | +0.7% |
| receiving-yards | 7,860 | 19.1733 | 23.7051 | **+4.5318** | +4.3% |
| carries | 3,970 | 2.8383 | 5.1186 | **+2.2803** | +1.4% |
| rushing-yards | 3,970 | 18.2224 | 25.8217 | **+7.5994** | +3.9% |

The flat baseline is "predict the league average for everyone", which is the
right control: it asks whether the player's own history contributes anything at
all. All four clear it, and the projection biases are small (+0.7% to +4.3%).

Archived prop rows now join: 11,177 receptions, 19,627 receiving yards, 3,890
carries, 11,656 rushing yards.

### Calibrated at each row's own line, not a fixed board line

The opposite of `fit_mlb_props.py`, deliberately, and 4.0c is why: MLB's line
concentration is 84-93% while NFL's runs 7.1-14.9% — every yardage market below
the 16% at which `pitcher-outs` inverted. **Calibrate where you serve.**

### Two bugs found, both mine, both silent

1. **The NFL fit was using MLB's crosswalk.** `fit_mlb_props.load_crosswalk`
   hardcodes `sport = 'mlb'`, so NFL prop ids were resolved against MLB players
   and **zero** prop rows joined. It failed silently because a crosswalk miss is
   a `continue`, not an error — and it was visible only because the joined-row
   count is printed. That is the argument for printing counts that ought to be
   non-zero. Fixed with a real NFL loader (1,020 ids); 4.0b had already measured
   the true rate at 97.5% with zero off-by-one dates.

2. **A "fix" that made things worse, reverted with the measurement.** Carries
   uses `rushingAttempts` as its own volume, which reads as degenerate — carries
   per carry, a league rate of exactly 1.000. The obvious correction is to make
   the opportunity "played a game". That was tried and **measured 3.0915 against
   2.8383**, because the engine's `volume_window` applies to VOLUME, not to the
   rate: pinning volume at 1.0 makes the window inert and forces a career
   average, which the fit duly picked. With carries as its own volume the window
   does real work and the model becomes "project this back's recent carry load".

   Recency matters here in a way it does not for a catch rate: a running back's
   workload moves with the depth chart and game script, while his hands do not.
   The rate of 1.000 is therefore not a bug but an honest description of a market
   with no sub-opportunity, and it is documented in place so the next reader does
   not re-make the same correction.

### Still open in this family

`Anytime Touchdown Scorer` (11,762 rows) is not modelled here. Phase 4.0a found
it is not one market but an alt-line family — 0.5 / 1.5 / 2.5 / 3.5 — and
touchdowns are a rare, high-variance event that the count engine's shape grid may
not fit. It needs its own decision, like `Longest Reception` in 4.4.

---

## 4.4 — Longest reception as an extreme value — **BUILT AND MEASURED 2026-09-08**

`fit_nfl_longest.py`. **Projection only** — 4.5 owns the probability gate.

**Why it is not `fit_nfl_props.py` with a different stat key.** Every model in
this repo projects a SUM: `count_prop_engine` multiplies a rate by a volume, the
Beta-Binomial priors count successes, the plate-appearance simulation adds
outcomes. Longest reception is a MAXIMUM, and the tail is precisely the part a
24.5-yard line asks about.

### The model needs no new data

    P(longest > L)  =  1 - F(L)^N

N is the receptions in the game and F the distribution of ONE reception's
length. Both inputs already exist: 4.3 fitted receptions and receiving yards, so
N and the mean length `mu = yards / receptions` come free.

### F was chosen by measurement, and the obvious guess was wrong

Exponential has the clean closed form and is the natural first try. It is
falsified sharply. Under Exp(mu), `E[max of N] = mu * H_N`, so actual/predicted
should be 1.00 at every N. Over 51,382 player-games:

    N        1      2      3      4      5      6      8     10
    ratio  1.000  0.951  0.926  0.906  0.897  0.878  0.878  0.868

Monotone decline: exponential over-predicts the longest catch by ~13% at ten
receptions. Real reception lengths have a **lighter** tail than exponential — a
receiver's catches cluster more than a memoryless process would.

So F is Weibull, the one-parameter generalisation that expresses exactly that:

    F(L) = 1 - exp(-(L/lambda)^k),   lambda = mu / Gamma(1 + 1/k)

k = 1 recovers the exponential; k > 1 is the lighter tail the data shows.

### Fitted k = 1.25, and it transfers

Shape fitted on seasons before 2024 by matching the E[max]/mu ratios, then
applied unchanged to 2024-2025:

    N        SELECT ratio      HELD-OUT ratio
    1           1.000              0.999
    2           1.000              1.002
    3           1.004              1.000
    4           1.001              1.002
    5           1.003              1.030
    6           0.997              0.987
    7           1.008              0.994
    8           1.010              1.038

Against the exponential's 0.868-1.000 decline, this is flat at 1.00 across the
whole range on data the shape never saw.

### At the market's own lines

n = 14,076 archived `Longest Reception` rows joined to real outcomes:

    exponential (k=1)     log-loss 0.28752
    Weibull (k=1.25)      log-loss 0.25390
    delta -0.03362   t = -44.99      WEIBULL BETTER

An 11.7% relative reduction, which is very large for a one-parameter change and
is what the plan predicted would be at stake in the tail.

### The honest limit on that number

**This uses each game's ACTUAL receptions and yards.** It therefore isolates the
DISTRIBUTION choice, which is what 4.4 is about, and does not claim the served
model will be this accurate: serving needs PROJECTED N and mu from 4.3, whose
own error stacks on top. 4.5 owns that measurement, and it needs the 2026
season.

`Anytime Touchdown Scorer` (11,762 rows) remains unmodelled and needs its own
decision — 4.0a found it is an alt-line family (0.5 / 1.5 / 2.5 / 3.5) rather
than one market, and touchdowns are rare and high-variance.

---

## 4.4b — Anytime Touchdown Scorer — **BUILT AND MEASURED 2026-09-08**

`fit_nfl_anytime_td.py`. **Operator decision: model it** — anytime touchdown is
the NFL equivalent of MLB home runs, the marquee rare-event market.

### Only the 0.5 line, deliberately

`Anytime Touchdown Scorer` is four markets under one name. Measured base rates:

    line 0.5   4,670 rows   P(>=1 TD) = 0.2103    modelled
    line 1.5   4,277 rows   P(>=2 TD) = 0.0333    not modelled
    line 2.5   2,764 rows   P(>=3 TD) = 0.0039    not modelled, 1 in 258
    line 3.5      51 rows                          not modelled

The alt-lines are left alone. A 0.4% event with 61 two-sided rows is where a
wrong tail does the most damage — the Phase 4.4 lesson — and nothing here has
earned the right to quote one.

### Why it needed its own file

**A touchdown spans two stat groups.** `receiving.receivingTouchdowns` appears on
58,152 player-games and `rushing.rushingTouchdowns` on 29,878, but only **17,485
carry both**. A player's touchdown total is the sum of two keys that are usually
not both present, while every market in `fit_nfl_props.py` reads exactly one key
with exactly one volume.

### Two things decided by measurement, neither of them the line

**The opportunity denominator.** A touchdown has no obvious one. Both candidates
were fitted and compared on SELECT:

    per game    volume = 1,                  rate 0.24809/game    ll 0.50153
    per touch   volume = targets + carries,  rate 0.03985/touch   ll 0.49674

**Per touch won**, which is also the more sensible story — a player with 20
touches has more chances to score than one with 3. Worth noting it was measured
rather than assumed, because 4.3 produced the opposite outcome: for carries the
principled-looking correction measured WORSE and was reverted.

**The distribution** came from the engine's usual grid: `nb(4)`, window 8,
shrink_k 20.

### Result — clears a home-runs-style gate

Fitted on seasons before 2024, held out on 2024-2025, n = 9,683:

    log-loss                0.48807
    constant-rate baseline  0.52530     model gains +0.03723  (7.1% relative)
    ordering  Q1 0.091 -> Q2 0.123 -> Q3 0.200 -> Q4 0.278 -> Q5 0.400   monotone
    ECE                     0.0156      (gate <= 0.025)
    worst bucket            0.022       (gate <= 0.05)
    bias                    -5.6%       (slightly under-predicts)

**It is stronger than the MLB market it was modelled on.** Home runs (3.2)
discriminates 2.5x across its quintiles and beats a constant by 1.92%; anytime
touchdown discriminates **4.4x** and beats a constant by **7.1%**.

### One difference from 4.4 worth keeping straight

Phase 4.4's longest-reception number used each game's ACTUAL receptions and
yards, because the question there was which DISTRIBUTION fits. This is a genuine
forward projection: volume comes from the player's prior games only, so the
error already includes the projection's own. The two numbers are not comparable
and 4.4's is the more flattered of the pair.

**4.5 still owns the ship gate.** NFL has no held-out PROP season until 2026
produces one; this is the model measured on history, and no probability reaches
a board until that gate clears.

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

**4.6 IS COMPLETE (2026-09-08), and the gate's two halves turned out to
contradict each other.** "Ranked against MLB rows" and "no probability on any
market that has not cleared 4.5" cannot both hold: the cross-market rank IS
`calibrated P(over) - league baseline`, so a row with no probability has no
quantity to rank on. The no-probability half wins, because it is the half
carrying the evidence claim. Under Phase 2's own rule an unranked row is a
first-class state: it appears, shows its projection, and ranks WITHIN its
market, but takes no global position. Measured live on `/nfl`: 0 rank chips,
which is correct rather than degraded. NFL joins the board on **Phase 2's
terms**, not on a rank it has not earned.

Five pieces, one pipe:

| piece | file |
|---|---|
| shared market table | `python-odds-service/src/predict/nfl_markets.py` |
| the pipe | `python-odds-service/src/predict/nfl_prop_serving.py` |
| the schedule | `nflProjectionsJob` in `jobs.py`'s `JOB_REGISTRY` (hourly) |
| the read | `readNflProjections()` + `app/api/nfl/projections/route.ts` |
| the board shape | `lib/sports/nfl/adapters/statsBoardAdapter.ts` |

**No board line is served**, per 4.0c: line concentration is 7.1-14.9% across
every yardage market, all below the 16% at which MLB's `pitcher-outs` inverted,
because a WR1's receiving line is 70.5 and a WR3's is 15.5. Scan pairs each
projection with the candidate's OWN posted line, which is where the per-player
line comes from for free.

**The subject-id prefix is not what the code says it is.**
`lib/sports/nfl/adapter.ts` documents the scheme as `espn:nfl:{id}`;
`teamSportEspn.ts` actually builds `espn:${espnSport}:${id}`, and NFL's
`espnSport` is **football**. Measured live: `espn:football:4678006`. Stripping
the literal `espn:nfl:` would have left every id untouched and matched ZERO
history rows — **silently**, because a miss is a skipped player, not an error.
This is the same failure class that cost 4.3 an hour (MLB's crosswalk reused for
NFL, zero joins, no error). `_bare_id` splits on the last `:` instead, so it is
correct for all three forms.

`readNflProjections` does **no name join**: `athlete_crosswalk` holds zero NFL
rows with a name, so joining would have dropped 177 of 1,931 rows and still
rendered the rest nameless. Scan takes the name from the candidate.

**Verified on a production build against real data.** `/api/nfl/projections`
returns 5 markets / 1,931 rows, `hasProbability=false` on all five. On the live
`/nfl` board, 7 of 7 Receptions candidates join and render a projection with its
sample size ("Some history — 30 games behind this projection"); the 2 Passing
Yards rows correctly carry none, that market being unfitted. `tsc` clean,
359/359 TS tests, 38/38 job registry contract.

**Shipped alongside** (`c229399`): Scan's row footer is now always rendered when
there are rows — "Showing 150 of 1,604" with "Show 50 more" and "Show all". An
absent footer was ambiguous between "everything is already on screen" and "the
button is broken", and late on a slate the count is what makes a board falling
from 844 rows to 33 legible rather than alarming.

---

# Phase 5 — Sustainability

**Inserted 2026-09-09, between NFL and CFB, because the platform cannot carry
another sport.** Every number here was measured on 2026-09-09 and is
reproducible; none of it is inherited from the earlier audit, two of whose
headline claims did not survive re-measurement (see 5.0).

**THREE CEILINGS, AND ONE JOB IS THE LARGEST CONTRIBUTOR TO ALL THREE.**

| ceiling | limit | measured | state |
|---|---|---|---|
| database | 8,192 MB | **7,174 MB (87.6%)** | ~7 days at +142 MB/day |
| egress | 250 GB/mo | **~500 GB** | 2x over, billing overage |
| worker RAM | 512 MB | **385 MB peak** | already OOM-killing a job |

**The pattern behind all three is the same: the system moves and keeps
everything, forever.** `mlbProjectionsJob` downloads 7,184,704 rows every run to
compute 300 numbers, discarding 74% of what it transfers. That single query
family is **64.7% of every row this database returns** (counted in
`pg_stat_statements` over a 4.76-day window: 685,336,093 rows total, 143.9M/day).
It is simultaneously the largest egress line, the cause of the worker OOM, and
why the MLB board sat 13 hours stale on 2026-09-09.

**WHY "SIX MONTHS OF HEADROOM" BECAME SEVEN DAYS.** The estimate was not
careless; the regime changed underneath it. `prop_odds_history` went from 4,238
rows/day across 12 books on 2026-08-24 to 775,342 rows/day across 26 books on
2026-09-04 — **183x in eleven days** — as book coverage doubled and football
season multiplied the slate. The two compound. Any projection made before
2026-09-01 was describing a different system. **A linear headroom estimate is not
a safe instrument here; 5.5 replaces it with a measured rate and an alarm.**

**THE GOAL IS A STEADY STATE, NOT A BIGGER CEILING.** No tier upgrade, no
overage. Today everything grows with TIME, so the 8 GB is a countdown. After
this phase the serving database grows with the SLATE — how many games are on
today's board, which does not increase year over year — and the corpus grows
where growth is free.

---

## 5.S — WHAT IS DONE AND WHAT REMAINS (the working checklist)

**This section is the authority on Phase 5's remaining work.** Steps are done in
number order. A step is DONE only when its gate has actually been run, not when
the code exists. Updated 2026-09-10.

### DONE

| step | evidence |
|---|---|
| 5.0 audit | `python audit_storage.py` exits 0, 8/8 checks |
| 5.1 serving aggregation | deployed; `mlbProjectionsJob` 152.36s -> 12.64s, board bit-identical |
| 5.2a corpus format | round-trip verified, digest compares canonical values not reprs |
| 5.2b identity gate | 10 MLB markets byte-identical from Parquet vs Postgres |
| 5.2c object storage | 441 files / 129.7 MB in Supabase, every one verified remotely |
| 5.2d (player_game_history only) | 2,048,626 rows pruned; board byte-identical after |
| summary infrastructure | `player_history_summary` + `mlbHistorySummaryJob`; MLB/NHL/NFL all reproduce |

### REMAINING, IN ORDER

**5.S.1 — DEPLOY.** Production runs the pre-5.1 replay path against a table now
holding 27% of what it replays. Nothing wrong has been written yet only because
`mlbProjectionsJob` has not run since 00:30Z. *Operator action.*
**Gate:** `mlbProjectionsJob` completes and its `history_rows` matches a local
`build()` on the same slate.

**5.S.2 — Back up and drop the dead tables.** 324 MB. `odds_import_staging`
alone is 284 MB / 1,140,676 rows, every one written inside a nine-minute window
on 2026-09-02 — a staging table that never drained. Six migration backups from
2026-08-29 and 2026-09-01 make up the rest.
**Gate:** each table exported to Parquet and digest-verified BEFORE its `DROP`.

**5.S.3 — Drop the never-scanned indexes.** 314 MB across `prop_odds_archive_close_lookup`
(162 MB), `idx_prop_odds_game` (52 MB), `odds_archive_pregame` (31 MB) and others.
**Gate:** `pg_stat_database.stats_reset` is still NULL at drop time — that is the
only thing making `idx_scan = 0` mean "never used" rather than "not used lately".
Re-check it immediately before, not from this document.

**5.S.4 — `VACUUM FULL player_game_history`.** 1,342 MB. The table holds 2,424
bytes per live row against its natural 655; the prune's space is still in the
file. Takes an ACCESS EXCLUSIVE lock, so it needs a quiet window, and it rewrites
into a new file so it needs ~500 MB free while it runs — which is why 5.S.2 and
5.S.3 come first.
**Gate:** `pg_total_relation_size` drops to ~497 MB and the board is unchanged.

**5.S.5 — Port `mlb_pitch_events` readers, then prune it.** 476 MB. Smallest
reader surface of the three remaining corpus tables: `/api/mlb/pitch-profile`,
`lib/sports/mlb/pitchProfile.ts`, `pitchRoles.ts`, `playerDetailAdapter.ts`.
Also the worst compression ratio (10x), so the least valuable to keep in Postgres.
**Gate:** measure what window each reader needs, keep that, prune the rest;
pitch-profile renders identically for a sampled set of players.

**5.S.6 — Port `prop_odds_archive` readers, then prune it.** 854 MB. Read by
`nhl_props.py` and every prop fitter. The fits already have a proven Parquet
path (5.2b); this is applying it.
**Gate:** each fit produces bit-identical output reading Parquet vs Postgres.

**5.S.7 — Port `odds_archive` readers, then prune it.** 1,203 MB, and the
largest single remaining win. Read by `nhl_props.py`, `archival_bridge.py`,
`health_check.py` and `gameModelBackfill.ts`. Note `archival_bridge` WRITES it
continuously, so only frozen rows may be pruned — `FROZEN_PREDICATE` already
encodes that boundary.
**Gate:** `fit_nfl_elo` reproduces its published numbers from Parquet.

**5.S.8 — 5.3's roll-up of `prop_odds_history`.** 1,189 MB, growing 122.7 MB/day,
read 8,358 times against 1,858,112 inserts. **The CLV question is MINE to
measure, not a decision to escalate:** determine whether `userClv.ts` takes its
entry price from `pick_history` (where Phase 3.5 put it) or from
`prop_odds_history`. Only if it is the latter does the retention window become
an operator choice.
**Gate:** the chart renders identically for every window the route permits, and
CLV is unchanged for a sampled set of real historical picks.

**5.S.9 — 5.5's guardrails.** A job that dies abnormally leaves a breadcrumb; an
unhealthy check reaches the operator; worker RAM is tracked as a ceiling beside
database size; the alarm is on MB/day, not percent-full.
**Gate:** a deliberately failed job produces an alert the operator actually
receives.

### WHERE THE SPACE IS, SO THE NUMBERS STOP MOVING

```
now                                        7,249 MB   88.5%
after 5.S.2 + 5.S.3 + 5.S.4               ~5,269 MB   64%
after 5.S.5 + 5.S.6 + 5.S.7               ~2,736 MB   33%
after 5.S.8                               ~2,400 MB   29%
```

**The ~2,400 MB target in this phase's header was always the figure for a
COMPLETED Phase 5, not for 5.4 alone.** Every table in 5.S.5 through 5.S.7 is
already exported and verified in the corpus; none has been deleted, because
their readers still query Postgres. That is the whole of the remaining gap.

---

## 5.0 — Pin the audit so it can be re-run, not re-argued

`audit_storage.py`, in the shape of `audit_nfl_phase4.py`: re-derives every
number in this phase and exits non-zero when a finding stops matching the data.

**Two claims from the earlier audit did NOT survive re-measurement, and both are
recorded here so they are not re-inherited:**

- **"Historical data is sitting in live tables" — NOT CONFIRMED.** Retention
  works exactly as written. `prop_odds` holds a 6-day span with **zero** rows
  past its 7-day rule; `game_odds_book_lines` a 1-day span against a 2-day rule.
- **The `_team_ids()` scan is NOT an egress problem.** It reads 572,366 rows to
  produce 66 team names, which looks alarming and is not: the `UNION` dedupes
  server-side, so **14 KB** crosses the wire per rebuild, not 26 MB. Rows
  scanned is not rows sent, and this phase's numbers are all rows SENT.

**Gate:** `python audit_storage.py` reproduces the ceiling table above and exits
zero.

---

## 5.1 — Serving asks a question instead of downloading the corpus

**THE ONE CHANGE THAT MOVES ALL THREE CEILINGS.** `mlb_prop_serving` calls
`mlb_props.load_game_history(dim)` per market, which pulls every MLB player-game
for that market — 511,257 rows for `hits` alone — and then both consumers
immediately discard most of it: `build`'s history loop keeps only
`aid in subjects`, and `league_baseline_for` skips everything else. 299 players
are served from 7,184,704 transferred rows.

**NHL AND NFL ALREADY DO THIS CORRECTLY.** Both filter in SQL
(`athlete_id = ANY($2::text[])`). MLB is the oldest pipe and never caught up.
This is not a redesign; it is bringing the original up to the pattern its own
successors already use.

| | before | after |
|---|---|---|
| rows per run | 7,184,704 | ~3,600 |
| wire bytes per run | 194 MB | ~0.2 MB |
| egress | ~140 GB/mo | ~0.16 GB/mo |
| worker peak RSS | 385 MB | ~250 MB |

`load_game_history` is shared with the walk-forward, which genuinely needs every
row — **"THE ONE HISTORY SOURCE... so the model that is measured is the model
that is served."** So the filter is an OPTIONAL parameter the serving path
passes and the fitter does not. Changing the default would silently narrow every
backtest.

**Gate:** the served board is **identical row-for-row** to a pre-change run —
same projections, same baselines, same sample sizes — with peak RSS and rows
transferred both measured before and after. A faster board that changed a number
is a failure, not a win.

---

## 5.2 — The corpus moves out of Postgres; nothing is deleted

**RETENTION IS THE WRONG MECHANISM FOR EVERYTHING EXCEPT 5.3.** What the
database actually holds:

| table | span | replaceable |
|---|---|---|
| `odds_archive` | **27.3 years** (1999-) | no |
| `game_result` | **27.0 years** | no |
| `player_game_history` | **16.1 years** | no |
| `mlb_pitch_events` | 2.5 years | partially |
| `prop_odds_archive` | 1.5 years | **never** — `client.ts`: *"no backfill exists anywhere for this, forward accumulation only"* |

Deleting any of it destroys irreplaceable model fuel. The problem is not that
too much history is kept — it is that **27 years of immutable, bulk-read columnar
data lives in a transactional row-store with a hard 8 GB ceiling.**
`odds_archive` carries 663 MB of index on 539 MB of heap, doing point-lookup
work for something only ever read in full scans by fitters.

Parquet on object storage, date-partitioned, read by DuckDB with the same SQL
the fits already write. ~4,600 MB compresses to roughly 500-900 MB, at storage
prices, **with no ceiling** — the missing decade of `player_game_history` then
costs nothing to add.

**THE FLUSH BOUNDARY IS "GAME FINAL", NOT AN AGE.** These tables are not
append-only: `prop_odds_archive` shows ~8.2M updates against 84k inserts, because
`archiveClosingLinesJob` keeps upserting so *"whatever is in the row when the
game begins IS the closing line."* A row is mutable until kickoff and frozen
forever after, so the boundary is derived from the data's own lifecycle rather
than a chosen constant, and no row is ever flushed while still being written.

**Supabase Storage first, R2 reserved.** Same account, S3-compatible, 100 GB
included on Pro. R2's zero egress only wins if Render does repeated bulk corpus
reads — which 5.1 specifically prevents. The destination is a config value; a
later move is a bucket copy.

**Gate:** every fit script produces **bit-identical output** reading Parquet
versus reading Postgres, on the same input window. Postgres drops the flushed
rows only after that passes.

---

## 5.3 — Roll up the one log no model reads

`prop_odds_history` is the fastest-growing object in the database — **122.7
MB/day, 86% of all growth, +246% week-over-week** — and it is **read 8,358 times
against 1,858,112 inserts, a 1:222 ratio.** No fit and no serving pipe touches
it (verified by grepping every `FROM` in the fit and serving modules). Its
consumers are the price chart, per-key grading, and user CLV.

**The data is legitimate; do not look for a dedup win.** Three hypotheses were
tested and rejected: the movement-only rule holds (**0.0%** of rows repeat the
previous price), null lines are 6.5% not the 53% a code comment implies for one
market, and alt-lines average 2.0 per series. Books genuinely reprice ~4.3 times
a day across 90,194 active series.

**The chart is unaffected by construction.** `line-history/route.ts` caps at
`MAX_HOURS = 24*30` and returns 400 beyond it, and at that 30-day maximum
`bucketSecondsFor(720)` already collapses everything into **12-hour buckets**.
Tick resolution older than the retained window is discarded at read time today.

**5.3a IS A GATE, NOT A STEP.** `userClv.ts` queries by key with `observed_at <
?` and **no lower time bound**, so a CLV lookup on an old pick reaches into
rolled-up data. Whether that matters depends on whether the entry price comes
from `pick_history` — where Phase 3.5 deliberately put it — or from
`prop_odds_history`. **Measure that before choosing the window.** A daily
open/high/low/close roll-up preserves the closing price CLV compares against but
loses the intraday tick.

**Gate:** the chart renders identically for every window the route permits, and
CLV is unchanged for a sampled set of real historical picks.

---

## 5.4 — Reclaim what is provably inert

Mechanical, reversible, no model data:

- **324 MB of leftover tables.** `odds_import_staging` alone is 284 MB /
  1,140,676 rows, **every one written inside a nine-minute window on 2026-09-02**
  — a staging table that never drained. Plus six migration backups from
  2026-08-29 and 2026-09-01.
- **324 MB of indexes never scanned once.** `prop_odds_archive_close_lookup`
  (162 MB), `idx_prop_odds_game` (52 MB), `odds_archive_pregame` (31 MB) and
  more. **Evidence checked before trusting it:** `stats_reset` is NULL, so the
  counters cover the database's whole lifetime, and sibling indexes on the same
  tables show 8.6M, 16M and 1.5M scans. The zeros are real, not a reset artifact.
- **One `VACUUM FULL` in a quiet window.** `run_retention`'s own docstring is the
  reason this is a deliberate operator action: *"`DELETE` marks rows dead; only
  VACUUM FULL returns the space... takes an ACCESS EXCLUSIVE lock that would
  block every reader."* Deletes in 5.2/5.3 free nothing on disk until this runs.

**Gate:** `pg_database_size` drops by at least 600 MB and every test suite still
passes.

---

## 5.5 — Make a regression impossible to miss

The failure mode this phase exists to prevent is not a crash; it is silence.
`mlbProjectionsJob` died for 13 hours and **nothing surfaced it** — an OOM kill
writes no breadcrumb, and `_run_one`'s timeout and unexpected-raise paths both
`return` without one either, so all three failure modes look identical from
outside. `health_check` DID detect it (`healthy=false, "stale — last run 751min
ago, expected within 120min"`) and wrote it to `job_health_checks`, where nobody
was looking.

- **A job that dies abnormally leaves a breadcrumb.** An OOM cannot be caught,
  but timeout and raise can, and today they are indistinguishable from silence.
- **An unhealthy check has to reach the operator.** This is Phase 9's
  *"all jobs healthy with a test alert actually received"*, pulled forward
  because it just demonstrated its cost.
- **Track worker RAM as a ceiling beside database size.** The plan tracked
  8,192 MB and said nothing about 512 MB, and it was the unwatched one that
  broke. Baseline: 385/512 MB on 2026-09-09.
- **Alarm on the rate, not the level.** A linear headroom estimate missed a 183x
  change in eleven days. Alert on MB/day and rows/day per table.

**Gate:** a deliberately failed job produces a visible alert the operator
actually receives.

---

## What this phase is worth

```
database   7,174 MB (87.6%)  ->  ~2,400 MB (29%), and stops climbing
egress     ~500 GB/mo        ->  ~180 GB/mo, inside the 250 GB allowance
worker     385 MB peak       ->  ~250 MB, stops crashing
corpus     capped at 8 GB    ->  unbounded, compressed, storage-priced
```

**Two things this phase deliberately does not promise.** The ~180 GB egress
figure is a projection that assumes bytes track rows; the **64.7% share is
counted, the conversion is not**, so verify against Supabase's own egress graph a
week after 5.1 rather than against this number. And **book coverage is a product
decision this architecture cannot make** — 12 to 26 books in two weeks is what
moved the growth curve, and the log tier scales with it. The plumbing absorbs it
far better; it does not decide it.

---

# Phase 6 — College football

- Ridge/least-squares rating on margin; residual against the closing spread is
  the signal. Cap or shrink blowout margins.
- Spreads back to 2013 (13,569 games) against moneylines only from 2021 (4,017).
  Model the spread.
- **CFBD spread rows carry lines but zero prices**, so CLV is measurable only on
  the 2025–26 ESPN rows. A real limit on the gate.
- **Props out of scope** — zero of 45,000 rows are two-sided.

---

# Phase 7 — NBA

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

# Phase 8 — Golf, tennis, soccer: decide

Three sports in an undecided state. Each needs a written decision, not drift.

- **Golf** has a live model layer the audit lists for deletion, plus 1,033,752
  shot events and 7,333 stored predictions. Either rebuild it onto the shared
  engine (match winner, top 3/5/10, hole-score prop) or delete it.
- **Tennis** closed with a measured NO at t=+20.68. Reopening needs new features,
  not a re-fit.
- **Soccer** failed at t=+3.05. No second attempt is scheduled.

---

# Phase 9 — Correctness backlog

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

# Phase 10 — Production infrastructure

- **No hosted web app exists.** Deploy it.
- Staging; load test; uptime monitoring; alerts as a product feature.
- **Move OddsHarvester off the laptop** — verified by unplugging it and checking
  `game_odds_book_lines` still advances.
- **Move the weekly backup off the laptop** — verified by shutting it for a week
  and checking a dump still appears.
- Supabase Pro migration **appears already done**.

---

# Phase 11 — Commercial readiness

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

# Phase 12 — UI design passes

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
4  NFL                  in-season first; ends in Scan, not a new page
5  Sustainability       the ceilings are days away, and one job causes all three
6  CFB  7 NBA           in-season order resumes once the platform can carry them
8  Golf/tennis/soccer   decide rather than drift
9  Correctness          before anyone outside sees it
10 Infrastructure       before anyone outside can reach it
11 Commercial           last
12 UI polish            after the structure stops moving
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
