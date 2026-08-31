# CURRENT — pick up here

**Phase 6's four remaining workstreams are BUILT** (line movement, 6.21 CLV,
6.24 de-vig, 6.10 venue factors), on top of a full pass over all three detail
pages against the design boards. **TS tests 262 → 339.**

**Read `docs/phase6-completion-plan.md` for the page-level list and the
board-vs-build audit artifact for the card-level one.**
`docs/audit-remediation-plan.md` §11 is the phase log. Trust §11 and `git log`
over this file if they disagree.

## 1. What just happened (2026-08-31, session six)

Eighteen commits, `9b9acd2`..`4a41bb6`. `tsc` and `npm run build` clean
throughout. No Render deploys.

| Task | State |
|---|---|
| Board audit | **DONE** — 63 cards, 439 cells, measured. Artifact published. |
| 6.15 Game Detail | rankings/unitGrades on 7 sports, matchup on 6, venue on 4. |
| 6.16 Player pass | 4 analytics cards × 8 sports. 13 → 17 of 20 board cards. |
| 6.17 Layout pass | rail assignment + `.two-up` pairing on all three pages. |
| 6.19 Team pass | 5 board cards from one shared call. |
| 6.20/6.21 Game | price card, team-form cards. |
| 6.22 Line movement | **DONE** — Game + Team, off `game_odds_history`. |
| 6.21 User CLV | **BUILT, UNVERIFIABLE** — see §4. |
| 6.24 De-vig | 3 methods + backtest. **Backtest declines a verdict at n=82.** |
| 6.10 Venue factors | **DONE** — new table, daily Python job, 282 rows. |

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**Measure the premise before building on it. It was wrong eight more times
today**, and each time the measurement took minutes:

1. **`bookGrid` "does not exist"** — it is the Line shopping block, shipping
   for every sport.
2. **`matchup` was "a design question"** — CFB and soccer already filled it;
   only an ALLOWED side was missing, and `opponent_id` is non-null on 100% of
   rows in every sport.
3. **`model`/`pickLockAt` "missing on six sports"** — the model tables are
   mlb-only, and `pickLockAt` renders nothing without a model. Nothing to wire.
4. **`venue` "a sourcing gap"** — 6.10 had been hanging weather on 1,181 of
   1,694 NFL candidates that nothing read back.
5. **Game team-form "needs five per-sport builders"** — every game adapter
   already produces `RecentResultRow`, which carries `isHome`, `opponentAbbr`
   and both scores. One builder, seven sports.
6. **`historical_odds` looked perfect for the de-vig backtest** — 37,922 games
   with two-sided probabilities and scores, and **every row sums to exactly
   1.0000**. The vig was removed before storage; the table is useless for this.
7. **"Park factors beyond MLB" is not a `sport` column** — a tree-wide scan
   found two venue columns in the whole database, both on `park_factors`.
8. **`park_factors` cannot be keyed for other sports at all** — so the home
   team is the venue, in its own table.

**And four wrong numbers that were live on a page**, all found by looking:

- **`shotsFaced` is 0.0 on all 11,492 EPL rows.** Declared with
  `lowerIsBetter`, it ranked all twenty teams JOINT-FIRST at 0.0. **Present is
  not populated.**
- **`CFB_TEAM_COUNT = 134` was hardcoded; the real pool is 138.** Every CFB
  chip printed "100th of 134" for a rank computed against 138.
- **Soccer's "xG Allowed/Gm" carried the goals-allowed rank** — wrong exactly
  for the team worth reading it about.
- **Cover rates rendered as bare integers on EVERY binary split** — "67" above
  an average of "0.7", no percent sign, on every sport.

**And the Players tab denied its own data.** `useSyntheticPlayerCandidates`
seeded `loading` to `false`, so before its effect ran it reported "not loading,
no candidates" — and `PlayerDetail`'s empty state for that pair says *"that's
real, not missing data."* It was missing data, for the 1.8–4.7s the fetch took,
on every player. **Seed a loading flag from its arguments, never from `false`.**

## 3. NEXT ACTIONS, in order

1. **The two gate violations found today.** The Phase 6 gate requires no
   `sport === 'x'` in a render path; two remain — `TeamDetail`'s `teamHref`
   (six branches) and `GameDetail`'s `renderLiveDetail` (six branches). MLB
   does the latter correctly via `hero.mlbLiveGame` presence; the fix is
   CLAUDE.md §5's own rule applied to the other five.
2. **Wire the venue factor to a card.** The data layer is complete and
   verified (282 rows, daily job, route, formatter). Nothing renders it yet —
   the natural home is the `conditions` role or the game hero's venue strip.
3. **Deploy Render.** `794240d`'s `_run_timed` wrap is STILL undeployed, and
   now `venueFactorsJob` is new and unrun in production. Call in §7.
4. **Walk CFB, NBA, NHL and tennis** when they have a slate. Everything built
   for them across this whole session is unverified on a page.
5. **6.11** (NBA/NHL book lines) and the correlated-prop / DFS halves of 6.24 —
   the operator agreed to split those out.

## 4. Blocked, and why — do not re-attempt without new data

**User CLV is built and cannot be walked.** Two bets exist, both golf, both
with a null bookmaker and a null game_id, so neither is measurable; there are
no credentials to sign in. The computation is verified against REAL closing
prices with synthetic bets (a bet at −76 into a −136 close scores +0.1445), but
the page is unverified and should stay recorded that way.

**The de-vig backtest cannot pick a winner.** The only source of a raw
two-sided close with an outcome is `game_odds_history` joined to settled
`game_picks`: **82 games**. `MIN_SAMPLE_FOR_VERDICT` is 1000. The sample grows
daily with no further code, since that log began 2026-08-12.

**No non-MLB game model exists**, which blocks win probability, simulation
density, "why the model likes it" and `game_sim_cache` beyond MLB. The operator
agreed to move the sim cache out of 6.10 to the model project.

**ESPN publishes no soccer injuries** — both leagues answer `"success"` with an
empty array, measured against CFB's in the same minute.

**Tennis `matchup` is tautological, not missing** — a match is zero-sum between
the two entities on the card.

**The four accepted sourcing gaps** (NFL route mix, NFL man/zone, CFB route
mix, CFB target map) all need a tracking feed.

## 5. What is running

**Nothing on port 3000 by default.** `npm run start` serves the production
build; `npm run dev` for HMR. A cold route can sit on its skeleton for a minute.

Seven `harvester_scrape.py` scheduled tasks on a ~20-minute cycle.

## 6. Things that will bite again

**Open the page. Read the log.** Every wrong number in §2 came from that.

**Present is not populated.** A key can be on every row and 0.0 on every row.

**Seed a hook's `loading` from its arguments, never `false`.** See §2.

**A season that has just started produces an EMPTY result, silently.** It has
now bitten twice — `computeSeasonAggregates` and `venueFactorsJob` — on the
same three sports (cfb, soccer_epl, soccer_mls), whose `max(season)` is 2026
with 8–15 events. Both walk back up to two seasons now, only on an empty result.

**A new server-only module under `lib/sports/shared/` needs TWO entries** in
`tests/client-bundle-boundary.test.ts`: `SELF` to exempt it from the scan and
`DB_MODULES` to stop anything client-reachable importing it. Its own comment
says so; I still got it wrong once.

**A hardcoded pool size fails no test.** 134 against a real 138 typechecks.

**Cache-busting is often the missing step.** `DELETE FROM snapshot_cache WHERE
cache_key = 'nfl:snapshot'`.

**Some stat keys are a TEAM fact on every player row.** Summing `goalsConceded`
multiplied one EPL season to 385 from 35. Use `perGameMax`.

**Two ESPN venue fields, one empty.** Soccer's is `gameInfo.venue`;
`header.competitions[0].venue` is undefined. NFL's game route always returned
`game.venue` — the TYPE never declared it.

**A numeric id matching the expected SHAPE is not evidence it is the right id.**

**Different feeds spell the same team differently.** Use `teamNameMatch.ts`.

**`team_elo_history.team_id` is NOT unique across sports** — filter on `sport`.

- **Out of season is the default state of most sports.**
- **`prop_odds_history` is LOG-ON-CHANGE.** Silence means unchanged.
- **`player_game_history` numbers are float TEXT.** Cast `::numeric`.
- **Backticks in `git commit -m` get shell-substituted.** Use `-F`.
- **A long heredoc breaks.** Use the Write tool — CURRENT.md failed twice as one.
- **`\n` in a heredoc'd Python patch arrives as a real newline.** Build the
  literal with `chr(92)`, or replace by span.
- **Set `PYTHONUTF8=1`** for heredoc'd Python matching any non-ASCII character.
- **Never `git add docs/` or `-A`** — `docs/discord-community-prompt.md` is the
  operator's.
- **The DB pool caps at 15 connections.** Close your `.mjs` clients.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `runmig.mjs` are gitignored. **`node runmig.mjs <path>` applies a migration.**
- **Running real TS against Postgres:** a scratch `.mts` at the repo root plus
  `npx tsx` resolves the `@/` aliases. Delete it afterwards.
- **Running a Python job by hand:** from `python-odds-service/`,
  `./.venv/Scripts/python.exe -u -c "import sys,asyncio; sys.path.insert(0,'src'); ..."`.
- **Tests:** `npm test` (**339**), plus each
  `./.venv/Scripts/python.exe -u src/test_*.py` from `python-odds-service/`.
  **Do not run the whole Python sweep at once.**
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`.
  `POST /v1/services/$SRV/deploys` with `RENDER_API_KEY` from `.env.local`,
  then confirm `"status":"live"` on your sha. ~90s, six polls at 15s.
- **There is NO hosted web app.** `render.yaml` declares a Python worker and a
  cron, nothing else. `npm run start` is the only way to see the pages.
- **Supabase PRO**, 8 GB.

## 8. Operator decisions taken — do not reopen

**2026-08-29:** Officials CUT. Tennis point-level CUT. NBA/NHL shots APPROVED.

**2026-08-30:** 6.5 let it accrue. Statcast depth 2024+. New sourcing tables are
Python-written. 6.18 skipped. 6.20/6.22 to Phase 7. Golf gets no game page.
**The four remaining sourcing gaps are ACCEPTED.**

**2026-08-31:** CFB/soccer ranked rollup BUILD IT (done). Build for
out-of-season sports and mark unverified. Split 6.10 (ship venue factors, move
`game_sim_cache` to the model project) and split 6.24 (ship de-vig, move
correlated-prop warnings and DFS pick'em out).

## 9. Known not done

1. **Two gate violations** — §3.1. The gate's per-sport page walk also cannot
   pass while four sports have no slate.
2. **The venue factor renders nowhere** — data layer only.
3. **`794240d` and `venueFactorsJob` are undeployed.**
4. **CFB, NBA, NHL and tennis pages have never been walked.**
5. **NBA/NHL have zero rows in `game_odds_history`** — line movement and the
   price card both ship their empty state there, correctly.
6. **TS's three Elo readers ignore `sport`** (`lib/db/client.ts`). Latent.
7. **Tennis `conditions`** is the last reachable Player Detail role cell.
8. **WTA surfaces are unfinished** in `lib/sports/tennis/surfaces.ts`.
9. **Duplicate React keys** — `GolfScheduleView.tsx:1244`,
   `TennisScheduleView.tsx:529`. The PlayerDetail instance was fixed; these two
   remain.
10. **`/diagnostics`, `/bets` and every signed-in surface are unverified** — no
    credentials. The 401s on `/api/picks` and `/api/watchlist` in every walk are
    this, not a defect.
11. **374 stale `soccer:understat:player:` rows** in `snapshot_cache`.
12. **2,380 duplicate observation groups in `game_odds_history`.**
13. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 |
