# Resume prompt — research pages build (2026-09-16, R6 COMPLETE — R7 next)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md` (the sport-adapter rule 2 now names `toPlayerResearchData`)
2. `docs/CURRENT.md` (the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the status block
   (the R6.1 through R6.4 records), the R6 section in full including "R6 Step 0
   premise audit", §1, §2, "Also in R8", and Appendix A rows
   C4, R2-F4..F6 and R6-F1..F11.
4. The G2 player spec: `docs/design/phase-g2/src/player.html`,
   `src/sports/common.js`, `mlb.js`, `src/kit2.js`; datasets in
   `docs/design/phase-g2/data/player-*.json`.

## Where the work is

- **R1-R5 and R6.1 (MLB) signed off. R6.2 (NFL and CFB), R6.3 (soccer),
  R6.4 (tennis), R6.5 (NBA and NHL) and R6.6 (golf) complete** — R6 is done for
  every sport, with live renders owed (below). Next is **R7, the team page
  rebuild** (plan §R7); confirm before starting it.
- Commits: `512b42a` (Step 0), `0169de1`/`5c46b29`/`48abdc5` (R6.1a),
  `7893e82`/`478e196` (R6.1b), `007ced4`/`16051a7` (R6.1c),
  `4da5684`/`d6ffd09`/`6d2139e` (R6.1d), `1438855` (R6.2),
  `35d6be5`/`b2b0e98` (hero and live-card rework),
  `093923a`/`efdaa04`/`15f1b06` (R6.3), `4afd6e3`/`18e600b` (R6.4),
  `6d52caf`/`16aafa0` (R6.5), `5ff166b` (R6.6). Pushed only if the operator asked.
  Nothing deployed: R6 has changed no Python.
- tsc clean, 525/525 TS tests, `npm run build` passes (build with
  `LB_DIST_DIR=.next-verify` while a dev server holds `.next`; delete stale
  `.next*/types` first if a validator names a deleted route).

## OWED — renders that no slate allowed yet

Each sub-phase's live card and re-priced line are unit-tested but unseen,
because nothing of that sport was playable when the code landed.

- **Thursday 2026-09-18, NFL slate:** a player with a market and a live game —
  the C4 game-state card for football, and the prop block without its target
  grid and rail season card.
- **Saturday 2026-09-19, CFB slate:** the same two for CFB, alongside the
  `refreshCfbJob` check already owed from R1f.
- **Next EPL match day:** soccer's live card, and R2-F9 (the
  `soccer:snapshot:epl` 22 MB write, still unproven — today's slate was empty).
- **Next tennis match day:** tennis's game-state card (set scores) and its
  re-priced line. Nothing was on the ATP or WTA slate on 2026-09-15.
- **Next tournament:** golf's prop block and live view.
- **October, when the seasons start:** NBA's and NHL's game-state cards and
  their re-priced lines. The plan always marked these two unverified until then.

## Operator decisions (2026-09-15) — don't reopen

- **The player is the page, not the market.** Every route renders the player
  with or without a candidate; the shared sections land for every sport at
  once; sport sections stay per sub-phase.
- **MLB lines:** the player page's prop block uses `candidateLine()` for its
  line, hit rates and price; the model % shows only when the cached row's line
  equals the line on screen, otherwise it is labelled "model at 1.5". Scan and
  the Python model keep `BOARD_LINES`. (Built in R6.1d.)

## What R6 built (read before R7)

| piece | file |
|---|---|
| types, `historySportFor`, `athleteIdOf`, sections as data (`ResearchSection`/`ResearchCard`) | `lib/sports/shared/playerResearchShapes.ts` |
| shared builder + stat helpers | `lib/sports/shared/playerResearch.ts` |
| per-sport columns | `lib/sports/{mlb,nfl,nba,nhl,soccer,tennis}/adapters/playerResearchSpec.ts` (CFB uses NFL's) |
| history + bio | `playerHistoryServer.ts` → `/api/player-history`; `playerBio.ts` → `/api/player-bio` |
| sections UI | `components/PlayerResearchSections.tsx` (`ResearchSectionBody` draws any sport's section) |
| MLB sections | `lib/sports/mlb/adapters/playerResearchSections.ts` (hitter contact, pitcher arsenal) |
| NFL/CFB sections | `lib/sports/nfl/targetShapes.ts` (`nflTargetsSection`, `cfbEfficiencySection`), read `lib/sports/nfl/targets.ts` → `/api/nfl/targets`, hook `components/useNflTargets.ts` |
| soccer sections | `lib/sports/soccer/playerUnderstatShapes.ts` (`soccerChancesSection`, `soccerKeeperSection`), read `playerUnderstat.ts` → `/api/soccer/understat`, hook `components/useSoccerUnderstat.ts` |
| tennis section | `lib/sports/tennis/playerArchiveShapes.ts` (`tennisSurfaceSection`), read `playerArchive.ts` → `/api/tennis/archive`, hook `components/useTennisArchive.ts` |
| golf research | `lib/sports/golf/playerResearchShapes.ts` (`toGolfResearch`, `summariseGolfShots`), read `playerResearch.ts` → `/api/golf/player-research`, hook `useGolfResearch.ts`; no per-game history, so a sport's own sections render without one |
| NBA / NHL sections | `lib/sports/nba/playerShotShapes.ts` (`nbaShotSection`), `lib/sports/nhl/playerShotMapShapes.ts` (`nhlShotMapSection`), reads `playerShots.ts` / `playerShotMap.ts` → `/api/nba/shots`, `/api/nhl/shots`, hooks `useNbaShots.ts` / `useNhlShots.ts` |
| charts added | `Histogram`, `ZoneScatter`, `FieldScatter`, `PitchScatter`, `CourtScatter`, `RinkScatter`, `SpatialSurface` chase zones, `CATEGORICAL`; a series card can carry `axisFormat` when its stored values are not what the axis should read |
| one line on the page | `repriceAtMainLine` in `lib/odds/props/mainLine.ts`; `PlayerDetailData.priceCandidate` — **done for every sport** (R6-F9 closed) |
| odds section | `lib/odds/props/playerPrices.ts`, `components/PlayerOddsSection.tsx` |
| prices at the start | `/api/props/lines?start`, `usePropOdds(..., startIso)`, `useLineHistory(line, before)` |
| C4 game state | `GameStateSlot` (MLB adapter file), `components/GameStateCard.tsx`, builders `lib/sports/multiSport/footballGameState.ts` and `hoopsHockeyGameState.ts`; soccer's and tennis's live in their own adapters — **filled for every sport** |
| page frame | `components/PlayerDetail.tsx` (`renderPage(propBlock, propSub, nextGame, oddsCards, live)`); the hero and the live section are `docs/design/hero-live-rework.md` |
| verification | `scripts/measure-golf.ts`, `scripts/verify-player-history.ts`, `verify-player-research-g2.ts`, `measure-mlb-main-line.ts`, `measure-nfl-targets.ts`, `measure-understat.ts`, `measure-soccer-snapshot.ts`, `measure-tennis.ts`, `measure-hoops-hockey.ts` |

A sport's section is one function returning a `ResearchSection`; the component
has no sport check. The prop block keeps market tabs, stepper, chips, windows,
bars, matchup explorer and role cards; every odds card lives in "Odds & prices".

## Next: R7 team page (STARTED 2026-09-16 — Step 0, R7.1 (MLB) and R7.2 (NFL, CFB) done, see the plan's R7 section; R7.3 NBA/NHL after sign-off)

Each sub-phase adds a reader to `READERS` in `app/api/team-research/route.ts`, a spec and
`toTeamResearchData` in each sport's team adapter, a case in `teamResearchFor`
(`components/TeamResearchPage.tsx`), and switches that sport's panel in
`TeamDetailPanel.tsx`. Results come from each league's schedule (R7-C1): NBA via `fetchTeamSeasonGames`
(ESPN, seasontype 2/3), NHL via api-web `club-schedule-season` (gameType 2/3,
`lastPeriodType` for OT/SO). Standings for NBA can use `fetchStandingsGroups`.

Read the plan's R7 section in full: a hero with record and standing, one season
switch scoping the page (last season when the current one is under MIN_GAMES,
said so), results and schedule, standings per league source, and the team's
own sections. Spec: `docs/design/phase-g2/src/team.html`, `team-common.js`,
`team-sports.js`; datasets `docs/design/phase-g2/data/team-*.json`.

**Measure before building.** The premise audit corrected something in every
R6 sub-phase — tennis's eight keys, NFL's unwritten `interception`, NBA/NHL
shots being current, NHL totals already parsed, golf's repeating
`tournament_id` — so start with a script, not a card.

**Verify:** the G2 team subjects, one early-season team, 1440 and 400
(`scratchpad` Python Playwright pattern), tsc, `npm test`, `npm run build`.
**Stop for sign-off after each sub-phase.**

## Lessons from R6

- **G2's results are wrong on back-to-backs and series.** Referee scores
  against StatsAPI / api-web, never against a G2 `result`/`pf`/`pa`.
- **Read the existing notes on a stat key before using it.** `is_major` had been
  documented as always-zero since 2026-08-30 and still went onto the page until
  a render showed Alcaraz with no major wins.
- **A render finds what the numbers don't:** a rehab affiliate as the team, a
  truncated tile label, dead game links. Open the page.
- **Stopping the dev server can leave half-written `.next/dev/types`** that
  break `tsc`. Deleting the generated `types` folder fixes it.
- **The Browser pane can't screenshot while the window is hidden**; the venv's
  Python Playwright (`python-odds-service/.venv`) against the dev server works.
- **Render every sport's own page, not one representative.** R6.4's three
  defects were all invisible in the data and the tests: an axis that printed
  the same rank twice, copy that said "he" on a WTA page, and an "@ / vs"
  prefix on a sport with no home side. A women's-tour page and a men's-tour
  page are not the same check.
- **A stored column is not a true one.** Tennis rows carry `is_home` and
  `is_major`; neither means anything for tennis. Look at the values, per
  sport, before rendering a column.
- **Derive a coordinate origin from something the rules fix.** NBA's y is
  measured from the RIM, not the baseline; the proof was that a corner three is
  22 ft by rule, so only one candidate origin left zero impossible threes.
  Charts fail silently when the origin is wrong — the picture still looks like a
  shot chart.
- **A reused id is not a duplicate.** Golf's 137,396 "repeated" shot keys were
  the same event in different years; dropping them as duplicates would have
  been as wrong as merging them, which is what G2 did. Find what the key
  actually identifies before grouping on it.
- **The client-bundle boundary broke a third time** (R6.5), and again `tsc` and
  every test passed while the dev server returned 500 on every route. If a
  page-reachable file needs one predicate from a server module, move the
  predicate to a client-safe file and ADD THE SERVER MODULE to
  `tests/client-bundle-boundary.test.ts` — the list is the only thing that makes
  the next one fail a test instead of a page.

## Open items that are not R6's

- **R5-F5, model track:** the worker OOM loop. Don't chase it in R6.
- **Model track, from R6:** R6-F3 (`is_major`, now answered on the page by
  R6.4's By level card, but the column is still 0), R6-F4 (no sacrifice flies in
  MLB history), R6-F5 (MLB `game_result` not joinable to game pks), R6-F7 (the
  pitch corpus holds about 12% of games only in part), R6-F8 (ParlayAPI files
  pitcher strikeouts and walks under the batter markets), R6-F11
  (`nfl_target_events.interception` is never written).
- **R8:** R6-F10, the game page's prop rows after the start.
- **Operator machine:** `build_statcast_rollups.py` runs after each corpus
  refresh; if the PC is off, Statcast rows show an older `as_of`.
- **MLB regular season ends late September:** R8's MLB live state must be
  verified before then (or on postseason games) — keep R6.1 moving.
- `refreshCfbJob` on Saturday 2026-09-19.

## Spec

The G2 mockups in `docs/design/phase-g2/`: pages `player.html`, `game.html`,
`team.html`; rebuild notes `PLAN.md`; per-card sources `BUILDABILITY.md`;
datasets in `data/` (plan Appendix B). Rebuild with
`node docs/design/phase-g2/build.mjs`.

## How every phase runs (plan §2)

1. Re-check every cited file and line first.
2. Build. 3. `tsc --noEmit`, `npm test`, `npm run build`.
4. Render each affected sport at 1440 and 400; compare with the G2 dataset.
5. Delete what the phase replaces, in the same phase.
6. Commit by explicit path. 7. Update the plan's status and this file.
8. **Stop for sign-off.**

## Decisions already made — don't reopen

- **Pages are research pages.** Odds are one section, **except the prop analysis
  block** (market tabs, line stepper with price, vs-opp/L5/L10/L15/Season chips,
  hit-rate tiles, bars vs line) — presentation fixes only.
- **How cards are judged:** "does this make sense for this sport / does this
  help". Real data only; show a status where data is missing.
- **G2 picks:** system sans; raised cards; sectioned layouts with a sticky
  section nav; slate research views deferred; everything the mockups show goes
  in.
- **Deferred:** golf until a live tournament; NBA/NHL live until October; Scan
  and slate pages out of scope.

## Standing constraints

- **One database connection at a time from the operator machine** (pooler caps
  at 15). Check for running fits, harvester cycles and other sessions first.
  The dev server's pool is up to 6: load pages one at a time.
- **Git:** never `git add -A` or `git add docs/` (`docs/discord-community-prompt.md`
  is the operator's); add explicit paths; don't push unless asked.
- Ask before deploying to Render.
- **Bugs found mid-phase:** fix app-breaking ones on the spot (own commit);
  route the rest into the receiving phase's section plus an Appendix A row.
- At ~92% context, stop and hand off: rewrite this file and the research track
  in `docs/CURRENT.md` (leave the model track's sections alone), commit, push.
