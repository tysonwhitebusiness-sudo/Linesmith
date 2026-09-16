# Research pages — master plan (Phase H)

**Status: APPROVED by the operator 2026-09-14, as written (including picks G1–G7
as taken in §3). R0 done. R1 signed off and deployed. R2 done (signed off by
the operator's instruction to proceed). R3 and R4 signed off 2026-09-14. R5
signed off 2026-09-15. R6 STARTED 2026-09-15: Step 0 done, corrections and
decisions recorded in the R6 section. R6.1 (MLB) SIGNED OFF 2026-09-15.
R6.2 (NFL and CFB) COMPLETE 2026-09-15, with two checks owed on Thursday's
NFL slate; R6.3 (soccer) next.**

**HERO AND LIVE-CARD REWORK COMPLETE 2026-09-15** (operator pivot after R6.2,
commit `35d6be5`; plan and mockups in `docs/design/hero-live-rework.md` and
`docs/design/hero-live/index.html`). The hero was 1416x332 with ~700px of dead
middle and a tile row that orphaned at ~1100; it is now the headshot with the
name, the facts full width beneath as label-above-value cells, a season panel
with the record and the last five games, and tiles on a fixed 6/4/3 grid. The
live card left "Prop analysis" for its own section under the hero, rebuilt as
bands with the sport's situation beside the scoreboard (MLB count and bases,
football down and distance — the summary parser now reads `situation` for CFB
too) and a lines table where a cleared line tints its row and names the book
behind its price. The eight legacy green-header cards on the player page now
use the shared `Card`, so one page no longer shows three heading styles.
Fixed in passing: a pick'em payout being taken as the live price, a duplicated
team abbreviation in the hero, and ESPN's day-first birth dates.

**R6.2 COMPLETE 2026-09-15.** NFL "Usage & depth" / "Where he throws", CFB's
not-held state, and football on one line. Commit `1438855`.
- **Step 0 audit:** `nfl_target_events` holds season, week, air yards, side,
  depth band, YAC, completion and touchdown per located pass — 17,848 rows
  (2024), 17,582 (2025), 945 so far (2026), 497-509 receivers and ~100 passers
  a season. `passer_id` is populated, so a quarterback's chart is real. The
  `interception` column exists and is false on all 36,375 rows (R6-F11).
- **Built:** `nflTargetsSection` (`lib/sports/nfl/targetShapes.ts`) — the
  target/pass chart (every located pass at its own air yards on the new
  `FieldScatter`, coloured caught / incomplete / touchdown, `surface: 'field'`
  on the shared scatter card), the six-zone table (share, catch %, air yards,
  YAC per catch, TD) and the per-season depth profile (targets, aDOT, deep %,
  catch %, YAC, TD). It opens on the newest season unless that season has
  under 20 passes, where the fuller one before it opens (G2's rule).
  `/api/nfl/targets` (cachedRoute, 6h, keyed by the page's own ESPN id, which
  it crosswalks to nflverse's GSIS id) and `useNflTargets` feed it; every held
  season comes back in one response, so the season control refetches nothing.
  CFB quarterbacks get `cfbEfficiencySection`: what CFBD publishes and this app
  does not ingest.
- **Also built:** R6-F9 — NFL and CFB re-price the active candidate at the
  current main line through the shared `repriceAtMainLine`, so the stepper, the
  price and the "Odds & prices" table name one line. C4 — both leagues fill
  `gameState` from ESPN's summary through one shared builder
  (`lib/sports/multiSport/footballGameState.ts`), with the lines so far
  measured against that same main line.
- **Removed:** `/api/nfl/target-map`, `lib/sports/nfl/targetMap.ts`,
  `targetMapShapes.ts`, `components/useNflTargetMap.ts`, the prop block's 2x3
  target grid (`spatialGrid` is null for NFL) and NFL's rail "Season stats"
  card — "Season by season" reads every season of the same totals, and its
  extra was a rank, which left the player page with D3 in R6. NBA, NHL and CFB
  still fill that slot until their sub-phases.
- **Verified:** 1440 and 400 on Lamb (WR), Prescott and Allen (QB), Hill (WR,
  no market), Sayin (CFB QB) and Witt (MLB, unchanged); then the plan's own
  remaining subjects and regression set at 1440: Chase (185 targets, 2025),
  Manning (CFB, the not-held state), Tua (injured, 372 passes with 3
  unlocated), and one page each for soccer (Cunha), tennis (Alcaraz), NBA
  (SGA), NHL (MacKinnon) and golf (Scheffler) — all unchanged, no overflow. The route's rows equal
  G2's own Lamb dataset row for row. Lamb opens on 2025 (117 targets) with
  2026 at 8; Allen's note says 1 of 29 passes carries no location. No page
  overflows at 400. tsc clean, 507/507 tests, build passes.
- **Found rendering the regression set:** a player whose ESPN bio carries no
  position got no section at all, because the role read the bio only. It now
  falls back to `footballResearchSpec`'s own box-score answer, the same
  fallback the page's columns already make.
- **OWED, Thursday 2026-09-18 (NFL slate):** the game-state card and the prop
  block for a player with a market — today's NFL slate had no live game and no
  priced player by the time the sections landed, so both are built and unit
  tested but not yet seen on a page. CFB's equivalent: Saturday 2026-09-19.

**R6.1d COMPLETE 2026-09-15.** One line on the page, Odds & prices, game state.
Commits `4da5684` and the cleanup/docs commits after it.
- **Built:**
  - *The line (R2-F4).* `repriceAtMainLine` (`mainLine.ts`, shared) re-prices
    a candidate at the main line its current rows show. MLB's prop block opens
    there: stepper, hit rates, chart, price chip, "Add to slip" and All books
    (`PlayerDetailData.priceCandidate`). The model percentage is a chip that
    names its own board line when it differs ("Model 68% at O 0.5"); the
    re-lined candidate drops the model fields. Scan and the Python model keep
    `BOARD_LINES`. Measured over 63 games on 2026-09-15: main equalled board
    for 8 of 31 pitcher strikeout markets, 3 of 30 pitcher outs, 123 of 270
    total bases; triples (258) and batter strikeouts are alternates-only and
    keep the board line with the status.
  - *Prices at the start (R2-F6).* `/api/props/lines?gameId&start` serves
    `readPreGamePropOddsForGame`; the player page passes the slate's start
    (`usePropOdds(..., startIso)`), labels the chip "price at the start", and
    the live poll no longer runs before the start.
  - *Line movement (R2-F5).* Pinned to the line on screen (`useLineHistory`
    `line`), cut at the start (`before`, both queries); the modal is only the
    fallback.
  - *Odds & prices section* (`PlayerOddsSection`, after Game log, every sport):
    every market this player is priced on at its main line
    (`playerPriceRows`: best over/under with book, books, updated; yes/no and
    alternates-only rows say so; a row switches the prop block to that market),
    then Line movement, All books and Game line cards. The rail's "Today's
    line", "Line movement" and "Recorded price" cards and the main column's
    "All books" are deleted. The embedded game-page player gets the same cards
    below its prop block.
  - *C4 game-state slot* (`GameStateSlot`, `GameStateCard`, top of the prop
    section): score, period, the player's own line and plays, today's lines
    against their main line; `baseball` (count, outs, bases, batter, pitcher)
    presence-checked. Only while the slate says in progress and the last poll
    succeeded. MLB fills it; `liveGame`/`LiveGameSlotData`, the MLB-only
    "Live today" block and its helpers are deleted, which also removes the
    stale comment above `data.liveGame`.
  - Fixed in passing: first pitch printed as a raw ISO timestamp in the
    matchup line and the conditions card; the player page's
    `useMarketCalibration` fetch, unread since R3, removed.
- **Verified:** 1440 and 400 on De La Cruz (total bases main 0.5), Freeman
  (hits main 1.5, "Model 68% at O 0.5", movement and All books at 1.5),
  Yamamoto, Lowder, Schmidt (no market: "No prices posted"), Allen (NFL);
  the embedded game page (Freeman on 824466). No page overflow at 400.
  **Live, CWS @ CLE (824384) at first pitch:** Chris Murphy and Chase
  Meidroth at 1440 and 400. Score, period, count, bases, batter and pitcher,
  the player's line and plate appearances, lines so far against the main line;
  the price chip reads "price at the start" and the section "as they stood at
  the start". Two fixes from that render: the card waited for the slate to say
  "In Progress" (it still said "Warmup"), so a successful live poll is now the
  proof; and the route's `isCurrentPitcher` marked a starter "Pitching" while
  his team batted, so the defense's pitcher decides. tsc clean, 508/508 tests
  (`tests/player-odds-r61d.test.ts`; the adapter tests fail with the adapter
  reverted), build passes. `scripts/measure-mlb-main-line.ts` is the
  measurement.
- **Found and routed:** R6-F8 (ParlayAPI files pitcher strikeouts and walks
  under the batter markets), R6-F9 (a snapshot's baked line goes stale for
  the other sports), R6-F10 (the game page's shared prop rows are current,
  not pre-game, after the start).

**R6.1c COMPLETE 2026-09-15.** MLB pitcher "Arsenal & command".
- **Built:** `mlbPitcherSection` (`playerResearchSections.ts`): arsenal table
  (usage, velo, whiff, CSW, xwOBA, EV allowed; spin and movement stated as not
  held), pitch locations (the rollup's latest 500, the six most thrown types
  with chip toggles, three on by default; new `ZoneScatter` primitive and a
  `scatter` card kind; a status card under the 500-pitch threshold), where he
  pitches (zone map, pitcher views: share, whiff, xwOBA allowed with low = good),
  fastball velocity by start (average and hardest), vs LHH/RHH. Coverage note
  against batters faced (at bats + walks + HBP from the box scores, which can
  only understate). `CATEGORICAL` palette in chart tokens.
- **Removed:** the prop block's strike zone and platoon split for pitchers
  (`spatialGrid`/`binarySplit` are null for MLB now), with their builders
  `toSpatialGridRole`/`toPlatoonBinarySplit` and their tests.
- **Verified:** the section equals `/api/mlb/statcast/player` on Skubal (FF
  37.4% 96.8 20.9 26.1 .363 86.6; 548 of 568 batters faced, 96%) and Yamamoto;
  De Paula (four games) and Witt unchanged. Yamamoto has a market today: his
  prop block keeps the pitch mix, has no strike zone or platoon split, and the
  shared game log shows IP per start — **F-B4 resolved** (the R6.1a game log
  reads `player_game_history`, not the slate). 1440 and 400 (the arsenal table
  scrolls in its own container at 400). tsc clean, 497/497 tests (11 zone and
  platoon role tests went with their builders; 4 pitcher tests added), build
  passes.

**R6.1b COMPLETE 2026-09-15.** MLB hitter "Contact quality & approach".
- **Built:** sport sections as data (`ResearchSection`/`ResearchCard` in
  `playerResearchShapes.ts`) drawn by one renderer (`ResearchSectionBody`);
  MLB's hitter section (`lib/sports/mlb/adapters/playerResearchSections.ts`):
  power profile with league percentiles for every season held (plus sweet-spot
  and barrel-style rate), exit-velocity distribution (new `Histogram`
  primitive), exit velocity by game, results by pitch type, strike zone with
  G2's three views and the four chase zones (`SpatialSurface` zone extended),
  vs LHP/RHP, home runs with distance. Season control, 2025 and 2026.
- **Removed:** `/api/mlb/pitch-profile`, `useMlbPitchProfile`,
  `lib/sports/mlb/pitchProfile.ts` (the matchup roles read the rollup row's
  `profile` block through `useMlbStatcast`); the rail's "Hitter stats" card;
  the prop block's strike zone and platoon split for hitters (a pitcher's stay
  until R6.1c).
- **Verified:** the section equals `/api/mlb/statcast/player` field for field
  on Witt (2026, and 2025 through the season control) and Judge; Witt against
  G2 differs only as R5a said (regular season, one copy per pitch: 387 balls in
  play to G2's 393, pool 307 to 333, avg EV 92.4 to 92.5); the opposing
  starter's pitch mix still renders beside the hitter's; every other sport's
  page unchanged (same sections and heights). 1440 and 400. tsc clean, 504/504
  tests, build passes.
- **R6-F7, found rendering Judge (14 Statcast home runs against 18 in the box
  scores): the pitch corpus holds some games only in part.** 281 of 2,229
  regular-season 2026 games in `corpus/mlb_pitch_events` have fewer than three
  pitch rows per plate appearance (Judge's 2026-04-19 game: 143 pitches), in
  every month, and 2025 is the same. Rollups cover 91-94% of a hitter's plate
  appearances (Judge 261/283, Witt 545/581). Not fixable in TypeScript; the
  section states its coverage whenever it is under 99%. Routed to the model
  track (ingest and corpus, Phase 5) and Appendix A.

**R6.1a SIGNED OFF 2026-09-15.** The player is the page, for
every sport. Commits `0169de1` (history and bio readers, shared builder) and
the R6.1a commit after it (page, routes, removals).
- **Built:** `/api/player-history` (direct read, every season, results joined)
  and `/api/player-bio` (StatsAPI, NHL api-web, ESPN athlete; injuries). Each
  sport's `toPlayerResearchData` builds the hero tiles, Season by season,
  Trends, Splits and Game log through one `buildPlayerResearch`. All eight
  player routes and the Players tab render the player with or without a market;
  the prop block is one section with a skeleton while the slate loads and a
  reasoned empty state after. Sticky section nav, Sources with as-of times.
- **Removed:** the old "Last 15 games" gamelog card and its adapters' gamelog
  and summary-strip code in all eight sports; Rolling form, Situational
  splits, Where this sits and Game context from the player page (the builders
  stay: team and game pages render them, R7/R8); `/api/mlb/player-gamelog`,
  `playerGamelogCache.ts` and the `mlb:full-raw:<date>` write (R6-F2; the
  Python prune clears the old rows after three days); `fallbackSubjectId` and
  the page-level identity cards.
- **Verified:** `scripts/verify-player-history.ts` — all 24 G2 player
  datasets, every G2 game present with identical stats and opponent; scores
  refereed by the leagues: MLB 995/995 against StatsAPI, NHL 751/751 against
  api-web. `scripts/verify-player-research-g2.ts` — G2's own spec formulas run
  over the same games: 856/856 season-table cells equal (IP printed in thirds
  by design, R2). Rendered 13 subjects (the G2 players plus Vasilevskiy,
  Lammens and injured Clarke Schmidt) at 1440 and 400: every section present,
  no horizontal overflow, nav pins under each header. tsc clean, 499/499 tests,
  `npm run build` passes.
- **Before R6.1a, 11 of those 13 page loads showed only "No tracked markets".**
- **What re-checking changed while building:**
  - **The G2 datasets' results are wrong on back-to-backs and series.** G2
    joined results by team name within a day and took the neighbouring game
    (Dončić 2023-11-16 at WAS, a 130-117 win, sits in G2 as the previous
    night's 110-131 loss). 8-87 games per NBA/NHL/MLB fixture; every disputed
    game checked agreed with the league. Measurement trap added below.
  - **MLB `game_result` cannot be joined to game pks (R6-F5).** No pk before
    the 2026-08 live capture (`lc…` CSV refs, ESPN ids), `espn_core` dates night
    games by UTC, and some games are absent (NYY @ CLE 2024-04-13 doubleheader).
    Joined by date, 25 of Witt's 449 games took a neighbour's score. MLB
    results now come from StatsAPI team schedules by pk.
  - **`is_major` is 0 on every tennis row (R6-F3),** already measured
    2026-08-30 and never fixed; majors columns were dropped rather than shown
    as zero.
  - **MLB OBP uses plate appearances (R6-F4):** the history stores no sacrifice
    flies, so OBP reads a few points under official where a hitter has them.
    G2 used the same formula. Labelled on the tile.
  - **StatsAPI's `currentTeam` is the rehab affiliate** for a player on a rehab
    assignment (Schmidt showed as the Somerset Patriots); the hero uses the
    MLB-level roster row.
  - **Past-game pages do not exist for MLB and NFL,** so their game-log rows are
    unlinked until R8 (no dead links, B5). CFB, NBA, NHL, soccer and tennis
    rows link.

**R5 SIGNED OFF 2026-09-15.** Decisions, findings and numbers:
- **5a's rollups run on the operator's machine** (operator, 2026-09-14), chained
  after the corpus refresh in `run-corpus-refresh.bat`. The Render worker has
  no corpus credentials, and the corpus docs measured ~280-312 MB per partition
  read against its 512 MB. Rollups write small Postgres tables and a job-run
  breadcrumb; if the machine is off, cards show their as-of date.
- **R5-F1, fixed and deployed:** MLB and tennis `player_game_history` had
  stopped on 2026-08-28 (task 4.7's hand backfill, never scheduled), so the MLB
  board projected without two weeks of games. `3867f60`, deployed
  `dep-dakbn4tg1s2s73bor350`.
- **The "79%" team join was spring training plus that gap**, not a join
  problem: the corpus holds Savant's `S` game type (173k pitches, never in
  `player_game_history`). Regular season matched 94.2% before the fix, every
  miss a game after 2026-08-28. Rollups filter to regular season by the
  StatsAPI schedule's game type.
- **Skenes has no Statcast block in G2**; Skubal's dataset is the pitcher
  reference for the arsenal check.
- **5a DONE.** `build_statcast_rollups.py` (chained in the corpus refresh task;
  96-146 s) writes `mlb_statcast_player_season` (3,047 rows),
  `mlb_statcast_team_season` (120) and `mlb_statcast_game_pregame` (today's and
  tomorrow's games, kept from kickoff), about 30 MB. Direct-read routes:
  `/api/mlb/statcast/player/[playerId]`, `/api/mlb/statcast/team/[teamId]`,
  `/api/mlb/game/[gameId]/pregame-statcast`. `verify_statcast_rollups_g2.py`
  reproduces the G2 datasets on 4,648 fields with none different (Witt 393 BIP,
  18 HR, pool 333; Skubal; Royals both sides; both KC @ BOS starters), run on
  the corpus files G2 was built from. Production differs from G2 on purpose:
  regular season only, one copy per pitch, every HR with its distance.
- **5a premise corrections.** Hit distance needs no ingest column: the season
  HR list is its only card, and one Savant query per season (5,164 HRs in
  2026, 12 s) carries `hit_distance_sc`. The team join needed no roster-by-date
  work once R5-F1 was fixed: 100% of regular-season pitches join.
- **R5-F2, fixed:** the pitch corpus was duplicating (a pruned pitch re-fetched
  by the 3-day ingest under a new id); 13,298 duplicate rows. Freeze rule moved
  past the ingest window (`a706141`); readers dedupe by pitch.
- **R5-F3, fixed:** the MLB player page's pitch mix, platoon split and strike
  zone (`getPitchProfile`) aggregated `mlb_pitch_events`, which Phase 5 cut to
  five days, and labelled it the season. Now read from the rollup (Skubal
  n=2,002 on the rendered page).
- **5b DONE (job not yet deployed).** `teamProductionJob` (daily) writes
  `athlete_positions`, `team_game_production` (per team, game and position
  group, so a kickoff cutoff is a `game_date <` sum) and
  `player_season_production` (production score and team share). Routes
  `/api/team-production?sport&season&before` (G2's matchup rollup shape) and
  `/api/key-players`. Tables filled from the operator machine (229 s for every
  sport). Against G2's matchup datasets on completed seasons, for and allowed
  totals match on all 758 team sides in six sports, NFL allowed-by-position
  matches exactly, and Dallas's key players come out in G2's order. NBA,
  soccer and NHL position groups differ from G2 by design: G2 grouped only
  players on rosters the day it ran, and NHL as skater/goalie; these use
  season rosters (NHL F/D/G) plus athlete lookups, and cover all but a handful
  of player-games.
- **5c DONE.** Shot ingest is regular season only, and NBA misses are stored
  with their real value (every miss had been a two: ESPN's play type never
  says "three point"); the stored 2024-25 rows were corrected (59,235 missed
  threes) and NHL 2024-25's preseason and playoff shots removed (21,339).
  2025-26 backfilled: NBA 1,239 games / 220,723 shots, NHL 1,312 / 153,754.
  Team views: `team_shot_profile` (NBA zones and bins for, allowed, allowed by
  position; NHL bins and types) via `/api/team-shot-profile`, leagues over
  teams with 40+ games. Equal to G2 on the Lakers' zones, league distributions
  and bins, all 30 teams' allowed zones, and the Leafs' bins both ways.
- **5d DONE.** `team_target_profile` (offense, defense, defense by receiver
  group; defense from the game id) via `/api/nfl/team-targets`. Equal to G2's
  matchup-nfl 2025 on 160 team rows and the league cells.
- **5e DONE.** SharpAPI yes/no rows now keep both sides (Yes -> over, No ->
  under); before, a book's Yes and No shared one key and the last read won,
  and 35 of 118 two-book yes/no markets disagreed in direction. A provider
  whose fetch read everything now has its withdrawn rungs removed on write
  (a partial SharpAPI walk removes nothing). R2's read-side guards stay:
  pre-game reads union `prop_odds_history`, and the harvester does not pass
  the flag.
- **Deployed:** `dep-dakl7c61egvs738eomf0` on `a445cc2` (teamProductionJob,
  shot ingest, prop writer).
- **Verified in production after the deploy:** `teamProductionJob` ran on the
  worker (144 s, RSS 344 MB, every sport's rows rebuilt); SharpAPI's WTA
  to-win-a-set rows now arrive as over/under, and 0 of 29 two-book yes/no
  markets written since disagree in direction (35 of 118 before).
- **R5-F5, routed to the model track (worker RAM, Phase 5):** the worker has
  been OOM-killed at its 512 MB limit 4-9 times an hour since about 22:00 UTC
  on 2026-09-11 — before R5 — with a quiet stretch on 09-14. Each kill drops
  whatever the queue was running. `docs/CURRENT.md` Phase 5 still records worker
  RAM as cleared.
- **The worker stalled for ~40 minutes after the R5 deploy** (last log
  14:20:57 UTC, `ingestNhlShotsJob` starting; no OOM event). It coincided with
  this session holding several connections on the operator machine at once
  (two shot backfills, the corpus refresh, the Statcast rollup) alongside the
  harvester, against a 15-connection pooler. Restarted 14:59 UTC; the queue
  ran through the same job in 19 s. The standing one-connection rule is the
  lesson.
- **R5-F4, fixed on the spot:** a706141's keep-recent margin sent
  `mlb_pitch_events` into prune_corpus's floor-publishing branch, which assumed
  `captured_at` and failed the 2026-09-15 scheduled prune (nothing deleted).
  `706a874`.
- **5b premise corrections.** `player_game_history` has no position anywhere
  (checked every sport's stat keys), so positions got their own table. ESPN's
  NBA roster ignores `?season=`; past NBA players come from the athlete
  endpoint, 150 a run. NHL history uses NHL ids, so NHL positions come from
  api-web, not ESPN. CFB has no position source in the plan and gets totals
  only.

**R4 COMPLETE 2026-09-14, awaiting sign-off.** Commits `f7c341d` (one shared
ESPN summary fetch), `aebd6a3` (ESPN summary parsers), `c649234` (MLB pitches,
batted balls, win probability), `cbce19e` (NHL landing and play-by-play), `e1e11d9`
(TennisMyLife serve/return/ranks, CFB poll ranks). Every parser is a pure
function tested on a real saved payload and checked field by field against the
G2 datasets. No card reads them yet; R6-R8 do. What re-checking the premises
changed:
- There was no "shared summary parser": eight modules fetched the same ESPN
  summary separately. One fetch with in-flight dedupe now serves all of them.
  Soccer's live tab had never loaded (it asked ESPN for `epl`, not `eng.1`) and
  was fixed in the same commit.
- NHL shot coordinates for a live game come from a new api-web play-by-play
  call, not ESPN: ESPN's NHL plays carry coordinates without shooter, goalie or
  strength situation.
- The summary cache is in memory (final 10 min, open 5 s), not
  `cachedRoute()`: R4 adds no routes. The long-TTL cache for finished games is
  set when R8's game routes read these parsers.
- R4-F1 routed to R6 (tennis archive lag, below).

**R3 COMPLETE 2026-09-14, awaiting sign-off.** Commits `7adb8c4` (3a tokens),
`a477d60` (3b primitives), `a2ba642` (3c charts and surfaces), `f7dbd4f`
(primitives adopted on real cards, 3d), `9fbb74e` (fixes from the verify
pass). Record and caveats in `docs/audit-2026-09-13/RESUME-PROMPT.md`.
What re-checking the premises changed:
- The old Tailwind type scale already used the names `label`, `body` and
  `title` at different sizes; its 266 uses were codemodded by F2's mapping
  rather than silently resized.
- `ChartFrame` and every standalone chart scaled through `viewBox`, so "real
  pixel width" was a change to the frame and five primitives, not a new chart.
- Golf's spatial grid is proximity by lie, not a place: it takes the `matrix`
  surface; a green view waits for shot coordinates.
- Before R1f 2b's NFL check: the "19h ago" prices were two bugs, not the game-day
  tier — stale prop rungs (`4b4c5c5`) and one Propline throttle clock shared by
  six sports (`2228a3d`, deployed `dep-dak6nkad0e5s73b736u0`). R2-F1 resolved.

**R2 COMPLETE 2026-09-14, awaiting sign-off.** All 9 rules (`33ce1f2`,
`8aedacf`, `4509175`, `6ebf081`, `b8f80d8`, `3a421b6`, `94b0f53`, `287d15f`,
`3e83af2`), plus a 400px top-bar fix from the sign-off pass (`fcaef2c`).
Three premises were wrong on re-check: MLB picks no line from `prop_odds`;
no TS path summed innings pitched as decimals; the NBA rim was at y=0, not
5.25. Per-rule record in `docs/audit-2026-09-13/RESUME-PROMPT.md`. Next after
sign-off: R3.

**R1 outcome, 2026-09-14** — commits f89d704, 69cf490, 770f6c9, 3f61ee6,
16e8227. Done: R1a, R1b, R1c, R1d (TS + Python; **deployed 2026-09-14**,
Render `dep-dak36up42hec73bri7hg` on `46a2def` — verified in prod:
`refreshNflJob games=33`, `refreshCfbJob games=146`, matching the frontend's
own slate counts exactly), R1e, R1f 2a, R1g except F-B4, R1h. Owed:
- **F-B4** (MLB pitcher game log) — not reproducible: today's MLB slate carries
  no pitcher markets at all, so no pitcher page renders a game log. Needs a
  slate with pitcher props. **Resolved in R6.1c's render (Yamamoto, with a
  market): the game log is R6.1a's, from `player_game_history`.**
- **F-B12** (tennis aces) — MEASURED AND RE-ROUTED TO R2. It is not a
  match-total market: `prop_odds` holds 503 aces rows over 45 subjects with a
  0.5–29.5 spread, and one subject-game (Ben Shelton, 182766) carries 9
  distinct lines from 8.5 to 29.5 across 2 books. That is an alternate ladder
  filed under the main key — exactly what R2's prop-main-line rule fixes. Do
  not fix it here; that would be a second main-line implementation.
- **R1f 2b** — calendar-blocked to Saturday 2026-09-19.
- **F-B2, F-B3** — already assigned to R2 and R7.

**Three plan corrections found by re-checking the cited lines (plan §R1):**
1. R1c said "three user-facing strings". There are ten, in five adapters —
   NHL and soccer were missed because those pages could not be rendered when
   the audit ran.
2. R1h said to check whether a high `pctOf` means "allows more". It does not,
   in any sport: rank 1 is the STRONGEST unit, so the headline was naming the
   opponent's best category as the subject's biggest edge. The missing floor
   was the smaller of the two faults.
3. F-B9 said the soccer moneylines were "likely on the wrong teams". They were
   not. `opponentIsHome` tested whether THIS team is home while being named for
   the opponent, and `isHome` negated it, so the two price rows were labelled
   with each other's team. The same inverted flag was in soccer, CFB, NBA and
   NHL.

**One live bug found in R1f 2a that R1 did not fix, and a decision is owed:**
`cachedRoute` serves stale **with no maximum age** — `if (cached) { trigger
rebuild; return stale }`. A route whose `build()` keeps failing serves its last
good payload forever and the page cannot tell. CFB's build is the one
documented as timing out, which is how a Sep 13 rebuild listed Sep 3/4 games.
The symptom does not reproduce today (146 games, all dated Sep 17–27), and the
TS and Python UTC fixes are a one-day shift that cannot explain a nine-day gap,
so they are ruled out as the cause. A maximum stale age changes every route's
contract and needs its own measurement; it is not an R1 call.

This is Phase H of `design-audit-plan.md`: every audit finding, every card verdict,
the visual and interaction system, the G2 mockups and the data work behind them,
merged into one build order.

- **Supersedes `build-plan.md`** as the build order. `build-plan.md` keeps its
  measured findings, and every item in it is carried in below (mapping in
  Appendix C).
- **Does not replace `docs/master-plan-2026-09-06.md`.** That plan owns the
  product and model order. This one covers only the player, team and game pages,
  which already exist. It adds no new surface: slate research views stay
  deferred.
- **The spec is the G2 mockups** in `docs/design/phase-g2/`: `player.html`,
  `game.html` and `team.html`, with sport switching, game states and the
  compare control. The datasets in `docs/design/phase-g2/data/` are real data
  pulled for named players, teams and games. They are the reference fixtures
  for verification.

Sources merged:
- Card audit: `phase-a-data-depth.md`, `phase-b-read-paths.md`,
  `phase-c-card-verdicts.md`, `phase-d-remediation.md`, `build-plan.md` and
  `before/README.md`.
- Design audit: `design-findings.md` (D1–D5), `design-audit/E-inventory.md`,
  `F-card-verdicts.md` (with F-B1..F-B13), `F2-visual-system.md`,
  `F2-ux-interaction.md` and `G-ideas.md`.
- Mockups: `docs/design/phase-g2/PLAN.md` and `BUILDABILITY.md`.

---

## 1. How close the build gets to the mockups

**Card for card, the pages can be built as shown.** Every section, card, chart
form, sport-native surface, scope control, tooltip, drill-down, game state and
compare view in G2 is drawn from data the app already stores or fetches
(`BUILDABILITY.md`). The type ramp, colors, spacing and phone layout are the F2
system, which the build adopts as tokens. For the same player, team or game, the
app should show the same numbers as the mockup dataset. R6–R9 verify exactly
that.

**Where the app will differ, and why:**

| # | mockup | app | why |
|---|---|---|---|
| 1 | Vanilla JS kit (`kit.js`, `kit2.js`, `viz-sport.js`) | React components under the sport-adapter architecture (`CLAUDE.md`). Existing `components/charts/` (`ChartFrame`, `useChartCrosshair`) and `SegmentedToggle` are extended to match, not duplicated | The kit is the visual spec, not code to port |
| 2 | One JSON file, loads instantly | Each section loads on its own, with a skeleton, an empty state, a human error and a staleness badge | Real routes, `cachedRoute()`, rate limits |
| 3 | **Live** replays a finished game cut at chosen moments | Live polls the existing live routes. There is no moment picker | A replay of a final game isn't a product feature |
| 4 | Football live props tracker parses play text | Reads the live box score the live parsers already refresh | The box score is the real source |
| 5 | Compare peers are a fixed list of 12 | A player picker filtered to the same position | Needs every player, not a sample |
| 6 | Typeface and elevation switchers, sport tabs | One typeface and one elevation ship. Sport comes from the route | The switchers were for choosing |
| 7 | "Before the game" injuries on a final page show the report fetched at build time | Labeled as the current report, with its fetch time | ESPN keeps no pre-kickoff snapshot. Capturing one is deferred |
| 8 | Cards whose data isn't held show a status | Same statuses, until the data lands | NBA/NHL shots 2024-25 only (until R5), no NHL or soccer win probability, no tennis point-by-point, no CFB advanced passing, no soccer/CFB injuries |
| 9 | Seven games and 13 subjects, all well covered | Every game: no odds, postponed, doubleheaders, neutral sites, OT and shootouts, extra innings, retirements and walkovers | Each gets an empty or status state, checked in R6–R8 |

**Calendar limits on verification:**
- NBA and NHL live and current-season pages can't be render-checked until October.
- Golf can't be checked until a live tournament.
- **The MLB regular season ends in late September.** Verify the MLB live game
  state before then, or on postseason games.

---

## 2. Rules for every phase

- **Findings go to the phase that fixes them best.** A bug found mid-phase that
  breaks the app is fixed on the spot. Anything else is written into the
  receiving phase's own section (an "Also in R*n*" block) and given a row in
  Appendix A, so the session that builds that phase reads it. Nothing is left
  only in a handoff file.
- **Build, type-check, render, compare, commit, stop.**
  - `tsc --noEmit`.
  - Render every affected sport at 1440px and 400px.
  - Put each page beside its G2 mockup for the same subject and check that the
    numbers match that dataset. Where data has moved on since the snapshot, the
    dataset's `fetched`/source note explains the difference.
  - Commit only the phase's own files, by explicit path. Never `git add -A` or
    `git add docs/`.
  - Update this doc's status line, then **stop for sign-off**.
- **Subtract in the same phase.** A card, field or component the rebuild
  replaces is deleted in the phase that replaces it, not kept beside it (rule 1
  of `master-plan-2026-09-06.md`).
- **Architecture (`CLAUDE.md`):**
  - One shared `PlayerDetail`/`TeamDetail`/`GameDetail`, and one adapter per
    sport per component.
  - `{Component}Data` is declared in the MLB adapter.
  - A named, presence-checked field only for a real data difference.
  - Adapters never return JSX, and hooks stay in the component.
  - GET routes go through `cachedRoute()` or a direct read of a table
    refreshed out of band. **Grep `cacheKey` before choosing a key.**
  - Python writes, TypeScript renders. One writer per table, and each new table
    gets its `docs/table-ownership.md` row in the same commit.
- **Real data only.** Where data is missing, show a status. Never fill a gap
  with a guess.
- **Ask before any Render deploy.** Don't push unless asked.
- **Before any DB work:** the pooler caps at 15 connections. Check for running
  fits, harvester cycles and other sessions' jobs.
- Don't touch `docs/CURRENT.md`. This thread's baton is `RESUME-PROMPT.md`.

---

## 3. Decisions

### Already taken (don't reopen)

| # | decision | from |
|---|---|---|
| 1 | Pages are in-depth research pages. Odds are one section, **except the prop analysis block**, which stays near the top of the player page: market tabs, line stepper with price and age, window chips (vs opp · L5 · L10 · L15 · Season), hit-rate tiles and bars vs line. Presentation fixes only: label the season in scope, hide a tile with no sample, open on recent games, F2 type and contrast | operator 2026-09-14 |
| 2 | Every card is judged by "does this make sense for this sport, does this help". No earlier design is the standard | design audit |
| 3 | "No clear edge" floor: 70th percentile | build plan D1 |
| 4 | Soccer default market by position: GK saves · DEF tackles (else shots) · MID shots on target · FWD anytime goalscorer, falling back to today's order | build plan D2 |
| 5 | Soccer and tennis live card on the player page: score and state only | build plan D3 |
| 6 | Two-tier interaction. Tier 1 on every card: hover detail, real links, scope, keyboard focus. Tier 2 where it adds insight: drill-downs and compare | design D6 |
| 7 | Tokens are built so dark mode is possible. Shipping dark mode is separate (deferred) | design D5 |
| 8 | Game page has three states: before start (research as of kickoff), live, final (recap, with the kickoff research kept) | operator 2026-09-14 |
| 9 | Player and team pages get a "Compare against" control | operator 2026-09-14 |
| 10 | Golf is held until a live tournament. NBA/NHL live waits for October. Scan and slate pages are out of scope except the games strip | standing |

### Picks G1–G7, taken as built in G2

Approving this plan approves these. Each is a token or layout choice that can be
swapped before R3 without changing any other phase.

| pick | taken | note |
|---|---|---|
| G1 typeface | **System sans** (`ui-sans-serif, system-ui, "Segoe UI", Roboto`). **Drop the IBM Plex Mono load** (1 element uses it) | Inter / Plex Sans / Source Sans 3 remain a one-token swap |
| G2 elevation | **Raised cards:** paper `oklch(94.5% …)`, card `oklch(98.5% …)`. This fixes today's card-darker-than-page inversion | Flat-with-borders is a one-token swap |
| G3 player layout | **A, sectioned** with a sticky section nav | as G2 |
| G4 live game layout | **Sectioned**, opening on "Right now" (live header, the sport's graphic, win probability) | as G2's live state |
| G5 team layout | **A, sectioned** | as G2 |
| G6 slate research views | **Not now.** Deferred with its data needs (§R-deferred). The ingest work in R4/R5 serves it later | consistent with "slate pages out of scope" |
| G7 ideas in the build | **Everything the G2 mockups show.** Ideas marked Not held stay deferred | |

---

## 4. Phases at a glance

| phase | what | size | depends on | calendar |
|---|---|---|---|---|
| R0 | Safekeeping and baseline | done 2026-09-13 | — | — |
| R1 | Correctness on today's pages | small–medium | — | CFB check Sat 2026-09-19 |
| R2 | Shared data rules | medium | — | — |
| R3 | Design system foundations | medium | picks above | — |
| R4 | Parsers for feeds already fetched, and two new endpoints | medium | R2 | — |
| R5 | Python rollups and ingest | large | R2 | Render deploy asks |
| R6 | Player page rebuild | large, per sport | R2–R5 | NBA/NHL verify Oct |
| R7 | Team page rebuild | medium–large | R2, R3, R5 | NBA/NHL verify Oct |
| R8 | Game page rebuild with three states | large | R2–R5 | MLB live before season end; NBA/NHL Oct |
| R9 | Compare control | medium | R5–R8 | — |
| R10 | Port-artifact cleanup | small–medium | R6–R9 | — |
| R11 | Deep history on team and game pages | large, design first | R2, R10 | — |

Order follows the design audit's sequencing rules:
- identity and interaction (R3) before any card;
- data rules (R2) before any page reads them;
- card changes before the field-rename cleanup (R10);
- scope before deep history (R11).

R1, R2 and R3 don't depend on each other and can run in any order.

---

## R0 — Safekeeping and baseline ◆ DONE

Audit committed, before-screenshots in `before/README.md` (build plan Phase 0).

---

## R1 — Correctness on today's pages ◆ small–medium

Located bugs with known causes that are live today. Fixing them doesn't wait for
the rebuild.

**1a. WTA shows men (B2).**
- `lib/sports/multiSport/espnTennis.ts`: declare `grouping.slug`, then keep only
  `womens-singles` (WTA) and `mens-singles` (ATP), mirroring
  `schedule.ts:278-279`.
- Verify: `/api/tennis/wta` lists no men and `/api/tennis/atp` no women. Game
  `182770`'s history arrays fill.

**1b. Team header (B6, and the Phase 0 baseline additions).**
- The adapter owns the phrase; `TeamDetail.tsx:314` stops appending
  ` in division`.
- Six team adapters return a correct phrase, or `''` when the rank is 0 or
  missing.
- Record format:
  - `record.draws` gives soccer W-D-L;
  - NHL gets W-L-OTL (F-B11);
  - MLB passes a real ordinal and division name.
- The season is labeled whenever it isn't the current one.
- `seasonStatus.label` replaces `0-0` before a season starts, and reaches the
  header through `TeamDetailData`.
- The R7 hero reuses this data.

**1c. Spelling (C10).** `defence` → `defense` in the three user-facing strings:
- `nfl/…/playerDetailAdapter.ts:427`
- `cfb/…:201-202`
- `nba/…:242`

**1d. Game links (B5), the rest of it.**
- **Past-game pages.** `app/nfl/game/[gameId]/page.tsx` finds its game in
  today's strip. Fall back to the game route when it isn't there. MLB's game
  page uses the same pattern, so fix it the same way. Check CFB.
- **Python UTC range.**
  - `python-odds-service/src/game_context.py:148` `_date_range_param` builds
    its range in UTC, so NFL and CFB jobs lose primetime games after 00:00Z.
  - Build the range from the US Eastern date, the way `teamSportEspn.ts` now
    does.
  - Keep the backward-range ordering `archiveResultsJob` relies on.
  - **Needs a Render deploy: ask first.**

**1e. Rate limiting (D5).**
- Today every unlisted `/api/*` route shares one 60/min bucket
  (`proxy.ts:132`, `:156`).
- Give page-load routes their own budgets sized to one page's real fan-out plus
  live polling, and correct the message wording.
- Pages never print API error text. Until R3's `ErrorState` exists, show a
  plain "Couldn't load … Retry", and never the false "No teams match".

**1f. CFB pages blank on a live slate (B1).**
- **2a:** find why a Sep 13 rebuild listed Sep 3/4 games
  (`app/api/cfb/route.ts` → `buildCfbSnapshot` → `loadGameContextsForSport`).
  Time box: one session, and write down what was ruled out.
- **2b, Saturday 2026-09-19:** during the live window, read `refreshCfbJob`'s
  run log, tier and `prop_odds` rows. Change `gameday.py` only if the tier is
  still cold with kickoffs inside 6h (asks before deploy).
  - **RESOLVED before the check (2026-09-14):** the NFL symptom below was
    stale prop rungs and a shared Propline throttle clock, fixed in `4b4c5c5`
    and `2228a3d` (deployed). Kept for the record:
    **Routed from R2 (2026-09-14): check NFL in the same pass, on Sunday
    2026-09-20.** DEN @ KC's prop prices read "19h ago" at 19:26 UTC with
    kickoff ~4h away, which is the same symptom: a game-day tier that is not
    refreshing. Read `refreshNflJob`'s run log and tier; one `gameday.py` fix
    covers both sports if the cause is shared.
- **2c:** once pages render, append CFB verdicts to
  `phase-c-card-verdicts.md`.

**1g. Phase F data bugs whose cause is in shared read code.**

| bug | fix here |
|---|---|
| F-B1 | Game page "allowed" ranks copy the other team's "for". Read real allowed values (`/api/season-ranks?side=allowed`) in NFL, NBA, soccer and tennis |
| F-B4 | MLB pitcher game log: zeros and blank rows |
| F-B5 | MLB team stats rounded to integers: carry proper precision |
| F-B6 | Soccer raw floats: format at the adapter |
| F-B7 | Soccer rank pools "of 23" in a 20-team league: one pool, the league's teams in that season |
| F-B8 | Soccer records count draws as losses: W-D-L |
| F-B9 | Soccer next-game moneylines: verify which team each belongs to; add the draw |
| F-B10 | Final CFB and NHL games stuck on "Loading live details…": a final game never shows a live loading state; NHL logos |
| F-B11 | NHL record drops OT losses (with 1b) |
| F-B12 | Tennis aces line: verify whether it is a match-total line compared with the player's own aces; label or pair correctly |
| F-B13 | Tennis multi-season W-L labeled as one season |

- F-B2 (duplicate `game_result` rows) is fixed by R2's read module.
- F-B3 (NFL team bar chart out of order) is replaced in R7. If R7 is more than
  two weeks out, sort it by date here.

**1h. Matchup "biggest edge" floor (C9).** `MatchupExplorerCard.tsx:298`.
- Below the 70th percentile, say "No clear edge against this opponent".
- Check first that a high `pctOf` means "allows more".
- The card is shared, so render one page per sport. It is deleted in R9.

**Done when:** each item has a before/after render and is committed. The Python
fix waits on deploy approval. **Stop.**

---

## R2 — Shared data rules ◆ medium

One implementation of each rule, in the language that consumes it. Where both
Python and TypeScript need a rule, a drift test asserts they agree, as
`tests/config-drift.test.ts` does for bookmaker aliases. Every later page reads
through these. None of them changes a card by itself.

| rule | what it does | where | fixes |
|---|---|---|---|
| **Prop main line** | Take the last **pre-game** quote per book, side and line. The main line is the one quoted on both sides by the most books; ties go to the price nearest even. Pick'em books (PrizePicks, Underdog, Sleeper, Dabble, ParlayPlay, Betr, Chalkboard) never count as a price. Yes/no markets keep a 0.5 line with 2+ books on the over. A market with only one-sided quotes is flagged "alternate lines only" and not shown as a line | Shared TS module read by `app/api/props/lines/route.ts` and every adapter that picks a line (`lib/odds/props/`) | Alternate ladders stored under the main key (14.5–144.5 passing yards); post-game captures; +100 pick'em payouts shown as prices |
| **Pre-start odds filter** | Split `game_odds_history` at the game's start time: before is pre-game history, after is in-game | `lib/odds/gameLineHistory.ts` | 1,790 of 2,782 KC @ BOS rows were after the start |
| **`game_result` read module** | Measure first: team-id fill rate, cross-source duplicates, date disagreements. Then read results for (sport, team, season range), de-duplicated on score plus home/away within ±1 day, with team identity through `team_name_index` / entity resolution | New TS read module, `cachedRoute()` with a one-day TTL (key e.g. `history:results:route:${sport}:${teamId}:${seasons}`) | F-B2; D1's streak spanning seasons |
| **Season convention** | One helper mapping (sport, season) to its label and date range: NBA uses the end year; NHL, NFL, CFB and EPL the start year (`backfill_player_game_history.py`). Also drop stray All-Star-type team ids | Shared TS helper plus Python equivalent | Mislabeled seasons |
| **Ranks** | Computed across the league's real teams for that season (teams with ≥30% of the max games played), each stat with a declared better/worse direction. Football per game from total / games played. ESPN's published ranks are never used. Neutral stats (fouls, possession share) get no good/bad color | `/api/season-ranks` plus a per-stat direction table | ESPN ranks above the team count (MLB total bases 122nd); CFB red-zone 0% and possession about half a game; fouls shown green |
| **Early-season fallback** | Open on last season when the current one has fewer than MIN_GAMES (NFL/CFB 4, NBA/NHL 15, MLB 20, soccer 6), with the reason stated | Adapter helper | Offseason `0-0 · 0th seed` headers; empty cards in week 1 |
| **Innings pitched** | Carry outs. Display as whole.thirds (6.2) only at render | MLB adapters, Python rollups | Summing 6.2 + 5.1 gives wrong season innings |
| **NBA shot coordinates** | Rim origin at y ≈ 1 ft, not 5.25. A miss's point value comes from the arc, because every miss is stored as 2 | Read time in `/api/nba/shot-profile`, and at ingest in `nba_shots.py` (R5) | Wrong zones; missed threes counted as twos |
| **Source quirks** | Understat match lists come newest-first, so sort before any "last N". A TennisMyLife `tourney_date` is the tournament start, so order by round within an event. ESPN's soccer team schedule needs the fixtures parameter for unplayed games | Each source's module | "Last 5" taken from the wrong end |

**Verify:**
- Run each rule against its G2 fixture: the Dart / Witt / Isbel prop lines,
  KC @ BOS pre-start lines, Raiders 52 games not 69, NBA zone make rates
  against stored point values.
- Add unit tests built from those real rows.

**Done when:** committed with tests. **Stop.**

---

## R3 — Design system foundations ◆ medium

Cards get rebuilt once, in the new system. Specs: `F2-visual-system.md`,
`F2-ux-interaction.md` and the G2 kit (`docs/design/phase-g2/src/system.css`,
`kit.js`, `kit2.js`).

**3a. Tokens** (Tailwind theme and CSS variables):

- **Type ramp:**

  | token | size / line height | weight |
  |---|---|---|
  | `display` | 32/1.1 | 700 |
  | `heading` | 22/1.2 | 600 |
  | `title` | 17/1.3 | 600 |
  | `card-title` | 14/1.3 | 600 |
  | `body` | 14/1.5 | 400 |
  | `body-sm` | 13/1.45 | 400 |
  | `label` | 12/1.35 | 500 |
  | `overline` | 11/1.3 | 600, uppercase |

  - Nothing below 11px outside charts. Chart ticks are 10px.
  - Tabular figures in columns, proportional for big standalone numbers.
- **Color within charcoal:**
  - Text roles: `ink`, `ink-secondary`, `ink-muted`. `ink-muted` is the
    lightest gray allowed for text and passes AA on a card. `ink-faint` is for
    decoration only.
  - `good`/`bad` only for stats with a declared direction.
  - A single-hue ramp for volume and share.
  - Diverging red → neutral gray → green, with no amber.
  - `live-*` only on live elements.
  - Compare colors `#2f6fb3` / `#c56a1c` (validated: worst colorblind ΔE 22.2).
  - No color literals in components; team colors come from team data.
  - Targets: ≤ 8 text colors per page, 0 AA failures.
- **Spacing:** 4 · 8 · 12 · 16 · 24 · 32 · 48.
  - Card padding 16 (12 in dense cards), header row 44.
  - Gutter 16 at phone width, 24 at desktop.
  - Table rows 36 (32 dense).
  - Radius: 12 card, 16 hero, 8 controls.
- **Elevation:** raised (G2 pick), with paper darker than card.
- **Motion:**

  | token | timing |
  |---|---|
  | `instant` | 100ms |
  | `quick` | 180ms |
  | `smooth` | 280ms |
  | `data` | 450ms |
  | `live` | 400ms tween + 1.2s flash |

  Easing: standard `cubic-bezier(0.2,0,0,1)`, emphasized `(0.3,0,0,1)`.
  Reduced motion falls back to fades only.
- **Font:** drop the Plex Mono load.

**3b. Primitives,** one of each, replacing the listed duplicates:

| primitive | replaces |
|---|---|
| `Card` (title, scope, info tooltip, expand, caption, built-in loading/empty/error) | 9 header styles |
| `Section` + `SectionNav` (sticky, IntersectionObserver, a horizontal scroller on phones) | none today |
| `SegmentedToggle` | 12 hand-rolled toggle groups |
| `Tabs` (real `role="tab"`) | button rows styled as tabs |
| `SelectBox` | ad hoc selects |
| `Chip` (tone × size) | `FilterChip`, `GradeChip`, `OddsChip`, `ConfidenceChip` |
| `Tooltip` (reachable by focus and tap) | 97 native `title`s |
| `StatValue` / `StatGrid` (value, unit, rank, percentile, delta, direction) | ad hoc value/rank/bar combinations |
| `RankRow` with a dot strip | today's ranked bars |
| `FactList` | ad hoc label/value lists |
| `DataTable` (sortable, sticky header and first column, numeric alignment, string columns as-is) | hand-built tables |
| `Avatar` (photo, logo or flag; silhouette-on-team-color fallback, never initials; links to its page) | initials circles, crest-as-headshot, blank logos |
| `DrillDownPanel` | navigating away to see detail |
| `StatusPill` | none today |
| `VizLegend` | none today |
| `Skeleton`, `EmptyState` (says why, offers nearest real data), `ErrorState` (human text, retry, keeps cached data) | per-card loading and empty text |

**3c. Charts** (`components/charts/`):
- Every chart renders at its real pixel width (ResizeObserver), never a scaled
  `viewBox`.
- Hover tooltip on every mark.
- Shared crosshair across charts of the same games (`useChartCrosshair`).
- Line and column charts. Column bar width is clamped to
  `max(1, min(24, band − gap))`.
- A dashed reference line for a prop line.
- A zero line where values go negative.
- Sport-native surfaces from `viz-sport.js`, chosen by an adapter field (D4's
  `surface`), never `sport === 'x'`:

  | surface | used for |
  |---|---|
  | `zone` | MLB zone map, spray |
  | `field` | NFL/CFB target field, drive field |
  | `halfCourt` | NBA |
  | `rink` | NHL |
  | `pitch` | soccer |
  | `green` / hole views | golf |

- `HeatGrid`'s hardcoded `aspect="zone"` goes.

**3d. Page-level UX:**
- One visible focus ring (2px, offset).
- Every name, photo and logo is a real `<Link>`.
- State lives in the URL: section, scope, market, game state, compare target.
- Breadcrumb back that names its destination.
- Breakpoints 400 / 768 / 1024 / 1440.
- Nothing wider than the viewport. Tables scroll inside their card, and the
  games strip scrolls inside its own container.

**Verify:**
- Build the primitives on one real card each on an existing page.
- Check contrast, focus and 400px on it.
- Screenshot beside the G2 kit.

**Done when:** committed. **Stop.**

---

## R4 — Parsers for feeds already fetched, and two new endpoints ◆ medium

The app downloads these and discards most of it. TypeScript parses request-time
game payloads. Finished games are cached through `cachedRoute()` with a long TTL
once final. Live routes keep their documented no-cache contract.

| source (already called) | fields to parse | feeds cards | where |
|---|---|---|---|
| ESPN game summary | `winprobability` (per play) | Win probability with biggest swings (NFL, CFB, NBA) | `footballLiveGame.ts`, `nba/liveGame.ts` |
| ESPN game summary | `drives.previous/current` (yard lines, down, distance, result) | Drive chart and selected-drive field (NFL/CFB) | `footballLiveGame.ts` |
| ESPN game summary | `plays` with coordinates | NBA lead tracker, scoring runs, two-team shot chart (check coordinates against R2's origin), play log | `nba/liveGame.ts` |
| ESPN game summary | `pickcenter` | Lines open → close; result vs line (NFL, CFB, NBA, NHL, soccer, including the soccer draw where present) | shared summary parser |
| ESPN game summary | `rosters` (formations), `commentary` (pitch positions), `lastFiveGames` | Soccer lineups, shot map, commentary, form | `soccer/liveGame.ts` |
| ESPN game summary | `seasonseries` | Season series (NBA, NHL) | shared summary parser |
| ESPN game summary | `injuries` | Injuries (NFL already calls the injuries endpoint; others from the summary), labeled with the report's fetch time | shared summary parser |
| MLB statsapi live feed | `plays[].playEvents[].pitchData` (location, velocity, type), `hitData` (distance, exit velocity, launch angle, coordinates) | Spray chart with distance, at-bat explorer, pitch mix per pitcher, last pitch/batted ball on live | `lib/sports/mlb/statsapi.ts` |
| MLB statsapi, **new endpoint** | `/game/{pk}/winProbability` | MLB win probability by plate appearance | `statsapi.ts` |
| NHL api-web | play-by-play shot coordinates for a live or unstored game | NHL shot-attempt flow, full-rink map | `nhl/liveGame.ts` (stored games come from `nhl_shot_events`) |
| NHL api-web, **new endpoint** | `/v1/player/{id}/landing` | Official NHL season totals (skater and goalie) | `lib/sports/nhl/nhle.ts` |
| TennisMyLife CSV | serve and return columns, break points, minutes, ranks | Tennis tiles, serve/return by match, ranking, match stats, serve vs return pre-match, form, fatigue | `lib/sports/tennis/tennismylife.ts` (parses only aces and surface today) |
| ESPN team schedule | `curatedRank` | CFB ranked opponents | `teamSportEspn.ts` |

**Not parsed, by decision:** ESPN core team-statistics API (not called today).
`/api/season-ranks`, nflverse team stats, MLB team hitting/pitching and
`*/teamDefenseAllowed.ts` cover team ranks.

**Verify:** the parsed output for each G2 game (Appendix B ids) matches the
mockup dataset field by field.

**Done when:** committed. **Stop.**

---

## R5 — Python rollups and ingest ◆ large

Python writes, TypeScript renders.
- Each new table gets a migration and its `docs/table-ownership.md` row.
- A `JOB_REGISTRY` entry where it runs on a schedule, and `withJobLock`.
- A direct-read route (pattern 2) or `cachedRoute()`.
- **Every deploy asks first.** Check pooler load before backfills.

**5a. Statcast corpus rollups.**
- `mlb_pitch_events` is a 5-day hot window. Full seasons are in the Parquet
  corpus, reachable only from Python (`corpus_reads.union_view`).
- Rollups, per season, with an as-of date so pre-game cards are cut at the game:

  | rollup | cards |
  |---|---|
  | Hitter: power profile (max and p90 EV, hard-hit, barrel-style rates as league percentiles among qualified hitters), EV distribution, EV by game, results by pitch type, zone map, vs LHP/RHP, HR list | "Contact quality & approach" |
  | Pitcher: arsenal (usage, velocity, results by pitch), pitch locations, "where he pitches", fastball velocity by start, vs LHH/RHH | "Arsenal & command" |
  | Team, pitch-weighted: contact and pitch quality percentiles | Team "Contact & pitch quality". Replaces `teamStatcast.ts`'s per-player average |
  | Team staff vs RHH/LHH, lineup vs RHP/LHP (handedness from `stand` / `p_throws`) | Compare cards, MLB starters card |
  | Starters before a game: season line, last starts, pitch mix; lineup vs the starter's hand, with head-to-head | Game "before start" |

- **The corpus has no team column.** Joining through `player_game_history`
  matched 79% of 2026 pitches. Measure and fix the join (roster by date) before
  the team rollups.
- **Keep hit distance at ingest.** `hit_distance_sc` / `totalDistance` is in
  neither the corpus nor any table. Add it to corpus writes and
  `mlb_pitch_events` so the season HR list has distances. The live feed covers
  today's game (R4).

**5b. Strength rollups** (from `player_game_history`, where `/api/season-ranks`
already computes for and allowed):
- Add a date cutoff (as of kickoff) for "before start".
- Add position grouping for "allowed to the position":
  - NFL positions from nflverse `players.csv`;
  - NBA, NHL and soccer positions from ESPN rosters.
- Measure whether `player_game_history` already carries position before adding
  a column.
- Production score for key players and roster production. **Not games played**:
  that surfaced punters.
- One rollup per (sport, season, team, side, position), so a page reads a
  handful of rows rather than a league's game logs.

**5c. Shot ingest.**
- Extend `nba_shots.py` and `nhl_shots.py` to 2025-26. Both tables hold 2024-25
  only while game logs reach 2025-26.
- Apply R2's NBA origin and miss-value correction at ingest, and backfill
  2024-25.
- Team views use the regular season only, with ≥ 40 games.

**5d. NFL defensive target view.**
- A defense-side read of `nfl_target_events`: where each defense is thrown at,
  by receiver position.
- The defense is derived from the game id plus the offense.

**5e. Prop odds ingest (routed from R2, 2026-09-14).** Both are writer
problems, and R2's main line (`lib/odds/props/mainLine.ts`) can only work
around them on read:
- **Yes/no `other` rows disagree in direction across books.** WTA 183796,
  Stephens to-win-a-set: DraftKings +650 and FanDuel −1450 at the same
  pre-start moment, so one book's `other` is the opposite selection. Find where
  the SharpAPI selection is mapped (`db.write_prop_odds` canonicalises side to
  `other`) and carry which selection it is, per book. Measure how many
  yes/no keys disagree before and after.
- **`prop_odds` keeps rungs a book stopped quoting.** It is an upsert that never
  deletes, so a line pulled hours ago still reads as current (WTA 183791: a
  12:19 DraftKings row beside 19:18 FanDuel rows). On each provider fetch,
  mark or delete that provider's rows for the same (game, subject, market) that
  the fetch did not return. `prop_odds_history` keeps the record. Then R2's
  "last quote per book" needs no staleness guess.

**Verify:**
- Rollup values match the G2 datasets (Witt 390 balls in play and 18 HR in the
  G-board; Skenes arsenal; Royals team Statcast).
- Row counts are recorded.
- Job run logs are clean.

**Done when:** committed and, with approval, deployed. **Stop.**

---

## R6 — Player page rebuild ◆ large, one sub-phase per sport

Spec: `docs/design/phase-g2/src/player.html`, `src/sports/common.js` (skeleton),
`mlb.js`, `football.js`, `hoops-hockey.js`, `soccer-tennis-golf.js`.

**Skeleton, every sport,** in `PlayerDetail` via adapters:
1. Hero: photo, position, team, jersey, age, injury status, links to team and
   next/last game. The page **always renders the player**, even with no market
   (7 of 22 captured pages were blank).
2. **Prop analysis:** the kept block, reading R2's main line. The season in
   scope is labeled, tiles without a sample are hidden, and it opens on recent
   games. Its "vs" chip opens on the compared team when one is set (R9).
3. *(R9: compare sections insert here.)*
4. **Season by season:** multi-season `player_game_history` (Gap 1: the table
   holds 2–4 seasons, pages read one), with the R2 season helper.
5. **Trends:** any stat over time, rolling average, scope toggles, crosshair.
6. **Splits:** home/away, W/L (from R2's `game_result` read), opponent, month.
7. The sport's own sections (table below).
8. **Game log:** every stat, grouped by season, rows linking to the game.
9. **Odds & prices:** best price, books and movement, from `prop_odds`.
10. **Sources:** the data behind the page and its as-of time.

**Sport sections:**

| sport | sections and cards (G2) | sources and tables | built in |
|---|---|---|---|
| MLB hitter | Contact quality & approach: Power profile · EV distribution · EV by game · Results by pitch type · Strike zone · vs LHP/RHP · Home runs (with distance) | corpus rollups (5a); distance (5a ingest) | R5 |
| MLB pitcher | Arsenal & command: Arsenal · Pitch locations · Where he pitches · Fastball velocity by start · vs LHH/RHH. Game log per start (F-B4) | corpus rollups; `player_game_history` (IP as outs) | R5, R2 |
| NFL WR/TE/RB | Usage & depth: Target chart on a half-field · depth by season | `nfl_target_events` via `/api/nfl/target-map` | Read |
| NFL QB | Where he throws: Pass chart | `nfl_target_events` | Read |
| CFB QB | Efficiency: Advanced passing, shown as **Not held** | — | status |
| NBA | Shot profile: Shot chart by zone | `nba_shot_events` via `/api/nba/shot-profile` (R2 correction; 2025-26 after 5c) | R2, R5 |
| NHL skater | Shot map & official totals | `nhl_shot_events`; NHL player landing | R4, R5 |
| NHL goalie | Shots faced map & official totals | same | R4, R5 |
| Soccer FW/MID | Chances & finishing: Shot map · Goals vs xG · Per 90 by season | Understat per player (cached in `snapshot_cache`); `player_game_history` | Read |
| Soccer GK | Shot-stopping: Beyond saves | `player_game_history` | Read |
| Tennis | Surface & serve: By surface (today's surface marked, C7) · Ranking · Serve and return by match | TennisMyLife (R4); current event's surface from `tennis/schedule.ts`, never the last match's | R4 |
| Golf | Scoring: Rounds · Scoring by par. Shot profile: Driving distance · Approach proximity · Putting · Make % by first-putt distance | `golf_round_scores`, `golf_hole_scores`, `golf_shot_events`, `golf_tournaments` (names); `/api/golf/shot-profile` | Read; verification held until a tournament |

**Also in R6:**
- **C8** soccer default market by position (decision 4). Order both priced and
  synthetic candidates by `subjectMeta.position`.
- **C4** live card on every in-season player page, as a sport-neutral slot:
  - game state for every sport;
  - "your lines so far" from the live box score for NBA, NHL, NFL and CFB;
  - MLB count, bases, batter and pitcher as a named presence-checked field;
  - soccer and tennis get score and state only (decision 5).
  - Live hooks run unconditionally, `enabled` per sport.
  - Fix the stale comment at `PlayerDetail.tsx:1601`.
- **D2 and D3:** replace "Game context" and "Where this sits"; their content
  moves into Seasons, Trends and Splits. Delete `toGameContext`,
  `toWhereThisSits` and any `DensityCurve` use left without a caller.
- **D4:** the spatial role draws on the adapter's surface (R3c), single-hue for
  share.
- Delete every card this replaces, in the same sub-phase.

**Sub-phase order:**
1. MLB, while the season is live.
2. NFL and CFB (CFB after R1f).
3. Soccer.
4. Tennis.
5. NBA and NHL, built now and render-verified in October.
6. Golf, built and verified at the next tournament.

**Also in R6 (routed from R2, 2026-09-14):**
- **MLB props read R2's main line.** `lib/sports/mlb/adapter.ts` (~1466) uses
  fixed lines (pitcher strikeouts 4.5, total bases 1.5) and never picks one
  from `prop_odds`, so an MLB prop block can sit on a line no book posted.
  Move MLB onto `candidateLine()`. Check first what `mlb_prop_model_cache` is
  keyed on, since the model probability must be for the same line.
- **The line movement card pins to R2's main line**, not
  `lineHistory.ts`'s `pinLine` modal line (most observations, which on a ladder
  is not the main line). One rule for "the line" on the page.
- **The price chip on a started game.** `liveEdge.resolveCandidateEdge` reads
  current `prop_odds` rows, so after the start it can show an in-play price
  beside a pre-game line. Label it or hold the pre-game price.
- **`soccer:snapshot:epl` cannot write its cache**: the payload is 22 MB
  against a 2-minute `statement_timeout`, so it rebuilds on every request and
  discards the result. Per-section loading is the fix; confirm the write
  succeeds once soccer's page is rebuilt.

**Also in R6 (routed from R5, 2026-09-14):**
- **`/api/mlb/pitch-profile` goes with the cards it feeds.** R5 repointed it at
  the rollup's `profile` block to fix R5-F3; the rebuilt MLB sections read
  `/api/mlb/statcast/player/[playerId]`, which carries that block and the rest.
  Delete the route, `useMlbPitchProfile` and `pitchProfile.ts` when the old
  pitch-mix/zone roles are replaced.

**Also in R6.4 (routed from R6.1a, 2026-09-15):**
- **Tournament level (majors) from TennisMyLife, not `is_major`** (R6-F3).
  Fixing `is_major` itself is a Python change to
  `backfill_player_game_history.py:854` plus a re-run, for the model track.
- **Tennis opponent names:** 13-17 of Alcaraz's and Zverev's opponents have no
  `athlete_crosswalk` name and show "—" in the game log.

**Also in R6 (routed from R4, 2026-09-14):**
- **Tennis history says how current it is.** TennisMyLife's 2026 ATP archive
  ended at Winston-Salem (starting 2026-08-30) on 2026-09-14, a day after the US
  Open final: the latest slam is missing, and form, fatigue and serve/return
  tiles would read as current without it. Show the archive's last match date
  beside those tiles, and fill matches after it from ESPN results where the
  card needs them.

**R6 Step 0 premise audit (2026-09-15) — corrections, and two operator decisions:**
- **The player is the page, not the market (operator, 2026-09-15).** All eight
  player routes (`app/*/player/[playerId]/page.tsx`) rendered only "No tracked
  markets for this player on today's slate" without a candidate: on
  2026-09-15 that blanked 8 of the 10 G2 subjects at both widths (Skubal,
  Chase, Allen, Manning, SGA, MacKinnon, Cunha, Alcaraz). R6.1a makes every
  route start from the player: `PlayerDetail` takes zero candidates, a bio
  source per sport, and the shared sections render for **every sport** in
  R6.1a, not one sport per sub-phase. The sport sections stay per sub-phase.
- **No route read a player's history across seasons.** R6.1a adds a direct
  read of `player_game_history`. Id spaces differ by sport (NHL uses NHL ids).
  MLB's "show all games" read `mlb:full-raw:<date>` blobs (79/78/52 MB, the
  Phase 5 growth rows) through `/api/mlb/player-gamelog`; once the game log
  reads the table, that route and the full-raw stash are deleted (R6.1d).
- **MLB fixed lines are load-bearing (operator decision, 2026-09-15).**
  `predict/mlb_board_lines.py`'s `BOARD_LINES` is the line the served model
  probability, its calibration and grading all use, and `adapter.ts` builds
  the one snapshot Scan also reads. So the player page's prop block takes
  `candidateLine()` for its line, hit rates and price; the model percentage
  shows only when the cached row's line equals the line on screen, otherwise
  it is labelled with its own line ("model at 1.5"). Scan and the model keep
  the board lines. The table is `prop_model_cache` (renamed from
  `mlb_prop_model_cache`); the line is a column, not part of the key.
- **D2/D3 are shared.** `toGameContext`/`toWhereThisSits` are built by
  `buildAnalyticsRoles` for all eight player adapters AND rendered by
  `TeamDetail` (`teamRoles.ts`) and `GameDetail` (`gameTeamForm.ts`). R6 drops
  them from each sport's player page; deleting the functions and
  `DensityCurve` moves to R7/R8.
- **Pitch profile has two callers on the page:** the player and tonight's
  opposing starter (matchup card). Both move to
  `/api/mlb/statcast/player/[playerId]` before the route goes. Keep
  `pitchProfileShapes.ts` (imported by `statcastRollupShapes.ts` and
  `pitchRoles.ts`).
- **`soccer:snapshot:epl` writes intermittently, not never:** 23.1 MB raw,
  3.7 MB stored, last written 00:08 UTC 2026-09-15. R6.3's check is "writes on
  every rebuild over a day".
- **C4 is half there:** `LiveLineTrackerCard` (tracked lines with live values)
  already runs for MLB, NFL, CFB, NBA and NHL. What is MLB-only is the game
  state (score, count, bases). C4 is a sport-neutral game-state slot.
- **Fixtures:** G2 holds Statcast only for Witt and Skubal, Understat only for
  Haaland. Contact/arsenal parity checks use Witt and Skubal, chances and
  finishing uses Haaland; Judge and Cunha verify the shared sections.
  `mlb_statcast_player_season` holds 2025 and 2026.
- **Order inside R6.1:** 6.1a shared (player-first entry, history route,
  skeleton, Seasons/Trends/Splits/Game log for every sport) · 6.1b MLB hitter ·
  6.1c MLB pitcher · 6.1d routed items and deletions.

**Verify, per sport:**
- Render the G2 subjects: Judge 592450, Skenes 694973, Chase 4362628, Allen
  3918298, Manning 4870906, SGA 4278073, Wembanyama 5104157, MacKinnon 8477492,
  Vasilevskiy 8476883, Cunha 259902, Lammens 301425, Alcaraz 3782.
- Plus one player with no market, one injured player and one early-season
  player.
- 1440/400px; numbers match the dataset.

**Stop after each sport.**

---

## R7 — Team page rebuild ◆ medium–large

Spec: `docs/design/phase-g2/src/team.html`, `src/sports/team-common.js`,
`team-sports.js`.

**Skeleton:**
1. Hero with R1b's record and standing: W-L / W-D-L / W-L-OTL, standing only
   for the current season, next game.
2. One season switch scoping the page. It opens on last season when the current
   one is under MIN_GAMES and says so.
3. **Results & schedule:** results with scores by season (R2 read), margins,
   home/away splits, schedule.
4. **Standings:**
   - ESPN for NFL, CFB, NBA and soccer;
   - MLB Stats API for MLB;
   - NHL `standings/now` (current season only).
5. **Team stats:** ranked across the league with a dot strip, direction-aware,
   per game for football, invariant stats dropped. CFB possession is excluded.
   Sources: `/api/season-ranks` for and allowed, nflverse team stats, MLB team
   hitting/pitching. This also covers B4 (NBA/NHL team payloads had no team
   stats).
6. **Roster production:** `player_game_history`, ranked by production score,
   with photos and links.
7. **Sources.**

**Sport sections:**

| sport | card | source | built in |
|---|---|---|---|
| MLB | Contact & pitch quality percentiles | corpus team rollup (5a) | R5 |
| NFL | Passing game: target share and throw map vs league | `nfl_target_events` | Read |
| CFB | Ranked opponents | ESPN schedule `curatedRank` | R4 |
| NBA | Shot profile vs league | `nba_shot_events` by `team_id` (R2 correction, regular season, ≥40 games) | R2, R5 |
| NHL | Shot map for / against | `nhl_shot_events` by `team_id` | Read |
| Soccer | W-D-L throughout; team totals ranked | `player_game_history`, `/api/season-ranks` | R2 |
| Tennis, golf | No team page; the route explains why | — | — |

**Also in R7 (routed from R2, 2026-09-14):**
- **Team pages fire MLB hooks for every sport.** `/nfl/team/13` and
  `/nba/team/13` request `/api/mlb/team-form?teamId=13` and `/api/mlb/team/13`,
  which 400. The rebuild's hooks must idle for other sports (pass `undefined`,
  per the adapter convention in `CLAUDE.md`), and verification checks the
  network tab, not only the render.
- **`/api/mlb/team/110` served a 28-day-old payload**, found by R2's staleness
  ceiling: its `build()` has been failing for weeks. Find why before the MLB
  team page is rebuilt on top of it.

**Delete:**
- line picker and 25-game win bars (F-B3);
- duplicate "Next game" cards;
- "Unit grades" where Phase F said remove.

**Verify:**
- Royals, Raiders, Ohio State, Lakers, Maple Leafs, Man City against the
  datasets.
- One offseason team (NBA or NHL) for the fallback.
- 1440/400px.

**Stop.**

---

## R8 — Game page rebuild with three states ◆ large

Spec: `docs/design/phase-g2/src/game.html`, `common-game.js`,
`game-football.js`, `game-hoops-hockey.js`, `game-mlb.js`,
`game-soccer-tennis.js`, `game-states.js`. State comes from the game's real
status. `?state=` is only for review.

**Also in R8 (routed from R6.1a, 2026-09-15):**
- **Turn on the player game-log links for MLB and NFL** once past games
  resolve: `gameHref` in `lib/sports/mlb/adapters/playerResearchSpec.ts` and
  `lib/sports/nfl/adapters/playerResearchSpec.ts` return `null` today because
  `/mlb/game/[id]` covers only today's slate and `/nfl/game/[id]` does not find
  last week's game.
- **MLB records and results must not come from `game_result` by date (R6-F5).**
  Use StatsAPI's schedule by pk (`getTeamSeasonFinals` in `statsapi.ts`), as
  the player page now does.

**Page rules:**
- One header. The live panel no longer repeats the hero (D1).
- Past games resolve (R1d).
- A final game never shows a live loading state (F-B10).
- During a live game the page opens on "Right now"; after the final whistle, on
  the recap.

### Before start (research as of kickoff)

| card | sports | source | built in |
|---|---|---|---|
| Header: start time, venue, weather, records entering, closing-line chips | all | ESPN summary / MLB feed; `game_result` | Read, R2 |
| **Strength vs strength:** one side's production against what the other allows, with league ranks | team sports | strength rollups with date cutoff (5b) | R5 |
| Form coming in; head-to-head | all | `game_result` read (R2); tennis head-to-head from TennisMyLife | R2 |
| Player props research: line, each player's last 10 (sparkline), history vs this opponent, injury flag, drill-down | NFL, CFB, MLB, NBA, soccer | `prop_odds` (main line), `player_game_history`, summary injuries | R2, R4 |
| Players to watch: season and vs-opponent averages, with an early-season fallback | NBA, NHL, soccer | `player_game_history` | Read |
| Injuries, starters first, with status and detail, labeled "report as of" | NFL (endpoint), others where the summary has them | ESPN | R4 |
| Passing matchup: where each offense throws vs where the other defense is thrown at | NFL | `nfl_target_events` plus the 5d defense view | R5 |
| Shot zones: one team's shots vs zones the other allows | NBA | `nba_shot_events` | R2, R5 |
| Starters: season line, last starts, pitch mix; lineup vs the starter's hand, with head-to-head | MLB | corpus rollup (5a) | R5 |
| Goalie form | NHL | `player_game_history` | Read |
| Lineups | soccer | summary `rosters` | R4 |
| Serve vs return, form before this round | tennis | TennisMyLife | R4 |
| Lines: pre-game lines and movement | all with odds | `game_odds_history` before the start (R2); `pickcenter` | R2, R4 |

### Live

| card | source | built in |
|---|---|---|
| **Right now:** live header with score, clock or period, possession, win probability and its trend; the sport's graphic (NFL/CFB field and drive; MLB diamond, count, last pitch and batted ball; NBA lead and current run; NHL shot map by period; soccer timeline; tennis set and game score) | existing live routes plus R4 parsers | R4 |
| **Props tracker:** each tracked player's stat so far against the line | live box score (`footballLiveGame.ts`, `nba/liveGame.ts`, `nhl/liveGame.ts`); MLB plate appearances | Read |
| **In-game odds** up to now | `game_odds_history` after the start (R2 split) | R2 |
| The final page's sections, up to now | same parsers | R4 |

Live values tween and flash on change (`live` token); a scoring play gets a
one-time highlight.

### Final (recap, kickoff research kept)

| section | NFL/CFB | NBA | NHL | MLB | soccer | tennis |
|---|---|---|---|---|---|---|
| Flow | WP + biggest swings, drive chart + selected-drive field | WP, lead tracker, scoring runs | Shot-attempt flow (no WP is published) | WP by PA (new endpoint) | Match timeline (`keyEvents`) | — |
| Sport detail | Scoring & leaders | Two-team shot chart; season series | Full-rink shot map; goaltending; penalties; season series | Batted balls (spray with distance); at-bat explorer (every pitch located); pitching (mix per pitcher) | Shot map; lineups and formations | Match stats; form vs season averages; head-to-head |
| Team stats, box score | Read | Read | Read (NHL boxscore) | Read | Read | — |
| Lines & props | open → close (`pickcenter`), result vs line, **props vs results** (main line vs box) | same | lines | last pre-game quote, run line and total (`game_odds_history` pre-start), props vs results | three-way with the draw, props vs results | lines; point-by-point shown as **Not held** |
| Play-by-play | plays by drive | play log | play log | play-by-play | commentary | — |
| **Before the game** | the before-start sections, kept | same | same | same | same | the kickoff section |

**Also in R8:** B8 (CFB game detail had no pregame line) is covered by the
summary `pickcenter` parse.

**Verify:**
- The seven G2 games (Appendix B) in all three states.
- The live state on a real in-progress game per in-season sport: NFL and CFB on
  a weekend; MLB **before the regular season ends**; soccer on a matchday;
  tennis during an event. NBA and NHL are marked unverified until October.
- Edge cases: no odds, postponed, doubleheader, OT/shootout, extra innings,
  retirement.

**Stop after each sport group:**
1. football;
2. MLB;
3. soccer and tennis;
4. NBA and NHL.

---

## R9 — Compare control ◆ medium

Spec: `docs/design/phase-g2/src/sports/compare.js` and the compare bars in
`player.html` / `team.html`. State in the URL (`vs`, `peer`). Compare sections
sit right after the prop analysis block on the player page and first on the team
page.

| compare | cards | source | built in |
|---|---|---|---|
| Player vs a team (defaults to the next opponent if in the league's team list, else the last opponent) | Games against them; averages vs season (with season fallback); **what this team allows to the position** (per game, league rank); the prop block's vs chip opens on that team | `player_game_history`; positions (5b) | R5 |
| — NFL | Defense thrown-at map vs the player's targets | `nfl_target_events` (5d), nflverse positions | R5 |
| — NBA | Player's zones vs zones allowed to the position | `nba_shot_events` + roster positions | R5 |
| — MLB | Opponent staff vs the hitter's hand; lineup vs the pitcher's hand | corpus (5a) | R5 |
| Player vs a same-position player | Season side by side; trend overlay in compare colors | `player_game_history` | Read |
| Tennis vs any player | Serve/return profiles; head-to-head | TennisMyLife | R4 |
| Golf vs the field | Round by round | golf tables | Read |
| Team vs team | Strength vs strength, head-to-head, form, key players; MLB hand cards | 5b rollups, `game_result` (R2), corpus | R5 |

- **Player picker:** replaces the fixed peer list, filtered to position, with
  search.
- **Delete:** `MatchupExplorerCard` and the `matchupExplorer` field (R1h's floor
  goes with it).

**Verify:** the G2 compare URLs (default opponent, a chosen team, a peer) for
each sport, against `data/matchup-<sport>.json`. **Stop.**

---

## R10 — Port-artifact cleanup ◆ small–medium

After R6–R9, so nothing is renamed twice. Fields the rebuilds already deleted
drop out of this list.

- **C1:** `hitterStats` + `nflSeasonStats` → `seasonStats`, if either survives.
- **C2:** optional fields instead of explicit `null` lines on `PlayerDetailData`.
- **C6:** MLB hero `pregameLines`. Check whether leaving it undefined is
  deliberate; close as *fits* if so.
- **B3:** games strip `firstPitch` → `startTime`, every sport.
- **Docs:**
  - `CLAUDE.md` §4 examples: use the surface field and C1 as worked examples.
  - `seasonAggregates.ts`'s "2.75M rows" → ~0.77M.

**Verify:** `tsc`, then render one player, team and game page per sport. A
rename that type-checks can still drop a card. **Stop.**

---

## R11 — Deep history on team and game pages ◆ large, design first

Builds on R2's `game_result` read, which covers the recent seasons the
rebuilt pages use.

1. **Measure:**
   - team-id fill rate per sport and decade (old raw names like "St. Louis
     Rams");
   - duplicates across sources;
   - rows per team;
   - what `team_elo_history` already gives.
2. **Design doc for approval:**
   - all-time and last-N records;
   - head-to-head across decades;
   - venue splits;
   - identity through entity resolution;
   - `(sport, home_team_id)` / `(sport, away_team_id)` indexes: a migration on
     a Python-owned table, with its `table-ownership.md` reasoning;
   - `cachedRoute()` with a day TTL.
3. **Build** in the design's sub-phases. **Stop** between them.

---

## R-deferred — not in this build

| item | unblocks when |
|---|---|
| Golf card audit and tournament view | a live tournament |
| NBA/NHL render verification (R6–R8 live and current season) | October |
| C3: fitted models for six sports | its own program (`master-plan-2026-09-06.md`) |
| `docs/table-ownership.md` full re-derivation (51 tables vs 36 documented) | its own task. R5 adds rows for its own tables |
| B8: NFL player id-mapping warnings | follow-up list |
| Dark mode shipped | tokens support it after R3; a product call later |
| Injury report captured at kickoff (so a final page shows the report as of kickoff) | a Python capture job; until then the "report as of" label |
| **Slate research views (G6)** | a product decision. Data needs: longest HR (distance kept in R5; park orientation and wind vs field **not held**); anytime TD (red-zone targets and carries need play-by-play, **dropped**); NBA pace-up (derivable); goalie and shots (confirmed starters **not held**); anytime goalscorer (xG per player across a matchday, stored only per player page); aces (TennisMyLife serve stats, R4) |
| **Not held, no current source** | NFL snap share and routes, EPA per play (play-by-play not kept); MLB confirmed lineups, bat speed and swing length, spin and movement; NHL confirmed starting goalies, PP/SH TOI; NBA on/off and lineups; CFB advanced (CFBD not ingested); soccer tackles and passes, probable lineups; NHL and soccer win probability; tennis point-by-point |
| Egress and payload review for rollup routes | measured in R5/R6 verification; its own task if a page exceeds budget |

---

## Measurement traps (apply to every verification)

- A payload's `fetchedAt` isn't the cache write time; `snapshot_cache.fetched_at`
  is.
- A cache can rebuild mid-check. Re-fetch before writing a number down.
- A type-check doesn't prove a card renders. Render it.
- Check the calendar, **including the weekday**, before judging an empty card
  (B1b's Sunday).
- API limiter: pace page captures, and watch for "Limit is 60 per 60s" until R1e.
- No `#` fragment in phone-width capture URLs (rendered zero cards).
- Loading shells look settled. Wait for real cards.
- **The G2 datasets' results (`result`, `pf`, `pa`) are wrong on back-to-backs
  and series**: joined by team name within a day. Referee scores against the
  league (StatsAPI, api-web), never against G2 (found in R6.1a).
- **Data traps found building G2:**
  - `prop_odds` keeps capturing for up to two days after a game, and files
    alternate ladders under the main key;
  - `game_odds_history` keeps storing after the start;
  - `game_result` has cross-source duplicates dated a day apart;
  - seasons follow each upstream's convention;
  - IP is whole.thirds;
  - ESPN ranks exceed team counts;
  - Understat lists come newest-first;
  - TennisMyLife dates are tournament starts;
  - golf lie codes aren't decoded;
  - the Statcast corpus has no team column;
  - All-Star-type team ids appear in game logs.
- ESPN returns 403 to custom User-Agents from scripts; use a browser UA for
  one-off checks.

---

## Appendix A — Correctness bug ledger

| bug | where | fixed in |
|---|---|---|
| B2 men on WTA | tennis slate | R1a |
| B6 team header | team pages | R1b → R7 hero |
| C10 spelling | 3 adapters | R1c |
| B5 dead game links; past-game pages; Python UTC | NFL/MLB game pages, worker | R1d (TS part fixed 2026-09-14) |
| D5 shared 60/min bucket, raw API text | `proxy.ts` | R1e, R3 `ErrorState` |
| B1 CFB blank player pages | CFB | R1f |
| C9 biggest edge without a floor | `MatchupExplorerCard` | R1h, deleted R9 |
| C8 soccer default market | soccer adapter | R6 |
| C7 tennis surface | tennis adapter | R6 |
| C4 live card MLB-only | `PlayerDetail` | slot built and MLB filled in R6.1d (`GameStateSlot`); NFL and CFB filled in R6.2 (`footballGameState.ts`, render owed Thursday); soccer, tennis, NBA and NHL in their sub-phases |
| D1 duplicate score, broken logos, initials, streak across seasons | NFL game | R3 `Avatar`, R2 read, R8 |
| D2 "Game context" | `analyticsRoles.ts:359` | R6 (removed) |
| D3 "Where this sits" | `analyticsRoles.ts:313` | R6 (removed) |
| D4 strike zone for every sport | `HeatGrid` `aspect="zone"` | R3c surfaces, R6 |
| F-B1 mirrored allowed ranks | NFL/NBA/soccer/tennis game | R1g |
| F-B2 duplicate games in records | `game_result` | R2 |
| F-B3 seasons out of order | NFL team chart | R7 (R1 if R7 is far) |
| F-B4 pitcher game log empty | MLB | **resolved** R6.1a/R6.1c (shared game log from `player_game_history`; Yamamoto verified with a market) |
| F-B5 integer-rounded rates | MLB game/team | R1g |
| F-B6 raw floats | soccer player | R1g |
| F-B7 rank pools | soccer | R1g, R2 ranks |
| F-B8 draws as losses | soccer game | R1g |
| F-B9 next-game moneylines | soccer team | R1g |
| F-B10 stuck live loading on final | CFB/NHL game | R1g, R8 |
| F-B11 OT losses dropped | NHL team | R1b/R1g |
| F-B12 aces line pairing | tennis player | R1g |
| F-B13 multi-season record label | tennis game | R1g |
| G2 prop main line | `prop_odds` reads | R2 |
| G2 post-start odds in history | `game_odds_history` reads | R2 |
| G2 NBA rim origin and miss value | `nba_shot_events` | R2, R5c |
| G2 IP summed as decimals | MLB | R2 |
| G2 ESPN ranks unusable | team ranks | R2 |
| R2-F1 NFL prop prices 19h old on game day | worker game-day tier | **resolved** `4b4c5c5` (stale rungs on read) + `2228a3d` (per-sport provider clock, deployed) |
| R3-F1 NFL matchup "17th of 32" overlapping its label | `StatRankRow` | **resolved** `f7dbd4f`/`9fbb74e` (renders `RankRow`) |
| R3-F2 801 hand-typed `text-[Npx]` sizes, whole-page AA failures (1.8-12%) and 12-38 text colors per page | legacy cards | R6-R8 (each card rebuilt on the primitives) |
| R2-F2 yes/no `other` direction disagrees across books | `prop_odds` writer | R5e |
| R2-F3 stale rungs never removed | `prop_odds` writer | R5e |
| R2-F4 MLB props on fixed lines, not the main line | MLB adapter | **resolved** R6.1d on the player page (`repriceAtMainLine`); Scan and the model keep board lines by decision |
| R2-F5 line movement pinned to modal, not main line | `lineHistory.ts` | **resolved** R6.1d (pinned to the line on screen) |
| R2-F6 in-play price beside pre-game line | `liveEdge.ts` | **resolved** R6.1d on the player page (pre-game rows after the start); game page is R6-F10 |
| R2-F7 MLB hooks fire on other sports' team pages | `TeamDetail` | R7 |
| R2-F8 `/api/mlb/team/110` 28-day-old payload | MLB team route | R7 |
| R2-F9 `soccer:snapshot:epl` 22 MB cannot write its cache | soccer snapshot | R6 (per-section loading) |
| R2-F10 Scan pages overflow at 400px | Scan | **no R-phase** — Scan is out of scope; parked in `docs/CURRENT.md` |
| R2-F11 huge old `snapshot_cache` rows | database | **model track Phase 5** (database growth), `docs/CURRENT.md` |
| R4-F1 TennisMyLife archive lags ~2 weeks (no US Open on 2026-09-14) | tennis history | R6 tennis (show the archive's last date; ESPN results after it) |
| R5-F1 MLB and tennis `player_game_history` stopped 2026-08-28 (hand backfill, never scheduled); MLB board projected without those games | `genericPlayerHistoryFreshnessJob` | **resolved** `3867f60`, deployed `dep-dakbn4tg1s2s73bor350` |
| R5-F2 pitch corpus duplicating: prune froze pitches inside the 3-day ingest window, so they came back under new ids (13,298 duplicate rows) | `corpus_store` freeze rule, `prune_corpus` | **resolved** `a706141` (new exports); the existing duplicate rows stay in the corpus files, readers dedupe by pitch. Rewriting the files is a model track Phase 5 decision |
| R5-F3 MLB player page pitch mix, platoon and strike zone were the last ~5 days labelled as the season | `getPitchProfile` on a pruned `mlb_pitch_events` | **resolved** in R5a (reads `mlb_statcast_player_season`); route deleted with its cards in R6 |
| R5-F4 scheduled `mlb_pitch_events` prune crashed on `captured_at` after R5-F2's margin | `prune_corpus` floor publish | **resolved** `706a874` |
| R5-F5 worker OOM-killed 4-9 times an hour since 2026-09-11 ~22:00 UTC | Render worker, 512 MB | **model track Phase 5** (worker RAM), `docs/CURRENT.md` |
| R5 NBA misses all stored as twos; NHL shots mixed preseason and playoffs | shot ingest | **resolved** in R5c (ingest and stored rows) |
| R6-F1 every player page blank without a market today (8 of 10 G2 subjects on 2026-09-15) | all eight player routes | R6.1a (player-first entry) |
| R6-F2 MLB "all games" reads 79 MB `mlb:full-raw:*` blobs | `/api/mlb/player-gamelog` | **resolved** R6.1a (game log reads `player_game_history`; route and stash deleted; Python prunes the old rows) |
| R6-F3 `is_major` 0 on every tennis row ("grand slam" never appears in slam names) | `backfill_player_game_history.py:854` | R6.4 reads level from TennisMyLife; the column fix is model track |
| R6-F4 MLB OBP over PA: no sacrifice flies stored per game | `player_game_history` MLB batting keys | labelled in R6.1a; adding `sacFlies` to the ingest is model track |
| R6-F5 MLB `game_result` has no game pk before 2026-08, UTC-dated night games, missing games | `game_result` (mlb) | R6.1a reads StatsAPI finals; R7/R8 MLB records must not join by date; source fix is model track |
| R6-F6 MLB and NFL past-game pages missing, so player game-log links would dead-end | `/mlb/game/[id]`, `/nfl/game/[id]` | R8 (links held off until then) |
| R6-F7 pitch corpus holds 281 of 2,229 regular-season 2026 games only in part (<3 pitches per PA); Statcast rollups cover 91-94% of a hitter's PA | `corpus/mlb_pitch_events`, pitch ingest | coverage stated on the page (R6.1b); the ingest gap is model track Phase 5 |
| R6-F8 ParlayAPI files a pitcher's strikeouts under `batter-strikeouts` (29 pitchers) and walks allowed under `walks` (9) on 2026-09-15; the page shows "Batter Strikeouts 7.5" for Yamamoto, and the pitcher markets miss those books | ParlayAPI market mapping, Python writer | model track (R5e writer work); the page shows the rows as stored |
| R6-F9 non-MLB candidates carry the main line from snapshot build time, which goes stale between rebuilds (Allen passing yards 249.5 in the stepper against a current 248.5) | NFL/CFB/NBA/NHL/soccer/tennis player adapters | **resolved for NFL and CFB** in R6.2 (`repriceAtMainLine`); soccer, tennis, NBA and NHL in their sub-phases |
| R6-F10 the game page's `usePropOdds` reads current rows, so after the start its prices (and the embedded player's) are in-play and the main line finds no pre-game quote | `GameDetail` | R8 (pass the start, as the player page does) |
| R6-F11 `nfl_target_events.interception` is false on all 36,375 rows: `write_nfl_target_events` writes 13 columns and that is not one of them, so G2's INT column and its red-ringed dot cannot be built | `python-odds-service/src/db.py` `write_nfl_target_events`, `nfl_pbp.parse_row` | model track (a column and a re-ingest); the section states it is not held |

## Appendix B — Reference fixtures (G2 datasets)

Rebuild with `node docs/design/phase-g2/build.mjs`. Refresh with the venv Python
from the repo root: `tools/build_player_data.py`, `build_game_data.py`,
`build_team_data.py` and `build_matchup_data.py` (shared helpers `g2lib.py`,
`pregame.py`).

| surface | fixtures |
|---|---|
| Games | MLB KC @ BOS (pk 824711) · NFL DAL @ NYG (401872930) · CFB Ohio State @ Texas (401856682) · NBA OKC @ LAL (401811010) · NHL FLA @ TOR (ESPN 401803621 / NHL 2025021270) · soccer MCI @ MUN (401879278) · tennis Paul v Zverev |
| Players | Judge 592450 · Skenes 694973 · Chase 4362628 · Allen 3918298 · Manning 4870906 · Gilgeous-Alexander 4278073 · Wembanyama 5104157 · MacKinnon 8477492 · Vasilevskiy 8476883 · Cunha 259902 · Lammens 301425 · Alcaraz 3782, plus 12 peers |
| Teams | Royals · Raiders · Ohio State · Lakers · Maple Leafs · Man City |
| Matchups | `data/matchup-<sport>.json`: all teams, results since 2023, rollups per season, next games |

## Appendix C — Where `build-plan.md` went

| build plan | here |
|---|---|
| Phase 0 | R0 (done) |
| 1a, 1b, 1c, 1d | R1a–R1d |
| 2a, 2b, 2c | R1f |
| 3 (tennis surface) | R6 tennis |
| 4 (live card) | R6 |
| 5a (edge floor), 5b (soccer market) | R1h, R6 |
| 6 (field collapse, B3) | R10 |
| 7 (deep history, Gap 1) | R11; Gap 1 → R6 seasons |
| Decisions 1–5 | §3 |
| Deferred list | R-deferred |
| Follow-ups B4, B8 | B4 → R7 team stats; B8 → R8 (CFB lines) and R-deferred (NFL id mapping) |
