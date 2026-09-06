# CURRENT — pick up here

**Phase 1 of `docs/master-plan-2026-09-06.md` is COMPLETE, tested and
committed. Phase 2 (Scan, the only surface) is next and has not started.**

The master plan supersedes `model-build-plan-2026-09-02.md`'s phase numbering
and `audit-remediation-plan.md`'s track lettering. Read it first; Phase 1's
section records what actually happened versus what was planned.

`tsc` clean, **346 TS tests / 0 fail**, **50 Python test files pass**,
production build succeeds.

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

## 3. START HERE: what Phase 2 must not lose

**`tests/stats-board-no-edge.test.ts` is one assertion lighter than it was.**
It enforced that no edge or profit language reached the board's rendered copy;
that component is deleted, and the assertion was deliberately NOT re-aimed at
Scan, because decision 4 puts a model probability next to an implied one there
and re-aiming it today would fail on unbuilt work.

**Phase 2 owes the replacement.** Whatever Scan renders must still not claim an
edge, a profit or a beaten close, and only the two approved identifiers are
licensed. The two columns ship; nothing computes, names, sorts by or colours
their difference. The file itself carries this note above the removed test.

## 4. What Phase 2 inherits, concretely

- `/api/mlb/projections` and `/api/nhl/projections` — direct reads of
  `prop_model_cache`, kept fresh by `mlbProjectionsJob`/`nhlProjectionsJob`.
  Verified live: MLB returns 11 markets, each with a `hasProbability` flag,
  rows carrying `projection` / `probability` / `line` / `volume` / `sampleSize`.
  That is exactly the ranked data the plan's §2.1 and §2.3 describe.
- `lib/sports/{mlb,nhl}/adapters/statsBoardAdapter.ts` — the transform, kept.
  `StatsBoardData` is declared in the NHL adapter (NHL was ported first) and
  re-exported by MLB, per the sport-adapter convention.
- Four TypeScript modules still to delete when the surface is rebuilt.

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
- **The shared Postgres pooler caps at 15 connections.** Check for running fits
  or a second dev server before starting anything DB-touching.
