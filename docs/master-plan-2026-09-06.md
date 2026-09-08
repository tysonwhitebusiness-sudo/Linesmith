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
- **3.3** Plate-appearance simulation. log5 per-PA draw, base-out state, nine
  innings, ten thousand times.
- **3.4** **Does the simulation beat the direct model at its own job?** The
  control exists and is strong. If it does not, the direct model keeps the board
  and the sim is judged on game markets alone.
- **3.5** Game ship gate: CLV against the closing moneyline and total.

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

# Phase 4 — NBA

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

# Phase 5 — College football

- Ridge/least-squares rating on margin; residual against the closing spread is
  the signal. Cap or shrink blowout margins.
- Spreads back to 2013 (13,569 games) against moneylines only from 2021 (4,017).
  Model the spread.
- **CFBD spread rows carry lines but zero prices**, so CLV is measurable only on
  the 2025–26 ESPN rows. A real limit on the gate.
- **Props out of scope** — zero of 45,000 rows are two-sided.

---

# Phase 6 — NFL

- Margin-adjusted Elo with diminishing returns on blowouts. 7,336 spread/total
  games back to 1999; both spread sides priced, so NFL spread **can** be
  de-vigged unlike NBA/EPL/CFB.
- **Props are NOT blocked on snap counts.** 58,152 rows carry
  `receiving.receivingTargets`; a target is the opportunity, a blocking snap is
  not. `nfl_target_events` already holds 35,430 rows.
- **Longest reception needs extreme-value treatment** — it is a maximum, not a
  sum. Second-biggest NFL market by volume.
- **Milestone alt-lines are off by one**: a line of 2.0 means over 1.5.

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
4  NBA  5 CFB  6 NFL    each ends in Scan, not a new page
7  Golf/tennis/soccer   decide rather than drift
8  Correctness          before anyone outside sees it
9  Infrastructure       before anyone outside can reach it
10 Commercial           last
11 UI polish            after the structure stops moving
```

**Phase 2 before Phase 3** is deliberate. Two sports already have validated
models and neither is visible in the product. Adding a third before the first two
are on screen repeats exactly the pattern that produced this document.
