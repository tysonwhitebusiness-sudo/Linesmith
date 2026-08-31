# CURRENT — pick up here

**Phase 6 is IN PROGRESS.** Player Detail is at **39 of 48** role cells.
**Game Detail (6.15) went from "the largest thing left" to largely done on
2026-08-31** — `rankings` and `unitGrades` now fill on all seven sports, and
`matchup` on six. Team Detail's per-sport block walk is still not started.

**Read `docs/phase6-completion-plan.md` first — it is the authoritative list of
what is left.** `docs/audit-remediation-plan.md` §11 is the phase log. Trust
§11 and `git log` over this file if they disagree.

## 1. What just happened (2026-08-31, session six)

Five commits, `9b9acd2`..`016c7eb`. **TS tests 262 → 271.** `tsc` and
`npm run build` clean throughout. No Render deploys this session.

| Task | State |
|---|---|
| 6.15 `matchup` NBA/NHL | **DONE** — new allowed-side rollup, `producedAllowedMatchup.ts`. |
| 6.15 `rankings`/`unitGrades` | **7 of 7 sports.** CFB, soccer and tennis were the gaps. |
| 6.15 `venue` | **DONE** for NFL, CFB and soccer. MLB already had it. |
| MLB game `unitGrades` | **DONE** — both teams' Statcast now reach the page. |
| CFB + soccer team pages | **DONE** — 3 stat rows to 10 and 9, `unitGrades` fills. |
| Season rollup | 3 machinery fixes: dotted keys, empty-season fallback, `perGameMax`. |

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**Four of this plan's premises about Game Detail were wrong, and measuring took
minutes each.** That is now eight or more across the phase.

1. **`bookGrid` "does not exist anywhere in the codebase."** It is
   `BookmakerBreakdown` inside `LineShoppingSection`, fed for every sport, with
   its empty state already written. The board named it differently.
2. **`matchup` for NBA/NHL/tennis was "a design question."** It was not. CFB
   and soccer already fill the same field with a sport-agnostic shape; only an
   ALLOWED side was missing, and `opponent_id` is non-null on 100% of rows in
   every sport.
3. **`model` "missing across six sports."** `game_sim_cache`, `model_weights`
   and `model_calibration` are mlb-only — 217/21/7 rows. There is nothing to
   wire; this is model work, not Phase 6.
4. **`venue` "missing across six sports."** 6.10 has resolved per-game weather
   since it shipped and hangs it on every candidate: 1,181 of 1,694 NFL
   candidates were carrying a forecast that nothing read back out.

**And three wrong numbers that were on the page, all found by LOOKING at it:**

- **`shotsFaced` is 0.0 on all 11,492 EPL rows.** I declared it with
  `lowerIsBetter`, so it ranked all twenty teams JOINT-FIRST at 0.0. **Present
  is not populated**, and the existing key-set test could not catch it because
  the key genuinely exists. `rankPool` now drops any stat with no variance
  across the pool, and `DEAD_KEYS` pins this one.
- **`CFB_TEAM_COUNT = 134` was a hardcoded lie.** The index those ranks come
  from reports its real size, and it is **138** — so every CFB chip printed
  "100th of 134" for a rank computed against 138, on both pages, since they
  shipped. Found by noticing the same stat read "of 134" in one block and "of
  138" in the block beside it.
- **Soccer's team page rendered "xG Allowed/Gm" carrying `rank`**, which
  `understat.ts` sorts on `goalsAgainstPerGame`. The goals-allowed rank under an
  expected-goals label — wrong precisely for the team worth reading it about,
  one conceding more than its chances deserve. xGA now has its own `xgaRank`.

**I also called a defect that was not one.** NFL's matchup card looked empty; I
had read the DOM before its two team fetches landed. It renders "DEN OFFENSE VS
KC DEFENSE" with real stats. Measure again before calling it a defect, the same
way you measure before calling something a gap.

## 3. NEXT ACTIONS, in order

1. **Team Detail's per-sport block walk (6.14)** is now the largest untouched
   item. `TeamDetailData` has 18 fields against the board's 20 blocks and
   nobody has checked which render per sport. **Measurement first.**
2. **Deploy `794240d`+ to Render.** Still undeployed, still monitoring-only —
   the worker is live on `e1fd935`, so the odds cycle and the four ingest jobs
   are already fixed and running. What is missing is the `_run_timed` wrap,
   without which `health_check.py` is blind to those four. Call in §7.
3. **Walk CFB, NBA, NHL and tennis** once they have a slate. Everything built
   for them this session is verified by construction and by their routes' own
   responses, never on their own page.
4. **NBA/NHL/tennis `venue`** — arena name, no forecast, exactly the shape
   soccer just got. Small.
5. **6.10's park factors and `game_sim_cache`**, then **6.21**, then **6.24**
   (scope the de-vig backtest with the operator first — it is open-ended).

## 4. Blocked, and why — do not re-attempt without new data

**The four accepted sourcing gaps** (operator, 2026-08-30): NFL route mix, NFL
man/zone, CFB route mix, CFB target map. All need a tracking feed.

**ESPN does not publish soccer injuries.** `soccer/eng.1/injuries` and
`soccer/usa.1/injuries` both answer `"status":"success"` with an EMPTY array,
measured in the same minute as `football/college-football/injuries`, which
returned three teams. It is the feed, not the season and not the call.

**Soccer gets a venue NAME but never a forecast.** ESPN omits the roof state
for soccer and MLS has enclosed grounds; the per-venue roof list was waived.

**Tennis `matchup` is tautological, not missing.** A tennis match is zero-sum
between the two entities on the card, so "what he allows" is the complement of
his own results. The card would restate `statComparison` backwards.

**Golf `careerH2H` is not buildable** — `golf_tournaments` holds three events.

**6.23 book-lag is NOT DERIVABLE.** `observed_at` is a provider poll time:
126,977 rows over 24 hours share 426 distinct timestamps.

**Waived by the operator:** tennis point-level, MLS shot locations, the
MLS/EPL venue roof list.

## 5. What is running

**A dev server on port 3000 belongs to ANOTHER session.** The in-app Browser
pane cannot reach it — **use Playwright MCP.** It compiles routes cold on first
hit; a page can sit on its skeleton for a minute before anything is actually
wrong. Wait and re-read before diagnosing.

Seven `harvester_scrape.py` scheduled tasks on a ~20-minute cycle; two PIDs
each is ONE process.

## 6. Things that will bite again

**Open the page. Read the log.** Every wrong number in §2 came from that.

**Present is not populated.** A key can exist on every row and be 0.0 on every
row. `SUM` of it is 0, nothing throws, and with `lowerIsBetter` every entity
ranks joint-first.

**A hardcoded pool size will not fail any test.** 134 against a real 138
typechecks, renders, and reads as a fact.

**Cache-busting is often the missing step.** `venueName` was 0 of 1,694 until
the snapshot was rebuilt —
`DELETE FROM snapshot_cache WHERE cache_key = 'nfl:snapshot'`.

**A season that has just started produces an EMPTY pool, silently.**
`max(season)` is 2026 for cfb and both soccer leagues, holding 8-15 events.
`computeSeasonAggregates` now walks back up to two seasons, but only on an
empty pool, so a mid-season sport pays nothing.

**Some stat keys are a TEAM fact copied onto every player row.** Summing
`goalsConceded` multiplied one EPL side's season to 385 from 35. Use
`perGameMax`. The check that proves which is right: a team's conceded must
equal its opponent's scored — the max matches in 722 of 760 pairs, the sum in
194.

**Two ESPN venue fields, one of them empty.** Soccer's is `gameInfo.venue`;
`header.competitions[0].venue` is undefined. NFL's game route has always
returned `game.venue` — the TYPE just never declared it, so nothing could read
it.

**A numeric id matching the expected SHAPE is not evidence it is the right id.**
Golf's `player_id` is PGA's and `subjectId` is ESPN's, both five digits.

**Different feeds spell the same team differently.** Use
`lib/sports/shared/teamNameMatch.ts`, never `===`.

**`team_elo_history.team_id` is NOT unique across sports** — filter on `sport`.

**The venue split's 25% share floor must NOT be copied to other splits.** Use
`predicateSplit.ts`.

**`SeriesChart` reuses the subject's x scale for every context line** — pad
every series to one width with `NaN`. `zeroBased` has no default.

- **Out of season is the default state of most sports.**
- **`prop_odds_history` is LOG-ON-CHANGE.** Silence means unchanged.
- **Job breadcrumbs live in `snapshot_cache`** under `python-harness:job-run:%`.
  There is no `job_run_log` table.
- **The dimension is not the market key** — use `candidateDimensionToMarketKey`.
- **`player_game_history` numbers are float TEXT.** Cast `::numeric`.
- **Backticks in `git commit -m` get shell-substituted.** Always use `-F`.
- **A long heredoc breaks or truncates.** Use the Write tool for anything long
  — including this file, which failed as a heredoc twice before being written
  with the tool.
- **`\n` inside a heredoc'd Python patch arrives as a real newline**, so a
  pattern matching source that contains a literal `\n` will not match. Build the
  literal with `chr(92)`, or replace by string span instead of exact match.
- **Set `PYTHONUTF8=1`** for any heredoc'd Python that must match a non-ASCII
  character (an em dash in a comment will silently fail to match otherwise).
- **Never `git add docs/` or `-A`** — `docs/discord-community-prompt.md` is the
  operator's. Gitignored now, after being committed by accident once.
- **The DB pool caps at 15 connections.** Close your `.mjs` clients.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `runmig.mjs` are gitignored. **`node runmig.mjs <path>` applies a migration.**
- **Running real TS against real Postgres:** a scratch `.mts` at the repo root
  plus `npx tsx` resolves the `@/` aliases and works. Far faster than a route
  for checking what a rollup actually returns. Delete it afterwards.
- **Tests:** `npm test` (**271**), plus each
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
Python-written. 6.18 skipped (remains a launch blocker). 6.20/6.22 to Phase 7.
Golf gets no game page, so 6.15 ships **seven** sports. **The four remaining
sourcing gaps are ACCEPTED.** Tennis/MLS/roof-list gaps waived.

**2026-08-31:** CFB/soccer ranked rollup **BUILD IT** (done). Building blocks
for out-of-season sports and marking them unverified **APPROVED**.

## 9. Known not done

1. **`794240d`'s `_run_timed` wrap is undeployed** — §3.2. Monitoring only.
2. **CFB, NBA, NHL and tennis pages have never been walked.** Out of season or
   no slate. Everything built for them this session is unverified ON A PAGE.
3. **NBA/NHL have zero rows in `game_odds_book_lines`**; NFL 3 books over 9
   games, CFB 4 books ML-only, tennis 3, against MLB's 39 and soccer's 33. The
   line-shopping block correctly ships its empty state on those sports; closing
   it is 6.11's job, and it is a sourcing task.
4. **TS's three Elo readers ignore `sport`** (`lib/db/client.ts`). Latent: every
   caller is MLB's and MLBAM ids do not collide. Python filters correctly.
5. **Tennis `conditions`** is the last reachable Player Detail cell — the event
   never reaches `subjectMeta`.
6. **WTA surfaces are unfinished** in `lib/sports/tennis/surfaces.ts` — ATP's 60
   events are complete, WTA degrades to null.
7. **Duplicate React keys can omit prop rows** — `GolfScheduleView.tsx:1244`,
   `TennisScheduleView.tsx:529`. One-line fix, still unowned.
8. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds. **The 401s on
   `/api/picks` and `/api/watchlist` in every page walk are this, not a
   defect.** 6.21's user-facing CLV cannot be verified for the same reason.
9. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
10. **374 stale `soccer:understat:player:` rows** in `snapshot_cache`.
11. **2,380 duplicate observation groups in `game_odds_history`.**
12. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 |
