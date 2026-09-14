# Resume prompt — research pages build (2026-09-14, mid-R2)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (**approved as written 2026-09-14**, the build order). Its status block at the top records what R1 actually did.

## Where the work is

- **Done:** card audit (A–D), design audit (E, F, F2, G, G2), Phase H (the master plan), R0.
- **R1 DONE and signed off**, including the Render deploy (`dep-dak36up42hec73bri7hg`
  on `46a2def`, live 17:50 UTC — verified in prod: `refreshNflJob games=33`,
  `refreshCfbJob games=146`).
- **R2 IN PROGRESS.** Commit `33ce1f2` lands **2 of R2's 10 items**:
  the `game_result` read module (rule 3) and the `cachedRoute` staleness
  ceiling, which the operator folded into R2.

## R2 — what is done and what is left

**Done (`33ce1f2`):**
- **`game_result` read module** — `lib/history/gameResults.ts`, route
  `GET /api/history/results`, 13 tests, plus `scripts/verify-game-results.ts`
  which runs it against real Postgres. Fixture reproduced three independent
  ways: the Raiders go 71 raw rows -> **54 games**.
- **`cachedRoute` staleness ceiling** — `x-cache: expired`, `x-cache-age-ms`
  on every cached response, and a logged system event past the ceiling.

**Left, in this order (the first four are dependency-ordered, the rest are
independent):**
1. **Season convention** — one helper mapping (sport, season) to its label and
   date range. NBA uses the end year; NHL/NFL/CFB/EPL the start year. Drop
   stray All-Star team ids. Ranks and the early-season fallback both need it.
2. **Ranks** — computed over the league's real teams for that season (>=30% of
   max games played), each stat with a declared better/worse direction,
   football per game. ESPN's published ranks are never used. Neutral stats
   (fouls, possession share) get no good/bad colour.
3. **Early-season fallback** — open on last season under MIN_GAMES
   (NFL/CFB 4, NBA/NHL 15, MLB 20, soccer 6), with the reason stated.
4. **Prop main line** — the largest. Last PRE-GAME quote per book/side/line;
   the main line is the one quoted on both sides by the most books, ties to
   the price nearest even; pick'em books never count as a price; yes/no
   markets keep a 0.5 line with 2+ books over; one-sided markets are flagged
   "alternate lines only". **This is F-B12's fix** — see below.
5. **Pre-start odds filter** — split `game_odds_history` at the game's start.
6. **Innings pitched** — carry outs, render whole.thirds only.
7. **NBA shot coordinates** — rim origin y ~= 1ft not 5.25; a miss's point
   value comes from the arc.
8. **Source quirks** — Understat newest-first, TennisMyLife tournament-start
   dates, ESPN soccer fixtures param.

## Still owed from R1

- **R1f 2b is Saturday 2026-09-19**, during the live CFB window: read
  `refreshCfbJob`'s run log, tier and `prop_odds` rows. Change `gameday.py`
  only if the tier is still cold with kickoffs inside 6h.
- **F-B4 (MLB pitcher game log) could not be reproduced.** Today's MLB slate
  carries no pitcher markets, so no pitcher page renders a game log at all —
  Skenes' page says "No tracked markets for this player on today's slate."
  Retry on a slate with pitcher props. Do not fix it blind.
- **F-B12 was measured and re-routed to R2.** It is *not* a match-total
  market. `prop_odds` holds 503 aces rows / 45 subjects spanning 0.5–29.5, and
  Ben Shelton in game 182766 alone has 9 distinct lines from 8.5 to 29.5
  across 2 books — an alternate ladder under the main key, which is exactly
  what R2's prop-main-line rule exists to fix. Fixing it separately would be a
  second main-line implementation.
- **MLB has no `/api/mlb/game/{id}` route**, so an MLB game page still cannot
  resolve a past game. It now says so honestly instead of "Game not found."
  The per-game read belongs with R8.

## Two live problems the staleness ceiling exposed — NOT yet acted on

Both surfaced the moment the ceiling shipped, and both are real:

1. **`/api/mlb/team/110` was serving a payload 671 hours — 28 days — old**,
   silently. Its build has been failing for weeks and nothing reported it.
   Nobody has looked at why.
2. **`soccer:snapshot:epl` cannot write its cache**: `system_events` carries
   `canceling statement due to statement timeout` for it. The route rebuilds
   every request and throws the result away, which is both slow and the reason
   an edit to soccer data appears to "not take" until several requests later.

Neither is an R2 rule. Decide whether they get fixed inside R2 or become their
own task.

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
