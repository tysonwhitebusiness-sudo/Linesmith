# Resume prompt — research pages build (2026-09-15, R6.1c COMPLETE — R6.1d next)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md` (the sport-adapter rule 2 now names `toPlayerResearchData`)
2. `docs/CURRENT.md` (the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the status block
   (R6.1a-c records), the R6 section in full including "R6 Step 0
   premise audit", "Also in R6.4", §1, §2, "Also in R8", and Appendix A rows
   R2-F4..F6 and R6-F1..F7.
4. The G2 player spec: `docs/design/phase-g2/src/player.html`,
   `src/sports/common.js`, `mlb.js`, `src/kit2.js`; datasets in
   `docs/design/phase-g2/data/player-*.json`.

## Where the work is

- **R1-R5, R6.1a and R6.1b signed off. R6.1c (MLB pitcher Arsenal & command)
  complete 2026-09-15.** Next is R6.1d; confirm with the operator before
  starting it. Stop for sign-off after R6.1d.
- Commits: `512b42a` (Step 0), `0169de1` and `5c46b29` (R6.1a), `48abdc5`
  (R6.1a docs), `7893e82` and `478e196` (R6.1b), then the R6.1c commits.
  Pushed only if the operator asked. Nothing deployed: R6.1a-c changed no
  Python.
- tsc clean, 497/497 TS tests, `npm run build` passes (build with
  `LB_DIST_DIR=.next-verify` while a dev server holds `.next`; delete stale
  `.next*/types` first if a validator names a deleted route).

## Operator decisions (2026-09-15) — don't reopen

- **The player is the page, not the market.** Every route renders the player
  with or without a candidate; the shared sections land for every sport at
  once; sport sections stay per sub-phase.
- **MLB lines:** the player page's prop block uses `candidateLine()` for its
  line, hit rates and price; the model % shows only when the cached row's line
  equals the line on screen, otherwise it is labelled "model at 1.5". Scan and
  the Python model keep `BOARD_LINES`. (Built in R6.1d.)

## What R6.1a built (read these before R6.1b)

| piece | file |
|---|---|
| types, `historySportFor`, `athleteIdOf`, `sameSubject`, `formatResearchValue` | `lib/sports/shared/playerResearchShapes.ts` |
| shared builder + stat helpers (`total`, `ratio`, `perGame`, `col`…) | `lib/sports/shared/playerResearch.ts` |
| per-sport columns | `lib/sports/{mlb,nfl,nba,nhl,soccer,tennis}/adapters/playerResearchSpec.ts` (CFB uses NFL's) |
| history read + results join | `lib/sports/shared/playerHistoryServer.ts` → `/api/player-history` |
| bio parsers / fetch | `lib/sports/shared/playerBio.ts`, `playerBioServer.ts` → `/api/player-bio` |
| MLB finals by game pk | `getTeamSeasonFinals` in `lib/sports/mlb/statsapi.ts` |
| sections UI | `components/PlayerResearchSections.tsx`, hooks `components/usePlayerResearch.ts` |
| page frame | `components/PlayerDetail.tsx` (`subject`, `marketsLoading`, `renderPage`) |
| verification | `scripts/verify-player-history.ts` (DB + leagues), `scripts/verify-player-research-g2.ts` (no DB) |

The old prop block (market tabs, stepper, chips, windows, bars, matchup explorer,
role cards, rail) sits inside the "Prop analysis" section. R6.1b removed its
"Hitter stats" card and a hitter's strike zone and platoon split; the rail still
carries "Today's line", "Form", "Line movement", "Recorded price" and "All
books" — R6.1d replaces the odds cards.

## What R6.1b added (read before R6.1c)

- **Sport sections are data:** `ResearchSection` / `ResearchCard` (kinds
  `percentiles`, `histogram`, `series`, `table`, `surface`, `status`) in
  `playerResearchShapes.ts`, drawn by `ResearchSectionBody` /
  `ResearchCardView` in `components/PlayerResearchSections.tsx`. A sport adds a
  section by returning it from `toPlayerResearchData`; the component has no
  sport check. Sections sit between Splits and Game log in the nav.
- MLB's builder: `lib/sports/mlb/adapters/playerResearchSections.ts`
  (`mlbHitterSection`; `zoneViews(zones, 'pitcher')` is already written for
  R6.1c; `coverageNote`). Data from `components/useMlbStatcast.ts`.
- Primitives: `components/charts/Histogram.tsx`; `SpatialGridRole.outside`
  (chase zones) drawn by `SpatialSurface`'s zone geometry.
- Tests: `tests/mlb-research-sections.test.ts`.
- **R6-F7:** Statcast rollups cover 91-94% of plate appearances (partly
  ingested games); sections state coverage under 99%.

## What R6.1c added

- `mlbPitcherSection` in `playerResearchSections.ts` (arsenal, pitch locations,
  zone map, fastball velocity by start, vs LHH/RHH; coverage against batters
  faced). New card kind `scatter`, drawn by `ScatterCard` with the new
  `components/charts/ZoneScatter.tsx`; `CATEGORICAL` palette in chart tokens.
- MLB's prop block no longer has a strike zone or platoon split for anyone:
  `spatialGrid`/`binarySplit` are null for MLB; `toSpatialGridRole` and
  `toPlatoonBinarySplit` are deleted. The pitch mix and opposing starter stay.
- F-B4 resolved (Yamamoto rendered with a market; IP per start).

## Next: R6.1d (MLB), then stop

**R6.1d — routed items:** the MLB line decision above; line movement pinned to
R2's main line (`lineHistory.ts` `pinLine` is modal); the price chip on a
started game labelled or held (`liveEdge.resolveCandidateEdge` reads current
`prop_odds`, and `/api/props/lines` does not cut at the start); an "Odds &
prices" section (best price, books, movement) replacing the rail's odds cards;
the C4 game-state slot (MLB count/bases/batter/pitcher as a presence-checked
field; `LiveLineTrackerCard` already covers tracked lines for five sports).
Delete the cards replaced; fix the stale comment above
`data.liveGame` in `PlayerDetail.tsx` ("MLB only — ... above the Contact
quality matchup card").

**Verify (each sub-phase):** Judge 592450, Witt 677951, Skubal 669373, one
no-market player, injured Clarke Schmidt 657376, one early-season player; 1440
and 400 (`scratchpad` Python Playwright script pattern — Playwright MCP and the
Browser pane screenshots were unavailable this session); re-render the other
sports' pages to prove nothing regressed; contrast inside rebuilt cards (R3-F2);
tsc, `npm test`, `npm run build`. **Stop for sign-off after R6.1d.**

Then R6.2-R6.6 as written in the plan (NFL/CFB, soccer, tennis, NBA/NHL, golf).

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
- **Model track, from R6.1a-b:** R6-F3 (`is_major`), R6-F4 (no sacrifice flies
  in MLB history), R6-F5 (MLB `game_result` not joinable to game pks), R6-F7
  (the pitch corpus holds about 12% of games only in part).
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
