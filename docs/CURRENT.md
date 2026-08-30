# CURRENT — pick up here

**Phase 6 is IN PROGRESS.** Player Detail is furthest along: **36 of 48 role
cells fill, up from 14**, and four sports fill all six. Team Detail is nearly
complete. **Game Detail is the largest thing left.** The gate has been walked
for the five sports with live data and found four real defects.

**Read `docs/phase6-completion-plan.md` first — it is the authoritative list of
what is left.** `docs/audit-remediation-plan.md` §11 is the phase log;
`docs/player-detail-sourcing-gaps.md` has the 48-cell inventory. Trust §11 and
`git log` over this file if they disagree.

## 1. What just happened (2026-08-30, sessions four and five)

Nineteen commits, `e4c2745`..`6553e4f`. **TS tests 197 → 251.** `tsc` and
`npm run build` clean throughout. Three Render deploys; worker live on
`e1fd935`.

| Task | State |
|---|---|
| 6.8 nflverse PBP | **COMPLETE** — target map renders, 2025 backfilled. |
| 6.13 Player Detail | **14/48 → 36/48 roles.** MLB, NBA, NHL at 6/6. |
| golfR import | **DONE** — 1,033,752 shots; golf 1/6 → 3/6. |
| 6.14 rating block | **BUILT** — `team_elo_history`'s 88,774 rows reach a page. |
| NBA/NHL shot backfills | **DONE** — 195 → 219,873 and 102 → 73,291 rows. |
| 6.15 Game Detail | **STARTED** — NBA/NHL got `rankings` + `unitGrades`. |
| Gate walk | **PARTIAL** — five sports walked, four defects found and fixed. |
| Python worker | **3 bugs fixed**: a batch-aborting write, a TypeError meaning four ingest jobs had NEVER run, and their missing `_run_timed`. |

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**Everything of consequence this session was found by opening a page or reading
a log — never by a test, never by `tsc`.** Seven defects, all shipped and live:

1. **Soccer's opponent matching was dead.** Understat says "Leeds", ESPN says
   "Leeds United", three sites compared with `===`. 0 of 273 entries matched, so
   the h2h window, the `careerH2H` card and the opponent filter chip were all
   empty *since soccer shipped*. **Third sport with this bug class** — CFB's own
   fix comment says it had been found twice before.
2. **Four ingest jobs had never run.** `yield_fn()` with no argument is a
   `TypeError` against the queue's `functools.partial`. Their tables looked
   healthy because every row came from hand-run backfills, which pass no
   `yield_fn` at all.
3. **Those same four bypassed `_run_timed`** — the wrapper whose whole purpose
   is making failure visible was missing from exactly the jobs that were
   failing, so `health_check.py` could not see them.
4. **`refreshTier1` wrote nothing**, every run: one mislabeled row aborted the
   whole batch inside a single transaction.
5. **The line-movement card had an unreachable empty state** behind an early
   `return null`.
6. **NFL's `careerH2H` was returned from the wrong object**, so it never
   reached the page.
7. **Six page-load routes shared a 10/min provider budget** — one game-page view
   spent 60% of it and a second view 429'd.

*A populated table does not mean its job works. A filled field does not mean a
block renders. A guard's prose being right does not mean its predicate is.*

**And a diagnosis I got wrong.** `refreshTier1` failed on `mlb total under
point=5.5`. 5.5 is an ordinary MLB total and 37,881 settled games back that up,
so the constraint looks too tight. **The tell is the PRICE, not the point:**
under 5.5 at −225 implies 69% against a real 20–25%, so it is an
alternate-scope market. Widening the band would have readmitted exactly what
task 5.4 excluded. *Measuring the field you suspect is not the same as
measuring the row.*

**Three tests I wrote did not discriminate**, all caught by fault injection, all
bad FIXTURES rather than bad assertions — including one whose regex used
`` `\b` `` inside a template literal, where it is the backspace character, so
the loop skipped every case and compared an empty array to an empty array.
**When an injection PASSES, the test does not discriminate.**

## 3. NEXT ACTIONS, in order

1. **Deploy `794240d`+ to Render.** The worker is live on `e1fd935`, so the odds
   cycle and the four ingest jobs are already fixed and verified running. What is
   undeployed is the `_run_timed` wrap — until it ships those four write no
   breadcrumb and `health_check.py` is blind to them. Call in §7.
2. **Finish the gate walk when CFB/NBA/NHL are back in season.** They have
   **zero candidates today**, so their pages cannot be walked at all. This is now
   the biggest blocker to closing the Phase 6 gate.
3. **6.15 Game Detail** — the largest remaining item. `matchup` for
   NBA/NHL/tennis is a design question, not wiring: `GameMatchupData` is
   MLB/NFL-shaped (`pitching`, `BatterPitcherMatchupProps`). `bookGrid` and
   `matchupKey` exist nowhere in the codebase.
4. **MLB's game page has no `unitGrades`** though its team page does. Needs both
   teams' Statcast plumbed into `MlbGameDetailInput` — a hook change.
5. **Golf's remaining roles** — `opponentUnit` (the field) and `conditions`
   (course + weather) need `golf_tournaments`/`golf_round_scores` plumbed to a
   hook. The shot-by-shot import is DONE.
6. **6.10's park factors and `game_sim_cache`**, then **6.21**, then **6.24**
   (scope the de-vig backtest with the operator first — it is open-ended).

## 4. Blocked, and why — do not re-attempt without new data

**The four accepted sourcing gaps** (operator, 2026-08-30): NFL route mix, NFL
man/zone, CFB route mix, CFB target map. All need a tracking feed. **NGS does
not close them** — its public release is weekly per-player aggregates with no
route running and no coverage shell, verified by reading its scraper's own
column list. **cfbd play-by-play has no pass location or air yards.**

**Waived by the operator:** tennis point-level (serve mix, serve placement), MLS
shot locations, the MLS/EPL venue roof list.

**6.23 book-lag is NOT DERIVABLE.** `observed_at` is a provider poll time:
126,977 rows over 24 hours share 426 distinct timestamps.

**Golf `careerH2H` is not buildable** — it means "at this course", and
`golf_tournaments` holds three events. No multi-year course history exists.

**53% of `pitcher-strikeouts` rows in `prop_odds_history` carry no line.** Needs
its own task, in the Python ingest path.

## 5. What is running

**A dev server on port 3000 belongs to ANOTHER session.** The in-app Browser
pane cannot reach it — **use Playwright MCP.**

Seven `harvester_scrape.py` scheduled tasks on a ~20-minute cycle; two PIDs each
is ONE process.

## 6. Things that will bite again

**Open the page. Read the log.** See §2 — that is where all seven came from.

**A populated table does not mean its job works.** Four ingest tables were
filled entirely by hand-run backfills while the scheduled job crashed every run.

**Cache-busting is often the missing step.** A new adapter field will not appear
until `snapshot_cache` is cleared for that sport
(`DELETE FROM snapshot_cache WHERE cache_key = 'nfl:snapshot'`). Cost real time
three times today.

**Different feeds spell the same team differently.** Use
`lib/sports/shared/teamNameMatch.ts`, never `===`.

**A numeric id matching the expected SHAPE is not evidence it is the right
id.** Golf'''s `golf_shot_events.player_id` is PGA Tour'''s and `subjectId` is
ESPN'''s -- both five-digit numbers, so the wrong one compiles, runs and
returns zero rows for every player. Same class as 6.8'''s GSIS problem, walked
into anyway because there the two spaces LOOK different. Golf is keyed on
name; NFL carries a crosswalked `gsisId` on `subjectMeta`.

**A guard that fires on working code is broken, not strict.** My first
job-registry test reported eleven false positives against healthy jobs.

**`SeriesChart` reuses the subject's x scale for every context line** — pad every
series to one width with `NaN`. And `zeroBased` has no default: an Elo series
collapses to a flat strip against a zero axis and still renders cleanly.

**`team_elo_history.team_id` is NOT unique across sports** — 43 ids, four
leagues, 27,591 rows. Always filter on `sport`. TS's three Elo readers do not
(§9.3).

**The venue split's 25% share floor must NOT be copied to other splits.** It
encodes "league teams play a balanced schedule". Golf's real par 5 / par 4 ratio
is 8:48 — a 14% share it would reject. Use `predicateSplit.ts`.

- **Out of season is the default state of most sports** — CFB, NBA and NHL all
  return zero candidates today.
- **`prop_odds_history` is LOG-ON-CHANGE.** Silence means unchanged.
- **Job breadcrumbs live in `snapshot_cache`** under `python-harness:job-run:%`.
  There is no `job_run_log` table.
- **The dimension is not the market key** — use `candidateDimensionToMarketKey`.
- **`player_game_history` numbers are float TEXT.** Cast `::numeric`.
- **Backticks in `git commit -m` get shell-substituted.** Always use `-F`.
- **A long heredoc truncates silently.** Use the Write tool for anything long.
- **Never `git add docs/` or `-A`** — `docs/discord-community-prompt.md` is the
  operator's. Now gitignored, after being committed by accident once.
- **The DB pool caps at 15 connections.** Close your `.mjs` clients.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `runmig.mjs` are gitignored. **`node runmig.mjs <path>` applies a migration.**
- **Tests:** `npm test` (**251**), plus each
  `./.venv/Scripts/python.exe -u src/test_*.py` from `python-odds-service/`. Two
  are static and instant: `test_yield_contract.py`,
  `test_job_registry_contract.py`. **Do not run the whole Python sweep at once.**
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`.
  `POST /v1/services/$SRV/deploys` with `RENDER_API_KEY` from `.env.local`, then
  confirm `"status":"live"` on your sha. ~90s, six polls at 15s. **Then read the
  queue log** —
  `GET /v1/logs?ownerId=tea-da2ut3ibkg8c73d5gcdg&resource=$SRV&text=queue`.
- **Supabase PRO**, 8 GB. Re-measure before assuming headroom.

## 8. Operator decisions taken — do not reopen

**2026-08-29:** Officials CUT. Tennis point-level CUT. NBA/NHL shots APPROVED.

**2026-08-30:** 6.5 let it accrue. Statcast depth 2024+. New sourcing tables are
Python-written. 6.18 skipped (remains a launch blocker). 6.20/6.22 → Phase 7.
Golf gets no game page, so 6.15 ships **seven** sports. Three Render deploys
approved. **The four remaining sourcing gaps are ACCEPTED** — they render honest
empty states and nothing waits on them. Tennis/MLS/roof-list gaps waived.

## 9. Known not done

1. **`794240d`'s `_run_timed` wrap is undeployed** — §3.1. Monitoring only.
2. **CFB/NBA/NHL pages have never been walked** — out of season, zero candidates.
3. **TS's three Elo readers ignore `sport`** (`lib/db/client.ts`). Latent: every
   caller is MLB's and MLBAM ids do not collide. Python filters correctly.
4. **Tennis `conditions`/`opponentUnit` and golf `opponentUnit`/`conditions`**
   need new fetch plumbing, not data. Tennis's event never reaches `subjectMeta`;
   golf's field/course/weather reach no hook.
5. **WTA surfaces are unfinished** in `lib/sports/tennis/surfaces.ts` — ATP's 60
   events are complete, WTA degrades to null.
6. **Duplicate React keys can omit prop rows** — `GolfScheduleView.tsx:1244`,
   `TennisScheduleView.tsx:529`. One-line fix, still unowned.
7. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds. **6.21 user-facing CLV
   cannot be verified on a page for the same reason.**
8. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
9. **374 stale `soccer:understat:player:` rows** in `snapshot_cache`.
10. **2,380 duplicate observation groups in `game_odds_history`.**
11. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 |
