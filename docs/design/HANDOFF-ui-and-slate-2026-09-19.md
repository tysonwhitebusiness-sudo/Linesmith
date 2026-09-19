# Handoff — UI system overhaul + Slate Sheet (2026-09-19)

Paste everything below the line into a fresh session on any account.

---

I'm picking up two design threads from a session that ran out of usage on
2026-09-19. Read these first, **before doing anything**:

1. `CLAUDE.md`
2. `docs/CURRENT.md` (the tracks section at the top)
3. `docs/design/ui-system-master-prompt.md`, in full. It is the locked spec
   for thread 1.
4. This file, in full.

Nothing in either thread is built. Thread 1 is fully decided. Thread 2 is a
gameplan awaiting the operator's answers (§2g).

## 1. Thread 1: UI system overhaul (the U track). Decided; not started

- **Spec:** `docs/design/ui-system-master-prompt.md`, phases U0–U7.
- **In short:**
  - Untitled UI React's free MIT set, copied into `components/ui/` and rewritten
    to our tokens: Button, form controls, Select/ComboBox, Modal, SlideoutMenu,
    Dropdown, Pagination.
  - Tables become the **"Hybrid"**: our plain-`<table>` DataTable engine with
    Untitled UI's chrome. Rows are 36px, 28px compact, with a count badge in
    the header, sort and help icons, group rows, totals rows and paging.
  - Our Tooltip, Card, charts, Chip semantics and Avatar are kept.
- **Operator decisions, all 2026-09-19:**
  - "lets do hybrid"; every other recommendation accepted.
  - **Scan and the sport landing pages are OUT of the U track** ("no scan and
    landing pages shouldnt be included"). The doc's §0b lists the excluded
    pages and components, and the guard tests skip them through
    `OUT_OF_SCOPE`.
- **Next action:**
  - U0 (Tailwind 3.4 → 4, the token bridge, `react-aria-components`,
    `tailwind-merge`, the dev-only `/kit` page).
  - Start it only after R10–R12c are signed off, and never while another
    session is editing UI files (the doc's §10).
  - Ask the operator before starting.
- **Visual reference (operator only):**
  - The canvas https://claude.ai/artifact/UrwNspzj4nfUFSKXjUaz3D, with pages
    "Component audit" and "Tables".
  - It is private to the operator's account; other accounts may not open it.
    The spec doc is self-contained.
  - The canvas generator scripts lived in a temp scratchpad and are gone. They
    aren't needed.

## 2. Thread 2: the Slate Sheet. Gameplan; awaiting the operator

The operator wants the Scan page (a player table, with games behind a
Players/Games toggle, `components/AppShell.tsx:224`) to become a **Slate
Sheet**: a sectioned page of cards and tables covering the day's slate.

**Games are a section, never a toggle.**

The operator liked this section list; expand it, don't re-propose it:

**Games · Movers · Props board · Spotlights · Specials · Model card · Your lines**

### 2a. How it's built (architecture)

- **A new page, not a redesign of Scan.** It is **built on the U-track kit
  after U2** (the Hybrid DataTable). This doesn't conflict with Scan being out
  of the U track: old Scan is untouched until the Slate Sheet replaces it,
  then deleted in the same phase (subtract, don't coexist).
- **One shared `SlatePage.tsx`,** with one adapter per sport
  (`lib/sports/{sport}/adapters/slateAdapter.ts` → `toSlateData`). This is
  CLAUDE.md's sport-adapter rule: cards are data drawn by shared renderers,
  with no `sport === 'x'` in the page. Reuse `ResearchCard` kinds (table,
  series and so on) where they fit.
- **The route:** `/{sport}` (the current landing pages). It replaces
  AppShell's slate/Scan body; AppShell's chrome stays.
- **API:** `GET /api/slate?sport=&date=` through `cachedRoute()`. Grep the
  cache key first.
  - TTLs by section: games 60s; odds and props 2–5 min; rankings and
    spotlights once per slate.
- **Python writes, TypeScript renders.** The rankings (§2c-5) and spotlight
  scores are computed by a Python job into their own table, e.g.
  `slate_rankings`, with a `docs/table-ownership.md` row. TS only reads it.
  Model math never lives in TS.
- **Layout:**
  - Header: sport switcher, date strip, and a slate summary line: "14 games ·
    first pitch 1:05 PM · lines from 19 books · updated 2 min ago".
  - A sticky `SectionNav`.
  - Phones: sections stack and tables scroll inside their cards.
- **Framing:** a slate page is about lines, unlike the research pages. But
  every card must stay honest:
  - movement, price gaps and rankings are **not** edges;
  - only MLB and golf have fitted models;
  - the other sports measured NO: no "best bets" for them.

### 2b. Data facts measured this session (2026-09-19)

- ⚠️ **Football and soccer props stopped on 2026-09-15 at 20:13 UTC.** No
  passing, rushing or receiving yards, anytime-goalscorer or shots rows in
  `prop_odds` since then. `anytime-td` has only 84 rows ever (last 2026-09-12).
  A football slate would be empty. **Investigate first:** see
  `docs/odds-sources-2026-09-02.md` §4 (a missing env var once killed
  NFL/CFB/NBA the same way) and `health_check.py` / `job_health_checks`.
- **MLB props are healthy:** in the last 48h, 16 markets across 39 games.
  Total bases had 20 books; hits and home runs 19; RBI and runs 17; pitcher
  strikeouts 17. Tennis has only `to-win-a-set`, `games-won` and `aces`.
- **No provider carries sportsbook specials or boosts** (longest HR of the
  day, pick-3 anytime TD, profit boosts). Not in any feed, not even among the
  markets we drop. They are promotions on the books' own sites. Scraping book
  sites or aggregators is ruled out: geo-fencing, bot protection and the
  books' terms, and the one scraper we had (OddsHarvester) is already dead.
- **Soccer side markets arrive and are dropped** (`odds_unresolved`, kind
  `market`, provider `propline_2`): correct score 1,626 rows, goal or assist
  1,362, both teams to score 276, double chance 177, player shots 168, total
  corners 108, draw no bet 84; plus cards markets from `parlayapi_soccer`.
  Mapping them gives soccer a side-markets board almost for free.
- **Tables the cards can use** (checked in `information_schema`):

  | area | tables |
  |---|---|
  | game lines | `game_odds_book_lines` (per-book current), `game_odds_history` (every observation: open → now) |
  | props | `prop_odds` (current), `prop_odds_history` (observations), `prop_odds_archive` |
  | history | `player_game_history` (per-game `stats` json, every sport), `player_history_summary` (per market: `baseline_over` / `baseline_total` / `board_line`), `player_season_production` (`team_share`, position group), `team_game_production` (by position group) |
  | MLB | `mlb_pitch_events` (launch speed and angle, **no hit distance**), `mlb_statcast_player_season` (payload; the "Home runs" research table reads HR distance from it; **verify**), `mlb_statcast_game_pregame`, `park_factors`, `team_hr_rate_allowed`, `mlb_game_model_cache` |
  | other sports | `nfl_target_events` (air yards, TD), `team_target_profile`, `nba_shot_events`, `nhl_shot_events`, `team_shot_profile`, `venue_factors` |
  | models | `prop_model_cache` (`model_prob`, `projection`), `pick_history`, `game_picks`, `golf_model_predictions`, `golf_tournament_predictions`, `model_calibration` |
  | context | `injury_report` (captured per day), `game_result`, `team_elo_history` |
  | user | `tracked_lines`, `watchlist`, `picks`, `bets` (these stay TS-written) |

- **Not held** (from the research plan's R-deferred table):
  - weather and wind;
  - park orientation;
  - confirmed lineups (MLB) and confirmed NHL goalies;
  - red-zone usage and snap share (NFL);
  - NBA on/off;
  - soccer probable lineups.
- **The last query was interrupted.** It asked which `prop_model_cache`
  dimensions are fresh per sport, `injury_report` freshness per sport, and
  `pick_history` per sport. Rerun it before promising model columns outside
  MLB.

### 2c. The cards, in depth

**1. Games** (always first; one card per game)
- Grid: 3-up at 1440, 2-up at 1024, 1-up on phones. Sorted by start time.
  Status chips filter it: Upcoming / Live / Final.
- **Each game card:**
  - Teams: logos, records, and home/away.
  - Start time, or the live score and state, or the final.
  - MLB: the probable starters with ERA / K% (as the game page's "Probable
    starters").
  - **Lines:** best moneyline, spread and total with the book's logo, the
    consensus (median) and the book count.
  - A move arrow since open (`game_odds_history`).
  - **Model (MLB only):** win probability and projected total from
    `mlb_game_model_cache`, labeled as the model.
  - **Context chips:**
    - park factor (MLB, `park_factors`), e.g. "Coors +18% runs";
    - "pace-up" (NBA, derived);
    - an injuries count (`injury_report`) that links to the game page's
      injury table.
  - Footer links: "Game page →" and "N props →", which filters the Props board
    to this game.
- Weather is **not held**: show nothing rather than a guess. Adding a free
  weather API later is a separate item.

**2. Movers** (Hybrid DataTable)
- Tabs: **Game lines | Props.** Window chips: Since open · Last 3h · Last 1h.
- **Columns:**
  - subject: team or player, with face or logo;
  - market;
  - open → now for both the line and the price;
  - **move size in implied-probability points**, the sort key;
  - books moved / books quoting;
  - first-move time;
  - a price sparkline (from the `_history` tables).
- **Flags:**
  - **Steam**: 3+ books moved the same direction within 30 min.
  - **Line vs price split**: the line moved one way, the price the other.
- A caption says movement is market information, not an edge.

**3. Props board** (replaces the Scan table)
- **Summary cards on top:**
  - **Price outliers**: one book ≥ N implied-prob points off the median of
    the others on the same prop and line. Shows the book, its price, the
    median and the gap.
  - **Line disagreements**: books split on the line itself (0.5 at one, 1.5
    at the rest).
  - Both say "price gap, not a model edge".
- **Main table** (Hybrid, paged minimal). Market tabs come from the sport's
  live markets.
- **Columns:**
  - player: face, team, opponent, time;
  - the consensus main line;
  - best over and best under, each with its book;
  - books;
  - **L10 hit rate at this line**;
  - Last 5 streak strip;
  - season average and average vs this opponent;
  - flags for outliers and disagreements;
  - **MLB only:** model probability and edge (`prop_model_cache`).
- Filters: game, team, market, minimum books, minimum hit rate.
- **Row expand:**
  - the last 10 games as bars against today's line (the player page's prop
    block, reused);
  - the full book ladder, every book's over and under.
- **Soccer:** a side-markets tab for the dropped markets (§2b), once they're
  mapped in `entity_resolution.py`. Add them to both alias maps;
  `tests/config-drift.test.ts` checks the two stay the same.

**4. Spotlights** (research rankings, 5–10 rows each; every factor shown as a
column, a "why" line, and a link to the player page)
- **Every sport:**
  - **Hit-rate leaders**: best L10 over-rate at today's line; minimum sample
    shown.
  - **Active streaks**: 5+ straight overs or unders against today's line.
- **MLB:**
  - **Platoon spots**: batter vs today's starter's hand, from the statcast
    `hands` split.
  - **Pitcher K spots**: K% and whiff % by pitch type against the opponent's
    K% vs that hand.
  - **HR-friendly parks today**: `park_factors` × `team_hr_rate_allowed`.
- **NFL/CFB:**
  - target-share leaders against weak pass defenses (`team_target_profile`);
  - rushers against the worst run defenses by position group
    (`team_game_production`).
- **NBA** (October):
  - pace-up games;
  - **usage bumps** when a starter is out (`injury_report` +
    `player_season_production.team_share`).
- **NHL:** shot volume against the most-shots-allowed defenses
  (`team_shot_profile`).
- **Soccer:** shots and xG leaders against weak defenses. xG is stored per
  player page only; check before promising it.
- **Tennis:** serve against return mismatches (aces and serve points won).
- **Golf:** course fit and strokes-gained trend.

**5. Specials: odds-free rankings for the books' common promos**

The operator's direction: rank players by player and circumstances, **without
odds**. Each ranking is a table:
- rank, then player (face, team, opponent), then **every factor as a
  column**, then a composite score and a one-line "why";
- a caption: "a ranking of the factors, not a probability";
- the weights are documented and computed in Python;
- **receipts**: yesterday's top 5 and what happened (we hold the results), to
  build trust.

Pre-register a backtest before tuning the weights (the project habit; see
`docs/CURRENT.md`).

| sport | ranking (the book promo it serves) | factors (all held unless marked) |
|---|---|---|
| MLB | **Longest HR of the day** | season average and max HR distance (statcast payload `hrList`; verify), max exit velocity and launch profile (`mlb_pitch_events`), barrel %, park distance factor / altitude (`park_factors`), starter's HR allowed, handedness. Wind **not held** |
| MLB | **HR of the day / first HR** | HR per PA, starter's HR/9 and `team_hr_rate_allowed`, park, platoon split. Lineup spot **not held** |
| MLB | **Most strikeouts on the slate** (pitchers) | K%, average outs, opponent K% vs that hand, `prop_model_cache` K projection |
| MLB | Most hits / total bases | L10 and season rates, platoon, park |
| NFL/CFB | **Pick-3 anytime TD** | TD per game and share of team TDs (`player_game_history`); team implied points (spread + total when odds flow, else team scoring average); opponent TDs allowed to the position group (`team_game_production`). Red-zone role **not held** |
| NFL/CFB | Longest reception / TD | deep-target share and air yards (`nfl_target_events`), longest-reception history |
| NFL/CFB | First TD scorer | team first-score rate × the player's share of team TDs |
| NBA (Oct) | Most points / most 3s / triple-double watch | usage (`team_share`), minutes, pace, opponent defense, injury-driven usage |
| NHL | Goal scorer, most shots | shots per game (`nhl_shot_events`), shooting %, opponent shots allowed. Starting goalie **not held** |
| soccer | Anytime / first goalscorer | xG and shots per 90, opponent goals allowed. Penalty taker and lineup **not held** |
| tennis | Most aces of the day | ace rate, opponent return strength, surface |
| golf | Round leader / low round | strokes gained, round scoring average, course history (`golf_*` tables) |

An **optional later** card, "Today's specials at the books": an admin-entered
list (book, title, rules, expiry, link; no odds), each linked to its matching
ranking. It needs a small table and an authenticated POST. The operator hasn't
asked for it; offer it only.

**6. Model card** (**MLB and golf only**; the section is hidden elsewhere,
never faked)
- Today's model picks (`game_picks` / `pick_history` for MLB,
  `golf_model_predictions` for golf): pick, model probability, price, edge,
  and a calibration note (`model_calibration`).
- Yesterday's graded results.
- The 7- and 30-day record.
- This replaces `TodaysPicksModal`, which is deleted when this section ships.

**7. Your lines** (signed in only; hidden otherwise)
- Tracked lines, watchlist, slip legs and bets on today's slate. Each shows its
  live status (`useLiveGame`), the best price now against the price when it
  was tracked (CLV), and a link to the bet page.

### 2d. Suggested phases (S track; confirm with the operator)

| phase | what |
|---|---|
| S0 | Premise audit. Fix or route the football/soccer props outage. Rerun the interrupted query (§2b). Check HR distance is in the statcast payload |
| S1 | `SlatePage` shell, `/api/slate`, header, SectionNav, **Games** section (MLB first) |
| S2 | **Props board** (Scan's table moves here) + **Movers** |
| S3 | **Spotlights** |
| S4 | **Specials rankings**: a Python job into its own table, a pre-registered backtest, receipts |
| S5 | **Model card** + **Your lines** |
| S6 | Other sports' adapters. Delete old Scan: AppShell's slate body, `ScanTable`, `ScanCard`, `FilterBar`, `FilterSidebar`, `PlayerFilterDrawer`, `DateGameStrip`, `GameLinesView`, `GameLine`, `TodaysPicksModal`, `useFilters`, as each is replaced |

Dependencies:
- S1 needs U2 (the Hybrid DataTable) at least.
- If the operator wants the Slate Sheet before the U track reaches U2, ask
  whether to build S1 on today's kit and restyle it later.

### 2e. Rules carried over

- The research plan's §2: build, `tsc`, render at 1440 and 400 in a **fresh
  tab**, commit by explicit paths, stop for sign-off, subtract in the same
  phase.
- **Before DB work:** the pooler caps at 15 connections. Check for running
  fits and harvester cycles.
- **Ask before any Render deploy.** A new Python job needs one.

### 2f. What NOT to do

- Don't redesign old Scan in place; replace it.
- Don't show "edges" or "best bets" for sports without a fitted model.
- Don't scrape sportsbook sites for promos.
- Don't put ranking math in TypeScript.

### 2g. Operator answers (2026-09-19, second session)

1. Rollout: **all sports, in phases** (not MLB-only first).
2. **Keep** Scan's full player table as the Props board's main table.
3. The §2c-5 Specials rankings are the **pilot set**; add more later if needed.
   (The admin-entered "specials at the books" list is not wanted for now.)
4. **Wait for U2** before building the Slate Sheet.
5. Props outage, **diagnosed**: not game-day cadence. ESPN's scoreboard
   started rejecting `?dates=A-B` ranges (HTTP 400) around 2026-09-15 20:13
   UTC. `_fetch_espn_scoreboard` (Python) and `fetchScoreboard` (TS) return
   `[]` on a non-200, so NFL/CFB/EPL/MLS saw 0 games → "cold tier" → no paid
   props. The archival bridge's closes and results for those sports stopped too
   (last `odds_archive` rows 09-15/16, last `game_result` rows 09-13/15).
   Single dates still work. Fix awaiting the operator's go-ahead.

Next: specify each sport's exact cards from measured data (no guesswork).

### 2g-old. Open questions for the operator (answered above)

1. **Rollout:** MLB first (deepest props, a real model), or every sport
   together? Recommended: MLB first.
2. Keep Scan's full player table as the Props board's main table (the
   recommendation), or rely only on the curated cards?
3. The optional admin-entered "specials at the books" list: wanted?
4. **Order against the U track:** build the Slate Sheet after U2 (the
   recommendation), or sooner on today's kit?
5. The football/soccer props outage: fix now, before anything else?

## 3. State of the repo at handoff

- **New:**
  - `docs/design/ui-system-master-prompt.md` (thread 1's spec);
  - this file.
- **Edited:** `docs/CURRENT.md`, which points to both threads.
- Committed by explicit path at handoff; see `git log`. No code changed.
- Memory: `project_ui_system_overhaul.md` records thread 1's decisions and
  the Scan exclusion.
