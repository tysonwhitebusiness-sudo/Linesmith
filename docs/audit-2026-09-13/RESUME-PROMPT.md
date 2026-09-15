# Resume prompt — research pages build (2026-09-15, R5 COMPLETE — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (approved 2026-09-14, the build order). Its status block records R1-R5, with R5's decisions, findings and numbers.

## Where the work is

- **R1-R4** signed off. **R5 COMPLETE 2026-09-15, AWAITING OPERATOR SIGN-OFF.**
  Next after sign-off: **R6** (player page rebuild, one sub-phase per sport,
  stop after each).
- Everything committed and pushed. Worker deployed twice this phase (the
  operator approved both): `dep-dakbn4tg1s2s73bor350` (history freshness) and
  `dep-dakl7c61egvs738eomf0` on `a445cc2` (teamProductionJob, shot ingest,
  prop writer). The prune fix `706a874` runs on the operator machine.

## R5 — what landed

Python writes the rollups; TypeScript reads them directly (pattern 2). Each
part was checked against the G2 datasets on the same inputs.

| part | where it runs | tables | routes | G2 check |
|---|---|---|---|---|
| 5a Statcast | operator machine, chained after the corpus refresh (`build_statcast_rollups.py`, ~2-3 min) | `mlb_statcast_player_season`, `_team_season`, `_game_pregame` | `/api/mlb/statcast/player/[playerId]`, `/team/[teamId]`, `/api/mlb/game/[gameId]/pregame-statcast` | 4,648 fields equal (`verify_statcast_rollups_g2.py`) |
| 5b strength | worker, `teamProductionJob` daily | `athlete_positions`, `team_game_production`, `player_season_production` | `/api/team-production?sport&season&before`, `/api/key-players` | 758 team sides equal; NFL allowed-by-position equal |
| 5c shots | worker (ingest hourly, rollup in teamProductionJob) | `team_shot_profile` | `/api/team-shot-profile` | Lakers zones/league/bins, 30 teams' allowed zones, Leafs bins: equal |
| 5d NFL targets | worker, teamProductionJob | `team_target_profile` | `/api/nfl/team-targets` | 160 team rows and league cells equal |
| 5e prop writer | worker, every provider job | `prop_odds` | — | yes/no and stale-rung fixes, tested on Postgres |

Production differs from G2 on purpose, and says so in the code: regular
season only everywhere; one copy per pitch; every HR with distance; NBA, soccer
and NHL positions from season rosters (NHL F/D/G).

## Bugs found in R5 and what happened

- **R5-F1** MLB and tennis `player_game_history` stopped 2026-08-28 (hand
  backfill never scheduled); MLB board projected without two weeks. Fixed,
  caught up, deployed.
- **R5-F2** pitch corpus duplicating (prune froze pitches inside the 3-day
  ingest window). Freeze rule and prune margin fixed; the 13,298 duplicate rows
  already in the corpus files stay (a Phase 5 decision), and readers dedupe by
  pitch.
- **R5-F3** MLB player page pitch mix and strike zone were the last ~5 days
  labelled as the season. Now read from the rollup.
- **R5-F4** the scheduled prune crashed on R5-F2's margin (`captured_at`);
  fixed, nothing had been deleted.
- NBA misses all stored as twos; NHL shots mixed preseason and playoffs. Fixed
  at ingest and in the stored rows.
- **R5-F5, routed to the model track:** the worker has been OOM-killed 4-9
  times an hour since 2026-09-11 (pre-R5). And after the R5 deploy it stalled
  ~40 minutes while this machine held several DB connections at once;
  restarted 14:59 UTC, healthy since. Keep to one connection.

## R5 caveats — honest, and where each goes

- **5a depends on the operator machine** being on: if it is off, the
  `mlb_statcast_*` tables stop moving and each row's `as_of` says so. The
  pregame row is written for today's and tomorrow's games only.
- **Positions:** CFB and MLB have none (the plan names no CFB source; MLB
  splits by stat group). NBA athletes missing from current rosters are looked
  up 150 per run.
- **`/api/mlb/pitch-profile`** now reads the rollup and is deleted with its
  cards in R6 (plan "Also in R6").
- **R2 read-side prop guards stay** after 5e (history union, harvester).
- **`prop_odds_history`** still holds the mixed yes/no rows written before 5e.

## Findings routed (R2-F1..F11, R3-F1..F2, R4-F1, R5-F1..F4)

R2-F1, R3-F1 and R5-F1..F4 are **resolved**. The rest stand as routed in the
plan's Appendix A: R5e items are now done; R6 (MLB fixed prop lines;
line-movement pinned to the modal line; in-play price chip; EPL snapshot
cache; tennis archive lag; delete pitch-profile), R7 (MLB hooks on other
sports' team pages; `/api/mlb/team/110` stale payload), parked (Scan at
400px), model track Phase 5 (huge `snapshot_cache` rows; the duplicate pitch
rows in the corpus files), R6-R8 (R3-F2 legacy sizes and contrast).

## Still owed from R1

- **F-B4 (MLB pitcher game log)**: retry on a slate with pitcher props.
- **MLB has no `/api/mlb/game/{id}`** for past games — R8.
- **MLB regular season ends late September**: R8's MLB live state before then.
- R1f 2b's CFB check (Saturday 2026-09-19) is still worth a look at
  `refreshCfbJob`'s log.

## First reply

Say what you've read, confirm the state above matches `git log`, and say what
you intend to do first. Then wait for the go-ahead.

## Spec

The G2 mockups in `docs/design/phase-g2/`:
- pages: `player.html`, `game.html`, `team.html`;
- how to rebuild them: `PLAN.md`;
- per-card sources and tables: `BUILDABILITY.md`;
- reference fixtures: the datasets in `data/` (plan Appendix B).
- Rebuild with `node docs/design/phase-g2/build.mjs`.
- Refresh data with the venv Python from the repo root: `tools/build_player_data.py`, `build_game_data.py`, `build_team_data.py`, `build_matchup_data.py`.

## How every phase runs (plan §2)

1. Build.
2. `tsc --noEmit`.
3. Render each affected sport at 1440px and 400px.
4. Put each page beside its G2 mockup and check the numbers match the dataset.
5. Delete what the phase replaces, in the same phase.
6. Commit by explicit path.
7. Update the plan's status line and rewrite this file.
8. **Stop for my sign-off.**

**Start every phase by re-checking each item's cited file and line.** R1 found
three wrong premises that way — a spelling fix that spanned five adapters and
not three, an "add a floor" item whose metric was inverted, and a "suspected
wrong teams" item where the prices were right and the labels were swapped.
Each would have been shipped wrong if the plan had been taken at face value.

## Decisions already made — don't reopen

- **Pages are research pages.** Odds are one section, **except the prop analysis block**, which stays near the top of the player page:
  - market tabs, line stepper with price, vs-opp/L5/L10/L15/Season chips, hit-rate tiles, bars vs line;
  - presentation fixes only.
- **How cards are judged:** "does this make sense for this sport / does this help". No earlier design is the standard. Don't fix only screenshots. Don't add design calls to the plan.
- **Data:** real data only; show a status where data is missing.
- **Picks as built in G2:**
  - system sans (drop Plex Mono);
  - raised cards;
  - sectioned layouts with a sticky section nav;
  - slate research views deferred;
  - everything the mockups show goes into the build.
- **Deferred:** golf is held until a live tournament; NBA/NHL live waits for October; Scan and slate pages are out of scope.
- **The MLB live game state (R8) must be verified before the regular season ends in late September**, or on postseason games.

## Standing constraints

- Postgres pooler caps at 15 connections. Check for running fits, harvester cycles and other sessions' jobs before DB work.
- **Git:**
  - never `git add -A` or `git add docs/` (`docs/discord-community-prompt.md` is mine); add explicit paths;
  - don't push unless I ask.
- Ask before deploying to Render.
- **Bugs found mid-phase:** fix app-breaking ones on the spot (in their own commit). Route everything else into the phase that fixes it best: an "Also in R*n*" block in that phase's plan section plus an Appendix A row (plan §2). Never leave a find only in this file.
- At ~92% context, stop and hand off: rewrite this file, and update the research pages track in `docs/CURRENT.md` without disturbing the model track's sections.
- **Playwright MCP checks of the mockups:** route `http://phase-g2.local/**` to the local files and run scripts from `.playwright-mcp/` (file access is limited to the repo and that folder).

## Useful things R1 learned

- **A cache rebuild lands between your edit and your check.** Two numbers in
  R1 read as unfixed because the route was still serving the payload built
  before the edit. Re-fetch, and check the build's own timestamp moved.
- **ESPN 403s `curl` even with a browser UA**, but `node`'s `fetch` with the
  same UA gets 200. Understat needs `X-Requested-With: XMLHttpRequest` and
  403s a browser UA. Use `node` for one-off ESPN checks.
- **Git Bash `/tmp` is not visible to Windows Python.** Write scratch files to
  the session scratchpad directory instead.
- **`asyncpg` is the driver available in `python-odds-service/.venv`** (no
  psycopg). `prop_odds`'s market column is `market_key`, not `market`.
- **A render is worth more than a type-check every time.** "Last season: 0-0"
  type-checked perfectly and was a false claim; only the NBA page showed it.
