# Resume prompt — research pages build (2026-09-15, R6.1a COMPLETE — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md` (the sport-adapter rule 2 now names `toPlayerResearchData`)
2. `docs/CURRENT.md` (the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the status block
   (R6.1a record), the R6 section in full including "R6 Step 0 premise audit",
   "Also in R6.4", §1, §2, "Also in R8", and Appendix A rows R6-F1..F6.
4. The G2 player spec: `docs/design/phase-g2/src/player.html`,
   `src/sports/common.js`, `mlb.js` (R6.1b/c), `src/kit2.js`; datasets in
   `docs/design/phase-g2/data/player-*.json`.

## Where the work is

- **R1-R5 signed off. R6.1a complete 2026-09-15, awaiting the operator's
  sign-off.** Don't start R6.1b until it is given.
- Commits: `512b42a` (Step 0 corrections and decisions), `0169de1` (history and
  bio readers, shared builder), then the R6.1a page commit. Pushed only if the
  operator asked. Nothing deployed: R6.1a changed no Python.
- tsc clean, 499/499 TS tests, `npm run build` passes (build with
  `LB_DIST_DIR=.next-verify` while a dev server holds `.next`).

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
role cards, rail) sits unchanged inside the "Prop analysis" section. Its rail
still carries MLB "Hitter stats", "Today's line", "Form", "Line movement",
"Recorded price" and "All books" — R6.1b-d replace those.

## Next: R6.1b-d (MLB), then stop

**R6.1b — MLB hitter, "Contact quality & approach"** from
`/api/mlb/statcast/player/[playerId]?season` (`statcastRollupShapes.ts`):
power profile with percentiles (every season's pool, not 2026 only), EV
distribution, EV by game, results by pitch type, strike zone, vs LHP/RHP, home
runs with distance. Season switch. Move the matchup card's opposing-starter pitch
mix off `useMlbPitchProfile` onto the Statcast route. Check against Witt's G2
`statcast` block (Judge and Skenes have none). Replace the rail's "Hitter stats"
card where its content moves.

**R6.1c — MLB pitcher, "Arsenal & command":** arsenal, pitch locations, where he
pitches, fastball velocity by start, vs LHH/RHH. Check against Skubal's G2
block. The per-start game log (F-B4) already exists in the shared Game log.

**R6.1d — routed items:** the MLB line decision above; line movement pinned to
R2's main line (`lineHistory.ts` `pinLine` is modal); the price chip on a
started game labelled or held (`liveEdge.resolveCandidateEdge` reads current
`prop_odds`, and `/api/props/lines` does not cut at the start); an "Odds &
prices" section (best price, books, movement) replacing the rail's odds cards;
the C4 game-state slot (MLB count/bases/batter/pitcher as a presence-checked
field; `LiveLineTrackerCard` already covers tracked lines for five sports).
Delete `/api/mlb/pitch-profile`, `useMlbPitchProfile`, `pitchProfile.ts` (keep
`pitchProfileShapes.ts`) and the cards replaced; fix the stale comment above
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
- **Model track, from R6.1a:** R6-F3 (`is_major`), R6-F4 (no sacrifice flies in
  MLB history), R6-F5 (MLB `game_result` not joinable to game pks).
- **Operator machine:** `build_statcast_rollups.py` runs after each corpus
  refresh; if the PC is off, Statcast rows show an older `as_of`.
- **MLB regular season ends late September:** R8's MLB live state must be
  verified before then (or on postseason games) — keep R6.1 moving.
- F-B4 on a slate with pitcher props; `refreshCfbJob` on Saturday 2026-09-19.

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
