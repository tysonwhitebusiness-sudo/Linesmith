# Research pages — master plan (Phase H)

**Status: APPROVED by the operator 2026-09-14, as written (including picks G1–G7
as taken in §3). R0 done. R1 signed off and deployed. R2 done (signed off by
the operator's instruction to proceed). R3 and R4 signed off 2026-09-14. R5
signed off 2026-09-15. R6 STARTED 2026-09-15: Step 0 done, corrections and
decisions recorded in the R6 section. R6.1 (MLB) SIGNED OFF 2026-09-15. R6.2
(NFL and CFB) and R6.3 (soccer) COMPLETE 2026-09-15, each with render checks
owed on the next slate. R6.4 (tennis) and R6.5 (NBA and NHL) COMPLETE
2026-09-15. R6.6 (golf) COMPLETE 2026-09-16: **R6 is complete**, with live
renders owed per sport. R7 (team page) STARTED 2026-09-16: Step 0 done, R7-C1 changes the results source; **R7 SIGNED OFF 2026-09-16** (all four sub-phases and the tennis/golf team routes). R8 (game page) STARTED 2026-09-16, MLB first: 8.1a-c (shell, final recap, before-start research, live) done and the MLB group closed 2026-09-17; R8.2 (football): 8.2a-c built; live renders scheduled (TNF, Saturday CFB), then sign-off. R8.3a (soccer) and R8.3b (tennis) built: soccer's live render is scheduled, tennis's live state was verified; then sign-off. R8.4a (NBA) and R8.4b (NHL) built; live for both owed in October. Every R8 sport group is built; sign-offs and the old GameDetail deletion remain.**

**R6.6 COMPLETE 2026-09-16 — R6 is done for every sport.** Golf's Scoring and
Shot profile, built from the golf tables. Commit `5ff166b`.
- **Step 0 audit — golf had no research at all.** Golf has no
  `player_game_history` rows, so the hero had no numbers and the page had no
  research sections. Its record is four tables (`scripts/measure-golf.ts`):
  `golf_tournaments` (4 events, `start_date` null on all), `golf_round_scores`
  (586 rounds, ESPN id), `golf_hole_scores` (10,604 holes, summing to the round
  on every row) and `golf_shot_events` (1,033,752 shots, PGA TOUR id and name).
- **Three premises corrected:**
  1. The round and hole tables cover **three events**, the 2026 FedEx Cup
     playoffs, at most 12 rounds a golfer; Biltmore has a tournament row and no
     rounds. The hero counts rounds under "Recent events" and no card claims a
     season.
  2. The shot seed is **2020-2022** (234,454 / 694,115 / 105,183 shots), not
     2020-2023 as 6.13's comment said. The section names the seasons it draws on
     every time.
  3. **`tournament_id` repeats every year**: no shot key repeats within a
     season, 137,396 repeat across seasons. G2's grouping left the season out
     and merged two years of an event into one hole — Scheffler's putts per hole
     read 1.78; keyed on season it is 1.59.
- **Two more corrections against G2:** a putt's `distance_yds` is how far the
  ball rolled, so first-putt distance reads the previous shot's `left_yds`; and
  `golf_hole_scores.category` files eagles as birdies and doubles as bogeys
  (R6-F12), so scoring by par counts from `relative_to_par`.
- **Built:** `toGolfResearch` and `summariseGolfShots`
  (`lib/sports/golf/playerResearchShapes.ts`), read by `playerResearch.ts`
  through `/api/golf/player-research` (cachedRoute, 30 min) and
  `useGolfResearch`. The shot seed is summarised server-side, so ~4,000 rows
  per golfer never cross the wire. Scoring: rounds (with the forecast wind and
  temperature where recorded, 465 of 586) and scoring by par (eagle-, birdie,
  par, bogey, double+). Shot profile: driving distance, distance left before the
  first putt, putting, make % by first-putt distance, and the lie breakdown
  carried over from the deleted grid.
- **Shared changes:** the hero takes an optional `unit` ("rounds") and a
  per-chip `mark` and `tone` (a round's score to par), so golf shows neither
  "games" nor an invented W/L; a sport's own sections no longer need a per-game
  history to render, while Seasons, Trends, Splits and the log still do.
- **Deleted:** the golf lie mix and proximity grid from the prop block, with
  `/api/golf/shot-profile`, `useGolfShotProfile`, `shotProfile.ts`,
  `shotProfileShapes.ts` and their test. They only showed while a tournament
  was priced; this page was their only caller.
- **Verified** at 1440 and 400 on Scheffler (rounds and seed), Åberg (rounds,
  not in the seed — the section says why) and Woods (seed, no recent rounds).
  11 new tests; 525 pass; build clean. **Golf's prop block and live view are
  still held for a tournament.**


**R6.5 COMPLETE 2026-09-15.** NBA's shot chart, NHL's shot map and the league's
own season totals, one line and game state for both.
- **Step 0 audit — two of this plan's own premises were out of date.**
  1. "NBA/NHL shots 2024-25 only (until R5)" is wrong now: measured 2026-09-15,
     `nba_shot_events` holds 219,873 rows for 2025 and **220,723 for 2026**, and
     `nhl_shot_events` 156,622 for 20242025 and **153,754 for 20252026**. Every
     row is placed. Both sections open on the current season.
  2. G2's "Official NHL season totals — not parsed by the app today" is also
     out of date: `parsePlayerLanding` has parsed `seasonTotals` since R6.1a and
     the bio already fetches that landing, so the card costs no extra call.
- **Where the hoop is, measured rather than assumed.** `nba_shot_events` gives
  x 0-50 across and y **from the RIM**, not from the baseline. Proved by asking
  where a corner three lands — 22 ft from the rim by rule, so the right origin
  is the one where no three is closer:

  | assumed hoop | closest 3pt | threes inside 21 ft |
  |---|---|---|
  | (25, 5.25) | 18.8 ft | 11,516 — impossible |
  | (25, 4.00) | 20.0 ft | 516 — impossible |
  | **(25, 0.00)** | **22.0 ft** | **0 — exact** |

  Confirmed twice over: the made rate by 5 ft band then reads 60 / 54 / 43 / 38
  / 36 / 32%, which is the NBA shooting curve. Phase 6.7's own grid had reached
  the same origin; this re-derived it before drawing an arc on it.
- **Built:** `nbaShotSection` (`lib/sports/nba/playerShotShapes.ts`) — every
  located attempt on a real half court (new `CourtScatter`: paint, restricted
  arc, free-throw circle, corner lines at x = 3 and 47 meeting the 23.75 arc at
  y = 8.94), a zone table whose last column is **points per shot** (a 35% three
  is 1.05 and beats a 45% long two at 0.90), and a type table over every attempt
  including the unplaced. `nhlShotMapSection`
  (`lib/sports/nhl/playerShotMapShapes.ts`) — the rink map (new `RinkScatter`),
  a type table, and the official totals. New `/api/nba/shots` and
  `/api/nhl/shots` (cachedRoute, 30 min, id-bounded) with `useNbaShots` and
  `useNhlShots`.
- **The rotation is a rotation, not `abs(x)`.** Switching ends mirrors BOTH
  axes, so negating x alone would move a right-wing shot to the left wing. The
  measurement that established this (mean x by period -12, -10, +16, -3, -32
  against a steady mean |x| of 53-70) moved from the deleted
  `shotProfileShapes.ts` into the file that now owns it.
- **A goalie takes no shots** — Hellebuyck has 0 rows as `shooter_id`,
  Vasilevskiy 1 — so the read falls back to `goalie_id` (filled on 111,896 of
  153,754 rows) and the section becomes "Shots faced & official totals". Which
  column to key on is decided by the data, not by a position string.
- **R6-F9 is now closed for every sport**: NBA and NHL re-price through the
  shared `repriceAtMainLine`.
- **C4 for both** (`lib/sports/multiSport/hoopsHockeyGameState.ts`, one builder
  for two sports as football's is). NHL matches the box score on the **player
  id** api-web publishes; NBA has only a display name, the same match football
  makes.
- **Deleted, per the plan's own rule:** the 3x3 grid and shot-type donut for
  both sports, with their whole chain — `/api/nba/shot-profile`,
  `/api/nhl/shot-profile`, `useNbaShotProfile`, `useNhlShotProfile`, both
  `shotProfile.ts`, both `shotProfileShapes.ts` and their two test files.
  Grepped first: this page was their only caller.
- **One app-breaking bug, fixed in the same commit.** Gating the live nav on
  `isNhlGameLive` imported from `nhle.ts` pulled `pg` into the client bundle:
  `tsc` passed, 504 tests passed, and the dev server returned **500 on every
  route** — the third time Phase 6's own boundary bug has appeared. The
  predicates now live in a client-safe `gameStates.ts`, and
  `tests/client-bundle-boundary.test.ts` lists `nhle.ts` so the next one fails a
  test instead of a page.
- **Verified** at 1440 and 400 on SGA and Wembanyama (NBA) and MacKinnon and
  Hellebuyck (NHL), with 21 new unit tests. Rendering also caught two layout
  defects, both fixed: the court drew to the half-court line and the rink past
  the blue line, leaving a quarter of each card empty, and the chart sat alone
  in a full-width row with a 460px picture in it. **Neither league is in
  season, so the live card and the re-priced line are owed in October.**

**R6.4 COMPLETE 2026-09-15.** Tennis's "Surface & serve", the level split that
R6-F3 asked for, one line, game state, and the opponent names the history could
not give.
- **Step 0 audit — the page's own history cannot build this section.**
  `player_game_history` stores **eight keys** for tennis and no more, measured
  over 100,468 rows: games won/lost, sets won/lost, tiebreaks played,
  match_won, is_qualifying, is_major. No surface, no aces, no serve or return
  points, no round, no ranking, no tournament. So Seasons, Trends, Splits and
  the game log stay on those rows and the new section comes from the
  TennisMyLife archive instead, which carries all of it (serve and return
  columns on 9,738 of 10,080 ATP matches).
- **And the archive lags, so the section says so (R4-F1).** Measured
  2026-09-15: the ATP file ends at Winston-Salem, 2026-08-30 — the US Open,
  finished a week earlier, is not in it at all — and Alcaraz's own last row is
  2026-04-14. The note states both the archive's last date and, when the player
  stops earlier inside it, that player's own last match.
- **Built:** `tennisSurfaceSection`
  (`lib/sports/tennis/playerArchiveShapes.ts`) — By surface (W/L, win %, aces
  per match, first-serve points won, return points won, with today's court
  marked, C7), **By level** (slam / Masters 1000 / 500 / 250 / tour finals /
  other, with the deepest round reached), Ranking at each match, and serve
  against return as a 10-match rolling pair. `/api/tennis/archive` (cachedRoute,
  6h, name-keyed and shape-bounded) with `useTennisArchive`;
  `getTennisArchive` loads the newest season context and the one two years back
  and resolves the player through the same `matchTennisIndex` the snapshot uses.
- **R6-F3 is resolved on the page.** The level split reads TennisMyLife's own
  `level` column, so a slam is a slam without `is_major` — which is still 0 on
  every row. Measured across three players' files: the ATP archive writes `M`
  for a Masters and the WTA one writes `1000`, so one row covers both spellings;
  both also use G, 500, 250, F, D (Davis / BJK Cup), O (Olympics) and A.
  Fixing the column itself stays model track.
- **R6-F9 is resolved for tennis.** The adapter re-prices through the shared
  `repriceAtMainLine`, as NFL, CFB and soccer already do.
- **Game state (C4):** tennis holds set scores and nothing else live — there is
  no point-by-point source (R4) — so the card shows the players, the sets, and
  states what is not held rather than leaving a band empty.
- **Opponent names:** the archive names every opponent, `athlete_crosswalk`
  names 66,134 of 100,468 rows, and the adapter fills the game log's "—" from
  the archive by date. Alcaraz drops from 13-17 unnamed to 1 in the visible
  6 rows; the remainder are dates the archive does not cover either.
- **Three defects found by rendering, all fixed:**
  - The ranking axis printed **"No. 2, No. 2, No. 3, No. 3"** — five ticks over
    a three-rank span, rounded. The axis now spans a whole number of ranks over
    four gaps, and never pads past No. 1 into a rank that cannot exist. The
    negated series needed a new `axisFormat` on the shared series card so the
    axis can read back the real rank.
  - The section's own copy said **"he"** on a WTA page ("the ranking he carried
    into each match", "his own serve"). Reworded; the same sweep caught the
    column tooltip.
  - Tennis has **no home side**, but the history stores `is_home` anyway —
    false on every one of Alcaraz's rows, unset on Sabalenka's — so the game log
    printed "@ Shelton B." and Splits offered a Home/Away split on neutral
    courts. The adapter drops it, which empties both venue groups, so the split
    is no longer offered.
- **Verified** at 1440 and 400 on Alcaraz (ATP, archive stops in April),
  Sabalenka and Andreeva (WTA, and no ESPN headshot — the hero falls back to a
  placeholder). No tennis is on the slate on 2026-09-15, so all three render
  the no-market path; **the live card and the re-priced line are owed on the
  next tennis match day.** `tests/tennis-surface.test.ts` (8 tests) runs against
  G2's own Alcaraz archive block. 519 tests pass; build clean.

**R6.3 COMPLETE 2026-09-15.** Soccer's "Chances & finishing", the keeper's
state, one line, game state and the default market. Commit `093923a`.
- **Step 0 audit:** Understat's `/getPlayerData` carries every shot with `X`,
  `Y`, `xG`, `result`, `situation` and body part, plus every match with
  minutes, goals, xG, assists, xA and key passes — measured live: Haaland 700
  shots over eight seasons, Cunha 515, Salah 1,296, all placed, out of a
  654-player 2026 index. Resolution is BY NAME (Understat publishes no id this
  app can join on) and every subject tried resolved. A keeper resolves too and
  comes back with nonsense for this card: Pickford's whole shot list is one own
  goal in 2023.
- **Built:** `soccerChancesSection` (`lib/sports/soccer/playerUnderstatShapes.ts`)
  — the shot map on a new `PitchScatter` (Understat's own coordinates, the
  penalty area and six-yard box at real geometry, dot area proportional to xG,
  a goal filled green, situation chips), finishing by body part with the
  totals in the caption, goals against xG as a 10-match rolling average over
  the last 60 matches, and per 90 by season. `/api/soccer/understat`
  (cachedRoute, 6h, name-keyed and shape-bounded) with `useSoccerUnderstat`;
  the two fetchers behind it already cache their own payloads.
  `soccerKeeperSection` is G2's own not-held state, and MLS says Understat
  does not cover it rather than rendering nothing.
- **Also built:** R6-F9 (soccer re-prices on the current main line); C4
  (soccer's game state is the score, clock and key events, with the card
  stating that per-player live stats are not held — decision 5); C8 (a soccer
  page opens on the market the position plays for: saves, tackles, shots on
  target, anytime goalscorer, falling back to what the books priced).
- **Removed:** the prop block's 3x3 shot grid and its shot-type mix
  (`spatialGrid`/`usageMix` are null for soccer), the per-subject shot fetch in
  the snapshot build that fed them, `toShotGrid` and its test — the same rows
  are the section's shot map and finishing table now, drawn in full.
- **Verified:** 1440 and 400 on Cunha (chances section, shot map, the
  name-match note), Lammens (keeper state), Yoshida (MLS, the not-covered
  state) and Haaland; the route's own numbers equal G2's stored block season
  for season (2024-25: 109 shots, 22 goals, 23.95 xG, 31 matches, 2,749
  minutes on both sides). MLB and NFL re-rendered unchanged, with the rebuilt
  card headers. The route's rows
  equal G2's own Haaland block field for field in the tests. tsc clean,
  519/519 tests, build passes.
- **NOT rendered:** an injured soccer player — ESPN's EPL injuries feed was
  empty on 2026-09-15 and the players sampled were fit. The hero's injury pill
  is shared code and was rendered this session on Tua (NFL) and Schmidt (MLB).
- **OWED, next EPL match day:** the live card for soccer, and **R2-F9** — the
  `soccer:snapshot:epl` row wrote 5 minutes before the check but at ~0 MB,
  because today's EPL slate is empty, so the 22 MB write is still unproven.

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
app should show the same numbers as the mockup dataset. R6–R10 verify exactly
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
| 8 | Cards whose data isn't held show a status | Same statuses, until the data lands | ~~NBA/NHL shots 2024-25 only~~ (both hold the current season, measured R6.5), no NHL or soccer win probability, no tennis point-by-point, no CFB advanced passing, no soccer/CFB injuries |
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
| R9 | Visual density: identity, charts, emphasis | done 2026-09-17 | R6, R7, R8 | — |
| R10 | Compare control | medium | R5–R8 | — |
| R11 | Port-artifact cleanup | small–medium | R6–R10 | — |
| R12 | Deep history on team and game pages | large, design first | R2, R11 | — |

Order follows the design audit's sequencing rules:
- identity and interaction (R3) before any card;
- data rules (R2) before any page reads them;
- card changes before the field-rename cleanup (R11);
- scope before deep history (R12).

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
- The card is shared, so render one page per sport. It is deleted in R10.

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
   games. Its "vs" chip opens on the compared team when one is set (R10).
3. *(R10: compare sections insert here.)*
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
| NBA | Shot profile: Shot chart · By zone · By shot type | `nba_shot_events` via `/api/nba/shots` (holds 2024-25 AND 2025-26, measured R6.5) | R6.5 |
| NHL skater | Shot map & official totals | `nhl_shot_events` via `/api/nhl/shots`; totals off the player landing the bio already fetches | R6.5 |
| NHL goalie | Shots faced map & official totals | same, keyed on `goalie_id` | R6.5 |
| Soccer FW/MID | Chances & finishing: Shot map · Goals vs xG · Per 90 by season | Understat per player (cached in `snapshot_cache`); `player_game_history` | Read |
| Soccer GK | Shot-stopping: Beyond saves | `player_game_history` | Read |
| Tennis | Surface & serve: By surface (today's surface marked, C7) · Ranking · Serve and return by match | TennisMyLife (R4); current event's surface from `tennis/schedule.ts`, never the last match's | R4 |
| Golf | Scoring: Rounds · Scoring by par. Shot profile: Driving distance · Approach proximity · Putting · Make % by first-putt distance · By lie | `golf_round_scores`, `golf_hole_scores` (ESPN id), `golf_shot_events` (2020-2022 seed, by name), `golf_tournaments`; `/api/golf/player-research` | R6.6; prop block and live view held until a tournament |

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

**Also in R6.4 (routed from R6.1a, 2026-09-15) — both DONE 2026-09-15:**
- ~~**Tournament level (majors) from TennisMyLife, not `is_major`** (R6-F3).~~
  Done: the By level card reads the archive's `level`. Fixing `is_major` itself
  is still a Python change to `backfill_player_game_history.py:854` plus a
  re-run, for the model track.
- ~~**Tennis opponent names:** 13-17 of Alcaraz's and Zverev's opponents have no
  `athlete_crosswalk` name and show "—" in the game log.~~ Done: filled from the
  archive by date.

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

**R7 STARTED 2026-09-16 — Step 0 audit done** (`scripts/measure-team-page.ts`,
`scripts/measure-team-records.ts`; records refereed against StatsAPI, api-web
and ESPN, not G2).

- **R7-C1, the one that changes the build: `game_result` cannot be a team
  page's results source.** It has no season-type column and no overtime flag,
  and its sources mix preseason and postseason into the season:
  | team | `readGameResults` | the league |
  |---|---|---|
  | Maple Leafs 2025-26 | 84 games, 32-52 (from 2025-10-02, preseason) | 82, **32-36-14** (api-web) |
  | Maple Leafs 2024-25 | 97 games | 82 + 13 playoff |
  | Lakers 2025-26 | 92 games, 57-35 | 82, 53-29 + playoffs 4-6 (ESPN) |
  | Ohio State 2025 | 14 games, 12-2 | 13, 12-1 + CFP 0-1 |
  | Royals 2026 | 148 games, 65-83, 628-724 | **151, 66-85, 636-732** (StatsAPI) |
  | Royals 2025 | 163 games, 82-81 | 162, 82-80 |

  The MLB gap is R6-F5 again. **Results & schedule read each league's own
  schedule instead**, regular season, postseason kept apart: StatsAPI
  `gameType=R` for MLB (`statsapi.ts:1044` already calls it), api-web
  `club-schedule-season` for NHL (`gameType` 2/3, `lastPeriodType` gives OTL;
  `nhle.ts:228`), ESPN's team schedule by `seasontype` for NFL, CFB, NBA and
  soccer (`teamSportEspn.ts:223`). ESPN matched the league on every G2 team
  checked (LAL 53-29, LV 3-14, OSU 12-1, MCI 23-6-9). This is the R6.1a
  decision for the player page applied to teams, and it also gives the
  upcoming schedule, which `game_result` cannot. `game_result` stays for R12.
- **Ids agree within a sport, and G2's do not.** Route id = `game_result` =
  `player_game_history` = `team_game_production` = `player_season_production`
  = the shot tables: StatsAPI ids for MLB, api-web ids for NHL, ESPN for the
  rest. G2's datasets use ESPN ids for MLB (Royals 7, app 118) and NHL (Leafs
  21, app 10), and label NHL seasons by END year (G2 "2026" = app 2025).
  `nfl_target_events` keys the team by abbreviation.
- **Early-season today:** NFL (1 game), CFB (2), EPL (4) and NHL (0) open on
  last season; MLB and MLS do not. NBA's current season is 2025-26 until
  October 1, then falls back the same way.
- **R5 tables hold every sport's last two seasons** (`team_game_production`
  through 2026-09-15 for the in-season sports, `player_season_production`
  686-12,401 rows a sport-season, both shot tables both seasons).
- **Team stats sources:** `/api/season-ranks` covers NBA, NHL, CFB and soccer
  only. MLB reads StatsAPI `teams/stats` (`statsapi.ts:486`), NFL nflverse
  `stats_team` (`nflverse.ts`) — both already fetched, as the plan says.
- **R2-F7 confirmed on all five other sports:** `/nfl/team/13` and the rest
  call `/api/mlb/team-form` and `/api/mlb/team` (400) and
  `/api/mlb/team-statcast`, `/api/mlb/team-batter-ranks` (200, wrong sport).
- **R2-F8 does not reproduce:** `/api/mlb/team/110` rebuilt on request
  (74-78, fetched 2026-09-16) and 118 reads 66-85, equal to StatsAPI. The
  28-day payload was an unvisited key; nothing to fix.

**R7.1 COMPLETE 2026-09-16 — the shared team page, on MLB.**
- **Built:** `/api/team-research?sport&teamId` (cachedRoute, 30 min, key
  `team-research:route:{sport}:{teamId}`) with a reader per sport
  (`lib/sports/mlb/teamResearch.ts`); the shared builder `buildTeamResearch`
  (`lib/sports/shared/teamResearch.ts`, shapes in `teamResearchShapes.ts`);
  MLB's spec (`adapters/teamResearchSpec.ts`) and `toTeamResearchData` in
  MLB's team adapter; `TeamResearchPage` with its hook. Hero (record, standing
  current season only and "Finished Nth" for a past one, last ten, next game,
  tiles), ONE season switch scoping every section, Results & schedule (margin
  by game, running differential, splits, schedule), Standings (division and
  league), Team stats (ranked across all 30 clubs with a direction per stat
  and a league dot strip, per game or per PA throughout), Roster production
  (hitters and pitchers, headshots, links, innings as outs), MLB's "Contact &
  pitch quality" from the R5a rollup, Sources.
- **Shared pieces added for every sport:** roster production read
  (`teamRosterServer.ts`: score and games from `player_season_production`,
  totals summed from `player_game_history` for those athletes, because the
  rollup's `stats` hold no RBI, GS or HBP); research table cards gained view
  switching, linked/logo rows, an own-row mark and toned cells; percentile
  rows a league dot strip (`LeagueStripRow`); histogram bars a win/loss tone.
  `useStickyHeaderHeight` moved to its own file.
- **Refereed against StatsAPI, not G2:** Royals 2026 66-85, 636-732, home
  39-36, away 27-49, L3; 2025 162 games 82-80, +14, finished 3rd; Witt's
  roster row 132 G / 585 PA / 144 H / 18 HR equal to his StatsAPI line;
  Dodgers 92-59, +177, 1st. Rendered at 1440 and 400: no bad text, no
  horizontal overflow; the only console errors are the signed-out 401s.
- **Render caught three defects, fixed:** "Mar" printed over "Apr" (a month
  too short for its label now gives way), the schedule's venue column was
  clipped in a half-width card (dropped: vs/@ says whose park), and the
  Statcast join note described a league total as this team's.
- **R2-F7 fixed:** the old `TeamDetail`, still used by the other five sports,
  passes MLB's four hooks `undefined` outside MLB; `/nfl/team/13` now makes no
  `/api/mlb/` request (checked in the browser's network log).
- **Not rendered any more for MLB, deleted with `TeamDetail` in R7.4:** the
  line picker and win bars (F-B3), unit grades, the duplicate next-game card,
  and the next game's line-movement card. The MLB branch of `TeamDetail` and
  `toTeamDetailData` for MLB are now unreachable and go with it.
- **For sign-off:** the team list still sits above the page on a phone (the
  existing `TeamListShell`), and the page drops the next game's price
  movement, which the plan's skeleton does not name.
- 9 new tests; 537 pass; tsc and build clean.

**R7.1 SIGNED OFF 2026-09-16** with two operator decisions: the team list is
hidden on phones on a team's own URL (the Teams landing keeps it), and the next
game's price movement stays dropped.

**R7.2 COMPLETE 2026-09-16 — NFL and CFB.**
- **Read** (`lib/sports/multiSport/footballTeamResearch.ts`, both leagues):
  ESPN's team schedule with `seasontype=2` and `3` fetched apart
  (`fetchTeamSeasonGames`, reusable by NBA and soccer), ESPN standings
  (`fetchStandingsGroups`: NFL division then conference, a division ordered by
  conference seed; CFB the conference as published), team stats from the R5b
  rollup `team_game_production` for AND allowed with points from the
  standings, ranked across the standings' own real teams (FBS only for CFB,
  135 teams in 2025), roster production named from ESPN
  (`espnAthleteNames`: current roster, then the athlete endpoint).
- **Sections:** NFL's Passing game — a throw map on the field (offense,
  defense, league views), shares and completion % by area against the league,
  and target share from the box scores; CFB's Ranked opponents (AP rank at
  kickoff, bowls and playoff included and labelled).
- **Measured before building, and three premises corrected:**
  1. No table names football players (`athlete_crosswalk` names 29 of the
     Raiders' 59 of 2025) and ESPN's roster ignores `?season=` (0 athletes),
     so names come from ESPN per athlete, cached in process. The nflverse
     players file was not used: it lives in `snapshot_cache` as a large blob,
     the egress cost Phase 5 fought.
  2. CFB box scores carry no targets, QB hits or sacks taken; those columns
     and stats are NFL-only rather than zeros.
  3. ESPN's CFB standings have `wins` but no `losses`: games are read from the
     `overall` record. Caught refereeing — Ohio State's points per game read
     39.0 on wins alone, 33.4 is right.
- **Refereed against ESPN and nflverse:** Raiders 2025 3-14, 241-432, 4th in
  the AFC West behind Denver 14-3; Chiefs 6-11, 362-328, home 5-4, road 1-7;
  Ohio State 2025 12-1 and 454-106 in the regular season, plus the CFP
  quarterfinal 14-24, which together are ESPN's 12-2 and 468-130; Alabama's 15
  games 443-288 equal ESPN's 11-4.
- **Render caught, fixed:** a neutral-site game counted as an away one
  (Alabama's SEC title game made its road record 4-2 against ESPN's 4-1;
  `TeamGame.neutral`, a Neutral site split row, a test); the conference table
  printed its seed twice; long stat labels truncated at 1440.
- Rendered Raiders, Chiefs, Ohio State, Alabama at 1440 and 400: no bad text,
  no overflow, only the signed-out 401s. All four open on 2025-26 and say
  why (NFL 1 game, CFB 2); picking 2026-27 shows the Raiders 1-0, 2nd in the
  AFC West. Unknown id: 404, not cached. 1 new test; 538 pass; build clean.
- **Owed Saturday 2026-09-19 / Thursday 2026-09-18:** a live game on a
  football team page (the hero's "Live" next game).

**R7.2 SIGNED OFF 2026-09-16** (operator: "Start R7.3").

**R7.3 COMPLETE 2026-09-16 — NBA and NHL.**
- **Read** (`lib/sports/multiSport/hoopsHockeyTeamResearch.ts`): NBA from
  ESPN's team schedule (the play-in is season type 5 and counts as
  postseason — measured on Golden State's two), ESPN standings (division and
  conference by seed); NHL from api-web — `fetchClubSeasonGames` (game types
  2/3, preseason dropped, `lastPeriodType` for OT/SO),
  `fetchNhlSeasonStandings` (a finished season at its own `standingsEnd`,
  since `standings/now` only answers the current table; nothing for a season
  not yet started), `nhlPlayerNames` (the season roster, then player
  landings: Toronto's 2025-26 roster lists 18 of the 38 who played). Team
  stats from `team_game_production` for and allowed, with NHL goals from the
  standings; hits, blocked shots and PIM are not ranked (no better direction).
  The stat-ranking loop is now one shared `rankTeamStats` for all four sports.
- **Sections:** NBA's Shot profile (the court by zone for the team, its
  opponents and the league average; a by-zone table with ranks; FG% by zone as
  league strips); NHL's Shot map (the rink's nine areas for and against, a
  by-area table of goals per attempt, attempts per game against the league,
  shot types).
- **App-breaking bug found and fixed in passing:** the NHL team-id map sent
  the Utah Mammoth to id 59 (the old Utah Hockey Club), while every 2025-26
  table stores it as 68 — the team list linked a page that read the wrong
  franchise, and the Mammoth dropped out of every league pool (31 teams).
  Newest id wins per tricode; the cached map moved to `nhl:team-ids:v2`.
  2024-25 rows remain under 59 (a franchise id change the tables carry).
- **Render caught, fixed:** Utah's playoff record read "2-2-2" — a playoff
  overtime loss is an L, not an OTL (`gameResult`, test).
- **Refereed against the leagues:** Maple Leafs 2025-26 32-36-14, 253-299,
  8th in the Atlantic; Utah 43-33-6, 268-240, home 22-16-3, 4th in the
  Central, playoffs 2-4; Thunder 64-18, 9760-8846, home 34-7; Lakers 53-29,
  home 28-13, playoffs 4-6 — their points allowed read 9,396 from the games
  against ESPN standings' 9,395, a one-point disagreement inside ESPN's own
  feeds, left as it is.
- **Premise note:** 2026-27 is an 84-game NHL season (api-web lists 84 regular
  season games for Toronto, from 2026-09-29); nothing assumes 82.
- Rendered Lakers, Thunder, Maple Leafs, Utah at 1440 and 400: no bad text,
  no overflow, only the signed-out 401s. The Leafs and Utah open on 2025-26
  and say why (2026-27 has 0 games). The NBA opens on 2025-26 as its current
  season until October 1, then falls back the same way. 538 tests; build
  clean. **Owed in October:** a live NBA and NHL game on a team page.

**R7.3 SIGNED OFF 2026-09-16** (operator: "Start R7.4").

**R7 close-out, 2026-09-16: tennis and golf team routes** (the plan's "no team
page; the route explains why", missed in R7.4). `/golf/teams`,
`/golf/team/[id]`, `/tennis/[tour]/teams` and `/tennis/[tour]/team/[id]` render
`NoTeamPage`: why the sport has no teams and links to its Players and Schedule
tabs. Nothing links there — `TopBar` already shows Schedule in place of Teams
for both sports, and that tab is unchanged — so these only catch a typed or
shared URL, which 404'd. Rendered at 1440 and 400; every link lands; an unknown
tour still 404s.

**R7.4 COMPLETE 2026-09-16 — soccer, and the old team page deleted. R7 is done.**
- **Read** (`lib/sports/soccer/teamResearch.ts`, EPL and MLS apart): ESPN's
  team schedule, W-D-L throughout; ESPN standings (the Premier League table,
  or the club's MLS conference) by ESPN's rank; team stats from
  `team_game_production` for and allowed with goals and points from the
  standings (fouls, offsides, cards and saves not ranked); roster production
  named from ESPN. Soccer adds no section of its own: the plan's soccer card is
  its ranked club totals, which Team stats already is.
- **Measured first, three premises corrected:**
  1. ESPN's soccer `fixture=true` IGNORES `season`: asked for EPL or MLS 2025
     it returns 2026's unplayed fixtures. `fetchTeamSeasonGames` now keeps only
     events whose `season.year` is the season asked for. (The older
     `fetchTeamSchedule` has the same leak; no soccer caller uses it.)
  2. MLS playoffs are not a season type number: they are named season types
     ("Eastern Conference Playoffs - Round One", "MLS Cup") in the same
     response as "Regular Season", and are kept apart by name.
  3. **R7-F1: MLS 2026 game logs start on 2026-08-15.** `player_game_history`
     holds 59 MLS 2026 events (August and September only) against about 25
     games a club, so the rollup and roster production cover 4-5 of a club's
     games (Atlanta 5 of 25, Miami 4 of 25). MLS 2025 is complete (510 events).
     EPL 2026 holds 31 events after four matchdays (Man City 3 of 4). A Python
     backfill, routed to the model track. **Every sport's page now states it**:
     `TeamSeasonData.loggedGames`, and Team stats and Roster production say
     "Summed from the N of this team's M games that the app holds box scores
     for" whenever the logs are short.
- **Refereed against ESPN:** Man City 2025-26 23-9-6, 77-35, 2nd behind
  Arsenal; Inter Miami 2025 19-8-7, 81-55, with six playoff games through the
  MLS Cup kept out of the record; Inter Miami 2026 12-9-4, 61-46, 2nd in the
  East; Atlanta 2026 6-5-14, 29-43, 14th.
- **Deleted:** `components/TeamDetail.tsx` and every sport's
  `toTeamDetailData` with the `TeamDetailData` family (2,700+ lines, with the
  unused helpers and imports it left, pruned to a clean `--noUnusedLocals`);
  the modules only it used — `StandingsTables`, `useCfbTeamDetail`,
  `useNbaTeamDetail`, `useNhlTeamDetail`, `useSoccerTeamDetail`,
  `useTeamBatterRanks`, `useTeamForm`, `useTeamRatingHistory`,
  `useTeamRoster`, `useUserSportsbook`, five sports' `teamFormCandidates.ts`,
  `lib/sports/shared/teamRatingHistory.ts`; and the four routes only those
  hooks called: `/api/mlb/team-form`, `/api/mlb/team-batter-ranks`,
  `/api/mlb/team/[teamId]`, `/api/team-rating-history`. Checked by an import
  graph before and after: nothing new is left unimported. Kept: the
  `/api/{cfb,nba,nhl,soccer}/team/[teamId]` and `/api/nfl/team/[teamId]`
  routes and their `*TeamDetailApiResponse` types, which the game pages still
  read (R8). The line picker, win bars, unit grades and team rating chart went
  with the page (plan R7 delete list). `TeamDetailPanel` lost its dead
  `snapshot`/`odds`/`onAdd`/`addedKeys` props, and the MLB team pages stopped
  fetching game lines for them.
- **CLAUDE.md** pointed at two deleted routes as its `cachedRoute` examples
  and at `TeamDetail.tsx`/`TeamDetailData` in the sport-adapter section; both
  now point at live code. Six tests that read the deleted page were retargeted
  (the team page must not grow unit grades back; NBA/NHL team stats go
  through `rankTeamStats`; MLB's team Statcast section reads the rollup).
- **Sweep fixes:** the Teams landing requested `teamId=0` before its list
  loaded (the hook now idles); an api-web failure on NHL showed "team not
  found" (now an error with retry); roster sources printed "time unknown" in
  every offseason (the as-of now comes from the newest season that has one).
- Rendered every sport's team page and Teams landing at 1440 and 400: no bad
  text, no overflow, lists hidden on phones only on a team's URL, a made-up id
  shows not found. 538 tests; tsc and build clean.

**Sub-phases, stop after each:** R7.1 the shared team research skeleton
(hero, season switch, results & schedule, standings, team stats, roster
production, sources) built on MLB; R7.2 NFL and CFB; R7.3 NBA and NHL (live
verification in October); R7.4 soccer; tennis and golf routes explain why there
is no team page.


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

**R8 STARTED 2026-09-16 — Step 0 audit done** (`scratchpad` probes against the
seven G2 fixture games and a live MLB game; route and parser inventory).

- **What the seven game pages render today:** the old betting-first layout on
  every sport ("Candidates", "Good Bets", "My picks", "Line shopping", unit
  grades), no state switch, no live or recap sections. None of the G2 cards.
- **Past games (R1d, R6-F6), measured by fixture:**
  | sport | route loads by | fixture | today |
  |---|---|---|---|
  | MLB | today's snapshot | KC @ BOS 824711 | "isn't on today's slate" |
  | NFL | today's snapshot + `/api/nfl/game` | DAL @ NYG 401872930 | 404 |
  | CFB, NBA, soccer | their own `/api/{sport}/game/{id}` | all three | load |
  | NHL | `/api/nhl/game/{id}`, **NHL ids** | FLA @ TOR 2025021270 | loads (the ESPN id 401803621 404s; the player and team pages already link NHL ids) |
  | tennis | `/api/tennis/{tour}/game/{id}` | Paul v Zverev has no id in G2 | checked in its sub-phase |
  Both fixes are reads that already exist: StatsAPI's live feed by pk works
  for any MLB game (`getLiveFeed`, R4's fixture is 824711) and the shared ESPN
  summary fetch takes any NFL event id (`fetchEspnSummary`).
- **R4 built every flow and detail parser the Final table names** and no card
  reads them: ESPN win probability and biggest swings, drives, court plays,
  lead tracker and scoring runs, lines open/close with result vs line, season
  series, injuries with a report time, soccer lineups, commentary and last
  five; MLB at-bats (every pitch and batted ball), pitch mix and win
  probability; NHL play-by-play with shooter, goalie and strength. The
  pre/post-start odds split (`gameLineHistory.ts`) and `usePropOdds(…, start)`
  (R6-F10's fix, on the player page) exist too.
- **Premise to carry into the MLB group:** the pregame Statcast rollup
  (`mlb_statcast_game_pregame`, R5a) holds today's and tomorrow's games kept
  from kickoff, and began 2026-09-15. The "Starters" card will be empty for an
  MLB game before that date, including the G2 fixture, and must say so.
- **Order (operator decision asked):** the plan's groups run football → MLB →
  soccer/tennis → NBA/NHL, but its own verify rule needs MLB live "before the
  regular season ends" (last games 2026-09-27) and three MLB games were live
  during this audit, while football's live checks recur every week through
  January. Step 0 proposes MLB first, with a shared shell (state from the
  game's real status, one hero, section nav, before/live/final frames) built on
  it the way R7.1 built the team page on MLB. **Operator: MLB first.**

**R8.1 (MLB) progress:**
- **8.1a — shell and final recap, committed `7caba8d`.** `/api/game-research`
  (cache `game-research:route:v2:{sport}:{gameId}:{state}`; TTL by state),
  `GameResearchPage` with the state bar, `readMlbGameResearch(pk)` for any pk.
  Final: game flow (WP), batted balls, at-bat explorer, pitching, box, lines &
  props against results, play-by-play. Refereed on 824711 (77 PA, 289 pitches,
  every pitching line, R/H/E/LOB). `mainGameLine`: nearest even for totals
  (0.03), most books for run lines, superseded quotes dropped.
- **8.1b — before-start research, 2026-09-16.** `lib/sports/mlb/gamePregame.ts`,
  every read cut at the game date: strength vs strength (7 rows from
  `team_game_production`, league ranks, last season below `SEASON_MIN_GAMES`);
  form (last 10) and head to head since last season from StatsAPI schedules by
  pk; starters, recent starts, pitch mix and roster hitters against the starter
  from `mlb_statcast_game_pregame`; each prop's main line against the player's
  last 10 and games against this opponent (`player_game_history`); injuries.
  A final game keeps matchup, starters and players below the recap as
  "· at the start". Refereed: BOS 652/570 and KC 629/717 runs over 147 games
  before 824711 equal StatsAPI standings on 2026-09-10; the early-season
  fallback on 824136 (4 games) equals 2025's standings; KC-BOS head to head
  23-45 runs. Rendered at 1440 and 400 on LAD @ CIN (pre), KC @ BOS (final)
  and MIN @ KC 2026-04-01 (no starter card, 2025 strength).
  - **Premise corrected:** the pregame rollup began with games on
    **2026-09-11**, not 09-15, and holds 4 game days of 7 since (54 games). The
    empty state says so rather than naming a start date that was wrong.
  - Injuries read the roster as it stands now, so they show only while the
    game is still to come, never on a finished game (even reviewed as
    `?state=pre`).
  - Rutschman and Monasterio showing as Boston hitters is right: both are on
    Boston's roster (StatsAPI `currentTeam`).
- **8.1c — live, 2026-09-16/17.** "Right now" leads a live page: the game now
  (inning, outs, count, runners, batter and pitcher lines, win probability),
  the at-bat under way on the zone plot, a props tracker (main line at the
  start against the box so far; only an over is marked, `liveLineHit`), and
  in-game odds (`readInGameLines`: lines now and the home moneyline chance,
  vig removed). Then flow, batted balls, at-bats, pitching, box and plays, and
  the research as it stood at the start; Lines & props waits for the final.
  The research is memoized per game once it has started (the page polls every
  15 s). Verified on two live games, NYY @ MIN 823655 (extra innings) and
  DET @ TOR 822763, at 1440 and 400, state and count against the StatsAPI feed.
  - **In-game prices are sparse:** 494 quotes from 16-21 books over 13 capture
    minutes in three hours on 823655, about one capture every fifteen minutes.
  - **"Now" is the latest capture only.** A 30-minute window paired
    DraftKings' 4:25 moneyline (NYY -148, after the tie) with FanDuel's 4:15
    (MIN -1600), printing -148 / -1600. One book in the latest capture is
    shown as one book; a line two books share beats a nearer-even one-book
    line. The card says how many runs have scored since the capture (DET @ TOR
    showed a 4:20 price with Toronto five runs further on), timing an at-bat's
    runs by the next at-bat's start, since the feed stamps starts only.
  - **Run lines keep each team's sign** (`mainGameLine` keys spreads on the
    away handicap): in play, BetMGM had DET +1.5 and BetRivers DET -1.5 in one
    capture, and |point| pooled them. Pre-game books agree, so no close moves.
- **R6-F6 for MLB: game-log rows link to their game.** Every MLB
  `player_game_history.event_id` is a game pk (139,121 of 139,121 since 2025);
  links from Rutschman's log open BOS @ TEX 822849 in full. NFL stays unlinked
  until its group.
- **MLB group (R8.1) closed 2026-09-17; operator moved on to R8.2.** Owed: the
  live state again on a normal nine-inning game before 2026-09-27, and a
  postponed game when one occurs.

**R8.2 (football) progress:**
- **Step 0, 2026-09-17** (probes against DAL @ NYG 401872930 and OSU @ TEX
  401856682):
  - ESPN's summary serves any past football game: drives with every play
    (14/174 and 22/189), win probability (175 and 185 points), box score,
    team stats, scoring plays, injuries (NFL only) and pickcenter. No
    `lastFiveGames` or `seasonseries`, so form and head to head need schedules.
  - **Football game lines are moneyline-only in `game_odds_history`**
    (oddsharvester: 4 books on DAL @ NYG, 3 on OSU @ TEX); `game_odds_book_lines`
    keeps only the current board. Spread and total open/close come from
    pickcenter (DraftKings) alone, and the page says so.
  - Prop subjects are `espn:football:{athleteId}`; `prop_odds.game_id` and
    every football `player_game_history.event_id` are ESPN event ids, so
    game-log links can turn on for NFL.
  - `team_game_production` holds NFL 2026 week 1 only (32 rows), so strength
    falls back to 2025 until four games; CFB 2026 has 370 rows.
  - **A drive's `yardLine` counts from the HOME goal line**, not the offense's
    (DAL's drive from "DAL 28" is 72); the parser comment said otherwise and
    is corrected.
  - **DraftKings' "tackles" is SOLO tackles**: every line sits at 2.5-4.5,
    linebackers included (Overshown 4.5, Edmunds 3.5, who made 7 and 8 total).
    G2's mock settled it on total tackles, which would clear nearly every over.
- **8.2a — shell and final recap, 2026-09-17.** `readFootballGameResearch`
  (one reader for both leagues), `toGameResearchData` in
  `nfl/adapters/footballGameResearch.ts` exported from both leagues' game
  adapters, `/api/game-research?sport=nfl|cfb`, and both game routes on
  `GameResearchPage`. Final: game flow (win probability, a new `field` card
  kind for the drive chart, and a drive explorer with each drive's plays on
  the field), scoring & leaders, team stats, box score, lines & props
  (pickcenter open/close plus the stored moneyline median; props against the
  box by athlete id), play-by-play. `gameMainLines` is now the one main-line
  props helper for MLB and football. NFL game-log rows link to their game.
  Rendered DAL @ NYG and OSU @ TEX at 1440 and 400; chips refereed (DAL -3 lost
  by 8, 48 over 47.5; OSU +2.5 lost by 1, 47 under 50.5).
- **8.2b — before-start research, 2026-09-17.** Matchup (strength vs strength
  across nine offense/defense rows, form coming in across last season's break,
  head to head with postseason), the NFL passing matchup (share of attempts by
  depth and side against the league), Players (each prop's main line against
  the player's last ten and games against this opponent), the injury report
  (before kickoff only) and Lines. A final keeps Matchup and Players below the
  recap "at kickoff". The before-start reads and sections are now SHARED with
  MLB: `lib/sports/shared/gamePregameServer.ts` (`readGameStrength`,
  `readPropHistory`, `readLatestTeams`) and `gameResearchSections.ts`
  (`matchupSection`, `propHistorySection`); MLB passes its words and hrefs.
  Refereed: BUF 2025 393.82 yards and 159.65 rushing yards a game and Arkansas
  2025 454.83 yards a game equal ESPN's season statistics. Rendered DET @ BUF
  (NFL, pre), UGA @ ARK (CFB, pre), DAL @ NYG (final) and KC @ BOS (MLB, after
  the refactor) at 1440 and 400.
  - **`team_target_profile` is a season aggregate** with no per-game rows, so
    the passing matchup cannot be cut at kickoff; on a finished game it says it
    includes later games.
  - **The injury parser printed the status as the injury** ("questionable ·
    Not Specified"): ESPN's `type.description` is the status in lower case and
    the body part is `details.type`. Fixed in `parseInjuries`.
  - A prop player's side before kickoff comes from his latest game-log team
    (no box yet), which is what fills "vs opp".
  - Form reaches into last season: week 2 has one game per team.
- **8.2c — live, BUILT 2026-09-17; LIVE RENDER OWED** on TNF DET @ BUF
  (401872932, Thu 2026-09-17 8:15 PM ET) and Saturday's CFB slate. "Right now"
  leads: the game now (quarter and clock, ball, next snap, last play, win
  probability), the drive on the field, the props tracker, lines now and the
  home moneyline trend; then flow, scoring, team stats, box, plays, and the
  kickoff research. The props tracker and in-game odds cards are now SHARED
  with MLB (`propsTrackerCard`, `inGameOddsCards`); MLB's live page re-rendered
  on LAD @ CIN (bottom 6th) after the move, which also covers MLB's owed
  nine-inning live check.
  - The situation comes from the header's `situation` when ESPN sends it, else
    the last play's own after-the-snap record (`nextDownText`, added to the
    play parser with `wallclock`), since `footballLiveGame.ts` marks the
    header field unverified.
  - Football's stored in-game prices are moneylines only (Step 0), so "Lines
    now" is a moneyline against pickcenter's close; points scored since the
    capture use play wall-clock times.
  - Unit-tested on the DAL @ NYG fixture as if in progress; nothing on screen
    until a live game.
  - Scheduled checks (Claude app tasks): TNF DET @ BUF Thu 2026-09-17 7:43 PM
    CDT, CFB UGA @ ARK Sat 2026-09-19 11:37 AM CDT. Each records its result
    here.

**R8.3 (soccer and tennis) progress:** split into R8.3a soccer and R8.3b tennis,
which share almost nothing.
- **Step 0 (soccer), 2026-09-17,** probes on MUN v MCI (401879278, 0-1):
  - ESPN's summary serves the match: 27 key events (with team and player ids),
    116 commentary entries with 91 located on the pitch, lineups with
    formations, last five, team stats, per-player match stats in `rosters`,
    three-way pickcenter. No win probability for soccer.
  - **Commentary positions are normalised to the team in possession attacking
    x = 100** (both sides' shots at x 72-86, Haaland's goal at 97.5), so a
    full-pitch map mirrors the away side. **Commentary carries no team id,**
    only `team.displayName`; sides are matched on the full name.
  - **`game_odds_history` holds soccer moneylines only and no draw side** (4
    books); the draw, handicap and total come from pickcenter.
  - Props are mostly yes/no (anytime scorer 47 players, first scorer 43, 2+
    goals 45) beside goals, assists and shots; `gameMainLines` skipped yes/no
    markets and now returns them.
  - `prop_odds` subjects `espn:soccer:{id}`; `player_game_history` and
    `team_game_production` (`soccer_epl`, `soccer_mls`) key ESPN ids; season is
    `header.season.year` (2026 for 2026-27).
  - **R8.3-F1 (model track):** `team_game_production` credits goals to scorers,
    so own goals belong to nobody: EPL 2025-26 City 74 against ESPN's 77,
    United 66 against 69, United conceding 48 against 50 (City's 35 conceded,
    no own goals, matches). **FIXED 2026-09-17:** `team_production.py` rolls up
    `ownGoals` and writes `goals` (players' goals + the opponent's own goals) on
    each `all` row; equal to the opponent's `goalsConceded` in all 1,780 EPL/MLS
    2025 team-games. Rebuilt EPL/MLS 2025-26; City 77/35, United 69/50 match
    ESPN. The row is "Goals / match" again; cache key v8.
  - MLS 2026 logs start 2026-08-15 (R7-F1), so strength falls back to 2025 for
    sides 25 games in; the shared note now says what the app HOLDS, not what
    the season had.
- **8.3a — soccer page, 2026-09-17:** `readSoccerGameResearch` (EPL and MLS,
  `/api/game-research?sport=soccer_epl|soccer_mls`), the soccer route on
  `GameResearchPage`, two new graphics (`MatchTimeline` as a `timeline` card,
  `FullPitchScatter` as the `fullpitch` scatter surface). Final: match flow,
  shot map with located-shot counts, lineups, team stats, lines with the draw
  and props against results (yes/no settled Yes/No), commentary, and the
  kickoff research. Pre: Matchup, lineups once announced, Players, injuries,
  lines. Live: Right now (score, last event, props tracker, in-game
  moneylines), then flow, shots, stats, lineups, commentary. Form and head to
  head now come from one shared `readEspnForm` (football moved onto it).
  Refereed: located shots 16 and 6 equal ESPN's team shot totals; City's red
  card at 22:23 sits in the 23rd minute; the goal is mirrored to City's
  left-hand goal. Rendered MUN v MCI (final), ARS @ BHA (EPL, pre) and SD @ MIA
  (MLS, pre) at 1440 and 400. **Live soccer render owed** on the next matchday.
- **Step 0 (tennis), 2026-09-17:**
  - **ESPN has no tennis match summary** (every `summary?event=` form returns
    400); the match is read off the scoreboard. **The scoreboard returns nothing
    for a short past date RANGE** (`20260817-20260821`: 0 events) but 131
    singles matches for either single day inside it, so single days are read,
    with the match date from `player_game_history`. The old tennis game route's
    21-day range read (`fetchTennisMatchDetail`) is subject to the same gap; it
    is superseded by this page and goes with the old GameDetail deletion.
  - Serve and return stats exist only in the TennisMyLife archive, which ends
    2026-08-30 for both tours; game logs hold sets and games only. The archive
    dates a match differently from ESPN (Paul v Zverev: ESPN 08-19 18:00 UTC,
    archive 08-20), so the nearest meeting within a fortnight is matched.
  - **R8.3b-F1 (model track):** about 10,500 ATP game-log rows a season (2024-26)
    are ALSO stored as `tennis_wta` with the same event and athlete ids, written
    by the 2026-08-29 backfill (e.g. 181891 under both). Pages keyed by athlete
    id are unaffected; anything counting a tour's rows is inflated.
    **Cause, 2026-09-17:** at joint events ESPN's atp and wta scoreboards both
    return all five draws, and neither the backfill nor the daily freshness
    pass filtered on the grouping slug (`game_context.py` already did). So it is
    both ways (women as ATP too) and doubles pairs were stored as athletes
    ("3126-2946"). **Writers fixed** (singles slug per tour). Dry run against a
    fresh filtered sweep of 2024-26: of 100,516 rows, 46,356 belong to no match
    of their tour's singles draw (21,170 doubles, 25,186 the other tour's
    singles, 0 unexplained); the two tours' kept sets share no match.
    **CLEANED 2026-09-17, after the worker carried the fix** (deploy
    dep-daltnt0u01pc73e0f2dg, so the daily pass could not write them back):
    exactly 46,356 rows deleted in one transaction that would have rolled back
    on any other number, then the backfill re-ran 2024-26 and recovered 652
    singles rows the old sweep had skipped. After: 0 doubles rows, 0
    (event, athlete) pairs shared across tours, 0 matches filed under both.
    Event 181891 is ATP only, Paul over Zverev 2 sets to 1. Distinct 2026
    athletes fall to ATP 473 / WTA 747, from 1,675 / 2,358. **ESPN's WTA
    scoreboard genuinely covers more events than its ATP one** (5,076 matches
    against 3,229 in 2026, 125s and smaller draws included) — that gap is the
    source's, not a leftover of this bug.
  - Odds: moneylines (76 matches in book lines, 17 in history); props on aces,
    games won and to win a set. Opponent names come from ESPN's athlete endpoint.
- **8.3b — tennis page, 2026-09-17:** `readTennisGameResearch` (ATP and WTA,
  `/api/game-research?sport=tennis_atp|tennis_wta`), the tennis route on
  `GameResearchPage`. Final: set by set with tiebreak points and the match facts,
  match stats from the archive (or "not in the archive yet" with its end date),
  form (last ten each, and surface record and serve numbers against this
  match), head to head, match odds and props against results. Pre: form, head
  to head, players (games won and to-win-a-set history; aces have none), lines.
  Live: Right now (sets and games, props tracker, in-game moneylines). The hero
  shows rank and seed where a team sport says Away/Home (`GameSide.sideLabel`).
  Refereed: Paul v Zverev's archive row equals G2's fixture stat for stat, and
  the page's derived rates (66%/69% first serves in, 32%/30% return points,
  100-98 total points) check by hand. **Live, verified on WTA Guadalajara
  Samsonova v Day (183799) mid-second-set:** the page first showed 1-1 in sets
  and settled Day's "to win a set" as Yes while she led the second set 1-0;
  sets now count only on ESPN's `winner` flag, and the page matches ESPN (1-0,
  second set 0-1). Rendered final, live and pre (Bejlek v Bucsa) at 1440 and
  400.

**R8.4 (NBA and NHL) progress:** split into R8.4a NBA and R8.4b NHL. Neither
league plays until October, so each is built and checked on last season's G2
games; the live states are owed then.
- **Step 0, 2026-09-17:**
  - NBA: ESPN's summary serves OKC @ LAL (401811010) in full: 448 plays with 311
    located, 448 win-probability points, lead tracker, 3 scoring runs of 8+,
    the regular-season series, pickcenter, box and injuries.
  - **ESPN's NBA shot coordinates are rim-origin feet**, the system
    `CourtScatter` already draws: all 124 shots whose text states a distance
    sit within 2 ft of a rim at (25, 0) (mean 0.69 ft); the closest three is
    22.6 ft. Free throws carry the -2^31 sentinel `parseCourtPlays` drops.
  - NHL: the page, game logs and rollups key NHL's own ids (2025021270); ESPN's
    summary of the same game (pickcenter, season series, injuries) is a
    different id (401803621), so the NHL page needs an id bridge. Shots,
    goalies and penalties come from api-web play-by-play and boxscore.
  - No `game_odds_history` and no `prop_odds` held for either league (the
    offseason); `game_odds_book_lines` has two NHL 2026-27 games under NHL ids.
  - Season numbering differs: NBA 2025-26 is 2026 (ESPN's year), NHL 2025-26 is
    2025 (the rollups).
- **8.4a — NBA page, 2026-09-17:** `readNbaGameResearch`
  (`/api/game-research?sport=nba`), the NBA route on `GameResearchPage`. Final:
  game flow (win probability, lead tracker, scoring runs), the shot chart on the
  half court with shooting within 8 ft and from three, team stats, box score,
  lines with the season series and props against results, play-by-play, and
  the research at tip-off. Pre: Matchup, Players, injuries, lines. Live: Right
  now. ESPN's box parser is now shared (`lib/sports/espn/boxscore.ts`) by
  football and basketball. Refereed: OKC's located attempts 45/89 equal its box
  line (the Lakers' play-by-play lists one attempt more than ESPN's own box);
  OKC -17.5 covered by 36; 210 went under 221.5. Rendered final and the review
  of pre at 1440 and 400. **Live NBA owed in October.**
- **8.4b — NHL page, 2026-09-17:** `readNhlGameResearch`
  (`/api/game-research?sport=nhl`, NHL game ids), the NHL route on
  `GameResearchPage`. Final: game flow (cumulative shot attempts by minute,
  since the NHL publishes no win probability; scoring with each goal's
  strength; shots and attempts by period), the shot map on the rink (every
  attempt turned to one net), team stats, the box score with goaltending and
  penalties, lines with the season series and props, play-by-play, and the
  research at puck drop. Pre: Matchup (form and head to head from api-web club
  schedules), Players, injuries, lines. Live: Right now.
  - **ESPN id bridge:** ESPN's scoreboard for the game's date, matched on both
    teams' full names, gives the ESPN event (401803621 for 2025021270) for
    pickcenter and injuries.
  - **NHL game ids are ten digits** and failed the route's nine-digit id rule
    (400 on every NHL game); `nhlGameId` validates their fixed shape (season,
    game type 01-04, game number) and the reader names its own validator.
  - **A goal's strength** reads api-web's four-digit situation code with a
    pulled goalie's extra skater taken out: FLA's two late goals (code 1560)
    first read "short-handed, empty net" and are empty-net goals at even
    strength.
  - Refereed on FLA @ TOR (6-2): shots on goal from the events 25 and 19 equal
    the right rail; goals by result plus goals equal shots on goal; goalies
    Woll 19 saves on 4, Tarasov 17 on 2; season series 2-2; FLA +1.5 covered,
    8 over 6.5. Strength before the game (TOR 244 goals for and 280 against
    over 79 games) is a shootout short of the NHL standings (245, 284) by
    design: a shootout decider counts as a goal there, not in the rollup.
  - Rendered final and the review of pre at 1440 and 400. **Live NHL owed in
    October.**


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

## R9 — Visual density on the three research pages ◆ SIGNED OFF 2026-09-17

**Why.** Operator review 2026-09-17, on the rebuilt pages: "some parts are very
strong including icons, player images, team logos, while a good portion of the
section look like plain text tables... no boldness, very bland." Named: margin
by game unreadable and its opponent logos gone.

**What the audit measured (same day, whole repo):**

| finding | number |
|---|---|
| Table cards built across every sport | 99 |
| Every other card kind together (series, scatter, histogram, percentiles, field, timeline) | 50 |
| Rows that set `imageUrl` — the avatar slot `TableCard` already renders | 11, in 6 files |
| Chart primitives built in R3 and used only by the OLD components | 5 (`StreakStrip`, `SplitDumbbell`, `RangeBar`, `ContributionBars`, `PercentileRail`) |

Three causes, in order of what they cost the page:

1. **Identity is supported and not passed.** `TableRow.imageUrl`/`imageKind`
   render an `Avatar` in the label cell. Only MLB's game page (batters,
   starters) and the team page (opponent, standings, roster) set it. Head to
   head, prop lines, splits, team stats and every NBA/NHL/soccer/tennis game
   table pass text.
2. **The renderer's vocabulary is table-shaped.** `ResearchCardView` handles
   nine kinds; the five richest R3 primitives are not among them, so a rebuild
   that wanted a strip or a dumbbell had a table as its only option.
3. **A fixed-size chart.** `Histogram` is `width=420 height=180` with the band
   split across every bar: 153 games gives a bar under 3px, which is the
   operator's unreadable margin chart, and leaves no room for a logo tick.

### R9a — identity everywhere (A + E)

Set `imageUrl` on every table row naming a team or player, and put the side's
crest in headers that name one (`SD produce` / `COL allow`). No new component:
it is threading a field the type already has. Sports own their URL helper
(`mlbHeadshot` and the like) — the pass is per adapter, not per component.

**BUILT 2026-09-17.** `lib/sports/shared/identity.ts` holds every URL builder
(four copies of the ESPN headshot path existed before it), and
`ResearchColumn.imageUrl` puts a crest in a one-sided header. Filled: MLB
(batters, plays, longest balls, props, injuries), football (leaders, box, props,
injuries, scoring rows, drives, team-stat headers), NBA, NHL (mugshots, which
need season AND team as well as the player), tennis (archive opponents, the
per-side columns, each side's own flag), the shared strength headers, head to
head (the winner's crest) and both prop tables, plus the player page's opponent
splits.

- **R9a-F1, measured before shipping it:** ESPN's headshot path is not stocked
  for soccer — 1 of 12 for the United and City XI, and the summary carries no
  `headshot` href to fall back on. NBA 3/3, tennis 2/3, NFL, MLB and the NHL
  mugshots all resolve. So soccer keeps its crests and shows no faces: twelve
  identical grey silhouettes are noise, not identity. Recorded in `identity.ts`
  so the next person does not re-add them.

**R9a-F2, found by the operator 2026-09-17 on a LIVE game:** the props tracker
had no faces, and nor did four other tables. The gap was in the VERIFICATION,
not the idea — R9a was checked on final and before-start pages, because no game
was live at the time, so every live-only card went unlooked-at and unfilled.
Fixed: the live props trackers (MLB, football, tennis, soccer), the NHL and
tennis player-prop tables, MLB's hitters-vs-the-starter table, and the football
and NHL play-by-play rows, which now carry the side's crest. Soccer's player
rows carry the CLUB CREST in place of the face ESPN does not have, so
`imageKind` now follows the image rather than always saying 'player'.

**The check is repeatable, and should be re-run after any card work:** grep
every `labelHeader:` in `lib/sports`, keep the ones naming an entity (Player,
Batter, Skater, Opponent, Team…), and look 30 lines either side for `imageUrl`.
It flagged 15, of which 8 were real and 4 were rows built outside the window.
After the fix the only entity tables without an image are soccer's, by design.

**Verified** at 1440 on DAL @ NYG (401872930): crests in the team-stats headers
and on every scoring row, faces on the leaders and the box; MUN v MCI squads
clean; Ohtani's opponent splits carry the opposing crest.

### R9b — charts that fit their data (D)

`Histogram` responsive with a minimum bar width, horizontal scroll past ~60
bars, taller (240-280), and an optional logo tick per bar where one fits.
Fixes margin by game and both "coming in" cards.

**BUILT 2026-09-17 (R9b).** `Histogram` takes `minBand`, the width one bar is
entitled to: past it the chart draws wider than its host and the host scrolls
(`ChartFrame.minContentWidth`) instead of shrinking the bars. A bar also carries
`imageUrl`, drawn as the opponent's crest once the band clears 17px, with the
"@" kept beside it so an away game still reads as one. Margin by game: 20px a
bar, 260 tall, 153 games = 3,106px of scroller. The two "coming in" cards: same
band, 210 tall, crests from the ESPN schedule (which does carry them —
`FormGame.opponentLogoUrl` now threads them through, and MLB and the NHL fill it
from their own sources).

- Fixed in passing: the axis label sat at the START of its band while anchored
  middle, so every label was half a bar to the left of the bar it named.
- **Trap, cost one render cycle:** the SVG kept `max-width: 100%`, so the
  browser scaled the 3,106px chart straight back down to the card and the bars
  were thin again. It is now `none` whenever the chart scrolls.
- The payload grew a field, so the game-research cache key is **v9**.

**Verified** at 1440 and 400 on the Dodgers (153 games: readable bars, crests,
card scrolls, page does not) and DAL @ NYG before kickoff (both form charts
carry crests and the away "@").

### R9c — emphasis inside tables (C)

In `DataTable`: an optional in-cell magnitude bar behind a number, the leader
per column in bold, and a heavier key column. One change, all 99 tables.

**BUILT 2026-09-17 (R9c).** `DataTable` takes two per-cell signals, both
computed by the caller because only it knows what a column means: `bar` (0..1
behind the number) and `strong` (this cell leads its column). The first column
is always the heavier one — it carries the row's identity — which is the part
every table gets for free.

- **A bar says HOW MUCH, never how good.** Neutral ink, so it cannot be read as
  a verdict on a stat where less is better (interceptions, fumbles). Only
  `leader` claims an extreme, and only where the adapter says which end counts.
- **Two table shapes need two scales**, which is the real content of this
  sub-phase. Rows-are-entities (a box score) scales each cell against its
  COLUMN's largest. Columns-are-the-two-sides (Team stats, shot summaries)
  scales against the ROW's own total, so the two teams read against each other
  and not against the biggest number in the table: `compare: 'row'`.
- **A cell is a magnitude only when the whole cell is one number.** ESPN's team
  stats arrive as strings, so "21" and "45.5%" count while "22/34" and "0-0"
  draw nothing rather than being guessed at.
- Filled: team stats and shot summaries on football, soccer, NBA and NHL (row
  scale); MLB batting hits, NHL points, and the ESPN box's own YDS/PTS columns
  by label (column scale, with the leader marked).
- **Caught in review:** the hits bar first landed on MLB's PITCHING lines,
  where "most hits" reads backwards. Moved to batting.

**Verified** at 1440 on DAL @ NYG (row bars per stat; `22/34` correctly bare;
Dart's 230 yards bold and barred) and CWS @ CLE (hits barred, leader bold).

### R9d — restore the lost primitives (B)

Add `streak`, `dumbbell`, `range` and `contribution` card kinds to
`ResearchCardView`, then convert the tables that are really one of those. First
and smallest: the prop tracker's `Last 5`, today `values.join(' ')` — the digits
`0 1 1 0 1` in the operator's screenshot — becomes a `StreakStrip`.

**BUILT 2026-09-17 (R9d).** Two of the four, and a measured reason for the
other two.

- **`streak` is a CELL, not a card** — which the plan had wrong. The operator's
  `0 1 1 0 1` is one column of one table, so a card kind could never have
  replaced it. `ResearchColumn.streak` reads the row's `streaks[key]` and draws
  `StreakStrip`: the last five against the line, oldest faintest, each cell
  titled with its date and number. It sorts by hits, not by text.
- **`dumbbell` card kind**, used for the team page's **Home vs away**: runs for,
  runs against, differential and win %, each a line from the home number to the
  away one, only where both sides have games. A table made the reader subtract
  two rows to see the split.
- **`range` NOT BUILT, for want of data.** `RangeBar` draws each book's price
  around a consensus; `MainGameLine` carries the MEDIAN price and a book COUNT,
  not the per-book quotes (`gameLineHistory.ts`). Drawing a range from "best
  over" to "best under" would be two different markets on one axis. It needs
  per-book prices on the payload first.
- **`contribution` NOT BUILT, for want of a model.** `ContributionBars` shows
  what pushed a prediction; these pages carry no prediction — model work is
  `master-plan-2026-09-06.md`'s C3, deferred. Building it here would mean
  inventing the numbers.

**Verified** at 1440: CWS @ CLE's prop table draws the strip in place of the
digits (headshots beside each player), and the Dodgers' Home vs away reads 4.6
→ 5.0 runs for, 63% → 59% wins.

**Order:** R9a, R9b, R9c, R9d. a and b answer the two named complaints; c
lifts every table at once; d is the largest and is done per page after.

**Verify:** render each sub-phase at 1440 and 400 on one page per sport
(`scratchpad/g2render.py`), against the same games the R6-R8 records name.
**Stop after each sub-phase.**

---

## R10 — Compare control ◆ medium

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

**Step 0 — premises audited 2026-09-17, before building.** Three of the brief's
claims needed correcting, and the rest hold:

| premise | measured |
|---|---|
| "what this team allows to the position" for every sport | **Partly.** `team_game_production` carries position groups for nfl (QB/RB/TE/WR), nba (G/F/C), nhl (F/D/G) and soccer (GK/DEF/MID/FWD) — but mlb and cfb hold `all` ONLY, by design (`team_production.py`: MLB splits by stat group already, and the plan names no CFB source). G2's own ALLOW map already uses the whole-team `allowed`/`for` side for those two, so the cards match; the phrase "by position" does not apply to them. |
| Tennis serve/return profiles from TennisMyLife | **Holds, but not from a table.** There is no tennis table in Postgres; the stats come from `tennismylife.ts`'s fetched archive (`ServeStats`: aces, double faults, first in/won, break points). Looking for a DB table would have concluded this compare was impossible. |
| `nfl_target_events`, `nba_shot_events` | Hold: 36,375 and 440,596 rows. `nhl_shot_events` has 310,376 as well. |
| The shot-profile rollup | Table is **`team_shot_profile`**, singular, not `team_shot_profiles`. |
| A league team directory for the picker | Already exists: `playerHistoryServer.loadDirectory` resolves id → name, abbr, crest per sport from each league's own source. Not exported yet. |
| `player_game_history.opponent_id` for "games against them" | 732,014 rows, opponent non-null throughout — and the player page ALREADY holds the player's full history client-side, so the games-against-them cards need no new fetch. |

**R10.1 BUILT 2026-09-17 — the control, and the player against a team.**
`?vs=<teamId>` in the URL (so a compared page is a link), the picker under the
prop block where G2 puts it, and two cards:

- **Against THEM**, built from the history the page already holds — no second
  fetch. Each stat is a line from the average against that team to the average
  across every game held (R9d's dumbbell), with the game log beneath it. The
  sample is printed, never hidden: "5 of 223 games held".
- **What they give up**, from `/api/player-compare` (cachedRoute, 30 min, key
  `player-compare:route:v1:…`), as league-ranked rails. `ResearchLogRow` gained
  `opponentId` so the first card can filter without asking the server.

**Refereed against StatsAPI**, SF's 2026 offence (the card a pitcher sees):
runs 4.24, hits 8.42, home runs 1.14, strikeouts 8.06, walks 2.80 per game over
153 games — every one exact. Rendered SGA vs Chicago at 1440: 5 of 223 games,
29.0 points against them against 31.0 overall, and CHI giving up 58.8 points a
game to guards (12th), 17.7 assists (2nd).

- **R10-F1:** MLB's kind comes from whether the player has pitched, so a
  two-way player (Ohtani) gets the pitcher's card — the lineup he will face —
  and not the hitter's. Correct for the card that exists; a two-way page wanting
  both is R10.4's business.

**R10.2 BUILT 2026-09-17 — the player against a peer.** `?peer=` in the URL, a
picker of the league's producers in his own position group, and the two seasons
lined up stat by stat (the dumbbell again). The peer's numbers cost no new
machinery: his history comes from the same `/api/player-history` and his page
data from the same adapter, because a peer is just another player.

- **What made this a server read at all: names.** `player_game_history` holds
  none. Measured 2026-09-17: `athlete_crosswalk` names 1,629 of MLB's 1,657
  season producers and 947 of the NHL's 1,123, and **nothing** for NBA, NFL,
  CFB or soccer, whose ids are ESPN's — the crosswalk's `espn_athlete_id` joins
  nothing at all. So `/api/player-peers` names from the crosswalk where it can
  and from each league's team rosters otherwise (one call per team, not per
  player), and drops anyone it cannot name rather than offering a bare id.
- The list is cached per POSITION GROUP, not per player, so one guard's page
  warms it for every other guard; the subject is filtered out on the page.
- **R10-F2:** MLB's production score mixes batting and pitching, so a two-way
  player tops the PITCHER list on his hitting (Ohtani, 134 games). The list is
  honestly "players who pitched, by production score"; splitting the score by
  role is model work, not page work.

**Verified** at 1440: SGA vs Luka Doncic, 2025-26 per game — 33.3 against 35.4
minutes, 31.1 against 33.0 points, 4.3 against 7.6 rebounds — beside SGA's five
games against Chicago and what Chicago gives up to guards.

- **Player picker:** replaces the fixed peer list, filtered to position, with
  search.
**R10.3 BUILT 2026-09-17 — team against team, first on the team page.** `?vs=`
again, and **no new server work**: the page's own payload already carries this
team's per-game stats (with every team's value behind them), its schedule and
its roster, and the other team's comes from the same `/api/team-research` the
page itself uses. Three cards: both sides' stats as a line each, the meetings
from this team's own schedule, and each side's top producers.

- **The picker cannot come from the standings**, which a payload holds only for
  the team's OWN league — 15 of MLB's 30, so a Dodgers page could not reach the
  Yankees. It reads the rollup's team list instead (`/api/player-compare` with
  no athlete, which now answers with teams alone); the standings remain the
  fallback if that call fails.

**Verified** at 1440: LAD vs NYY across leagues — 4.96 runs a game against
4.59, .255 against .235, ERA 3.64 against 3.79 — with the three July meetings
and both top-producer lists. SF's 4.24 runs a game matches the StatsAPI figure
refereed in R10.1.

**R10.4a BUILT 2026-09-17 — NBA's own compare card.** "Where he shoots, against
what they allow": his share and FG% by zone beside what that team gives up to
his position group. Both sides already existed — his attempts from
`/api/nba/shots` (the page's own shot chart) and the opponent's from
`team_shot_profile.allowedPos`, whose route header had named this card since R5c
— so the work was a join, not a source. A sport's compare card is a named
`extras` slot the page fills, never a `sport === 'nba'` branch inside the shared
section.

- **R10-F3, and the reason to measure rather than assume:** the rollup writes
  the zone as **`Above-break 3`** while the player page's own card calls it
  "Above the break 3". Matching on the display name silently dropped that row
  until the real keys were read back from the API.

**Verified** at 1440, SGA against Chicago: 25% of his attempts at the rim at
71.4%, against 27% allowed at 62.0%; 1% from the corner against 12% allowed.
Both share columns add to 100.

**R10.4b BUILT 2026-09-17 — football's compare card.** "Where he is thrown to,
against where they are thrown at": his target share and catch rate by depth and
side, beside the defence's. Same shape as NBA's and the same reason it was
cheap — `/api/nfl/team-targets` has named this caller since R5d. The defence is
taken BY the targeted receiver's position where the rollup has it, and the whole
defence otherwise.

- **Share, not volume**, is what lines up: a season of his targets against a
  season of a defence's is not a comparison. Both columns add to 100 of their
  own side, and the caption says so.

**Verified** at 1440, George Pickens against the Giants (251 located targets):
38% of his targets short left at 74% caught, against 22% of what NYG face there
at 67% allowed. Both share columns total exactly 100.

**R10.4c BUILT 2026-09-17 — MLB's hand card.** What the chosen opponent has done
against players who bat or throw as this one does, from the stored Statcast
rollup's `vsHand` split. **Which side answers depends on what he is**, and
getting it backwards would be the card's one real error: a hitter faces their
STAFF (`pit.vsHand[his bat hand]`), a pitcher faces their LINEUP
(`bat.vsHand[his throwing hand]`). A switch hitter ("S") is neither column, so
the card is left out rather than picking a side.

- `/api/mlb/team-statcast-season` is new and deliberately NOT the existing
  `/api/mlb/team-statcast`, which serves the older league-wide contact tiles and
  carries no hand splits. Pattern 2, a direct read of `mlb_team_statcast`.
- The rows do not share a unit (.254, 20.2%, 87.7 mph) and a column formats
  every cell the same way, so each row prints its own number.

**Verified** at 1440: Ohtani (throws right) against San Francisco shows "How
SF's lineup hits right-handed pitching" — 3,852 plate appearances, .254, 20.2%
strikeouts — matching the API exactly.

**R10.4d BUILT 2026-09-17 — tennis compare, from the archive.** Tennis has no
team rollups, so its compare is player against player: serve and return side by
side (each rate over its OWN denominator — first-serve points won is of first
serves in, and the return number is the server's loss turned around), plus head
to head from the subject's own archive rows, which name their opponent. The
picker lists the players he has actually met, so a chosen peer always has a
meeting to show.

- **R10-F4 WITHDRAWN 2026-09-18 — it was the browser pane, not the app.** The
  finding said a tennis player page loaded by URL makes no client fetches and
  shows skeletons forever. It does not: a browser-pane tab that has navigated
  many times stops running page effects, and both the original check and the
  "pre-existing" stash check were made in the same worn tab. In a fresh tab the
  page loads normally. **Lesson: verify every render in a fresh tab
  (`tabs_create`), and re-check any "nothing loads" finding in one before
  recording it.**
- **Rendered on prod 2026-09-18:** Samsonova (`espn:tennis:3840`) against
  Sabalenka — serve and return over 196 and 269 matches, head to head 1-4 over
  five meetings, 103 met opponents in the picker.
- **R10.4d-F1, fixed on the spot:** every head-to-head date read "Invalid
  Date". The archive's `date` is a full ISO timestamp (`toIsoDate`) and the
  card appended `T12:00:00Z` to it; the test passed because its fixture used a
  bare day. The card now takes the first ten characters, and the fixture uses
  the real shape and asserts the label (`tests/compare-tennis.test.ts`).

**R10.5 FIXED 2026-09-18 — the Players tab loads with no games on, every
sport.** The operator has asked three times for players and teams to load
whatever the slate. Team pages already did; player DETAIL pages were freed in
R6.1a; the Players INDEX never was: it built its whole list from
`snapshot.subjects`, so a day with no games said "No players on today's slate"
and left the search box nothing to search.

- `/api/player-index` lists every player a sport holds — `player_season_production`
  for the seven rollup sports, `player_game_history` for tennis — named by the
  resolver R10.2 built (crosswalk, then team rosters; a player nobody can name is
  left out). Today's slate still leads the list; the index follows it, so "no
  games" costs a badge, not the page. Golf keeps its tournament field.
- **Two duplicates caught in the render, both fixed:** the slate keys players
  by the namespaced id and the index by the bare one, so matching raw strings
  listed **461 NBA players twice**; and the rollup is one row per player PER
  TEAM, so a traded player (Cam Thomas, Jaden Ivey, ten more) appeared once per
  stint. The index is now one row per player, his current team the last he
  played for.

**Verified:** all nine leagues answer (NFL, CFB, MLB 600 each; NBA 582; NHL 593;
EPL 382; MLS 585; ATP 296; WTA 334) with no repeated id, and the NFL tab — the
operator's screenshot, no games scheduled — lists every player with position
chips and opens A.J. Brown's page. The one name still twice in the NBA list is
two different Brandon Williamses.

**R10.6 BUILT 2026-09-18 — compare views, the right stats, and collapsible
sections (operator's asks).**

- **The stats were wrong, and it was a truncation, not the data.** Compare took
  the first six numeric columns of the season table; for an MLB hitter that is
  PA, AB, H, 2B, 3B, HR — raw counts that mostly measure playing time (Jensen's
  567 PA against Burleson's 642). The rate columns were cut off at the end. Both
  player compares now read the spec's SPLIT columns — the per-game and rate
  stats each sport chose for comparing (AVG, OBP, SLG, HR/G, K/G, TB/G) — the
  "against them" card from the all-seasons split set, so it covers every
  meeting held.
- **`CompareView`: Table, Bars or Lines** over the same rows, opening on the
  table (both numbers and the signed gap). The operator found the dumbbells hard
  to read; Bars puts each stat on its OWN scale so a .300 average is not
  flattened beside 30 home runs. The leader is bolded **only where the stat
  declares its direction** — team stats do; a player's split column does not (a
  hitter's K/G is better low), so there the gap is shown and nobody is crowned.
- **Every `Section` collapses as a whole**, from its header — one change in
  `components/ui/Section.tsx`, so the player, team and game pages all have it.
  Component state, so each page load opens fully expanded as asked; the body is
  hidden rather than unmounted, so cards keep their toggles and charts
  re-measure through their ResizeObserver.

**Verified** at 1440: Jensen vs Burleson reads .235 against .284 AVG, K/G 1.12
against 0.74, nothing bolded; Bars renders each stat on its own scale; hiding
Compare shortens the page from 9,492 to 7,846px and showing it restores all
four cards; the Dodgers page has seven collapsible sections and marks LAD ahead
on runs, AVG, OBP and SLG against the Yankees.

**R10.4e BUILT 2026-09-18 — golf against the field** (G2 `golfCompare`). Golf
has no opponent, so its compare is a section on the golf page: for each event
he played, his score each round beside the average of everyone who played every
round held (a missed cut drops out, so a later round is not averaged over a
weaker set of players), the strokes he gained on them, and the field's
leaderboard with him marked — appended below the top eight when outside it.
Names come from ESPN's event leaderboard, one call per event, because the round
table holds ids only.

- **Refereed against G2's own dataset** for 9478: field size and every round's
  field average match to three decimals at all three playoff events. The one
  difference was a TIE — G2 numbered tied golfers by sort order (BMW: 13th); a
  leaderboard gives them the same place, so it now reads **T12th**.
- Verified by building the section end to end against the database (six cards,
  toned strokes gained, named leaderboards). **Render owed:** the isolated
  `linesmith-dev-verify` server answered 404 to every route (R10-F6, tooling),
  and the prod server was left alone while the operator tested.

**R10 G2 SWEEP DONE 2026-09-18.** Every sport's "what they give up" spec against
`matchup-<sport>.json`, every team, on a season that was over when G2 was built:

| sport | sides | result |
|---|---|---|
| NFL 2025 | QB, RB, WR, TE by position | exact — 0 of 576 values differ |
| CFB 2025 | whole defence | exact — 0 of 924 |
| NHL 2024 | skaters, goalies' opponents | exact — 0 of 352 |
| MLB 2025 | staff allowed, lineup for | exact — 0 of 300 |
| EPL 2025 | goalkeeper (the opponent's attack) | exact — 0 of 60 |
| NBA 2025, EPL 2025 | allowed BY POSITION | differ — see R10-F5 |

- **R10-F5 — the reference is incomplete, not this app.** The NBA and EPL
  position splits read higher here than in G2 on every group, while the
  whole-team totals match exactly. Measured: G2's position groups hold only
  **89.6%** of NBA team points and **78.6%** of EPL team shots — G2 dropped every
  player it had no position for — where this app's hold **100%**, because
  `athlete_positions` finished filling after G2 was built. Treat G2's
  position-split numbers as a lower bound, not a target.

- **Delete:** `MatchupExplorerCard` and the `matchupExplorer` field (R1h's floor
  goes with it). **DONE 2026-09-18, on the operator's word after comparing the
  two:** the component (with R1h's floor inside it), the field and its four
  types on `PlayerDetailData`, and the builders in eight sport adapters.
  Cut with care, not by pattern: NFL's block held the `opponentUnit` role,
  which other code still reads, so only the builder statement went there.
  `NflPlayerVsDefenseCard` stays — the old `GameDetail` still uses it, and R11
  deletes that. `tests/unit-grades.test.ts` now fails if either comes back. Full
  suite 564/564. (Previously: **NOT DONE — deliberately left for the operator's return:** it
  spans eight sport adapters, `playerRoles.ts` and the old prop block, and it is
  the one part of R10 that removes something a person may still be looking at.
  Compare now covers what it did for player-against-team.)

**Verify:** the G2 compare URLs (default opponent, a chosen team, a peer) for
each sport, against `data/matchup-<sport>.json`. **Stop.**

---

## R11 — Port-artifact cleanup ◆ small–medium

After R6–R10, so nothing is renamed twice. Fields the rebuilds already deleted
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

### R11 — DONE 2026-09-18 (built while the operator was away), awaiting sign-off

**Step 0 found the phase bigger than its list.** The old `GameDetail` page was
rendered by no route (every game route has used `GameResearchPage` since R8);
only type imports kept it compiling. So R11 opened with the deletion, found by
an import-graph reachability pass from `app/**` rather than by pattern.

- **R11a part 1 (`8bdd411`)** — deleted `GameDetail.tsx` (2,440 lines),
  `GameHeroCard`, the pitching/batter/NFL-defense matchup cards, the five live
  tabs, 12 hooks, the seven `gameDetailAdapter.ts` files (MLB's research half
  moved to `mlbGameResearch.ts`, like every other sport's), **17 API routes**
  only those hooks called (the `/live` routes stay: live hooks poll them), and
  what that left dead — including the whole `/api/season-ranks` machinery
  (`seasonAggregates*`) and unit grades. Seven files already orphaned by
  earlier deletions went too. PlayerDetail's `embedded`/`sharedPropOdds`
  props (only GameDetail set them) are gone and `subject` is required.
  `GameDetailGame` moved to `lib/sports/mlb/slateGameShapes.ts` as
  `MlbSlateGame`.
- **R11a part 2 (`6dc28cb`)** — 138 unused exports removed (a comment-aware
  scan, cut with the TypeScript parser, cascaded to a fixed point in two
  rounds). Among them **TypeScript writers with no callers**: `writePropOdds`,
  the game-pick set, `logSurfaced`/`writeGrades`, `writePitcherGameScore`,
  `writeGameSimCache`, and `writeGameOddsBookLines` with its producer
  `recordEspnPregameLine` — which **wrote on GET** from the old per-sport game
  routes. Those tables are Python-only now (recorded in
  `table-ownership.md`'s preface; CLAUDE.md's normalisation paragraph
  updated). Kept on purpose: `runDevigBacktest` (6.24's research tool) and ten
  exports only tests use.
- **R11b (`f74d737`, `7bfe807`)** — **C1:** `nflSeasonStats` -> `seasonStats`
  (`hitterStats` was already gone). **C2:** 45 explicit `field: null` lines
  removed from the player adapters — except the six role keys, which are
  returned as `null` on purpose (`tests/player-roles.test.ts`). **C6:** moot,
  `pregameLines` went with GameDetail. **B3:** step 1 only, see F2.
  **Docs:** CLAUDE.md §4's worked example is now the scatter card's
  `surface`; the `seasonAggregates.ts` row-count fix is moot (file deleted).
- **Verified:** tsc clean, 478/478 tests, production build clean; rendered on
  prod in fresh tabs — player, team and game for MLB, NFL, CFB, NBA, NHL,
  soccer (EPL) and tennis (ATP; no team page), plus golf's player page. Every
  page drew every section with no error and no stuck skeleton, and the
  renamed "Season stats" rail card still shows on CFB, NBA, NHL and soccer.

**Findings:**

- **R11b-F1 (operator decision):** the rail "Season stats" card survives on
  CFB, NBA, NHL and soccer. R6.2 removed NFL's for repeating "Season by
  season" and said the others would follow in their sub-phases; they did not.
  It is **not** a pure duplicate for them — NBA steals/blocks/turnovers,
  soccer xG/xA/key passes, CFB kicking points and longest plays are not in
  "Season by season" — so dropping it needs those columns added to the
  Seasons spec first, or a decision to keep the card.
- **R11b-F2 (blocked on a worker deploy):** B3 `firstPitch` -> `startTime` is
  a cross-language contract: `python-odds-service/src/game_context.py` reads
  the MLB snapshot's `firstPitch` to date games for the odds-lines cycle.
  Step 1 is committed (Python reads `startTime` first, falls back to
  `firstPitch`; checked read-only against the live snapshot, 15/15 dated).
  **Step 2, the TypeScript rename, waits until the worker is redeployed** —
  renaming first would blank MLB game dates in the worker.
- **R11-F3 (small, routed to R12's build):** every game reader turns a failed
  upstream fetch into `null`, so an upstream hiccup reads "This game was not
  found" instead of "couldn't load". Fixed for NHL (`4030e75`, seen in the
  render); NBA, football, soccer, tennis and MLB share the pattern. Retry
  recovers, so nothing is stuck.

---

## R12 — Deep history on team and game pages ◆ large, design first

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

**R12 steps 1-2 DONE 2026-09-18: measured, and the design is written —
[`r12-deep-history-design.md`](r12-deep-history-design.md). AWAITING
APPROVAL; nothing built.** Headline measurements: team ids 94-100% filled
(the gaps are relocated franchises and exhibitions); cross-source duplicates
in every sport, and **MLB 217 / NBA 4 days where two sources disagree on the
score**, which R2's merge rule would double-count over a deep window — so the
design proposes one source per sport-season; no index on the team-id
columns; Elo deep only for MLB; venue names too sparse for stadium splits.
Four questions for the operator at the end of the design.

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
| C9 biggest edge without a floor | `MatchupExplorerCard` | R1h, deleted R10 |
| C8 soccer default market | soccer adapter | **resolved** R6.3 (`preferredSoccerMarket`) |
| C7 tennis surface | tennis adapter | R6 |
| C4 live card MLB-only | `PlayerDetail` | **filled for every sport**: MLB (R6.1d), NFL and CFB (R6.2), soccer (R6.3), tennis (R6.4), NBA and NHL (R6.5, `hoopsHockeyGameState.ts`). Four renders owed on live slates |
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
| R6-F3 `is_major` 0 on every tennis row ("grand slam" never appears in slam names) | `backfill_player_game_history.py:854` | **resolved on the page** (R6.4): By level reads TennisMyLife's `level`, ATP `M` and WTA `1000` both counted; the column fix is model track |
| R6-F4 MLB OBP over PA: no sacrifice flies stored per game | `player_game_history` MLB batting keys | labelled in R6.1a; adding `sacFlies` to the ingest is model track |
| R6-F5 MLB `game_result` has no game pk before 2026-08, UTC-dated night games, missing games | `game_result` (mlb) | R6.1a reads StatsAPI finals; R7/R8 MLB records must not join by date; source fix is model track |
| R6-F6 MLB and NFL past-game pages missing, so player game-log links would dead-end | `/mlb/game/[id]`, `/nfl/game/[id]` | R8 (links held off until then) |
| R6-F7 pitch corpus holds 281 of 2,229 regular-season 2026 games only in part (<3 pitches per PA); Statcast rollups cover 91-94% of a hitter's PA | `corpus/mlb_pitch_events`, pitch ingest | coverage stated on the page (R6.1b); the ingest gap is model track Phase 5 |
| R6-F8 ParlayAPI files a pitcher's strikeouts under `batter-strikeouts` (29 pitchers) and walks allowed under `walks` (9) on 2026-09-15; the page shows "Batter Strikeouts 7.5" for Yamamoto, and the pitcher markets miss those books | ParlayAPI market mapping, Python writer | model track (R5e writer work); the page shows the rows as stored |
| R6-F9 non-MLB candidates carry the main line from snapshot build time, which goes stale between rebuilds (Allen passing yards 249.5 in the stepper against a current 248.5) | NFL/CFB/NBA/NHL/soccer/tennis player adapters | **RESOLVED for every sport** (R6.2, R6.3, R6.4, R6.5) |
| R6-F10 the game page's `usePropOdds` reads current rows, so after the start its prices (and the embedded player's) are in-play and the main line finds no pre-game quote | `GameDetail` | R8 (pass the start, as the player page does) |
| R7-F1 MLS 2026 `player_game_history` starts 2026-08-15 (59 events; about 25 games a club played) | the soccer history writer | R7.4 pages state the logged share (`loggedGames`); the backfill is model track |
| R6-F12 `golf_hole_scores.category` holds only birdie/par/bogey: 47 eagles are filed as birdies and 178 doubles and triples as bogeys | the golf hole-score writer | R6.6 counts from `relative_to_par`; the column fix is model track |
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
| 6 (field collapse, B3) | R11 |
| 7 (deep history, Gap 1) | R12; Gap 1 → R6 seasons |
| Decisions 1–5 | §3 |
| Deferred list | R-deferred |
| Follow-ups B4, B8 | B4 → R7 team stats; B8 → R8 (CFB lines) and R-deferred (NFL id mapping) |
