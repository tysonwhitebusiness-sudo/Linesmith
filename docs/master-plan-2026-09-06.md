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

- **3.1** Statcast skill-vs-luck prior. `estimated_woba` separates what a batter
  earned from what he got. The join is proven: `player_game_history.event_id` IS
  the MLB gamePk, 6,885 games, **100.00% date agreement**. Kept only if it
  improves held-out log-loss.
- **3.2** Home runs currently **untestable** — its archive ends 2025-11-02, so
  the season split leaves no held-out rows. Either find a split that tests it or
  record it as unmodellable.
- **3.3** Plate-appearance simulation. log5 per-PA draw, base-out state, nine
  innings, ten thousand times.
- **3.4** **Does the simulation beat the direct model at its own job?** The
  control exists and is strong. If it does not, the direct model keeps the board
  and the sim is judged on game markets alone.
- **3.5** Game ship gate: CLV against the closing moneyline and total.

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
