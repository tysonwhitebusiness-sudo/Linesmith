# CURRENT — pick up here

**Updated 2026-09-23 — THE RUN IS COMPLETE. Track C (card redesign) and the
sport-specific Spotlights are approved, audited, and every question is
answered. All sixteen phases of the run order are built and
deployed — but CLOSING them was over-claimed, and
**`docs/design/closeout-2026-09-23.md` is the list of what is actually left**.
Read it next. In short:

1. **C5-UI sign-off** waits on a real graded slate — NFL Sunday **2026-09-27**
   plus one MLB day graded by PY-A's code. When it comes, check that NFL's
   receipts actually fill: `nfl-longest-reception` for 09-21 produced a leader
   row and ZERO graded players.
2. **`docs/design/SIGNOFF-QUEUE.md` Q26–Q30** are this run's own decisions.
   **Q26 needs a real answer**: SPC's spec asks for graded spotlights and the
   build deliberately does the opposite.
3. ~~C8 is not really closed~~ — **closed properly 2026-09-23** (closeout
   B1-B4): `/kit` checked, all 10 sports swept at 1440 and 400 with 22
   screenshots in `docs/design/closeout-shots/`, the 390px control-rows check
   written (`scripts/check-controls-390.js`, run via the Playwright MCP), and
   six bugs the sweep found fixed — see Entry 16 in `VSCODE-HANDOFF.md`.
4. **Odds-model track (separate workstream, own plan):**
   `docs/design/odds-model-two-system-gameplan-2026-09-22.md`. Phase 0 is
   committed (`af2ef13`, `f4a8373`) and deployed; see its STATUS block. One
   step is left and needs the operator: the `--apply` drop of the two dead
   golf prediction tables, which the sandbox refused. **Phase 1 (no-odds
   ranking system, every priced market) is next.**
5. The usual operator items: Q0–Q25, M4, M5, and a signed-in pass over Q15 and
   `/diagnostics`.
6. **Scraper bridge, line movement + market edge (new workstream, 2026-09-23):**
   `docs/design/scraper-bridge-and-edge-gameplan-2026-09-23.md`. Decisions
   are settled (§1). **Source run R0–R5 is DONE, live and CLOSED (operator, 2026-09-24) in the odds-scraper
   repo (29 sources; plan §4c STATUS; the scraper's `HANDOFF.md` top section
   is the operating guide). Next: B0–B2 matching, then the B4 bridge — waits
   for the operator's go.** New data types landed: `splits` (DraftKings and
   Circa handle/bets %, ScoresAndOdds, Covers picks, Sleeper pick counts,
   Action Network bet counts) and `reference_data` (umpires, referees, power
   ratings, openers, comparenbet per-game history, theoddsgap prop closes).
   Open items are listed in the scraper `HANDOFF.md` (oddsrun data API,
   oddstrader openers, betmonitor still rate-limiting us, FanDuel NBA/NHL prop
   tabs). Nothing in line-buddy/Supabase changed for the source run. Also done: user CLV removed (`709d807`), `prop_odds_history`
   window 14 → 10 days (`2331a56`).**
7. **Track O — odds section rebuild (2026-09-24): MOCKUPS APPROVED** (D17).
   The operator's answers are D18–D23 in the parent plan. **Re-audit done:
   `docs/design/odds-build-phases-2026-09-24.md` is the build order (P0–P13)
   and holds 14 findings.** The headline findings:
   - the scraper stalled at 17:38 UTC on 09-24 and the watchdog cannot see
     it;
   - the scraper makes ~7M changes a day against a DB at 65% of 8 GB, so the
     storage decision (P4) must come before the bridge;
   - the writers stamp write time with one time per price;
   - game-line tables have no period and no alternate lines;
   - live bug: game-line history misses line moves.

   Next is P0, then P1 + P2, each on the operator's go.
   **Resume prompt for the whole workstream: `docs/design/odds-rebuild/HANDOFF-PROMPT.md`.**
   Read `docs/design/odds-rebuild/HANDOFF-OM.md` first. It covers how to view
   and regenerate the mockups and the four review rounds so far. Round 4
   (v4) is done:
   - no receipt pills anywhere;
   - "Sharp prices" as a normal header with a live dot;
   - the live layer (a replay of the real last hour, flashes, trails, pulls,
     heartbeat);
   - v3 verified at both widths.

   It waits on the operator's review, plus the §8 answers. Plan:
   `docs/design/odds-section-rebuild-gameplan-2026-09-24.md` (§8 =
   decisions + revision log, Revision 4 = the live rules). **Nothing in
   Track O is built until the operator approves (D16).**

> **VS Code session?** Read `docs/VSCODE-HANDOFF.md` first — it is the
> running record of the VS Code (Copilot) session's changes and current
> state, and it points back here for the full plan.

---

## Read, in this order

1. **`docs/design/unattended-run-2026-09-21.md`**: the run order (§2), the
   operator's standing answers (§1, including **Render deploys authorised**
   for this run), the six corrections to the plans (§3), and what to do when
   blocked (§4).
2. `docs/design/card-redesign-gameplan-2026-09-21.md`: WHAT each Track C
   phase builds. The visual target is
   `docs/design/card-redesign-2026-09-21.html`; serve it with the
   `design-mockups` preview on :8125. The mockup wins on looks; the plan wins
   on where the data comes from.
3. `docs/design/movers-and-spotlights-gameplan.md`: WHAT the Spotlight phases
   build (the eight new ideas N1–N8, where each one renders, sources per
   sport). Movers MV0–MV4 is done (`1bad903`).

## Where the work is

| # | phase | status |
|---|---|---|
| 1 | C7 delete the live line tracker (the role keys stay six: the tracker was never one) | **done** |
| 2 | C0 Electric Turf + `-ink` tokens, ESPN team colours, kit pieces | **done** |
| 3 | C1 charcoal section bands (Movers included) — revised by C1b | **done** |
| 3b | C1b transparent section headers, charcoal side line (replaces the charcoal band) | **done** |
| 4 | PY-A shared Python: C5 grading + 3 new Specials + park table + spotlight `kind` (**deploy**) | **done** |
| 5 | C2 player hero | **done** |
| 5b | C2b team hero, same rework as the player hero | **done** |
| 6 | PY-B spotlight rankings: NFL, CFB, NHL, soccer, MLB (**deploy**) — NBA deferred (no Python games loader) | **done** |
| 7 | C3 player search rail | **done** |
| 8 | C4 Slate imagery (Movers included) | **done** |
| 9 | C6 props controls (tabs → filters, Home Runs deleted) | **done** — tabs → status/watchlist, HR deleted, Position, Showing line, filter surfaces on the kit, <640 filters sheet (`5c41440`, `b3f7d5c`, `fc8e69f`) |
| 10 | F0-UI research-page flags + Slate spotlight cards | **done** — `/api/slate/flags`, `ResearchFlags` (chips on the player page, card on team/game), the Python spotlights on the Slate, N5 weather (`400802d`) |
| 11 | C5-UI receipts table + new Specials (needs a real graded slate) | **built, awaiting graded slate** — receipts card, percentile cells, read line, sticky player column (`815b94e`). Sign off after NFL Sunday 2026-09-27 + one MLB day graded by PY-A's code |
| 12 | DJ-GOLF tournament → course backfill (**deploy**) | **done** — 235/235 events have a course (was 4), 82 courses, `golfCoursesJob` now a no-op (`f3b6817`) |
| 13 | DJ-TEN TML-Database ingest, licence check first (**deploy**) | **done** — ATP only; `tennis_match_stats`, 10,833 rows, busiest 80 players covered (`7e9e119`) |
| 14 | SP-GOLF, SP-TEN | **done** — 4 of 6: tennis Form (both tours), Serve vs return + Surface record (ATP), golf Course history. Round movers + Scoring by par type not built, Q27 (`f6c4cd6`) |
| 15 | C8 close Track C | **done** — guards, CLAUDE.md, mockup historical (`4f49150`) |
| 16 | SPC close Spotlights | **done** — guards + docs; receipts deliberately NOT built, Q26 (`4f49150`) |

Update this table and the run doc's §2 after every phase commit, then push.

## Deploys

| when | commit | service | what it enables |
|---|---|---|---|
| 2026-09-23 18:53 UTC | `f4a8373` (odds-model Phase 0) | line-buddy-odds-worker (`dep-daq1vkjncjis7397r6rg`, live) | `golfEloJob` (hourly) and `maintainMlbStatcastAggJob` (6-hourly), both confirmed running live at 21:44 UTC. Nine dead model files deleted. The `corpusFreshness` fix (checks all 6 corpus tables, was 2) lives in the health-check cron, which auto-deploys on push. Its Render deploy has not been checked yet. Was on `4f49150`. |
| 2026-09-21 21:31 UTC | `5e6568d` (PY-A) | line-buddy-odds-worker (`dep-daoq3i6k1f9s738ael6g`, live) | hit rules + leader rows + stat lines + `_read`; longest HR, longest reception, NHL two goals; wind out + temperature from the park table; `kind` and team ids on every row. Was on `c5baee4`. |
| 2026-09-23 16:11 UTC | `4f49150` (C8+SPC) | line-buddy-odds-worker (`live`) | Golfer names from ESPN's per-athlete endpoint (cached a month); read templates for the tennis and golf factors, with no pronouns in any of them. Was on `f6c4cd6`. |
| 2026-09-23 15:23 UTC | `f6c4cd6` (SP-TEN + SP-GOLF) | line-buddy-odds-worker (`live`) | Four new spotlights: tennis Form (both tours), Serve vs return and Surface record (ATP), golf Course history. `RankingDef.freezes` so a week-long golf slate is not frozen on day one. Was on `7e9e119`. |
| 2026-09-23 14:48 UTC | `7e9e119` (DJ-TEN) | line-buddy-odds-worker (`live`) | `tennisStatsJob`, daily: TML-Database serve and return numbers into the new `tennis_match_stats` (migration 20260923000000, applied by hand first). ATP only. Was on `f3b6817`. |
| 2026-09-23 03:04 UTC | `f3b6817` (DJ-GOLF) | line-buddy-odds-worker (`dep-dapk2ik9v7es738t1qng`, live) | `golfCoursesJob`, six-hourly: fills `golf_tournaments.course_name` for events that have none. The 235-event backlog was cleared locally before the deploy, so the job runs as a no-op from here. Was on `5f9a7df`. |
| 2026-09-22 02:26 UTC | `5f9a7df` (PY-B) | line-buddy-odds-worker (`dep-daoudr5g1s2s738njlcg`, live) | 32 spotlight rankings (`kind='spotlight'`, never graded) across NFL/CFB/NHL/soccer/MLB: the sport-specific cards and the eight N ideas (N1/N2/N3/N6/N7/N8, N4 MLB). Was on `5e6568d`. |

## Decisions that bind this run

- **Electric Turf**: good `#00d26a` / bad `#ff4d4f` / warn `#ffb020`. Text
  always uses the `-ink` shade. It recolours the frozen Scan table
  (approved); Scan's layout and the length pins stay.
- **Green never marks structure.** Headers are transparent with a 3px
  charcoal (`#1d1f23`) line on the left and a hairline divider beneath —
  C1b (2026-09-21) replaces C1's charcoal band with its 2px `#6e727a` top line.
- **Stats never render as chips or buttons**: a labelled value + percentile.
- **Specials are forecasts** graded next morning, never leaderboards.
- **Weather** only from `python-odds-service/src/predict/weather.py`
  (Open-Meteo). **Park orientation ships on cited sources with wind
  direction on**, plus a queue row listing five parks for the operator to
  check after the fact.
- **Tennis** data from TML-Database, after a licence check.
- **Blocked? Skip ahead, come back** (run doc §4).

## Still open from before

- `docs/design/SIGNOFF-QUEUE.md` Q0–Q20: operator sign-off. Q15 and
  `/diagnostics` need a signed-in session.
- M4 (promotion tests) and M5 (prop baselines, needs approval).
- **PY-B deferrals (A6):** NBA's spotlights (pace-up, usage bumps, shot-zone
  matchups + its N1/N2/N6/N7/N8) wait on a Python `'nba'` games loader —
  `load_sport_games` has no NBA entry and the season has no games yet. N5
  (weather) shipped with F0-UI.
- **Only MLB has ever written spotlight rows** (measured 2026-09-22: 3
  rankings, 33 rows). PY-B deployed at 02:26 UTC on 09-22, after Sunday's NFL
  slate, so NFL/CFB/NHL/soccer rankings appear on their next slate — NFL
  Thursday 09-24, CFB Saturday 09-26. F0-UI renders whatever exists, so there
  is nothing to do but look on those days.

## Findings worth knowing

- **C0: `@utility text-good` does NOT override Tailwind's theme-generated
  `.text-good`**; Tailwind kept its own rule. The frozen Scan files get the
  ink shade from a plain UNLAYERED `.text-good{}` rule in `globals.css`
  (unlayered beats `@layer utilities`). Verified in the browser:
  Scan's `text-warn` went `rgb(183,121,31)` → `rgb(154,98,0)`.
- **C0: team colours.** `bandColors()` falls back to charcoal only for true
  blacks and too-light golds (LV, NO, PIT, Pirates, White Sox). A relative
  saturation test keeps dark hues (GB green, SD brown). The oklch
  `gradientCardStyle` ramp in `heat.ts` already sits on Electric Turf's three
  hues and was left alone.

- **`DataTable.tone` is a RESULT chip ("W 6–3"), not a colour.** Use `ink`
  for good/bad-by-definition values, and `heat` for a rank.
- **Scan's cell components stay frozen** (`StatCells`, `OddsChip`). C6
  unfreezes only the filter-bar files.
- **C2: hero tile ranks come from `player_season_production`**, the
  position-grouped rollup the peer picker reads (`/api/player-pool`), NOT
  the plan's "34th of 142 RB" (`subject.rankDetail`), which is an NFL-only
  composite that exists only when a market does. `playerPool.ts` ranks each
  tile with its OWN `of()` on the pool's season totals and refuses a rank
  (no rank, no bar) when the tile reads a key the rollup lacks (MLB RBI, HBP,
  innings; NBA minutes), is not a sum (counts, maxima), reads no stat
  (games), or is a lower-is-better TOTAL (fewest walks = pitched least). The
  floor is 30% of the pool's 95th-percentile games: MLB's pitcher pool holds
  position players who pitched once with 142 games each. C2b's team tiles
  should rank against the team pool `teamResearchSpec` already uses.
- **C2: `DisclosureBar` is a kit piece** (the hero's summary bar), because U7
  closed the raw-`<button>` list. C2b reuses it.
- **PY-A: per-HR distance was already stored.** `mlb_statcast_player_season`
  payload `hrList[]` carries `distance` (5,019 of 5,027 in 2026), so the
  planned `hit_distance_sc` column and backfill were skipped. The rollup
  rebuilds daily; longest-HR grading waits until it has run past noon UTC the
  day after the slate.
- **PY-A: the ESPN->GSIS map is not in `athlete_crosswalk`** (zero NFL rows
  bridge to nflverse). `nfl_pbp.espn_to_gsis` reads nflverse `players.csv`,
  the same file TypeScript's `getEspnToGsisMap` does, cached 24h.
- **PY-A: migration `20260921120000` was applied by hand before the deploy.**
  It is additive (defaulted `kind`, nullable ids), so the old worker kept
  writing through it.
- **C1: a HIDDEN Browser pane never fires `requestAnimationFrame`**, and
  React 19's streaming reveal (`$RC` -> `$RB` -> rAF -> `$RV`) waits on it, so
  every Suspense page (player, team) sits in `<div hidden id="S:0">` with
  zero-width bands. It is not a page bug. Verify in the Playwright browser, or
  call `$RV($RB)` from the console to inspect.
- **C1: band bleed is per column.** Each `<main>` declares `--lb-gutter`; a
  two-column layout (team list + detail) resets it to 0 on the detail column
  at `lg`, so the band stays inside its column instead of touching the list.
- **A worn browser tab stalls effects** and React Aria's exit animations.
  Render in a fresh tab.
- **The Playwright browser can be locked by another session.** Fall back to
  the built-in browser pane with `tabs_create` for a fresh tab.
- **The mockup's stat lines are illustrative.** Don't sign off C5 on
  placeholder data.
- **F0: a spotlight's SUBJECT is not always a player.** `mlb-hr-parks` ranks
  GAMES — its `subject_id` IS the `game_id` and its name is "AZ @ COL" — so
  `ResearchFlag.subjectKind` says which, the card's first column is headed
  "Game" rather than "Player", and a game row gets no face and no team badge.
  Anything new reading these rows must not assume an athlete id.
- **F0: `lib/slate/flags.ts` holds no query on purpose.** Its shapes reach the
  BROWSER through `spotlights.ts` and `ResearchFlags.tsx`, and `pgClient` pulls
  `pg` in with them, which breaks the build. The read lives in `flagsRead.ts`
  — the same split `specialsFormat.ts` already keeps. `tests/slate-flags.test.ts`
  pins it.
- **F0: the flags route caches the whole sport-day and slices in `transform`.**
  One cache entry serves the Slate and every player, team and game page; keying
  per athlete id would mint hundreds.
- **C5: a `cachedRoute` serves the SHAPE it cached.** `snapshot_cache` survives
  deploys, so for one TTL after a payload's shape changes the page is handed the
  OLD shape. Adding `receipts.slates` took the whole Slate down with "Cannot
  read properties of undefined" — `tsc` says the field is there and the cached
  bytes disagree. **Read a new array off a cached payload defensively**, and
  render before believing.
- **A read line never guesses a person's gender.** A live WTA card read "Katie
  Volynets ... has won 70% of HIS last ten". The `READS` templates in
  `slate_rankings.py` now take no pronoun at all.
- **DJ-TEN: Jeff Sackmann's `tennis_atp`/`tennis_wta` repos are GONE** — the
  canonical open tennis datasets, and what the gameplan names. TML-Database
  continues the ATP half; nothing continues WTA, so WTA has no serve line and
  the job says so in its own output rather than implying coverage.
- **DJ-TEN: match on ESPN's own names, not through `athlete_crosswalk`.** That
  table holds 401 of 715 ATP players and is missing Auger-Aliassime, Davidovich
  Fokina and Mpetshi Perricard; going through it capped coverage at 47%.
- **SP-TEN: nothing held knows what surface is played THIS week.** ESPN's
  tennis feed carries none, and `game_result`'s comes from an operator-run
  load that was 25 days stale. The card reads the most recent completed tour
  week and says "the current swing", which is what it measures.
- **SP-GOLF: a golf slate is a WEEK, not a day**, so the generic freeze would
  blank a card for six days of seven. `RankingDef.freezes` is the opt-out, and
  golf is the only user.
- **Tennis is GRANULAR in `slate_rankings.sport`** (`tennis_atp`/`tennis_wta`),
  like soccer. `flagScope` folded it to 'tennis' and every tennis page showed
  no flags; `rankingSport()` describes the Specials, which tennis has none of.
- **DJ-GOLF: the Ryder Cup is not a stroke-play event and its feed says so.**
  Event 401734110's `competitions` is a list of LISTS (the pairings) where
  every other golf event's is a list of one dict. `.get` on it threw and killed
  the first full backfill 46 events in. Anything reading ESPN golf per event
  must tolerate it; a team event has no field size to report.
- **DJ-GOLF: ESPN answers an unknown `&event=` with a 200 and TODAY's
  tournament**, not an error. The id returned is checked against the id asked
  for, or a dead id writes today's course onto a 2022 event.
- **C5: a ranking can have a leader row and NO graded players.** Measured on
  `nfl-longest-reception` 2026-09-21: `grade()` skips a row whose team's game
  has not landed in `player_game_history`, so the slate's real leader was
  written and all 11 ranked players were left ungraded. Watch this on 09-27 —
  if it repeats, NFL receipts will never fill and it is a Python fix, not a UI
  one.
- **Bash heredocs eat backslashes, quotes and `\n`** in this environment.
  Write scripts and regex-bearing tests with the Write/Edit tools.
- The browser can't load `file://`. Use the `design-mockups` preview.

## Standing constraints

- Render deploys: **authorised for this run's Python phases** (run doc §1
  A1). Record each one above. `git push` itself does not deploy.
- Never `git add -A` or `git add docs/`: `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on :3000 serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. `/kit` is dev-only: `linesmith-dev-verify` on :3001.
- The Postgres pooler caps at 15 connections. Check for long-running
  fits/scripts first.
- At ~92% context, stop and hand off by rewriting this file.
