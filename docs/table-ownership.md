# Table ownership

> **One table, one writer.** Task 2.1 of `docs/audit-remediation-plan.md`,
> closing P2 M9 and P3 §4 (22 of 35 tables with writers in both languages).
>
> Standing decision **Q2: Python owns all writes and model math. TypeScript
> renders.** The exceptions below are deliberate and each carries its reason.
>
> **Derived, not recalled.** Table list from `information_schema` on the live
> database (36 base tables in `public`). Writers found by parsing every
> `INSERT INTO` / `UPDATE` / `DELETE FROM` in `lib/db/client.ts` and
> `python-odds-service/src/db.py` — the only two files in either tree issuing
> raw writes — mapping each to its enclosing exported function, then grepping
> both trees for that function's call sites. The gate re-derives this the same
> way and diffs against it; if they disagree, this file is wrong.
>
> **Last derived:** 2026-08-29, **after** tasks 2.2–2.7b landed, by re-running the
derivation described above. The `Writers today — TypeScript` column below is
therefore the state *at Phase 2 kickoff*, kept deliberately so the column
opposite it shows what each task actually removed; the **Owner** column is the
decided, current answer. The gate re-derives from scratch and diffs.

**Re-derivation on 2026-08-29 found six TypeScript modules that had become
unreachable** once their last callers were deleted — `pickHistoryLog.ts`,
`props/grading.ts`, `gameOddsLog.ts`, `core/gamePickLock.ts`,
`golf/historyIngest.ts` and `golf/models/grading.ts`. All six are deleted. Rule
2 is "the TypeScript is deleted, not disabled", and a one-hop importer check
would have missed every one of them: each still *appeared* used, because the
comments explaining the removal name the functions they replaced.

## How to read the Owner column

| Owner | Meaning |
|---|---|
| **Python** | A `JOB_REGISTRY` job is the only writer. TypeScript reads. |
| **TS · user** | Request-scoped, session-authenticated user data. Stays in TypeScript per Q2's own carve-out — this is not model math and it has no business on a background worker. |
| **TS · render cache** | A cache of what TypeScript renders. Not model math; see the note under `snapshot_cache`. |
| **TS · admin** | Written only by a hand-invoked operator/backfill route, never on a user's page-load path. |
| **⚠ contested** | Two writers today. The Task column names what closes it. |

---

## The 36 tables

| # | Table | Owner | Writers today — TypeScript | Writers today — Python | Task |
|---|---|---|---|---|---|
| 1 | `bets` | **TS · user** | `submitPicksAsBets` ← `/api/bets`; `markBetsLive`, `writeBetGrades` ← `betGrading.ts` | — | — |
| 2 | `picks` | **TS · user** | `addPick`/`deletePick`/`clearPicks`/`updatePickOdds` ← `/api/picks` + every sport page | — | — |
| 3 | `watchlist` | **TS · user** | `addWatch`/`removeWatch` ← `/api/watchlist` | — | — |
| 4 | `tracked_lines` | **TS · user** | `addTrackedLine`/`removeTrackedLine` ← `/api/tracked-lines` | — | — |
| 5 | `snapshot_cache` | **TS · render cache** | `writeSnapshotCache` ← 35 call sites (`cachedRoute.ts`, every sport module, `scheduler.ts`) | `write_snapshot`, `_write_job_run_log_inner` | 2.7 (lock only) |
| 6 | `prop_odds` | **Python** | ⚠ `writePropOdds` ← `registry.ts` ← `scan-player`, `more-books` | `write_prop_odds` ← `job_runner.run_provider_specs` | **2.5** |
| 7 | `prop_odds_history` | **Python** | ⚠ same as above | `write_prop_odds` | **2.5** |
| 8 | `odds_unresolved` | **Python** | ⚠ `replaceUnresolvedForProvider` ← `registry.ts` | — | **2.5** |
| 9 | `provider_usage` | **Python** | ⚠ `incrementProviderUsage` ← `budget.ts` ← the three buttons; also `/api/diagnostics/ai-summary` | `_increment_usage_inner` | **2.5** (see note) |
| 10 | `game_odds_history` | **Python** | ⚠ `writeGameOddsHistory` ← `gameOddsLog.ts` ← `/api/odds/lines` **on GET** | `write_game_odds_history` ← `mlbOddsLinesCycleJob` | **2.3** |
| 11 | `game_picks` | **Python** | ⚠ `attachMoneylinePrice`/`attachTotalPrice` ← `/api/odds/lines` **on GET**; `capture*`/`grade*`/`ensureGamePickRow` ← `gamePickLock.ts` ← snapshot rebuild | `attach_*`, `capture_*`, `grade_game_pick`, `ensure_game_pick_row` | **2.3**, 2.7 |
| 12 | `pick_history` | **Python** | ⚠ `logSurfaced` ← `pickHistoryLog.ts`; `writeGrades` ← `grading.ts`; `writeBackfill` ← two backfills | `log_surfaced`, `write_pick_history_grades` | **2.3**, **2.7** |
| 13 | `game_odds_book_lines` | **Python** | ⚠ `writeGameOddsBookLines` ← `espnBookLines.ts` ← `recordEspnPregameLine` ← `/api/{cfb,nba,soccer,…}/game/[gameId]` **on GET** | `write_game_odds_book_lines` | **2.3** (see note) |
| 14 | `odds_cache` | **Python** | ⚠ `writeOddsCache` ← `golfLines.ts`, `oddsApi.ts`, `tennisLines.ts`, on odds-route GETs | `write_odds_cache` | 2.3 (see note) |
| 15 | `golf_model_predictions` | **Python** | ⚠ `logGolfModelPredictions` ← `golf/adapter.ts:675`; `writeGradedHolePredictions` ← `golf/models/grading.ts` | `log_golf_model_predictions`, `write_graded_hole_predictions` | **2.4** |
| 16 | `golf_tournament_predictions` | **Python** | ⚠ `logGolfTournamentPredictions` ← `golf/adapter.ts:661`; `writeGradedTournamentPredictions` ← `grading.ts` | `log_golf_tournament_predictions`, `write_graded_tournament_predictions` | **2.4** |
| 17 | `golf_hole_scores` | **Python** | ⚠ `writeGolfHoleScores` ← `historyIngest.ts` ← `adapter.ts:689` | `write_golf_hole_scores` | **2.4** |
| 18 | `golf_round_scores` | **Python** | ⚠ `writeGolfRoundScores` ← `historyIngest.ts` | `write_golf_round_scores` | **2.4** |
| 19 | `golf_tournaments` | **Python** | ⚠ `writeGolfTournament` ← `historyIngest.ts` | `write_golf_tournament` | **2.4** |
| 20 | `golf_tournament_results` | **Python** | ⚠ `writeGolfTournamentResults` ← `historyIngest.ts` | `write_golf_tournament_results` | **2.4** |
| 21 | `game_sim_cache` | **Python** | — (read-only since 2.9) | `ensure_game_sims` ← `computeMlbGameModelJob` | **2.9** |
| 22 | `park_factors` | **Python** (+ TS admin) | `refreshParkFactors` ← `/api/props/park-factors` **only** | `compute_park_factors` ← `maintainMlbParkFactorsJob` | **2.9** |
| 23 | `team_hr_rate_allowed` | **Python** (+ TS admin) | `refreshTeamHrRateAllowed` ← `/api/mlb/refresh-hr-matchup` **only** (admin-gated as of **3.13**, not 2.9 — see note) | `refresh_team_hr_rate_allowed` ← `maintainMlbHrMatchupJob` | **2.9** |
| 24 | `team_elo_history` | **Python** | `writeEloHistory` ← `eloModel.ts` ← **`/api/props/elo-backfill` only** | `write_elo_history` ← `maintainMlbEloJob` | see note |
| 25 | `pitcher_game_score_history` | **Python** | `writePitcherGameScore` ← `eloModel.ts` ← **dead path** | `write_pitcher_game_score` | see note |
| 26 | `model_weights` | **TS · admin** | `writeModelWeights` ← `modelFit.ts`, `homeRunModelFit.ts` ← `/api/props/fit-*` | `write_model_weights` | see note |
| 27 | `historical_odds` | **TS · admin** | `writeHistoricalOdds` ← two ingest routes | — | — |
| 28 | `system_events` | shared, by design | `logSystemEvent` ← 16 call sites | `log_system_event` | see note |
| 29 | `player_game_history` | **Python** | — | `write_player_game_history` | — |
| 30 | `mlb_game_model_cache` | **Python** | — | `write_game_model_cache` | — |
| 31 | `model_calibration` | **Python** | — | `write_calibration` | — |
| 32 | `model_artifacts` | **Python** | — | `write_model_artifact` | — |
| 33 | `walkforward_results` | **Python** | — | `write_walkforward_result` | — |
| 34 | `job_health_checks` | **Python** | — | `_write_health_check_results_inner` | — |
| 35 | `job_locks` | **TS** | `withJobLock` ← `lib/scheduler.ts`'s two timers | — | 2.7c |
| 36 | `mlb_prop_model_cache` | **Python** | — (read-only via `readPropModelCacheForGames`) | `write_prop_model_cache` ← `computeMlbPropPredictionsJob` | 2.7a |

---

## Notes

**`watch_links` was dropped** (migration `20260829000000`, operator decision
Q17). It had no writer or reader in either tree, no `CREATE TABLE` in
`supabase/migrations` — it had been made by hand — and 0 rows. It was also
absent from P3 §4's map, which accounts for 34 tables (22 shared + 6 + 6), not
35; the audit was working from that map rather than from `information_schema`,
which is how it went unnoticed. Dropping it and adding `job_locks` (2.7c) left the count
at 35; `mlb_prop_model_cache` (2.7a) then took it to **36**.

**THESE THREE TOOK TWO CORRECTIONS TO GET RIGHT, and both are recorded because
the second one contradicts the first.**

*First error.* This file originally listed `game_sim_cache`, `park_factors` and
`team_hr_rate_allowed` as Python-owned with task 2.7 closing them. **2.7 never
touched them.** Caught by running this file's own re-derivation properly at the
Phase 2 gate — the first pass only checked which TypeScript writers were
*reachable*, and never diffed the Owner column against reality.

*Second error, mine, while fixing the first.* I then recorded all three as
"written by `adapter.ts` on every snapshot rebuild". **Only `game_sim_cache`
was.** `loadParkFactorCache` and `loadTeamHrRateAllowedCache` are and always
were **read-only** — they only call `readParkFactors`/`readTeamHrRateAllowed`.
The writes live in separate `refreshParkFactors`/`refreshTeamHrRateAllowed`
functions whose only callers are operator routes. A one-hop grep from the table
to `parkFactors.ts` looked like a page-path write; the file contains both a
read path and a write path, and I attributed the wrong one.

**What was actually true, and what 2.9 changed:**

| Table | Real problem | Fix |
|---|---|---|
| `game_sim_cache` | A genuine page-path dual writer — `adapter.ts:2056` called `ensureGameSims` on every rebuild | `ensure_game_sims` now runs inside `computeMlbGameModelJob`, which already holds the same slate and lineups; `adapter.ts` is read-only |
| `park_factors` | Not a page-path write — but **nothing in either language refreshed it on a schedule**. It stayed current only if someone POSTed an admin route | `maintainMlbParkFactorsJob`, every 6h |
| `team_hr_rate_allowed` | Same, and its refresh route was **unauthenticated** | `maintainMlbHrMatchupJob`, every 6h; route added to `ADMIN_API_PREFIXES` |

So the headline finding was smaller than the correction claimed (one contested
table, not three) and the *other* problem was real and different: two seasonal
aggregates the model depends on had no automatic writer at all. Both are fixed.

The TypeScript admin refresh routes survive deliberately, same accepted category
as `model_weights` and `team_elo_history`'s `elo-backfill` — hand-invoked, never
on a page-load path, and useful for forcing a recompute without waiting 6 hours.

**The `/api/mlb/refresh-hr-matchup` gate did not work when 2.9 claimed it.**
Task 2.9 added the route to `ADMIN_API_PREFIXES` and this file recorded it as
admin-gated. It was not: a prefix in that list does nothing unless
`proxy.ts`'s `config.matcher` also routes the proxy over the path, and the
matcher entry was missed — three lines below a comment warning about exactly
that. The route answered unauthenticated POSTs with 200 from 2.9 until 3.13
caught it by testing with a request instead of reading the constant.
`tests/proxy-matcher.test.ts` now fails whenever a guarded prefix is unrouted.

**`pick_history` has one *scheduled* writer**The `/api/mlb/refresh-hr-matchup` gate did not work when 2.9 claimed it.**
Task 2.9 added the route to `ADMIN_API_PREFIXES` and this file recorded it as
admin-gated. It was not: a prefix in that list does nothing unless
`proxy.ts`'s `config.matcher` also routes the proxy over the path, and the
matcher entry was missed — three lines below a comment warning about exactly
that. The route answered unauthenticated POSTs with 200 from 2.9 until 3.13
caught it by testing with a request instead of reading the constant.
`tests/proxy-matcher.test.ts` now fails whenever a guarded prefix is unrouted.

**`pick_history` has one *scheduled* writer, plus three admin backfills.**
Python owns every live write (`computeMlbPropPredictionsJob`,
`computeMlbGameModelJob`, `gradeMlbPropsJob`, and the generic-sport jobs).
`writeBackfill` also reaches it from `/api/props/backfill`,
`/api/props/game-backfill` and `/api/props/game-total-backfill` — all
hand-invoked and all under `ADMIN_API_PREFIXES`, so none is on a user's
page-load path. Same accepted category as `model_weights` and
`team_elo_history`'s `elo-backfill`. Recorded so the Owner column is not read
as "nothing in TypeScript can write this".

**`mlb_prop_model_cache` is the one table created by Phase 2's own work**
(migration `20260829010000`, task 2.7a). Python writes it, TypeScript only
reads it, and it is the mechanism by which `adapter.ts` renders Python's model
numbers instead of its own. It is deliberately *not* `pick_history`: that is a
first-write-wins immutable log, this is mutable current state, and both are
written from the same `CandidateResult` list in the same pass so they cannot
disagree.

**`job_locks` is TypeScript-owned and that is correct.** It is written only by
`withJobLock`, and the only callers are `lib/scheduler.ts`'s two timers, which
are TypeScript. It holds no model data — it is coordination state for the
process doing the work. If a Python job ever needs the same mutual exclusion,
it should write this same table rather than inventing a second mechanism; the
lease semantics are in the migration.

**`team_elo_history` / `pitcher_game_score_history` are already effectively
Python-owned.** The TypeScript writers survive but are barely reachable:
`writeEloHistory` only from `/api/props/elo-backfill`, a hand-invoked admin
route, and `writePitcherGameScore` only via `logPitcherGameScore` and
`updateEloForFinishedGame` — **both of which have zero callers anywhere in the
tree.** Those two exports are dead code and belong in 2.6's sweep. This confirms
the earlier `maintainMlbEloJob` cutover landed properly; the leftovers just were
not removed.

**`game_odds_book_lines` has a request-path writer the audit did not name.**
`recordEspnPregameLine` (`lib/odds/espnBookLines.ts:71`) is called from the CFB,
NBA and Soccer `game/[gameId]` GET handlers. P4 H1 flagged `/api/odds/lines` for
writing on a GET; this is the same class of problem in four other routes and it
was not in any finding. Sequenced under 2.3 as the closest owner, but it is
**new work, not a listed task** — recorded here so it is not lost if 2.3 is
scoped narrowly.

**`odds_cache` is written on odds-route GETs** by `golfLines.ts`, `oddsApi.ts`
and `tennisLines.ts`. These are genuine fetch-and-cache paths, not model math,
so they are lower risk than the model writes — but they are still a GET with a
write side-effect, and Python already has `write_odds_cache`. Not closed by any
current Phase 2 task; **carried into Phase 3** with the rest of the caching work
rather than silently left off the map.

**`provider_usage` keeps one TypeScript writer after 2.5.**
`/api/diagnostics/ai-summary` calls `incrementProviderUsage` for its own
provider spend, which is unrelated to the odds providers. That is correct — it
is recording its own usage, not duplicating Python's. Noted so a later sweep
does not "fix" it.

**`system_events` is shared on purpose.** It is an append-only diagnostic log
with no read-modify-write anywhere; both applications appending to it is the
intended behaviour, not a contested table. It is the one entry here where two
writers is the right answer.

**`model_weights` stays in TypeScript for now.** Its only writers are the
hand-invoked `/api/props/fit-*` model-fitting routes, which `CLAUDE.md` already
exempts from the request-path rules. Python's `write_model_weights` exists and
is used by its own fitting scripts. Two writers, but never concurrently and
never on a user's page load. **Phase 4 owns the model-fitting story** and should
decide this properly; Phase 2 deliberately does not move it.

**`snapshot_cache` is the one place Q2 is read narrowly, and here is why.**
Python writes it only under its own keys (`python-harness:job-run:*`, ESPN
roster data) and has never written `mlb:snapshot`. So the two languages share
the table but not a single row — there is no last-write-wins race and no
possibility of the silent divergence P3 §4 describes. It caches the payload
TypeScript renders, which is the render side of "Python computes, TypeScript
renders." What 2.7 fixes here is not the writer but the *timer*: per-process
`setInterval`s mean N app instances do N rebuilds. `withJobLock` closes that.

The model numbers that used to be computed on the way into this cache are a
different matter, and 2.7 moves those to Python.
