# Resume prompt — research pages build (2026-09-14, mid-R2 — prop main line next)

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
- **R2 IN PROGRESS — 7 of R2's 9 rules done**, plus the `cachedRoute` item the
  operator folded in. Commits `33ce1f2`, `8aedacf`, `4509175`, `6ebf081`,
  `b8f80d8` (prop main line). tsc clean, 435/435 tests.

  **THE NEXT RULE IS THE PRE-START ODDS FILTER (§2).** Before the sign-off
  pass, look at the tennis/soccer nested-route 404 logged under §1.

## R2 — what is done and what is left

**Done:**
- **`game_result` read module** (`33ce1f2`) — `lib/history/gameResults.ts`,
  route `GET /api/history/results`, 13 tests, plus
  `scripts/verify-game-results.ts` which runs it against real Postgres.
  Fixture reproduced three independent ways: the Raiders go 71 raw rows ->
  **54 games**.
- **`cachedRoute` staleness ceiling** (`33ce1f2`) — `x-cache: expired`,
  `x-cache-age-ms` on every cached response, a logged event past the ceiling.
- **Ranks** (`4509175`, `6ebf081`) — COMPLETE. Season-correct block labels, an
  explicit fallback, and a third stat direction: `neutral`. Neutral stats rank
  but are not coloured and do not vote in unit grades (nba.fouls,
  soccer.foulsCommitted, soccer.offsides, nhl.hits). Two of the plan's ranks
  sub-items were already true and were checked, not built: football stats are
  already `perGame`, and no ESPN published rank is read anywhere.
- **Early-season fallback** (`4509175`, `6ebf081`) — COMPLETE. The ranks path
  reports `requestedSeason`/`isFallback`/`fallbackReason`; `SEASON_MIN_GAMES`
  + `seasonScope()` give pages the same rule (NFL/CFB 4, NBA/NHL 15, MLB 20,
  soccer 6), always with the reason stated.
- **Season convention** (`8aedacf`) — `lib/sports/shared/season.ts` +
  `python-odds-service/src/season.py`, one table, drift test that was checked
  by deliberately diverging it. Seven scattered TS helpers now delegate.
  `realTeams` / `real_teams` is the All-Star filter AND the rank-pool
  predicate, measured (9 fake NBA teams, 130 rows, all on All-Star weekend).

  **`season.py` is committed but NOTHING IMPORTS IT YET**, so no Render deploy
  has been done — deploying a dormant module would restart the worker's queue
  for nothing. **The operator has already granted deploy permission**; deploy
  when a job actually calls it.

**Left — 3 rules, in this order:**

### 1. Prop main line — DONE 2026-09-14 (`b8f80d8`)

`lib/odds/props/mainLine.ts` (`pickMainLine`, `candidateLine`), 9 tests in
`tests/prop-main-line.test.ts`, `readPreGamePropOddsForGame` in
`lib/db/client.ts`. All six `bestRow`/`bestOverPrice` copies are deleted, and
`liveEdge.bestPrice` no longer counts pick'em books. Rendered live: NFL Mahomes
passing yards 149.5 at +2000 (the old pick) became 223.5 at −112; CFB alternates-only
note checked at 400px. What re-checking the premises changed:
- **`prop_odds` is upserted in place**, so a post-start poll overwrites the
  pre-game price. For a started game the reader takes the last
  `prop_odds_history` row at or before the start (history is pruned at 14 days).
- **SharpAPI's yes side is stored as `other`**, not `over`. Missed at first and
  caught on the WTA render: every to-win-a-set had lost its price.
- **MLB does not pick a line from `prop_odds` at all.** It uses fixed lines
  (`lib/sports/mlb/adapter.ts` ~1466, e.g. pitcher strikeouts 4.5) and matches rows
  exactly. It was left untouched because the MLB prop model cache is keyed to those
  lines. Golf does not read `prop_odds`.
- `/api/props/lines` stays a raw row feed; the pick happens in the adapters.
- `pick6` (DraftKings pick'em) was added to the pick'em list the plan gave.
- `lineHistory.ts`'s `pinLine` is a separate modal-line picker for line-movement
  charts. Left alone.

**Found in passing, logged and not chased:**
1. **Every nested page under a dynamic segment 404s in dev**:
   `/tennis/{tour}/player/*`, `/tennis/{tour}/game/*`, `/soccer/{league}/player/*`,
   on hard load AND client navigation. `/nba/player/*` and `/cfb/player/*` work.
   The page component calls `notFound()`, which suggests `useParams().tour`
   is not resolving. Not caused by `b8f80d8`, which touches no routing. **This
   blocks rendering tennis and soccer pages for the R2 sign-off pass**, so it
   must be looked at first.
2. **Yes/no `other` rows disagree in direction across books**: WTA 183796
   Stephens to-win-a-set is DraftKings +650 and FanDuel −1450, captured at the same
   moment before the start. One book's `other` is probably the opposite selection.
   Ingest problem; the old code showed +650 too.
3. **"Last quote per book" keeps rungs a book has stopped quoting**: `prop_odds`
   never deletes, so a 12:19 DraftKings row sat beside 19:18 FanDuel rows on WTA
   183791.
4. NFL prop prices on the DEN @ KC page read "19h ago" at 19:26 UTC on game day.

### 1 (original brief, kept for reference). The measurement is already done.

The rule (plan §R2): take the last **pre-game** quote per book, side and line.
The main line is the one quoted on both sides by the most books; ties go to
the price nearest even. Pick'em books never count as a price. Yes/no markets
keep a 0.5 line with 2+ books on the over. A market with only one-sided quotes
is flagged "alternate lines only" and not shown as a line.

**Measured against production 2026-09-14 — use these, do NOT re-query:**

- `prop_odds` columns: `subject_id, game_id, market_key, line, side,
  bookmaker, american_odds, decimal_odds, fetched_at, is_delayed,
  delay_seconds`. The market column is **`market_key`**, not `market`.
- **Sides:** `over` 357,296 · `under` 168,036 · `other` 727. Overs outnumber
  unders 2:1, so "quoted on both sides by the most books" will disqualify many
  ladder rungs — that is the rule working, not a bug.
- **Ladders are over half the data.** Distinct lines per
  (subject, game, market): 1 → 6,479 keys · 2 → 4,629 · 3 → 3,105 · 4 → 2,246
  · 5-11+ → ~3,500. And 4,995 keys have **0** distinct lines (null `line` —
  the yes/no markets the rule's 0.5 clause covers).
- **Pick'em books actually present**, by rows: `prizepicks` 47,725,
  `underdog` 25,498, `sleeper` 17,954. The plan also names Dabble, ParlayPlay,
  Betr and Chalkboard — **none appear in the data at all**, so still list them
  (they can return) but expect no effect today. `novig`, `prophetx`, `kalshi`
  and `smarkets` are EXCHANGES, not pick'em: they post real two-sided prices
  and must NOT be excluded.
- **F-B12 is this rule's test case.** Ben Shelton, game `182766`, market
  `aces`: 9 distinct lines from 8.5 to 29.5 across 2 books. The audit saw 24.5
  chosen; the main line should land near the 8.5-10.5 end. `aces` overall
  spans 0.5-29.5 across 503 rows / 45 subjects, median 6.5.
- **"Pre-game" needs the game's start time**, which `prop_odds` does not
  carry — join `game_result.event_start` or the sport's game context. The plan
  notes `prop_odds` keeps capturing for up to two days AFTER a game.

Where it goes: a shared TS module under `lib/odds/props/`, read by
`app/api/props/lines/route.ts` and every adapter that picks a line.

### 2. Pre-start odds filter

Split `game_odds_history` at the game's start time: before is pre-game
history, after is in-game. In `lib/odds/gameLineHistory.ts`. Fixture: 1,790 of
2,782 KC @ BOS rows are after the start.

### 3. The three small ones

- **Innings pitched** — carry outs; render whole.thirds (6.2) only at render.
  MLB adapters. The Python rollup half is R5's, not this.
- **NBA shot coordinates** — rim origin y ≈ 1 ft, not 5.25; a miss's point
  value comes from the arc, because every miss is stored as a 2. Read time in
  `/api/nba/shot-profile`. Ingest-time + backfill is R5c.
- **Source quirks** — Understat match lists come newest-first (sort before any
  "last N"); a TennisMyLife `tourney_date` is the tournament start (order by
  round within an event); ESPN's soccer team schedule needs the fixtures
  parameter for unplayed games.

Then: the R2 sign-off render pass (plan §2 — every affected sport at 1440 and
400px, numbers against the G2 fixtures), update the plan's status line,
rewrite this file, stop for sign-off.

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

## Three live problems found and NOT yet acted on

All measured, none fixed. The operator's standing instruction is to keep
chasing real bugs but not at R2's expense — so these are logged, not chased:

1. **`/api/mlb/team/110` was serving a payload 671 hours — 28 days — old**,
   silently. Its build has been failing for weeks and nothing reported it.
   Nobody has looked at why.
2. **`soccer:snapshot:epl` cannot write its cache**: `system_events` carries
   `canceling statement due to statement timeout`. **Cause measured:** the
   payload is **22 MB** against a 2-minute `statement_timeout`. The route
   rebuilds every request and throws the result away. That is a payload-size
   problem — R6's per-section loading is what fixes it, not an R2 rule. It
   does NOT block R2: `/api/season-ranks` has its own key and a 27 KB payload.
3. **`snapshot_cache` holds several very large, very old rows** —
   `mlb:full-raw:*` at 79/78/52 MB and `mlb:snapshot:2026-08-16` at 22 MB and
   29 days old. Relevant to the database-growth line in `CURRENT.md`.

None is an R2 rule.

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
