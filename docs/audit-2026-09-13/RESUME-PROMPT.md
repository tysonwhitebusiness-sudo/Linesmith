# Resume prompt — research pages build (2026-09-15, R5 SIGNED OFF — R6 next)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the R6 section in full, §1 (how close the build gets to the mockups), §2 (rules), and Appendix A rows routed to R6.
4. The G2 player spec: `docs/design/phase-g2/src/player.html`, `src/sports/common.js` (skeleton), `mlb.js`, `football.js`, `hoops-hockey.js`, `soccer-tennis-golf.js`; datasets in `docs/design/phase-g2/data/player-*.json`.

## Where the work is

- **R1-R5 signed off** (R5 on 2026-09-15). **R6 (player page rebuild) is next
  and not started.** The gameplan below was written at R5's close; confirm it
  with me before building.
- Everything committed and pushed. Worker live on `a445cc2`
  (`dep-dakl7c61egvs738eomf0`), restarted 14:59 UTC 2026-09-15.
- tsc clean, 485/485 TS tests.

## What R5 left for R6 to read (all pattern-2 direct reads)

| data | route | shape |
|---|---|---|
| MLB Statcast season, hitter and pitcher | `/api/mlb/statcast/player/[playerId]?season` | `lib/sports/mlb/statcastRollupShapes.ts` |
| MLB pitch mix / zone / platoon (legacy shape) | `/api/mlb/pitch-profile` | delete with its cards in R6 |
| Strength for/allowed by team, game, position (kickoff cutoff) | `/api/team-production?sport&season&before` | `lib/sports/shared/teamProductionShapes.ts` |
| Key players by production | `/api/key-players?sport&season&teamId` | same |
| NBA/NHL team shot views | `/api/team-shot-profile` | same |
| NFL team target maps | `/api/nfl/team-targets` | `lib/sports/nfl/teamTargetShapes.ts` |
| ESPN summary, MLB feed, NHL landing/pbp, TennisMyLife serve/return (R4 parsers) | parsers in `lib/sports/espn/summaryParsers.ts`, `mlb/liveFeedParsers.ts`, `nhl/apiWebParsers.ts`, `tennis/tennismylife.ts` | no routes yet |
| Player history, every season | `player_game_history` (MLB and tennis now current again, R5-F1) | — |
| NBA shots 2024-25 and 2025-26, misses valued; NHL regular season both seasons | `/api/nba/shot-profile`, `/api/nhl/shot-profile` | existing |

## R6 gameplan (confirm before building)

**Step 0 — premise audit, before any code.** Re-check every cited file and
line: `PlayerDetail.tsx` (size, sections, the stale comment near :1601),
`toGameContext` / `toWhereThisSits` / `DensityCurve` callers, MLB's fixed prop
lines in `lib/sports/mlb/adapter.ts` (~1466) and what `mlb_prop_model_cache` is
keyed on, `lineHistory.ts` `pinLine`, `liveEdge.resolveCandidateEdge`, the
`soccer:snapshot:epl` payload size, and how each sport's player page renders
today (before screenshots at 1440 and 400). Report wrong premises before
building, as every earlier phase found some.

**R6.0 — shared skeleton, inside R6.1.** Built once in `PlayerDetail` on the R3
primitives (`Section`, `SectionNav`, `Card`, `DataTable`, `StatGrid`...), fed by
adapters, never a sport check:
1. Hero (photo, position, team, jersey, age, injury, links); the page always
   renders the player, market or not.
2. Prop analysis — the kept block on R2's main line; season in scope labelled,
   empty tiles hidden, opens on recent games.
3. Season by season from every `player_game_history` season (R2 season helper).
4. Trends (any stat, rolling average, scope toggles, crosshair).
5. Splits (home/away, W/L from R2's `game_result` read, opponent, month).
6. The sport's own sections.
7. Game log (every stat, by season, rows link to the game).
8. Odds & prices from `prop_odds` (best price, books, movement on the main line).
9. Sources with as-of times.
Each section loads on its own with skeleton / empty / human error / staleness
(plan §1 row 2). New fields go on `PlayerDetailData` (the MLB adapter owns the
type) and are `null` for a sport not yet rebuilt, so NFL, soccer and the rest
keep today's cards until their own sub-phase — **every sub-phase re-renders the
other sports' pages to prove nothing regressed.** D2/D3 cards are deleted when
their content has moved; D4 spatial roles draw on the adapter's surface.

**R6.1 — MLB (first, while the season is live).**
- Hitter: Contact quality & approach (power profile with percentiles, EV
  distribution, EV by game, results by pitch type, strike zone, vs LHP/RHP,
  home runs with distance) from `/api/mlb/statcast/player`.
- Pitcher: Arsenal & command (arsenal, locations, where he pitches, fastball
  velocity by start, vs LHH/RHH); game log per start (F-B4, IP as outs).
- Routed items: MLB props onto `candidateLine()` (model probability must be for
  the same line); line movement pinned to the main line; the price chip on a
  started game labelled or held; C4 live card slot (MLB count, bases, batter,
  pitcher as a presence-checked field; hooks unconditional, `enabled` per sport).
- Delete `/api/mlb/pitch-profile`, `useMlbPitchProfile`, `pitchProfile.ts` and
  the cards replaced.
- Verify: Judge 592450, Witt, Skubal (Skenes has no Statcast block in G2), plus
  one no-market, one injured and one early-season player; 1440 and 400;
  numbers equal to `player-mlb-*.json` (production is regular season only and
  one copy per pitch, so G2's spring-inclusive numbers differ — say which).
  **Stop.**

**R6.2 — NFL and CFB.** Usage & depth (WR/TE/RB target chart on a half field,
depth by season), QB pass chart, CFB advanced passing as "Not held". C4 "your
lines so far" from the live box score. Verify Chase 4362628, Allen 3918298,
Manning 4870906 (a Saturday gives CFB live). **Stop.**

**R6.3 — Soccer.** Chances & finishing (shot map, goals vs xG, per 90 by
season), GK shot-stopping; C8 default market by position; per-section loading
so `soccer:snapshot:epl` (22 MB) stops failing its cache write — confirm the
write. Verify Cunha 259902, Lammens 301425. **Stop.**

**R6.4 — Tennis.** Surface & serve (by surface with today's surface marked from
`tennis/schedule.ts`, C7; ranking; serve and return by match from R4's
TennisMyLife fields); show the archive's last match date and fill later matches
from ESPN (R4-F1). Verify Alcaraz 3782. **Stop.**

**R6.5 — NBA and NHL.** Shot chart by zone (2025-26 now held); NHL skater shot
map and official totals (R4 landing parser), goalie shots faced. Built now,
render-verified in October. Verify SGA 4278073, Wembanyama 5104157, MacKinnon
8477492, Vasilevskiy 8476883 as far as the off-season allows. **Stop.**

**R6.6 — Golf.** Scoring and shot profile; built, verified at the next
tournament. **Stop.**

**Every sub-phase:** `tsc`, `npm test`, and **`npm run build`** before claiming
UI work done (a client module importing a DB module passes tsc and tests and
breaks every page); render at 1440/400; contrast inside the rebuilt cards
(R3-F2); commit by explicit path; update the plan status and this file.

## Open items that are not R6's

- **R5-F5, model track:** the worker has been OOM-killed 4-9 times an hour since
  2026-09-11 (pre-R5). Don't chase it in R6; it's in `CURRENT.md`.
- **Operator machine:** `build_statcast_rollups.py` runs after each corpus
  refresh; if the PC is off, MLB Statcast rows show an older `as_of`.
- **MLB regular season ends late September:** R8's MLB live state must be
  verified before then (or on postseason games) — keep R6.1 moving.
- F-B4 on a slate with pitcher props; `refreshCfbJob` on Saturday 2026-09-19;
  MLB has no `/api/mlb/game/{id}` for past games (R8).

## Lessons from R5 worth carrying

- **Keep to ONE database connection from the operator machine.** R5 ran two
  backfills, the corpus refresh and the rollups at once beside the harvester;
  the worker stalled for ~40 minutes and needed a restart.
- **Run a new check against a reference before trusting a mismatch.** The NHL
  shot parity "failed" because the G2 file carried ESPN's team id, not the NHL
  API's; the data was right.
- **A dev server that 404s every nested API route needs a restart**, not a fix.
- **`&&` after `grep` commits even when the test before it failed.** Check the
  test's exit status, not its output.

## First reply

Say what you've read, confirm the state above matches `git log`, run Step 0's
premise audit (read-only), and come back with the R6 gameplan confirmed or
corrected by what it found. Then wait for the go-ahead.

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
