# Resume prompt — research pages build (2026-09-15, R6.2 COMPLETE — R6.3 next)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md` (the sport-adapter rule 2 now names `toPlayerResearchData`)
2. `docs/CURRENT.md` (the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the status block
   (R6.1 and R6.2 records), the R6 section in full including "R6 Step 0
   premise audit", "Also in R6.4", §1, §2, "Also in R8", and Appendix A rows
   C4, R2-F4..F6 and R6-F1..F11.
4. The G2 player spec: `docs/design/phase-g2/src/player.html`,
   `src/sports/common.js`, `mlb.js`, `src/kit2.js`; datasets in
   `docs/design/phase-g2/data/player-*.json`.

## Where the work is

- **R1-R5 and R6.1 (MLB) signed off. R6.2 (NFL and CFB) complete
  2026-09-15**, with two renders owed on Thursday's NFL slate (below). Next is
  R6.3 (soccer); confirm before starting it.
- Commits: `512b42a` (Step 0), `0169de1`/`5c46b29`/`48abdc5` (R6.1a),
  `7893e82`/`478e196` (R6.1b), `007ced4`/`16051a7` (R6.1c),
  `4da5684`/`d6ffd09`/`6d2139e` (R6.1d), `1438855` (R6.2). Pushed only if the
  operator asked. Nothing deployed: R6 has changed no Python.
- tsc clean, 507/507 TS tests, `npm run build` passes (build with
  `LB_DIST_DIR=.next-verify` while a dev server holds `.next`; delete stale
  `.next*/types` first if a validator names a deleted route).

## OWED before R6.2 is closed

- **Thursday 2026-09-18, NFL slate:** render a player with a market and a live
  game. Two things landed after today's NFL markets rolled off, so they are
  unit-tested but unseen: the C4 game-state card for football, and the prop
  block without its target grid and rail season card.
- **Saturday 2026-09-19, CFB slate:** the same two for CFB, alongside the
  `refreshCfbJob` check already owed from R1f.

## Operator decisions (2026-09-15) — don't reopen

- **The player is the page, not the market.** Every route renders the player
  with or without a candidate; the shared sections land for every sport at
  once; sport sections stay per sub-phase.
- **MLB lines:** the player page's prop block uses `candidateLine()` for its
  line, hit rates and price; the model % shows only when the cached row's line
  equals the line on screen, otherwise it is labelled "model at 1.5". Scan and
  the Python model keep `BOARD_LINES`. (Built in R6.1d.)

## What R6.1 and R6.2 built (read before R6.3)

| piece | file |
|---|---|
| types, `historySportFor`, `athleteIdOf`, sections as data (`ResearchSection`/`ResearchCard`) | `lib/sports/shared/playerResearchShapes.ts` |
| shared builder + stat helpers | `lib/sports/shared/playerResearch.ts` |
| per-sport columns | `lib/sports/{mlb,nfl,nba,nhl,soccer,tennis}/adapters/playerResearchSpec.ts` (CFB uses NFL's) |
| history + bio | `playerHistoryServer.ts` → `/api/player-history`; `playerBio.ts` → `/api/player-bio` |
| sections UI | `components/PlayerResearchSections.tsx` (`ResearchSectionBody` draws any sport's section) |
| MLB sections | `lib/sports/mlb/adapters/playerResearchSections.ts` (hitter contact, pitcher arsenal) |
| NFL/CFB sections | `lib/sports/nfl/targetShapes.ts` (`nflTargetsSection`, `cfbEfficiencySection`), read `lib/sports/nfl/targets.ts` → `/api/nfl/targets`, hook `components/useNflTargets.ts` |
| charts added | `Histogram`, `ZoneScatter`, `FieldScatter`, `SpatialSurface` chase zones, `CATEGORICAL` |
| one line on the page | `repriceAtMainLine` in `lib/odds/props/mainLine.ts`; `PlayerDetailData.priceCandidate`; stepper `model` (MLB, NFL, CFB so far) |
| odds section | `lib/odds/props/playerPrices.ts`, `components/PlayerOddsSection.tsx` |
| prices at the start | `/api/props/lines?start`, `usePropOdds(..., startIso)`, `useLineHistory(line, before)` |
| C4 game state | `GameStateSlot` (MLB adapter file), `components/GameStateCard.tsx`, football's builder `lib/sports/multiSport/footballGameState.ts` |
| page frame | `components/PlayerDetail.tsx` (`renderPage(propBlock, propSub, nextGame, oddsCards)`) |
| verification | `scripts/verify-player-history.ts`, `verify-player-research-g2.ts`, `measure-mlb-main-line.ts`, `measure-nfl-targets.ts` |

A sport's section is one function returning a `ResearchSection`; the component
has no sport check. The prop block keeps market tabs, stepper, chips, windows,
bars, matchup explorer and role cards; every odds card lives in "Odds & prices".

## Next: R6.3 soccer (after the go-ahead)

Per the plan's sport table: **FW/MID "Chances & finishing"** (shot map, goals vs
xG, per 90 by season) from Understat per player, cached in `snapshot_cache`,
plus `player_game_history`; **GK "Shot-stopping: beyond saves"** from
`player_game_history`. Also in R6.3:
- **R6-F9:** soccer's adapter re-prices on the current main line
  (`repriceAtMainLine`), as MLB, NFL and CFB now do.
- **C4:** soccer's game state is score and match state only (decision 5); the
  live hook is `lib/sports/soccer/liveGame.ts`.
- **C8:** soccer's default market by position — order both priced and synthetic
  candidates by `subjectMeta.position`.
- **R2-F9:** confirm `soccer:snapshot:epl` writes its cache on every rebuild
  over a day once the page is per-section (22 MB payload against a 2-minute
  statement timeout).
- Check what Understat actually holds before building: the plan's own premise
  audit rule.

**Verify (each sub-phase):** the G2 subjects (Cunha 259902, Lammens 301425),
one no-market player, one injured player, one early-season player; 1440 and 400
(`scratchpad` Python Playwright script pattern); a live match where one exists;
re-render the other sports' pages; tsc, `npm test`, `npm run build`.
**Stop for sign-off after each sport.**

Then R6.4-R6.6 as written in the plan (tennis, NBA/NHL, golf).

## Lessons from R6.1a

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

## Open items that are not R6's

- **R5-F5, model track:** the worker OOM loop. Don't chase it in R6.
- **Model track, from R6:** R6-F3 (`is_major`), R6-F4 (no sacrifice flies in
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
