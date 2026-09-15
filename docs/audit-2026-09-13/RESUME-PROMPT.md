# Resume prompt — research pages build (2026-09-14, R4 COMPLETE — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (approved 2026-09-14, the build order). Its status block records R1-R4.

## Where the work is

- **R1** signed off and deployed. **R2** done. **R3** signed off 2026-09-14.
- **R4 COMPLETE 2026-09-14, AWAITING OPERATOR SIGN-OFF.** Next after sign-off:
  **R5** (Python rollups and ingest; large, and it needs Render deploy asks).
- Everything committed and pushed. tsc clean, 485/485 tests.
- No worker deploy in R4 (TypeScript only).

## R4 — what landed

Parsers only: every one is a pure function over the raw payload, tested on a
real saved payload, and checked field by field against the G2 dataset built
from the same document. **No card reads them yet** — R6-R8 wire them in.

| step | commit | what |
|---|---|---|
| 1 shared fetch | `f7c341d` | `lib/sports/espn/summary.ts` `fetchEspnSummary(leaguePath, eventId)`: one fetch for the 8 modules that each fetched the ESPN summary themselves; in-flight dedupe; in memory, final 10 min, open 5 s; failures never cached. **Fixed on the spot:** soccer's live tab had never loaded (asked for `epl`, ESPN wants `eng.1`). |
| 2 ESPN parsers | `aebd6a3` | `lib/sports/espn/summaryParsers.ts`: win probability + biggest swings; drives with plays (NFL/CFB); court plays with ESPN's -2^31 sentinel as null, lead tracker, scoring runs (NBA); lines open/close as numbers with the soccer draw, `resultVsLine`; season series; injuries stamped with fetch time; soccer lineups, commentary pitch positions, last five. Fixtures `tests/fixtures/espn/summary-*.json`. |
| 3-4 MLB | `c649234` | `lib/sports/mlb/liveFeedParsers.ts`: every pitch (type, speed, pX/pZ, call, zone, count) and batted ball (EV, LA, distance, coordinates), `pitchMix`; new endpoint `statsapi.getWinProbability` + `parseMlbWinProbability` (0-1 home). Fixture gamePk 824711. |
| 4 NHL | `cbce19e` | `lib/sports/nhl/apiWebParsers.ts` + `nhle.ts`: new `/v1/player/{id}/landing` (official regular-season lines and career, skater and goalie) and `/v1/gamecenter/{id}/play-by-play` (rink x/y, shooter, goalie, situation code, roster). |
| 5 tennis, CFB | `e1e11d9` | `tennismylife.ts` keeps level, round, indoor, best-of, minutes, rank/points/seed, opponent rank and both sides' serve counts (`serve`, `opponentServe`), `returnPointsWon`, `breakPointsConverted`; pure `buildTennisSeasonContext`; cache key `tennis:tml:v2:`. ESPN scoreboard/schedule games carry `homeRank`/`awayRank` (`pollRank`); schedule key `espnTeamSport:schedule:v2:`. |

**Verify (done):** each parser against G2 in tests (win probability point for
point, drives/plays, NBA coordinates, lines for all five summary sports,
injuries, lineups and commentary, MLB pitches and win probability, NHL landing
and events, tennis serve on both sides of a win and a loss). The whole live
2026 ATP CSV parses (serve and minutes 100%, rank 99.8%). Ohio State's live
schedule ranks equal G2 on 12 of 12 games. `/api/cfb/team/194` 200 on the new
key. No UI changed, so no page renders were owed.

## R4 caveats — honest, and where each goes

- **Finished-game caching is in memory, not `cachedRoute()`**, because R4 adds
  no routes. When R8's game routes read these parsers, finished games get the
  plan's long-TTL `cachedRoute()`; live routes keep their no-cache contract.
- **Not exercised in a live state:** drives on an in-progress NFL/CFB game, an
  MLB feed mid-game, NHL play-by-play on a live game (off-season). R8 renders
  each state and verifies there (MLB before late September).
- **The eight modules moved onto the shared fetch still do their own parsing**
  (`nba/liveGame.ts`, `multiSport/footballLiveGame.ts` and the rest); R6-R8
  move each card onto the new parsers and delete what they replace.
- **R4-F1, routed to R6 tennis:** TennisMyLife's archive lags about two weeks
  (no US Open on 2026-09-14). Show its last match date beside tennis history
  tiles; fill later matches from ESPN where needed.
- **Tennis `snapshot_cache` rows got wider** (12 columns kept to 45); 2,132
  rows for 2026 ATP. Watch it alongside R2-F11 if the table grows.

## Findings routed (R2-F1..F11, R3-F1..F2, R4-F1)

R2-F1 and R3-F1 are **resolved**. The rest stand as routed in the plan's
Appendix A: R5e (yes/no `other` direction; the writer deleting stale rungs),
R6 (MLB fixed prop lines; line-movement pinned to the modal line; in-play price
chip; EPL snapshot cache; tennis archive lag), R7 (MLB hooks on other sports'
team pages; `/api/mlb/team/110` stale payload), parked (Scan at 400px), model
track Phase 5 (huge `snapshot_cache` rows), R6-R8 (R3-F2 legacy sizes and
contrast).

## R3 caveats still standing

- Whole pages are not yet at F2's type and contrast targets (R3-F2): R6-R8.
- `Section` is built but not yet adopted; R6 uses it. Links on every name and
  photo, game state and compare target in the URL arrive with R6-R9.

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
