# Resume prompt — research pages build (2026-09-14, after R1)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (**approved as written 2026-09-14**, the build order). Its status block at the top records what R1 actually did.

## Where the work is

- **Done:** card audit (A–D), design audit (E, F, F2, G, G2), Phase H (the master plan), R0.
- **R1 BUILT 2026-09-14, awaiting the operator's sign-off.** Five commits:
  `f89d704`, `69cf490`, `770f6c9`, `3f61ee6`, `16e8227`. Nothing pushed.
- **Next, once R1 is signed off: R2 and R3, in any order.** Neither depends on
  the other, and R2 has the larger backlog pointed at it.

## What R1 left owed — read before starting anything

- **The Python UTC fix is committed and NOT deployed.** `_date_range_param`
  in `python-odds-service/src/game_context.py` now builds its window from the
  US Eastern date. It is worker code; it needs a Render deploy, and the
  operator has not been asked yet. **Ask before deploying.**
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
- **A decision is owed on `cachedRoute`'s stale ceiling** — see below.
- **MLB has no `/api/mlb/game/{id}` route**, so an MLB game page still cannot
  resolve a past game. It now says so honestly instead of "Game not found."
  The per-game read belongs with R8.

## The one live bug R1 found and deliberately did not fix

`lib/cachedRoute.ts` serves stale **with no maximum age**:

    if (cached) { triggerBackgroundRebuild(...); return respondCached(payload, 'stale'); }

A route whose `build()` keeps failing serves its last good payload
indefinitely, and the page has no way to know. CFB's build is the one already
documented as timing out (`CURRENT.md`, PARKED), which is how a Sep 13 rebuild
listed Sep 3/4 games. **It does not reproduce today** — `/api/cfb` returns 146
games all dated Sep 17–27 — and both UTC date-range bugs are ruled out as the
cause, since a one-day shift cannot produce a nine-day gap.

A maximum stale age changes every route's contract and needs its own
measurement per route. **Put it to the operator; don't decide it inside a
phase.**

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
