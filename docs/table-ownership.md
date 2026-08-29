# Table ownership

> **One table, one writer.** Task 2.1 of `docs/audit-remediation-plan.md`,
> closing P2 M9 and P3 §4 (22 of 35 tables with writers in both languages).
>
> Standing decision **Q2: Python owns all writes and model math. TypeScript
> renders.** The exceptions below are deliberate and each carries its reason.
>
> **Derived, not recalled.** Table list from `information_schema` on the live
> database (35 base tables in `public`). Writers found by parsing every
> `INSERT INTO` / `UPDATE` / `DELETE FROM` in `lib/db/client.ts` and
> `python-odds-service/src/db.py` — the only two files in either tree issuing
> raw writes — mapping each to its enclosing exported function, then grepping
> both trees for that function's call sites. The gate re-derives this the same
> way and diffs against it; if they disagree, this file is wrong.
>
> **Last derived:** 2026-08-28 at Phase 2 kickoff (`464fda6`); amended 2026-08-29
for `watch_links` (dropped, Q17) and `job_locks` (added, 2.7c).

## How to read the Owner column

| Owner | Meaning |
|---|---|
| **Python** | A `JOB_REGISTRY` job is the only writer. TypeScript reads. |
| **TS · user** | Request-scoped, session-authenticated user data. Stays in TypeScript per Q2's own carve-out — this is not model math and it has no business on a background worker. |
| **TS · render cache** | A cache of what TypeScript renders. Not model math; see the note under `snapshot_cache`. |
| **TS · admin** | Written only by a hand-invoked operator/backfill route, never on a user's page-load path. |
| **⚠ contested** | Two writers today. The Task column names what closes it. |

---

## The 35 tables

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
| 21 | `game_sim_cache` | **Python** | ⚠ `writeGameSimCache` ← `gameSimCache.ts` ← `adapter.ts:1993` `ensureGameSims`, **on snapshot rebuild** | `write_game_sim_cache` | **2.7** |
| 22 | `park_factors` | **Python** | ⚠ `writeParkFactors` ← `parkFactors.ts` ← `adapter.ts:1894` | `write_park_factors` | **2.7** |
| 23 | `team_hr_rate_allowed` | **Python** | ⚠ `writeTeamHrRateAllowed` ← `homeRunLiveMatchup.ts` ← `adapter.ts:1899` | `write_team_hr_rate_allowed` | **2.7** |
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

---

## Notes

**`watch_links` was dropped** (migration `20260829000000`, operator decision
Q17). It had no writer or reader in either tree, no `CREATE TABLE` in
`supabase/migrations` — it had been made by hand — and 0 rows. It was also
absent from P3 §4's map, which accounts for 34 tables (22 shared + 6 + 6), not
35; the audit was working from that map rather than from `information_schema`,
which is how it went unnoticed. The table count stays at 35 because `job_locks`
(2.7c) took its place.

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
