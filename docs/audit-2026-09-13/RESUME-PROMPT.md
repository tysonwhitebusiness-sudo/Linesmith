# Resume prompt — research pages build (2026-09-14, R3 COMPLETE — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (approved 2026-09-14, the build order). Its status block records R1-R3.

## Where the work is

- **R1** signed off and deployed. **R2** done (the operator's instruction to
  proceed to R3 stands as its sign-off).
- **R3 COMPLETE 2026-09-14, AWAITING OPERATOR SIGN-OFF.** Run autonomously on
  the instruction "complete R3 only, then stop". Next after sign-off: **R4**
  (parsers for feeds already fetched, plus two new endpoints).
- Everything committed and pushed. tsc clean, 460/460 tests.
- **Worker deployed this run** (operator-approved): `dep-dak6nkad0e5s73b736u0`
  on `2228a3d`, live 21:50 UTC.

## What was done before R3 (the operator folded it in first)

The NFL "19h ago" find was fixed, not checked on Saturday:
- `4b4c5c5` — a prop rung its book stopped quoting no longer counts in the
  main line (Mahomes 223.5 was a dead 00:05 DraftKings quote). Read side only,
  before the start; the writer-side delete stays in R5e.
- `2228a3d` — provider throttle gets a clock per sport, and each sport's paced
  interval is multiplied by the number of sports sharing the budget. One
  `provider-throttle:propline` clock let refreshTier1 (150s) take every window;
  NFL's Propline rows were 32h old. Verified in prod: `provider-throttle:propline:nfl`
  stamped, DEN @ KC Propline rows fresh.

## R3 — what landed

| part | commit | what |
|---|---|---|
| 3a tokens | `7adb8c4` | F2 type ramp (display 32 · heading 22 · title 17 · card-title 14 · body 14 · body-sm 13 · label 12 · overline 11; `tick` 10 for charts). The old scale's 266 uses codemodded by F2's mapping. Elevation flipped (paper 94.5% under card 98.5%). 502 `text-ink-faint/soft` -> `text-ink-muted`. Motion tokens and easings, reduced-motion fades, one 2px focus ring, radius 12/16/8, Plex Mono dropped. |
| 3b primitives | `a477d60` | `components/ui/`: Card, Section + SectionNav, SegmentedToggle, Tabs, SelectBox, Chip + StatusPill, Tooltip, StatValue/StatGrid, RankRow, FactList, VizLegend, DataTable, Avatar, DrillDownPanel, Skeleton/EmptyState/ErrorState, BackLink, useUrlState. Palette in CSS variables (`globals.css` :root); Tailwind points at them. `Chip.tsx` re-exports the primitive; `SubjectAvatar` renders `Avatar` (initials gone app-wide). Rules test `tests/ui-primitives.test.ts`. |
| 3c charts | `a2ba642` | `useChartWidth`: charts draw at real pixel width (ChartFrame + 5 primitives). `MarkTip` replaces every SVG `<title>` (hover, focus, tap). Column chart clamp, dashed prop line, zero lines, shared crosshair. **Sport surfaces (D4):** `SpatialGridRole.surface` + `measure`, set by each adapter; `SpatialSurface` draws zone / field / halfCourt / rink / pitch / matrix with each sport's real banding; share data on a single-hue ramp. |
| adoption, 3d | `f7dbd4f` | LineMovementCard on Card + VizLegend + DrillDownPanel (sortable DataTable); PlayerDetail market Tabs, window Chips, gamelog SegmentedToggle, StatusPill; AnalyticsCard -> Card; Game context -> FactList; StatRankRow -> RankRow; weather -> StatGrid; SelectBox in the NFL matchup picker; GameDetail SectionNav + `?records=` via useUrlState; NFL player page BackLink ("DEN @ KC") + ErrorState. Breakpoints xs 400 / wide 1440. |
| verify fixes | `9fbb74e` | SectionNav bleed opt-in (overflowed at 400); closed DrillDownPanel `inert` (was Tab-reachable); StatusPill wraps (tennis page 60px over at 400); RankRow track 48px floor (dot sat on labels in half-width columns). |

**Verify pass (done):** 6 pages x 400/1440, no overflow, no page errors.
Keyboard focus shows the ring and opens tooltips; SectionNav writes the hash;
Records scope writes `?records=`; market tabs follow arrow keys and `?market=`;
drill-down opens a sortable table, closes on Escape, returns focus. Contrast:
**0 AA failures inside the primitives** on 5 pages. Screenshots in
`.playwright-mcp/r3v-*.png`, the kit's in `r3v-g2-game-1440.png`.

## R3 caveats — honest, and where each goes

- **Whole pages are not yet at F2's targets.** AA failures per page: NFL game
  18/1018, NFL player 24/457, NBA team 86/716 (F2 measured 43% before R3). Text
  colors per page 12-38 against a target of 8. 801 hand-typed `text-[Npx]`
  sizes remain. All of it is legacy card code: **R6-R8 rebuild those cards on
  the primitives** (ledger R3-F2).
- **Adopted once, not everywhere,** per R3's own verify step. `Section` (the
  wrapper) is built but the GameDetail adoption used plain `id` wrappers under
  `SectionNav`; R6 uses `Section` for the rebuilt pages.
- **3d "every name, photo and logo is a Link"**: `Avatar href` and `BackLink`
  exist and the hero already linked teams; linking every name app-wide happens
  as pages rebuild (R6-R8). Game state and compare target in the URL are R8/R9.
- **Not rendered in their triggering state:** the NFL player page ErrorState
  (needs a failing fetch) and the LiveLineTrackerCard SelectBox (behind login).
- **NBA and NHL surfaces** were checked by static render (off-season pages are
  empty); golf is `matrix` until shot coordinates and a live tournament.

## Findings routed (R2-F1..F11, R3-F1..F2)

R2-F1 and R3-F1 are **resolved**. The rest stand as routed in the plan's
Appendix A: R5e (yes/no `other` direction; the writer deleting stale rungs —
the read-side guard is in), R6 (MLB fixed prop lines; line-movement pinned to
the modal line; in-play price chip; EPL snapshot cache), R7 (MLB hooks on other
sports' team pages; `/api/mlb/team/110` stale payload), parked (Scan at 400px),
model track Phase 5 (huge `snapshot_cache` rows), R6-R8 (R3-F2 above).

## Still owed from R1

- **F-B4 (MLB pitcher game log)**: retry on a slate with pitcher props.
- **MLB has no `/api/mlb/game/{id}`** for past games — R8.
- **MLB regular season ends late September**: R8's MLB live state before then.
- R1f 2b's CFB check (Saturday 2026-09-19) is still worth a look at
  `refreshCfbJob`'s log; its NFL half was resolved above.

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
