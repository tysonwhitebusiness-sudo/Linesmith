# CURRENT — pick up here

**Phases 1 and 2 of `docs/master-plan-2026-09-06.md` are COMPLETE, tested and
committed. Phase 3 (Finish MLB) is next and has not started.**

**READ THIS FIRST: Scan's #1 is currently a backup catcher.** `pitcher-outs`'s
fitted calibration has a NEGATIVE Platt slope (corr(projection, model_prob) =
-0.933), so the lower the projection the higher the probability. The live board
opens:

```
#1  Luis Torrens   pitcher-outs  proj 2.00 outs  P 65.1%  +28.1pt
#2  Jhonny Pereda  pitcher-outs  proj 2.20 outs  P 64.0%  +27.0pt
#3  Kody Clemens   pitcher-outs  proj 2.40 outs  P 63.1%  +26.0pt
```

Position players who threw a mop-up inning, above every real prop. The operator
decided 2026-09-06 to keep all pitcher probabilities and fix them in Phase 3, so
this is deliberate and measured, not an oversight. **Phase 3.4 owns the re-fit.**
The cause: those calibrations were fitted at the MARKET's lines and are served at
the board's FIXED line, far outside the region they were fitted in. The fit's
gate checks `ordering_monotone` on the projection, never on the calibrated
probability — that hole is what let it through.

The master plan supersedes `model-build-plan-2026-09-02.md`'s phase numbering
and `audit-remediation-plan.md`'s track lettering. Read it first; Phase 1's
section records what actually happened versus what was planned.

`tsc` clean, **359 TS tests / 0 fail**, **50 Python test files pass**.

## 1. What Phase 1 did

**3,435 lines deleted, 222 added.** One model, one table, one surface.

- **Deleted the condemned scoring layer and the generic prop pipeline together**
  — 21 modules, 8 jobs. `edge_model`, `prop_score`, `good_bets`,
  `generic_prop_score`, `generic_prop_production`, `generic_rare_markets`,
  `generic_dimension_configs`, `generic_prop_grading`, `prop_candidates`,
  `prop_pick_history`, `market_trust`, `windowed_stat`, plus three test files
  that only covered them.
- **`live_edge` was SPLIT, not deleted** → `predict/price_resolution.py`. Two
  thirds of it was real price machinery (de-vig, sharp/consensus reference,
  staleness) that Phase 2 and three Phase 8 items depend on.
- **`nhl_props` now binds `count_prop_engine`** instead of carrying its own copy
  of the maths.
- **`/mlb/projections` and `/nhl/projections` are gone**, with `StatsBoard.tsx`
  and both panels. The routes and adapters survive — they are Phase 2's input.

## 2. Four operator decisions, made 2026-09-06

1. `live_edge` split rather than deleted.
2. Generic pipeline deleted NOW rather than after Phase 2 — accepted cost:
   `pick_history` stops accruing prop rows for seven sports, and Scan's
   non-MLB/NHL prop rows go until Phases 4-7 restore them.
3. **The TypeScript twins (`propScore.ts`, `goodBets.ts`, `edgeModel.ts`,
   `liveEdge.ts`) survive until Phase 2** and are what Scan renders today.
   Phase 2 deletes them when it replaces the surface.
4. **Model % may appear alongside Implied % on Scan.** Closes the open item in
   the plan's §2.3.

## 3. What Phase 2 did

**Good Bets is gone from Scan** — tab, filter and Reason column. `propScore.ts`
and `PropScoreBadge.tsx` deleted. The ranking is now the table's **default
sort**, not a tab.

**Columns**: `Avg L10` → `Proj` (hero number, unit muted after it), `Diff` is
projection − line, `Model %` sits beside `IP`, `Conf` shows sample size. Rank
chip in the leftmost cell (1-3 filled, 4-10 outlined, 11+ muted).

New: `lib/sports/propRanking.ts` (the metric, 8 tests),
`components/useProjections.ts`, `tests/scan-no-edge.test.ts` (the guard Phase 1
owed, now aimed at Scan).

**Four things were wrong underneath and were fixed on the way** — each is
written up in the plan's Phase 2 section:

1. **`league_rate` is not a probability.** It is the engine's per-CHANCE rate
   (0.222 hits per plate appearance). Ranking on `P(over) − league_rate` would
   have been a silent unit error. Added `league_baseline` (migration
   `20260906120000`) = P(stat > line), measured by each serving job over the
   same history it built its projections from.
2. **The serving pipe could not serve a live slate.** It took its slate from
   games already PLAYED, so it could never project tonight's players — and
   `player_game_history` ended 2026-08-28, making every cached row nine days
   stale. `live_slate_subjects` now resolves today's posted lineups and probable
   starters from the schedule. Verified: 15 games, 2,078 projections.
3. **The projection reads served a union of slates** — five runs coexisted in
   `prop_model_cache` with no date predicate on the routes. Reads are now scoped
   to `computed_at = max(computed_at)`, and `asOf` is exposed.
4. **The board opened at #117.** Ranking ran over the served board while the
   table shows a filtered subset. `rankWithin` is now applied to the rows
   actually rendered (and was made non-mutating).

## 4. Phase 3 starts here

- **3.4 owes the pitcher re-fit** — see the top of this file. `pitcher-outs` is
  inverted and `pitcher-strikeouts` is crushed flat (slope 0.104: raw 0.55% →
  37.2%). Both were fitted at market lines and are served at a fixed line.
  **Re-fit at the line the board serves**, and add a gate on the CALIBRATED
  probability's monotonicity — the existing `ordering_monotone` check only looks
  at the projection, which is why this shipped.
- A one-line guard would drop an inverted market to projection-only under the
  plan's existing rule. Not applied, by operator decision.

## 5. Known gaps, carried forward

- **`prop_model_cache` is the only table holding prop model output.**
  `pick_history` now receives only MLB game-moneyline rows from the validated
  game model. The historical prop rows in `pick_history` were produced by the
  deleted model — treat the existing track record accordingly.
- **`odds_unresolved` is 22,838 rows**, not near zero. Phase 8.
- **The database is 79% full** (6,459 MB of 8,192) and grew ~1.2 GB in a week.
  `prop_odds_history` (823 MB) and `odds_import_staging` (270 MB) are the first
  prune candidates. This already killed a fit run once.
- **Home runs may be unmodellable.** Its archive ends 2025-11-02, so the season
  split leaves no held-out rows. Phase 3.2 decides. Its beta-binomial prior now
  lives inside `home_run_model.py` (bit-exact with the deleted `edge_model`
  version), so the module is intact for that decision.
- **Park factors still are not wired and cannot be** — no path from a
  player-game to a venue. The engine's multiplier hook is tested inert at 1.0.

## 6. Standing constraints

- **Do not deploy to Render without asking.**
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** 399 MLB ids once matched by shape and **0.00%** landed on the right
  game date.
- **The operator must read `app/privacy/page.tsx` before it is public** — the
  hosting/retention terms and governing jurisdiction are outside the repo. This
  blocks any public exposure, per the plan's §2.4.
- **A dev server started before your changes can serve a deleted route from a
  stale compiled build.** This happened during Phase 1's verification and looked
  exactly like a failed deletion. Verify page removal on a freshly started
  server, or against `npm run build`'s route list.
- **Scan empties once a slate finishes.** It drops candidates whose game is
  `done`, so late in the evening the board is legitimately blank (2,382 of 2,739
  MLB candidates were `done` at 9pm ET on 2026-09-06). Verify the ranked board
  earlier in the day, or against `/api/{sport}/projections` directly.
- **A long-lived dev server degrades**: `/api/props/lines` returns ~94k rows and
  after a while `slateProps.loading` stops settling, leaving permanent
  skeletons. Restarting the server fixes it; it is not a render bug.
- **The shared Postgres pooler caps at 15 connections.** Check for running fits
  or a second dev server before starting anything DB-touching.
