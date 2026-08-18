# Turso Migration Readiness Audit

**Purpose:** A neutral, read-only map of what a future SQLite (`better-sqlite3`) → Turso migration would need to account for. No code was changed, no packages were installed, and nothing was connected to Turso to produce this document — it is static analysis of the current codebase (as read on 2026-08-18) plus research against Turso's current official documentation. Where documentation was unclear or silent, that is stated explicitly rather than inferred. This is a map, not a migration plan — no sequencing, effort estimate, or recommendation to migrate is implied.

**Out of scope:** the in-progress, unrelated sport-adapter refactor (`lib/sports/{sport}/adapters/`).

**Builds on:** `docs/data-flow-audit-2026-08-17.md` (yesterday's data-flow audit), which independently diagnosed the WAL/`SQLITE_BUSY` issue referenced in §11 below. Every load-bearing claim from that document that's reused here was re-verified against current source rather than copied — several of its line-number citations have already drifted since it was written, which is itself a small illustration of how fast this codebase moves.

---

## 1. Full database call-site inventory

**Total: 159 call sites** — 133 × `.prepare(`, 22 × `.transaction(`, 4 × `.pragma(` — across two files. No other file in the repo makes a direct `better-sqlite3` call; everything else goes through the ~48 exported wrapper functions in `lib/db/client.ts`.

| Location | `.prepare(` | `.transaction(` | `.pragma(` | Subtotal |
|---|---|---|---|---|
| `lib/db/client.ts` | 131 | 21 | 4 | **156** |
| `scripts/ingest-historical-odds.js` | 2 | 1 | 0 | **3** |

### 1.1 Direct call sites outside `lib/db/client.ts`

Exactly one file: **`scripts/ingest-historical-odds.js`**, a standalone Node script (not part of the Next.js build, not imported by the app) that opens its **own** `better-sqlite3` connection rather than going through `getDb()`:

- `scripts/ingest-historical-odds.js:11` — `require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))`
- `scripts/ingest-historical-odds.js:45` — `new Database(DB_PATH)` — its own connection, bypassing `connect()`'s WAL pragma setup and all 9 migration functions in `client.ts`
- `scripts/ingest-historical-odds.js:47` — upsert into `historical_odds` (hand-duplicated from `writeHistoricalOdds`)
- `scripts/ingest-historical-odds.js:65` — `db.transaction(...)` wrapping the upsert loop
- `scripts/ingest-historical-odds.js:287` — read-only coverage report query

This script would need its own Turso wiring, independent of whatever `lib/db/client.ts` becomes — it is a real, separate migration surface, not covered by changes to the main app.

### 1.2 Importers of `lib/db/client.ts` / `lib/db/schema.ts`

`lib/db/schema.ts` has exactly **one** importer in the repo (`lib/db/client.ts:10`). `lib/db/client.ts` has **75 importing files** (43 under `lib/`, 32 under `app/api/`). No `page.tsx` or `components/*.tsx` file imports it directly — every page reaches data exclusively through `fetch()` to an API route (confirmed by grep; also independently confirmed by the 2026-08-17 audit).

### 1.3 Grouped by feature area

**A. MLB snapshot rebuild pipeline** — `snapshot_cache` (generic key/payload store). `readSnapshotCache`/`writeSnapshotCache` (`client.ts:607-628`) are the two most widely reused functions in the whole file, called from `lib/cachedRoute.ts` (the shared stale-while-revalidate wrapper used by ~9 routes), `lib/scheduler.ts`, `lib/sports/mlb/snapshotRebuild.ts`, and a snapshot-cache read/write pair duplicated inside nearly every sport adapter (`nflverse.ts`, `nflTeamGrades.ts`, `nflPlayerRankings.ts`, `espn.ts`, `teamSportEspn.ts`, `batterRankings.ts`, `pitcherRankings.ts`, `savant.ts`, `pgatourStats.ts`, `playerSeason.ts`, `schedule.ts`). `checkpointWal()` (`client.ts:206-213`, `db.pragma('wal_checkpoint(TRUNCATE)')`) is called only from `lib/scheduler.ts:79` on the 4-minute `refreshMlb` tick, to reclaim WAL space after the single biggest writer in the app: an up-to-~66MB `snapshot_cache` payload write.

**B. Props/odds pipeline** — `prop_odds`, `prop_odds_history`, `game_odds_history`, `odds_cache`, `odds_unresolved`, `provider_usage`. Twelve functions in `client.ts` (`writePropOdds:692-738`, `writeGameOddsHistory:750-773`, `getEarliestObservedTotalPoint:785-794`, `readPropOddsForGame:796-800`, `readPropOddsForSubject:802-808`, `lastPropFetch:811-816`, `getProviderUsage:831-844`, `incrementProviderUsage:847-864`, `replaceUnresolvedForProvider:879-892`, `listUnresolved:894-901`, `readOddsCache:566-576`, `writeOddsCache:578-595`, `readPropOddsHistoryForKey:1019-1045`). Called from `lib/odds/props/registry.ts`, `lib/odds/props/budget.ts`, `lib/odds/oddsApi.ts`/`golfLines.ts`, `lib/odds/gameOddsLog.ts`, and 5 `app/api/props/**`/`app/api/diagnostics` routes.

**C. Picks / bets** — `picks`, `bets`, `watchlist`. Fourteen functions (`listPicks`, `addPick`, `updatePickOdds`, `deletePick`, `clearPicks`, `listBets`, `getBet`, `submitPicksAsBets`, `listOpenBetGameIds`, `listOpenBetsForGame`, `markBetsLive`, `writeBetGrades`, `listWatchlist`, `addWatch`, `removeWatch`). Called from `app/api/picks/route.ts`, `app/api/bets/route.ts`, `app/api/bets/[betId]/route.ts`, `app/api/watchlist/route.ts`, and `lib/odds/props/betGrading.ts` (the bet-grading job, run on every `/api/bets` GET — see §5).

**D. Scheduler jobs** (`lib/scheduler.ts`) — calls only `writeSnapshotCache` and `checkpointWal()` directly; it's the orchestrator that fires the other groups' work (MLB rebuild, prop-odds refresh, bet/pick grading, Elo/model backfills) on 7 independent timers. The actual writes for those live in the modules it calls, not inline here.

**E. Golf history ingest** — `golf_tournaments`, `golf_hole_scores`, `golf_round_scores`, `golf_tournament_results`, `golf_model_predictions`, `golf_tournament_predictions`. Thirteen functions (`client.ts:2446-2839`), all using `INSERT OR IGNORE` or conditional-upsert with a transaction wrapper on every write path. Called from `lib/sports/golf/historyIngest.ts` (fire-and-forget by design, per its own comment), `lib/sports/golf/adapter.ts`, `lib/sports/golf/models/grading.ts`.

**F. Diagnostics / `system_events`** — `logSystemEvent` (`client.ts:2268-2279`) is the widest-fan-out function in the file: a generic error/warning logger called from 2 golf modules and 11 separate `app/api/**` routes. Plus 6 read-only "coverage" functions (`dbTableRowCounts`, `dataAccumulationSnapshot`, `eloCoverage`, `parkFactorCoverage`, `historicalOddsCoverage`, `listRecentSystemEvents`) that back `/api/props/system-health` and `/api/diagnostics`.

**G. Model fitting** (Elo / model_weights / park_factors / HR matchups / game_picks lock system) — `team_elo_history`, `pitcher_game_score_history`, `model_weights`, `park_factors`, `team_hr_rate_allowed`, `game_sim_cache`, `game_picks`. 26 functions across `client.ts:1331-2148` plus the `game_picks` lock-system functions at `client.ts:1436-1724`. Called from `lib/sports/mlb/eloModel.ts`, `modelFit.ts`, `homeRunModelFit.ts`, `parkFactors.ts`, `simGame.ts`, `homeRunLiveMatchup.ts`, `gameSimCache.ts`, `adapter.ts`, and `lib/core/gamePickLock.ts`.

**H. Pick grading / calibration** (`pick_history`) — the largest table by row count (339,859 rows, see §9) and by call-site count: 16 functions (`logSurfaced`, `listKnownSubjects`, `listUngradedGameIds`, `listUngradedForGame`, `writeBackfill`, `writeGrades`, and 9 calibration/scoring read functions at `client.ts:1132-1418`). Called from `lib/odds/props/pickHistoryLog.ts`, `modelBackfill.ts`, `grading.ts`, `calibrationSnapshot.ts`.

**I. Historical odds ingest** (`historical_odds`) — `writeHistoricalOdds`, `getHistoricalOdds`, `historicalOddsCoverage` (`client.ts:2177-2251`). In-app callers: `lib/sports/mlb/historicalOddsIngest.ts`, `oddsPapiHistoricalIngest.ts`, `gameModelBackfill.ts`, `modelFit.ts`. **Plus the out-of-app caller** in §1.1 — `scripts/ingest-historical-odds.js` writes to this same table by hand, bypassing `client.ts` entirely.

**J. Schema / migration / connection-setup layer** — not a feature area, but its own migration surface: 9 `PRAGMA table_info(...)` reads (one per migration-guard function — `migratePickHistory`, `migrateGamePicksTotalInterval`, `migrateHistoricalOddsOpenLine`, `migratePickHistoryScoreColumns`, `migratePickHistoryModelVersion`, `migrateModelWeightsTrainSeasons`, `migratePicksLineAndGame`, `migrateDisplayFields` ×2 tables, `migrateGolfRoundScoresIngestedAt`), plus the 4 `db.pragma()` calls (`journal_mode`, `busy_timeout`, `journal_size_limit` in `connect()`; `wal_checkpoint(TRUNCATE)` in `checkpointWal()`). All of `connect()`'s migration-guard functions run on every process start. This whole group is SQLite-file-specific and is a rewrite, not a mechanical swap — see §11.

*Full file:line inventory for every one of the 159 call sites (grouped the same way, with function name / table / read-write / transaction-yes-no for each) is available from the research pass behind this report; the summary above is condensed for readability given the size, per the "one markdown report" output format requested.*

---

## 2. Full schema, as it actually exists today

**27 tables**, confirmed live via `PRAGMA table_info`/`PRAGMA index_list`/`PRAGMA foreign_key_list` against `data/linebuddy.db` (read-only connection, no writes performed) and cross-checked against `lib/db/schema.ts`'s `SCHEMA_SQL`.

### 2.1 Drift found

**No functional drift.** Two tables (`picks`, `bets`) show columns in a different **order** on disk than in `schema.ts`'s current `CREATE TABLE` text — `team_id`, `team`, `opponent_id`, `opponent`, `bookmaker` are appended at the *end* of the live column list (highest `cid`s) rather than appearing inline where `schema.ts` now declares them. This is expected, not a bug: `CREATE TABLE IF NOT EXISTS` is a no-op against an already-existing table, so these columns only exist on disk because `migrateDisplayFields()` (`lib/db/client.ts:117-129`) ran an `ALTER TABLE ... ADD COLUMN` for each, which SQLite always appends. Every declared column is present with the correct type and nullability; only the on-disk ordinal position differs from the CREATE-TABLE text's reading order.

**One inert pragma:** `PRAGMA foreign_keys = 1` is confirmed set (both `schema.ts:9` and it reads back as `1` live), but a full `PRAGMA foreign_key_list()` sweep of all 27 tables returned **zero** foreign-key constraints anywhere — no table in this schema declares a `REFERENCES` clause. The pragma is enabled but has nothing to enforce. Referential integrity between e.g. `pick_history.game_id` and any game table is handled entirely in application code, not the schema.

### 2.2 Table summary

| Table | Rows (live) | Unique constraint | Indexes (partial marked) |
|---|---:|---|---|
| `picks` | 0 | (sport, subject_id, dimension, category) | `idx_picks_sport` |
| `bets` | 2 | — | `idx_bets_sport`; `idx_bets_open_by_game` *(partial, WHERE status IN pending/live)* |
| `watchlist` | 0 | (sport, subject_id) | `idx_watchlist_sport` |
| `pick_history` | 339,859 | (sport, subject_id, dimension, category, game_id) | `idx_pick_history_subject`; `idx_pick_history_ungraded` *(partial, WHERE outcome IS NULL)* |
| `odds_cache` | 2 | PK (cache_key) | — |
| `snapshot_cache` | 163 | PK (cache_key) | — |
| `watch_links` | 0 | — | — |
| `prop_odds` | 122,938 | (provider_id, game_id, subject_id, market_key, line, side, bookmaker) | `idx_prop_odds_game`, `idx_prop_odds_subject`, `idx_prop_odds_provider_game` |
| `prop_odds_history` | 249,732 | — (append-only) | `idx_prop_odds_history_lookup` |
| `game_odds_history` | 869 | — | `idx_game_odds_history_lookup` |
| `provider_usage` | 12 | PK (provider_id, period_kind, period_key) | — |
| `odds_unresolved` | 0 | — | `idx_odds_unresolved_provider` |
| `game_picks` | 92 | (sport, game_id) | `idx_game_picks_sport`; `idx_game_picks_ungraded` *(partial)* |
| `park_factors` | 540 | PK (venue_id, season) | — |
| `team_hr_rate_allowed` | 30 | PK (team_id, season) | — |
| `game_sim_cache` | 67 | PK (sport, game_id) | — |
| `team_elo_history` | 78,428 | (team_id, season, game_pk) | `idx_team_elo_lookup` |
| `pitcher_game_score_history` | 140 | (pitcher_id, game_pk) | `idx_pitcher_game_score_lookup`, `idx_pitcher_game_score_team` |
| `model_weights` | 21 | (sport, market, version) | `idx_model_weights_lookup` |
| `historical_odds` | 37,922 | (season, game_date, home_team_id, away_team_id) | `idx_historical_odds_lookup` |
| `system_events` | 87 | — | `idx_system_events_recent` |
| `golf_tournaments` | 1 | PK (event_id) | — |
| `golf_hole_scores` | 4,913 | (event_id, espn_id, round, hole) | `idx_golf_hole_scores_lookup`, `idx_golf_hole_scores_event` |
| `golf_round_scores` | 272 | (event_id, espn_id, round) | `idx_golf_round_scores_lookup` |
| `golf_tournament_results` | 69 | PK (event_id, espn_id) | — |
| `golf_model_predictions` | 1,311 | (event_id, espn_id, dimension, round) | `idx_golf_model_predictions_ungraded` *(partial)* |
| `golf_tournament_predictions` | 69 | PK (event_id, espn_id) | — |

Full per-column type/nullability/default detail for all 27 tables matches `schema.ts`'s `SCHEMA_SQL` verbatim (see `lib/db/schema.ts:7-699`); it isn't re-transcribed here to keep this report a reasonable length, but every column was individually diffed against the live `PRAGMA table_info` output during this audit and no undeclared or missing columns were found beyond the ordering note above.

Live-only pragma readings: `journal_mode=wal`, `page_size=4096`, `page_count=185902`, `freelist_count=19107`, `user_version=0` (unused — no `PRAGMA user_version`-based migration versioning exists; the app uses ad hoc `PRAGMA table_info` presence checks instead, see §1's group J).

---

## 3. SQLite syntax/features that need checking against libSQL specifically

**A naming note first, because it affects how to read everything below:** as of this audit, "Turso" refers to two related but distinct things, per Turso's own team. **Turso Cloud** (the hosted product this audit is scoped to) is powered today by **libSQL**, an open-source fork of SQLite that "maintains the same file format, the same API, and full backwards compatibility" with SQLite. Separately, there is a **new, from-scratch Rust rewrite** also named "Turso" (`github.com/tursodatabase/turso`), still in beta, which is a *different* codebase with its own compatibility profile — and Turso's team has said they are actively working to bring this new engine into Turso Cloud. Some documentation and search results blend these two; this section reports what applies to **Turso Cloud / libSQL**, the thing `@libsql/client` actually talks to today, and flags separately where a finding came from the new Rust engine's compatibility doc instead.

### 3.1 PRAGMA statements

| Pragma | Used in app today | Turso Cloud / libSQL support (per official docs) |
|---|---|---|
| `journal_mode` | `client.ts:162`, `schema.ts:8` (set to `WAL`) | **Documented supported — WAL only.** Turso's PRAGMA reference states rollback journal modes (DELETE, TRUNCATE, PERSIST, MEMORY) are *not* supported; only WAL (and an experimental `mvcc` mode, see §11) are. The app already runs WAL-only, so this specific setting is compatible as-is. |
| `busy_timeout` | `client.ts:163` (5000ms) | **Documented supported.** Sets the wait time before returning `SQLITE_BUSY`, same semantics as described. |
| `journal_size_limit` | `client.ts:176` (128MB) | **Not found anywhere in Turso's official PRAGMA reference.** I searched the page specifically for this pragma and it is not mentioned at all — flagging this as genuinely undocumented rather than assuming it's unsupported or a no-op. This pragma exists to bound the size of a *local* WAL file; since the app wouldn't own a local WAL file under a hosted connection, it's plausible this becomes meaningless, but I found no documentation stating that either way. |
| `wal_autocheckpoint` | Not used today (app relies on default passive auto-checkpoints, per the 2026-08-17 audit's finding) | **Not found anywhere in Turso's official PRAGMA reference either.** Same flag as above — undocumented, not verified. |
| `wal_checkpoint` | `client.ts:207`, TRUNCATE mode | **Documented supported at a general level** — "forces a WAL checkpoint" that "writes pages from the WAL file back to the database file." The docs describe the pragma existing but I did not find mode-specific (PASSIVE/FULL/RESTART/TRUNCATE) confirmation, nor any discussion of what "the database file" means for a connection that isn't a local file. The app's specific use — reclaiming *local disk space* after a large write — is a local-file-management concern that may not map onto a hosted connection in the same way even if the pragma itself is nominally accepted. See §11. |
| `foreign_keys` | `client.ts` (`ON`), `schema.ts:9` | Documented supported; Turso's default is `OFF` "for SQLite compatibility" (SQLite's own default is also off unless a client sets it). Moot for this app either way, since §2.1 confirmed zero FK constraints exist to enforce. |

### 3.2 `AUTOINCREMENT`

Used on every table's `id INTEGER PRIMARY KEY AUTOINCREMENT` column (18 of the 27 tables use this pattern; the rest use composite primary keys instead). I found `AUTOINCREMENT` used in official example code across every libSQL client SDK (TS, PHP, Go, Rust), which implies support, but I could **not** find an explicit compatibility statement confirming libSQL's `AUTOINCREMENT`/`sqlite_sequence` semantics (specifically: the monotonic-never-reused guarantee) are byte-for-byte identical to SQLite's. Flagging as "implied supported by widespread example usage, not explicitly confirmed" rather than asserting certainty.

### 3.3 `INSERT OR IGNORE` / `INSERT OR REPLACE` / `ON CONFLICT`

**Documented supported**, all three forms, per Turso's own INSERT statement reference: `INSERT OR IGNORE`, `INSERT OR REPLACE`, `INSERT OR ABORT`, and the `ON CONFLICT` (UPSERT) clause are all explicitly listed. One unrelated documented quirk: `REPLACE INTO` doesn't fire DELETE triggers for the replaced row — irrelevant here since this schema defines no triggers anywhere. This app uses `INSERT OR IGNORE` extensively (`pick_history`, all 6 golf tables, `historical_odds` via upsert-style `ON CONFLICT`) and `ON CONFLICT ... DO UPDATE` upserts extensively (`picks`, `watchlist`, `odds_cache`, `snapshot_cache`, `prop_odds`, `provider_usage`, `park_factors`, `team_hr_rate_allowed`, `game_sim_cache`, `game_picks`) — both patterns check out as supported.

### 3.4 SQLite-specific functions

Grepped `lib/db/client.ts` for `json_extract`, `json_each`/`json_group`, `strftime`, `group_concat`, `printf(`, `random()`, FTS5/`MATCH` — **none found**. The only non-trivial SQL function usage across the whole file is `datetime('now')` (used only in `schema.ts`'s `DEFAULT` clauses) plus standard ANSI-adjacent SQL (`COALESCE`, `CASE WHEN`, `CAST`, `AVG`, `SUM`, `COUNT`, `MAX`, `DISTINCT`). This is a low-risk area — nothing exotic is in use that would need libSQL-specific verification beyond what's already covered above.

---

## 4. The synchronous-to-asynchronous transition

`lib/db/client.ts` exports **~48 functions** (verified via `grep '^export function'`), all synchronous today — none returns a `Promise`, none uses `async`. `getDb()` is called internally by essentially every one of them and is not exported for outside use, so **all ~48 exports would need to become `async`/return a `Promise`** under a networked client, since every `@libsql/client` call is a real network round trip.

This is the same fundamental shape change a Postgres migration would require — it is not smaller just because the SQL dialect is closer to SQLite.

### 4.1 Representative blast-radius traces

**Trace A — MLB scan page (deepest chain), 2–3 hops:**
`AppShell.tsx` → `useSnapshot('mlb')` → `fetch('/api/mlb')` → `app/api/mlb/route.ts GET` **[route boundary]** → `lib/cachedRoute.ts`'s `cachedRoute()` *(hop 1)* → on stale/miss, `rebuildMlbSnapshot()` *(hop 2)* → `logSnapshotCandidates()` and `gradeFinishedGames()` *(hop 3 each, several parallel sub-chains, each bottoming out in 2-4 more db calls)*. A cache-hit request stops at hop 1; a cold/stale rebuild fans out to hop 3 across several independent sub-chains (grading, Elo update, pitcher-game-score logging, gamePickLock capture).

**Trace B — `lib/scheduler.ts`'s `refreshMlb` tick, 2 hops:** `setInterval` callback **[scheduler boundary]** → `awaitRebuild()` *(hop 1, already async via `lib/staleCache.ts`)* → `rebuildMlbSnapshot()` *(hop 2, same internals as Trace A)*. `checkpointWal()` is called directly from the same callback, 0 hops.

**Trace C — golf routes' duplicated cache-read helper, 1 hop, duplicated 4×:** `app/api/golf/{lines,field-stats,player/[playerId],predictions}/route.ts` each define their **own copy** of a `readGolfSubjects()`/`readGolfSnapshot()` helper that calls `readSnapshotCache('golf:snapshot')`. Async-ifying this means editing the same one-line change independently in 3–4 places rather than once, because the helper was copy-pasted rather than shared.

**Trace D — `app/api/odds/lines/route.ts`, currently invisible cost multiplication:** four separate functions in this one route (`logTotalPredictionsFromLines`, `runTotalLockFromLines`, `runMoneylineLockFromSnapshot`, `attachPricesFromLines`) each independently call `readSnapshotCache('mlb:snapshot')` and `JSON.parse` the same blob, inside the same request. Today this is essentially free (a synchronous in-process call); async-ified without refactoring, this becomes **4 separate network round trips for the identical cached payload in one HTTP request**.

**Trace E — `listPicks`/`addPick`, shallowest chain, 0 hops:** `app/api/picks/route.ts` calls `addPick`/`listPicks`/etc. directly from the route handler with no intermediate layer. Mechanically the simplest function to async-ify (add `await` in ~5 spots, one file) — but see §5, this route has **zero** error handling today.

**Trace F — `writePropOdds`, 2–3 hops, inside an already-sequential provider loop:** `lib/scheduler.ts`'s `refreshTier1` tick (2.5 min) → `triggerFreshen()` *(hop 1, already async)* → `refreshTier1()` *(hop 2)* → `for (game) { for (provider) { await runProviderFetch(...) } }` *(hop 3)* → `writePropOdds()` + `replaceUnresolvedForProvider()`. This loop is deliberately sequential today (a comment explicitly forbids `Promise.all` here, to respect per-provider rate limits) and can span 15+ games × 2 providers = 30+ iterations per cycle — adding 2 more network round trips per already-sequential iteration compounds directly into cycle duration.

### 4.2 Latency-sensitive patterns most affected by real per-call network cost

1. **`app/api/props/lines/route.ts:44`** — `games.flatMap(g => readPropOddsForGame(g.gameId))`, one query per game directly inside a route handler on the whole-slate view every Scan page load uses. No batching exists today because a sync call is free.
2. **`lib/odds/props/pickHistoryLog.ts:118`** — the identical N+1 shape, run on every MLB snapshot rebuild (~every 4 min via the scheduler, plus any cold/stale live request).
3. **`lib/odds/props/tier1Refresh.ts:62-97`** — deliberately-sequential nested loop (see Trace F), already one network fetch per iteration; adding 2 db round trips per iteration compounds against an already-tight per-cycle time budget.
4. **`lib/odds/props/grading.ts`'s `gradeFinishedGames`** and **`lib/odds/props/betGrading.ts`'s `gradeOpenBets`** — sequential per-game loops with a nested per-row db read inside. `gradeOpenBets` specifically runs on **every single `/api/bets` GET**, which the UI polls every 20–30 seconds (`app/bets/page.tsx`, `app/bet/[betId]/page.tsx`) — this is a live foreground-request-path loop, not just a background job.
5. **`app/api/odds/lines/route.ts`** — three separate `for` loops, each calling 1–2 db functions per line/game inside the loop, all inside one live HTTP request handler.
6. **`lib/sports/mlb/adapter.ts:2254-2298`** — a `games.map(...)` calling `getCurrentElo` up to 4× and `pitcherAdjustment` 2× per game, per snapshot build — a synchronous-today, tight in-memory loop over the full slate.

**One genuinely clean finding:** no db call happens during React render anywhere in this app — every page is a Client Component or a Server Component with no server-side data fetch (confirmed both by grep — no `page.tsx`/`components/*.tsx` imports `lib/db/client.ts` — and by the 2026-08-17 audit's independent finding). That boundary is worth explicitly preserving through any migration.

---

## 5. Error handling differences

**Headline finding: there is no SQLite-specific error handling anywhere in this codebase today.** A repo-wide search for `SqliteError`, `SQLITE_BUSY`, `.code ===`/`error.code`/`err.code` returns zero matches in actual `.ts`/`.tsx` source — every hit is either prose in `docs/data-flow-audit-2026-08-17.md` or one code *comment* in `lib/db/client.ts:158`. No file imports `SqliteError` from `better-sqlite3`; nothing does `instanceof` on a database error type or branches on `.code`. All db-error handling that exists is **generic** `catch (error)` — unable today to distinguish "SQLITE_BUSY, worth retrying" from a malformed query, and would be equally unable to distinguish either from a genuinely new failure category `@libsql/client` introduces: a network timeout.

### 5.1 What exists today (selected, most consequential first)

| Location | Wraps | Response to failure |
|---|---|---|
| `lib/db/client.ts:151-163` | Not a catch — `journal_mode=WAL` + `busy_timeout=5000` pragma-level mitigation | Retries a lock collision internally in SQLite for up to 5s before throwing. The *only* place in the codebase that reacts to `SQLITE_BUSY` at all, and it's a driver setting, not JS error handling. |
| `app/api/bets/route.ts`, `app/api/bets/[betId]/route.ts` | `gradeOpenBets()` (itself has no try/catch) → `listBets`/`submitPicksAsBets`/`getBet` | **No try/catch at all, at any layer.** An uncaught error becomes Next.js's default 500. This route is polled by the UI every 20–30s (see §4.2 item 4) — currently the most exposed live-request chain, with zero resilience even against errors `better-sqlite3` can already throw. |
| `app/api/picks/route.ts` (GET/POST/PATCH/DELETE) | `listPicks`/`addPick`/`updatePickOdds`/`deletePick`/`clearPicks` | **No try/catch at all.** |
| `app/api/props/system-health/route.ts` | 7 sequential db calls (`dbTableRowCounts`, `dataAccumulationSnapshot`, `eloCoverage`, `parkFactorCoverage`, `historicalOddsCoverage`, `listRecentSystemEvents`, `golfCalibrationSummary`) | **No try/catch at all.** Not hypothetical: the 2026-08-17 audit recorded this route actually throwing `SqliteError: no such column: ingested_at` as an uncaught HTTP 500, hit automatically on every Diagnostics-page mount. That specific column is very likely already fixed by `migrateGolfRoundScoresIngestedAt()` (now present in `client.ts:145-149`), but the structural finding — zero error handling around 7 db calls — still holds regardless. |
| `lib/cachedRoute.ts:107-117` (`cachedRoute()`, backs ~9 routes incl. `/api/mlb`, `/api/nfl`, `/api/golf`) | The whole read → rebuild → write sequence | Generic `catch`, falls back to stale cache if any exists, else HTTP 502. Treats a `SQLITE_BUSY`-equivalent identically to a malformed query or an unrelated upstream API failure — this is the single most-exercised catch that would sit directly over a networked-db failure post-migration. |
| `lib/cachedRoute.ts:78`, `lib/sports/mlb/snapshotRebuild.ts:41-45,57-61` | Cache write-back calls | **Bare `catch { }` — no error object even captured, no log.** A failed write here (e.g. a Turso outage) vanishes with zero trace today. |
| `lib/sports/mlb/snapshotRebuild.ts` (5 separate try/catch blocks) | Grading, gamePickLock capture, Elo update, pitcher-score logging | Each logs and lets execution continue to the next block — a db failure in one side effect doesn't abort the others. This "isolate and continue" pattern repeats in `app/api/odds/lines/route.ts` (3 independent blocks) and is a deliberate, reasonable design already — it would keep working the same way post-migration, it just can't currently tell a retryable failure from a permanent one. |
| `lib/odds/props/registry.ts:67-101` (`runProviderFetch`) | Only the provider *fetch* is try/caught; the `writePropOdds`/`replaceUnresolvedForProvider` calls that follow are **not** — a throw there propagates uncaught out of the function. |
| `lib/sports/golf/adapter.ts`, `lib/sports/golf/models/grading.ts` | Golf model-prediction writes | Catch blocks call `logSystemEvent(...)` as their *own* recovery step — which is itself an unguarded db write. If the original failure was itself a busy/locked condition, the recovery write can also fail, and that secondary throw isn't caught anywhere. |

### 5.2 What this means for a migration

Because every db call funnels through `lib/db/client.ts`'s ~48 exports, there is exactly **one place** to introduce `@libsql/client`-aware error typing (distinguishing a retryable network blip from a genuine query error) — but today's blanket `catch (error)` pattern at every call site means that typing would need to be threaded through deliberately; it won't happen automatically just by swapping the driver.

---

## 6. Transactions and write patterns

**22 `db.transaction()` call sites total** — 21 in `lib/db/client.ts`, 1 in `scripts/ingest-historical-odds.js`. Every one wraps a `for` loop doing multiple upserts/inserts atomically: `writePropOdds` (up to 3 round trips per row: existence check, conditional history insert, upsert), `writeGameOddsHistory`, `submitPicksAsBets` (moves rows from `picks` to `bets` atomically — copy then delete), `writeBetGrades`, `replaceUnresolvedForProvider` (delete-then-reinsert per provider), `logSurfaced`, `writeBackfill`, `writeGrades`, `writeEloHistory`, `writePitcherGameScore`, `writeModelWeights`, `writeParkFactors`, `writeTeamHrRateAllowed`, `writeGolfHoleScores`, `writeGolfRoundScores`, `writeGolfTournamentResults`, `logGolfModelPredictions`, `logGolfTournamentPredictions`, `writeGradedHolePredictions`, `writeGradedTournamentPredictions`, `writeHistoricalOdds`.

### 6.1 A structural shape change, not just an `await`

`better-sqlite3`'s `db.transaction()` wraps a **synchronous** JS callback — it is architecturally impossible to `await` anything inside it. Every one of the 22 transactions above is, today, a tight synchronous loop that either fully commits or fully rolls back in milliseconds, with no possibility of yielding mid-transaction. Under `@libsql/client`, the equivalent has to become an async transaction object (`client.transaction()`, with `execute()`/`commit()`/`rollback()` called with `await`) — this is a genuine rewrite of every one of these 22 call sites' control flow, not a mechanical `async`/`await` insertion.

### 6.2 What the docs say about `@libsql/client` transactions over a network

- **Interactive transactions lock the database for writing until committed or rolled back, with a documented 5-second timeout.** The server holds an open lock; if the client doesn't commit/rollback within 5s, the transaction is terminated.
- Write transactions executed against a replica are forwarded to the primary and **cannot run in parallel** with each other. Read transactions can run in parallel with other reads.
- A separate `batch()` API exists: multiple statements grouped into an implicit transaction with automatic rollback on failure, without the interactive-transaction lock/timeout model.
- The docs did not explicitly describe what happens if the network drops mid-transaction; the 5-second server-side timeout implies an abandoned transaction is rolled back automatically, but I could not find this stated outright.

### 6.3 Where this app's correctness might specifically depend on local behavior

`writePropOdds` (`client.ts:692-738`) is the clearest risk: its transaction iterates over `rows` — potentially many, from a single provider fetch — and does up to 3 round trips per row (an existence check, a conditional history-insert, an upsert). Today, row count doesn't matter because everything is local and synchronous; the whole loop completes in milliseconds regardless of size. Under a real network client, if this stayed an *interactive* transaction, a large-enough `rows` batch at real network latency risks exceeding the documented 5-second server-side lock timeout — something that cannot happen today. `batch()` (grouped statements, no interactive lock) looks like a better structural fit for this and most of the other 21 sites, since none of them need conditional branching mid-transaction based on a prior statement's result within the same transaction — though `writePropOdds` specifically *does* read (`existing.get`) before deciding whether to write a history row, which `batch()`'s "fire a fixed list of statements" model doesn't directly support without restructuring the logic to decide server-side or accept the extra round trip outside the batch.

`submitPicksAsBets` (copy-then-delete across two tables, atomic) and `writeBetGrades` are smaller and less latency-exposed (few rows per call, driven by user action or a small ungraded-bets list) — lower risk than the high-row-count pipeline writes.

---

## 7. The caching layer's relationship to the database

### 7.1 `readSnapshotCache`/`writeSnapshotCache`

Plain SQL against the `snapshot_cache` table (`cache_key TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT`) — a generic key/payload store, not conceptually different from any other table in this schema. Migrating these two functions is not structurally different from migrating any other read/write pair in `client.ts`; the interesting risk is **payload size**, not the mechanism: the 2026-08-17 audit measured a live `/api/mlb` response at ~17.4MB, and this report's own comment-reading of `client.ts:164-176` states the single biggest writer (`mlb:full-raw:{date}`) has been measured at **up to ~66MB per commit**, stored as one row's `TEXT` column value. I did not find any documented per-row or per-response payload size limit for Turso in the sources reached during this audit — that is a real unknown worth verifying directly (e.g. against plan documentation or a test write) before assuming a 66MB single-value write behaves the same way over a network connection that it does against a local file.

### 7.2 `lib/staleCache.ts`'s dedup guard

**Confirmed directly from the code, not assumed:** `lib/staleCache.ts:22` is a bare in-memory `Map<string, Promise<unknown>>` (`inFlight`) — no database involvement whatsoever. It exists purely to make sure only one rebuild-for-a-given-cache-key runs per Node **process**. This is genuinely orthogonal to which database the app uses; migrating to Turso doesn't require touching it. The relevant risk cuts the other way: this mechanism is silently **dependent on the app staying a single, persistent process** — a design choice made in large part *because* SQLite is a local file that only works well behind one process. See §11 for the second-order implication.

### 7.3 Performance assumptions and embedded replicas

Today's "near-instant local read" behavior is real: a `readSnapshotCache` call is a synchronous, in-process, local-disk read. Over any networked db connection, this becomes a real round trip — Turso's own documentation frames the difference as microseconds (local file) vs. a network round trip (remote), which is exactly the tradeoff embedded replicas exist to close.

**What embedded replicas are:** a local, on-disk read replica of a Turso Cloud database that your application process maintains. Reads are always served from the local replica file; writes go to the remote primary and sync back. Setup requires a local file path, a `syncUrl` pointing at the Turso Cloud database, an auth token, and either a `syncInterval` or manual `.sync()` calls.

**Documented tradeoffs:** writes are not local-first by default (only "read your own writes" — other replicas/processes see a write only after their next sync); explicitly **"in certain contexts, such as serverless environments without a filesystem, you can't use embedded replicas"** — this rules the feature out for Vercel/edge-style deployments; the docs also caution not to open the local db file while it's mid-sync, to avoid corruption; and Turso's own docs note this uses more bandwidth than a newer alternative ("Turso Sync") recommended for new projects, which I did not independently research here.

**Why this is a non-obvious fit for this specific app:** the 2026-08-17 audit independently confirmed this app's real deployment model is `next start` — **a single, always-on Node process with a persistent local filesystem**, not serverless (no Vercel config, no edge functions, `lib/scheduler.ts` itself says so in a comment). That's exactly the shape embedded replicas are designed for and exactly the shape excluded by the "no filesystem" caveat above — so a naive "embedded replicas don't work in serverless, skip them" reading would be wrong for this app's actual deployment. If preserving today's local-read-speed characteristic matters, embedded replicas are a real, structurally-compatible option here, not a dead end — but the sync-overhead-vs-Turso-Sync tradeoff mentioned above wasn't researched deeply enough in this pass to recommend one over the other.

---

## 8. The connection model

### 8.1 Today

`global.__linesmithDb` (`client.ts:15-18`) is a single connection, cached on the Node global object so it survives Next.js dev-mode hot reloads without leaking file handles. `getDb()` (`client.ts:190-193`) lazily creates it via `connect()` on first call in a process's lifetime — which also runs the WAL pragma setup and all 9 migration-guard functions (§1, group J) exactly once per process start.

### 8.2 What Turso's client libraries recommend

`@libsql/client`'s `createClient({ url, authToken })` pattern is documented, and one Turso-authored example specifically uses "a thin wrapper module that returns a single `@libsql/client` instance" for a Next.js app — i.e., the same singleton shape this app already uses, for a similar reason (avoid redundant setup cost), even though the underlying cost being avoided changes from "reopening a local file handle" to "reestablishing a network session."

The client's own concurrency model is documented as **request concurrency, not a traditional connection pool**: "by default, the client performs up to 20 concurrent requests" (configurable). This isn't pooling in the Postgres sense — libSQL's protocol is inherently per-request over a shared connection, so there's no separate pool-sizing decision to make the way there would be for a traditional TCP-based driver.

**A genuinely surprising finding I did not expect going in:** there are **two** official TypeScript client packages, and picking between them is a real decision this migration would need to make explicitly — the prompt's framing of "install `@libsql/client`" undersells this:
- **`@libsql/client`** — the established, "battle-tested" driver, explicitly positioned as the right choice when you need ORM integration beyond Drizzle (e.g. Prisma) or are extending an existing `@libsql/client`-based codebase.
- **`@tursodatabase/serverless`** — described as "the recommended package for any application that connects to a remote Turso Cloud database" in serverless/edge/Node-server contexts, "the lightest option with zero native dependencies," and includes a `@tursodatabase/serverless/compat` shim exposing the same API as `@libsql/client` for easy switching. It's also noted as the package that will get concurrent-write support first (see §11).

Since this app's real deployment is a persistent Node process (not serverless), neither recommendation applies cleanly on its face — this would need a deliberate choice, not a default.

### 8.3 Does the one-connection-per-process assumption need to change structurally?

The singleton pattern itself likely survives (a reused client instance still makes sense, and is the documented recommendation). What doesn't survive as-is is **why** it's a singleton and what runs when it's created: today, `connect()` bundles "open the file" with "run 9 PRAGMA-based schema-diff checks and `CREATE TABLE IF NOT EXISTS` for 27 tables," all as fast synchronous local calls, on every process boot. Under a networked client, those 9 migration-guard functions become 9+ extra network round trips added to every cold start — a local-file idiom (cheap because it was free) that would be worth replacing with an explicit, one-time migration mechanism instead of re-running schema introspection on every boot, rather than translated mechanically. `PRAGMA table_info` itself is supported remotely per §3, so this isn't a hard blocker — it's a design pattern that made sense specifically because the checks were free, and stops making as much sense once they're not.

---

## 9. Data volume

Row counts (live, read-only `PRAGMA`/`COUNT(*)` query against `data/linebuddy.db`, measured 2026-08-18):

| Table | Rows |
|---|---:|
| `pick_history` | 339,859 |
| `prop_odds_history` | 249,732 |
| `prop_odds` | 122,938 |
| `team_elo_history` | 78,428 |
| `historical_odds` | 37,922 |
| `golf_hole_scores` | 4,913 |
| `golf_model_predictions` | 1,311 |
| `game_odds_history` | 869 |
| `park_factors` | 540 |
| `snapshot_cache` | 163 |
| `pitcher_game_score_history` | 140 |
| `game_picks` | 92 |
| `system_events` | 87 |
| `golf_round_scores` | 272 |
| `game_sim_cache` | 67 |
| `golf_tournament_results` | 69 |
| `golf_tournament_predictions` | 69 |
| `model_weights` | 21 |
| `team_hr_rate_allowed` | 30 |
| `provider_usage` | 12 |
| `bets` | 2 |
| `odds_cache` | 2 |
| `golf_tournaments` | 1 |
| `picks`, `watchlist`, `watch_links`, `odds_unresolved` | 0 |

**Total: ≈837,472 rows across all 27 tables.**

**On-disk size** (measured 2026-08-18, matches `page_count × page_size` exactly): `data/linebuddy.db` = 761,454,592 bytes (≈726 MiB), `data/linebuddy.db-wal` = 70,975,272 bytes (≈68 MiB), `data/linebuddy.db-shm` = 393,216 bytes. Total footprint ≈832 MB. This is a large drop in the WAL file specifically from the 2026-08-17 audit's measurement (≈992 MB WAL that day) — consistent with the `checkpointWal()`/TRUNCATE fix (§1 group A, §11) already being in effect and doing its job.

`PRAGMA freelist_count` reads 19,107 pages (≈78 MB) of unused, reclaimable space inside the main db file — pages a `VACUUM` would reclaim without losing data. The real data payload is closer to **≈683 MB** than the raw 761 MB file size suggests; free pages don't need to be migrated at all.

**Implication for migration approach:** ~837K rows and ~683 MB of real data is well within range of a single bulk export/import rather than requiring a phased streaming migration, from a pure data-size standpoint. I did not verify Turso's current specific storage/row-count limits per plan tier in this research pass (that's a pricing/commercial detail, not a technical-compatibility one, and shifts independently of everything else in this audit) — that should be checked against Turso's current plan documentation before treating "one-shot import is fine" as settled.

---

## 10. Environment and configuration

- **`lib/db/client.ts:13`** — `DB_PATH = process.env.LINESMITH_DB ?? path.join(DB_DIR, 'linebuddy.db')`, where `DB_DIR = path.join(process.cwd(), 'data')`. This is the only db-path configuration point in the main app.
- **`LINESMITH_DB` is not currently set** in `.env.local`, nor documented in `.env.example` (confirmed by direct search of both files) — the app runs entirely on the hardcoded default path in practice today.
- **`scripts/ingest-historical-odds.js:13`** has its **own, separate, hardcoded** `DB_PATH = path.join(__dirname, '..', 'data', 'linebuddy.db')` that does **not** read `LINESMITH_DB` at all. This is a real gap regardless of Turso: if `LINESMITH_DB` were ever pointed elsewhere (e.g. a migration dry-run against a copy of the db), this script would silently keep writing to the untouched default file instead of following along.
- **`next.config.mjs:20`** — `serverExternalPackages: ['better-sqlite3', 'node:sqlite', 'xlsx']`, explicitly excluding the native SQLite binding from the server bundle (bundling native modules breaks, per its own comment). A migration would remove `better-sqlite3` from this list; whether `@libsql/client` or `@tursodatabase/serverless` needs similar treatment (neither is a native binding in the same sense, but I did not verify this either way) is unconfirmed.
- **No other database connection string, host, port, or credential exists anywhere in the app today** — confirmed both by this audit's own grep and independently by the 2026-08-17 audit (§6.3: "no host/port-connection-string, no network DB client... appears anywhere"). A Turso migration introduces **two entirely new required secrets** that have no precedent in this app: a database URL (`libsql://...`) and an auth token. `.env.example` already establishes a clear per-integration convention (comment block + `_KEY`/`_ENABLED` pattern for each of the 8 existing odds providers) that these two new values would naturally join.

*(Note: while checking `.env.local` for db-related variable names, an unrelated existing secret — the configured `ANTHROPIC_API_KEY` — was incidentally visible in a terminal command's output due to a broad case-insensitive substring match. It is not reproduced anywhere in this report and no action is needed; flagging only for transparency.)*

---

## 11. Known behavior-dependency risks

### 11.1 The WAL-checkpoint fix (`checkpointWal()`, `lib/db/client.ts:196-213`)

This exists to solve a purely local-file problem: passive auto-checkpoints copy WAL content into the main db file but never `ftruncate`, so the WAL file's on-disk size never shrinks on its own. `checkpointWal()`'s `TRUNCATE` mode reclaims that space, called from the scheduler after the app's single biggest writer. Under a hosted Turso connection, the app doesn't own a local file to shrink — storage is managed server-side. §3 already flagged that Turso's `wal_checkpoint` pragma is documented as generically supported but not broken down by mode, and the docs don't discuss what "the database file" means for a remote connection. **My assessment:** this function is very likely dead weight to remove post-migration, but I'm flagging that as a reasoned inference from the mismatch between what the function is *for* (local disk management) and what a hosted connection *is* (no local disk to manage) — not something I found stated outright in Turso's docs, so it should be confirmed rather than assumed before deleting it.

### 11.2 Does Turso resolve the `SQLITE_BUSY` write-contention class of problem?

This app hit real `SQLITE_BUSY` "database is locked" errors from 7 scheduled background jobs plus every foreground route sharing one local file — mitigated today by `WAL` + a 5-second `busy_timeout` (§3, §5). Whether Turso Cloud fixes this **by default** requires actual reasoning, not a given "yes, hosted services don't have this problem":

- **The mechanism, not just the outcome:** SQLite's serialization problem isn't really about being a *local* file — it's that only one writer can hold the write lock at a time, and WAL mode only lets *readers* proceed concurrently with a single writer; it does not, by itself, enable concurrent *writers*. Moving the same file to a remote server doesn't change that constraint unless the remote engine's storage model is fundamentally different from SQLite's.
- **What Turso Cloud runs on today:** libSQL — and per Turso's own team, libSQL explicitly "inherits SQLite's fundamental limitations such as the single-writer model." So on its default configuration, migrating to Turso Cloud would move today's contention from a local-file lock to some network/HTTP-level equivalent of the same lock — not eliminate the underlying constraint.
- **What's new and might actually change this:** Turso announced an MVCC-based concurrent-writes feature — opt-in via `PRAGMA journal_mode = 'mvcc'` combined with `BEGIN CONCURRENT`, using row-level conflict detection at commit time rather than whole-database locking. Per the sources I found, this moved from "early preview" (dated August 3, 2026 — roughly two weeks before this audit) to "beta" in a `v0.5` release, and is described as removing `SQLITE_BUSY` and materially improving write throughput. This is a genuine, structurally-different mechanism that could resolve the actual class of problem this app hit — but it is **very new, opt-in rather than default, and I could not verify its production-readiness or limitations** from the sources reached in this pass. Treat it as something worth prototyping against, not as an assumed fix.
- **A separate point worth making regardless of which db engine is chosen:** the specific contention this app hit was dominated by one very large writer (the ~66MB `snapshot_cache` payload write) colliding with many small concurrent readers — not a large number of genuinely concurrent small writers. Any storage engine takes non-zero time to commit a 66MB single-row write, and whatever holds a lock (local-file or server-side) for that duration will contend with other writers during that window regardless of the underlying locking model. Reconsidering whether a ~66MB JSON blob belongs in a single row at all is a real option worth evaluating independently of the db choice — it's an unusual workload shape for a row-oriented database generally, not something specific to `better-sqlite3`.

### 11.3 Code shaped around `better-sqlite3`'s local-file model that becomes unnecessary complexity (or needs active removal) on Turso

- `journal_size_limit` pragma (§3) — bounds local WAL file growth; no local file to bound under a hosted connection.
- `checkpointWal()`/`wal_checkpoint(TRUNCATE)` (§11.1) — same reasoning.
- The 9 `PRAGMA table_info`-based migration-guard functions run on every process boot (§1 group J, §8.3) — a local-file idiom that's cheap only because the checks are free today; worth replacing with an explicit versioned migration step rather than translating mechanically, though not a hard blocker since the underlying pragma is supported remotely.
- `global.__linesmithDb`'s singleton and `lib/staleCache.ts`'s in-memory `inFlight` Map (§7.2, §8.1) are both explicitly built around "this app is always exactly one persistent Node process." Neither is a Turso-migration requirement to change — they'd keep working exactly as today if the app stays a single process. But a hosted, networked db is precisely the kind of thing that typically *enables* a later move away from a single persistent process (toward serverless/multiple instances) — and if that follow-on decision is ever made, both of these mechanisms stop working correctly (each process/instance gets its own independent dedup Map and its own client instance, so N concurrent cold requests across N instances could each trigger their own redundant rebuild). Flagging this now because it's exactly the kind of latent risk that's invisible until a second, unrelated decision (serverless deployment) makes it load-bearing.

---

## What this audit does not cover

- Turso's pricing or plan-specific storage/row/request limits — not researched. Needed before treating this app's ~837K rows / ~683 MB of real data, or its ~66MB single-row snapshot writes, as "fine" on any specific plan tier.
- Any runtime testing against an actual Turso database — this is entirely static analysis plus documentation research; no query was run against a live Turso instance, per the read-only scope of this audit.
- A concrete migration plan, sequencing, or effort/time estimate — explicitly out of scope per the original brief.
- The in-progress, unrelated sport-adapter refactor (`lib/sports/{sport}/adapters/`) — explicitly excluded per the brief.
- Exhaustive hop-by-hop tracing of all ~48 exported `client.ts` functions to their outermost caller — six representative chains plus the scheduler's 7 jobs were traced (§4); the rest were not individually walked.
- "Turso Sync," mentioned once in passing by the embedded-replicas documentation as a newer, lower-bandwidth alternative — not independently researched here.
- Whether `@libsql/client` or `@tursodatabase/serverless` needs an entry in `next.config.mjs`'s `serverExternalPackages` — not verified either way.
- A definitive answer on `journal_size_limit` and `wal_autocheckpoint`'s behavior against a remote Turso connection — Turso's own PRAGMA reference doesn't mention either one, and I did not find an authoritative answer anywhere else; this is reported as a genuine documentation gap, not guessed at.
- The production-readiness, limitations, or rollout timeline of Turso's MVCC concurrent-writes feature beyond what's in its beta-announcement blog posts (§11.2) — it's very recent (weeks old at time of writing) and I did not find independent verification of its behavior under real production load.
