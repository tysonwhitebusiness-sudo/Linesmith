# Resume prompt — research pages build (2026-09-14, R2 COMPLETE — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (**approved as written 2026-09-14**, the build order). Its status block records what R1 and R2 actually did.

## IN FLIGHT — R3 underway (autonomous run, operator away). Read first.

Operator instruction 2026-09-14: finish the throttle fix, then complete R3
ONLY, and stop when R3 is done. R2 is treated as signed off by that.

- **Throttle fix DONE + DEPLOYED** (`4b4c5c5` read-side stale rungs; `2228a3d`
  per-sport provider clock, deploy `dep-dak6nkad0e5s73b736u0` live 21:50 UTC).
  Verified in prod: `provider-throttle:propline:nfl` stamped 21:53; DEN @ KC
  Propline rows fresh at 21:53 (were 32h old). R2-F1 is resolved by these.
- **R3 3a DONE** `7adb8c4` — tokens: F2 type ramp (266 old token uses
  codemodded by F2's mapping), elevation flipped (paper 94.5 under card 98.5),
  502 `text-ink-faint/soft` -> `text-ink-muted`, motion tokens, focus ring,
  Plex Mono dropped. 10 pages x 400/1440: no overflow.
- **R3 3b primitives DONE** `a477d60` — `components/ui/` (Card, Section +
  SectionNav, SegmentedToggle, Tabs, SelectBox, Chip + StatusPill, Tooltip,
  StatValue/StatGrid, RankRow, FactList, VizLegend, DataTable, Avatar,
  DrillDownPanel, Skeleton/EmptyState/ErrorState, BackLink, useUrlState).
  Palette now in CSS vars (globals.css :root). Chip.tsx re-exports the
  primitive; SubjectAvatar renders Avatar (no initials). Rules test:
  `tests/ui-primitives.test.ts`.
- **NEXT:** 3b adoption — each primitive on one real card on an existing page
  (plan's Verify); 3c charts (ResizeObserver real width, hover on every mark,
  column clamp, dashed ref line, zero line, sport surfaces by adapter field,
  HeatGrid `aspect` removal); 3d (Links on names/photos, URL state, BackLink,
  breakpoints); then the R3 verify pass (contrast, focus, 400px, beside G2
  kit), plan status + batons, STOP.
- **Routed find (not R3's):** NFL game matchup card's "17th of 32" column
  overlaps its label at 1440 (hand-typed 9px grid) — pre-existing, goes to R8.

## Where the work is

- **Done:** card audit (A–D), design audit (E, F, F2, G, G2), Phase H (the master plan), R0.
- **R1 DONE, signed off and deployed** (`dep-dak36up42hec73bri7hg` on `46a2def`).
- **R2 COMPLETE 2026-09-14: all 9 rules, plus the folded-in `cachedRoute`
  ceiling, plus a phone-width top-bar fix found in the sign-off pass.
  AWAITING OPERATOR SIGN-OFF.** Next after sign-off: **R3, design system
  foundations** (plan §R3).
- Everything committed and pushed through `fcaef2c`. tsc clean, 448/448 tests.

## R2 — what each rule did (commit, and what re-checking the premise changed)

| rule | commit | note |
|---|---|---|
| `game_result` read module | `33ce1f2` | Raiders 71 raw rows -> 54 games |
| `cachedRoute` staleness ceiling | `33ce1f2` | `x-cache: expired`, age header, logged event |
| Season convention | `8aedacf` | TS + `season.py`, drift-tested; `season.py` NOT deployed (nothing imports it; deploy pre-approved for when a job does) |
| Ranks + early-season fallback | `4509175`, `6ebf081` | season-labelled blocks; `neutral` stat direction |
| **Prop main line** | `b8f80d8` | `lib/odds/props/mainLine.ts`; six adapters' "highest over price across every line" picked the ladder's top rung (Mahomes 149.5 @ +2000 -> 223.5 @ -112). `prop_odds` is an upsert, so a started game reads pre-game prices from `prop_odds_history`. SharpAPI's yes side is `other`. **MLB does not pick a line from `prop_odds` (fixed lines) and was left alone.** |
| **Pre-start odds filter** | `3a421b6` | `readGameLineHistory` takes `startsAt`; pre-game = `hours` ending at the start, `inGame` separate (8h cap). `GameDetailData.hero.startsAt` in all 7 adapters via `lib/sports/shared/startsAt.ts`. KC @ BOS 824711: pre ends 22:30, first pitch 23:10, 264 in-game points split out |
| **Innings pitched** | `94b0f53` | Premise wrong: no TS path summed IP as decimals. Three parsers folded into `lib/sports/mlb/innings.ts` (outs; format at render). Python rollup stays R5 |
| **NBA shots** | `287d15f` | Premise half-wrong: the code had the rim at y=0, not 5.25 (5.25 is G2's shifted frame). Rim -> y=1; a miss's value from the fitted arc. Curry 2024-25: 62.5% of attempts from three at 39.8% (real ~60%, 39.7%) |
| **Source quirks** | `3e83af2` | ESPN soccer team schedule needs `fixture=true` (EPL 382: 4 played + 34 fixtures = 38); Understat sorted oldest-first at source; TennisMyLife ordered by round within an event |
| Top bar at 400px | `fcaef2c` | every page was 31-71px wider than a phone; fixed below `sm` only |

**Sign-off render pass (done):** 11 pages (MLB/NFL/CFB/EPL/tennis player and
game pages, NFL and NBA team pages) at 1440 and 400px — no 404s, no NaN or
undefined text, no horizontal overflow after `fcaef2c`. NBA/NHL player pages
show "No tracked markets" (off-season, expected).

## Correction to the previous handoff

The "tennis/soccer nested pages 404" logged under the prop main line was **a
broken dev-server state, not a code bug**. A fresh `next dev` serves every one
of those routes. If a page 404s in dev, restart the server before debugging.

## Findings from R2 — routed to the phase that fixes them

None breaks the app. Each is written into its receiving phase's section of the
master plan and has a row (R2-F1..F11) in its Appendix A ledger:

| find | goes to |
|---|---|
| NFL prop prices 19h old on game day | **R1f 2b** — check NFL on Sun 2026-09-20 alongside CFB |
| Yes/no `other` direction disagrees across books; stale rungs never removed | **R5e** (prop odds writer) |
| MLB props on fixed lines; line movement pinned to the modal line; in-play price chip; EPL snapshot cache cannot write | **R6** |
| MLB hooks fire on other sports' team pages; `/api/mlb/team/110` 28-day-old payload | **R7** |
| Scan pages overflow at 400px | no R-phase (Scan out of scope) — parked in `CURRENT.md` |
| Huge old `snapshot_cache` rows | model track Phase 5, `CURRENT.md` |

## Still owed from R1

- **R1f 2b is Saturday 2026-09-19** (live CFB window): read `refreshCfbJob`'s
  run log before touching `gameday.py`.
- **F-B4 (MLB pitcher game log)**: retry on a slate with pitcher props.
- **MLB has no `/api/mlb/game/{id}`** for past games — R8.
- **MLB regular season ends late September**: R8's MLB live state before then.

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
